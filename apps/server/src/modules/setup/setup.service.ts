import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_USER_ROLE_PERMISSIONS,
} from '@shared/constants/default-seed'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { SetupResult, SetupStatus } from '@shared/schemas/setup'
import * as argon2 from 'argon2'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import { permissions, rolePermissions, roles, users } from '@/db/schema'

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name)

  // M3：本进程成功初始化过的内存标记——初始化完成后 /setup 立即失效（DB 查询之外的
  // 二道闸），/setup/status 恒返回 true，未初始化窗口不再被轮询持续探测；
  // 全量软删后的重新初始化需重启进程（配合 ALLOW_SETUP 显式开启），刻意从严
  private setupCompleted = false

  async getStatus(): Promise<SetupStatus> {
    if (this.setupCompleted) {
      return { initialized: true }
    }

    const [userCountResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(notDeleted(users.deletedAt))

    // 已初始化判定: 存在任意用户即视为已初始化（避免重复创建 admin）
    // 不返回计数，避免 /status 公开接口泄露用户/角色规模
    return { initialized: (userCountResult?.count ?? 0) > 0 }
  }

  async initialize(input: {
    username: string
    email: string
    password: string
    nickname?: string
  }): Promise<SetupResult> {
    // M3：本进程已初始化过 → 直接拒（不查库），配合下方事务双保险
    if (this.setupCompleted) {
      throw new ConflictException(ErrorMessages[ErrorCodes.SETUP_ALREADY_INITIALIZED])
    }

    const status = await this.getStatus()
    if (status.initialized) {
      throw new ConflictException(ErrorMessages[ErrorCodes.SETUP_ALREADY_INITIALIZED])
    }

    const hashedPassword = await argon2.hash(input.password)

    try {
      await db.transaction(async (tx) => {
        // 事务级锁：随事务提交/回滚自动释放，避免 session-level 锁泄露到连接池
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1234567890)`)

        // 与 getStatus 同口径: 仅统计未软删用户（全部用户被软删时允许重新初始化）
        const [existing] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(notDeleted(users.deletedAt))
        if (!existing || existing.count > 0) {
          throw new ConflictException(ErrorMessages[ErrorCodes.SETUP_ALREADY_INITIALIZED])
        }

        const createdRoles = await tx
          .insert(roles)
          .values(DEFAULT_ROLES)
          .onConflictDoNothing()
          .returning()

        const adminRole =
          createdRoles.find((r) => r.name === 'admin') ??
          (await tx.query.roles.findFirst({
            where: and(eq(roles.name, 'admin'), notDeleted(roles.deletedAt)),
          }))

        if (!adminRole) {
          throw new BadRequestException('默认角色创建失败')
        }

        // M11：与 seed 同源灌入 22 条默认权限并给 admin 绑全量（原 setup 不灌权限不绑定，
        // 走 ALLOW_SETUP 初始化的部署 permissions 表为空、角色授权功能完全空转）
        await tx.insert(permissions).values(DEFAULT_PERMISSIONS).onConflictDoNothing()
        await tx
          .insert(rolePermissions)
          .values(DEFAULT_PERMISSIONS.map((p) => ({ roleId: adminRole.id, permission: p.code })))
          .onConflictDoNothing()

        // M3：user 角色默认零权限（原先 mail:send 构成 SMTP 开放中继），空集跳过 insert（drizzle 不接受空 values）
        const userRole =
          createdRoles.find((r) => r.name === 'user') ??
          (await tx.query.roles.findFirst({
            where: and(eq(roles.name, 'user'), notDeleted(roles.deletedAt)),
          }))
        if (userRole && DEFAULT_USER_ROLE_PERMISSIONS.length > 0) {
          await tx
            .insert(rolePermissions)
            .values(
              DEFAULT_USER_ROLE_PERMISSIONS.map((permission) => ({
                roleId: userRole.id,
                permission,
              })),
            )
            .onConflictDoNothing()
        }

        await tx.insert(users).values({
          username: input.username,
          email: input.email,
          password: hashedPassword,
          nickname: input.nickname,
          roleId: adminRole.id,
          status: true,
          // L17：与 seed 路径对齐——首登强制改密（setup 密码虽为部署者自选，仍可能弱口令或被分享）
          mustChangePassword: true,
        })
      })

      this.setupCompleted = true
      this.logger.log(`系统初始化完成，管理员: ${input.username}`)
      return { message: '初始化成功', adminUsername: input.username }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('用户名或邮箱已存在')
      }
      throw error
    }
  }
}
