import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'
import type { SetupResult, SetupStatus } from '@shared/schemas/setup'
import * as argon2 from 'argon2'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { isUniqueViolation, notDeleted } from '@/db/helpers'
import { roles, users } from '@/db/schema'

const DEFAULT_ROLES = [
  { name: 'admin', description: '系统管理员，拥有全部权限' },
  { name: 'editor', description: '编辑者，可管理业务数据' },
  { name: 'viewer', description: '访客，仅可查看' },
]

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name)

  async getStatus(): Promise<SetupStatus> {
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
    const status = await this.getStatus()
    if (status.initialized) {
      throw new ConflictException(ErrorMessages[ErrorCodes.SETUP_ALREADY_INITIALIZED])
    }

    const hashedPassword = await argon2.hash(input.password)

    try {
      await db.transaction(async (tx) => {
        // 事务级锁：随事务提交/回滚自动释放，避免 session-level 锁泄露到连接池
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1234567890)`)

        const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(users)
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

        await tx.insert(users).values({
          username: input.username,
          email: input.email,
          password: hashedPassword,
          nickname: input.nickname,
          roleId: adminRole.id,
          status: true,
        })
      })

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
