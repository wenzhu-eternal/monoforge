import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_USER_ROLE_PERMISSIONS,
} from '@shared/constants/default-seed'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { SetupResult, SetupStatus } from '@shared/schemas/setup'
import * as argon2 from 'argon2'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getEnv } from '@/config/env'
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

        // L2：全量软删后重初始化——roles 部分唯一索引（WHERE deleted_at IS NULL）令
        // onConflictDoNothing 不命中，会新建 serial 续号角色；admin 新 id≠ADMIN_ROLE_ID 时
        // isAdminUser 恒 false，超管闸/includeDeleted 视图/路由编辑全 403 静默降级。
        // 无同名活跃行时复活软删原行复用原 id，随后的插入即被索引拦下（幂等）
        for (const roleName of ['admin', 'user']) {
          const active = await tx.query.roles.findFirst({
            where: and(eq(roles.name, roleName), notDeleted(roles.deletedAt)),
          })
          if (active) continue
          const stale = await tx.query.roles.findFirst({
            where: and(eq(roles.name, roleName), isNotNull(roles.deletedAt)),
            orderBy: (t, ops) => ops.asc(t.id),
          })
          if (stale) {
            await tx.update(roles).set({ deletedAt: null }).where(eq(roles.id, stale.id))
          }
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

        // L2：解析出的 admin id 必须与配置一致——否则超管判定恒 false，
        // 显式失败优于管理面静默降级（复活原行仍漂移时指引人工核对）
        if (adminRole.id !== getEnv().ADMIN_ROLE_ID) {
          throw new BadRequestException(
            `admin 角色 id ${adminRole.id} 与 ADMIN_ROLE_ID ${getEnv().ADMIN_ROLE_ID} 不一致，请核对 roles 表`,
          )
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
        if (!userRole) {
          throw new BadRequestException('默认用户角色创建失败')
        }
        if (userRole.id !== getEnv().DEFAULT_USER_ROLE_ID) {
          throw new BadRequestException(
            `user 角色 id ${userRole.id} 与 DEFAULT_USER_ROLE_ID ${getEnv().DEFAULT_USER_ROLE_ID} 不一致，请核对 roles 表`,
          )
        }
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
