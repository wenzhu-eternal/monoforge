import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import * as argon2 from 'argon2'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { roles, users } from '@/db/schema'

// 默认角色: admin 全部权限，editor 编辑权限，viewer 只读
const DEFAULT_ROLES = [
  { name: 'admin', description: '系统管理员，拥有全部权限' },
  { name: 'editor', description: '编辑者，可管理业务数据' },
  { name: 'viewer', description: '访客，仅可查看' },
]

export interface SetupStatus {
  initialized: boolean
  userCount: number
  roleCount: number
}

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name)

  async getStatus(): Promise<SetupStatus> {
    const [userCountResult, roleCountResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(notDeleted(users.deletedAt)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(roles)
        .where(notDeleted(roles.deletedAt)),
    ])

    const userCount = userCountResult[0]?.count ?? 0
    const roleCount = roleCountResult[0]?.count ?? 0

    // 已初始化判定: 存在任意用户即视为已初始化（避免重复创建 admin）
    return {
      initialized: userCount > 0,
      userCount,
      roleCount,
    }
  }

  async initialize(input: {
    username: string
    email: string
    password: string
    nickname?: string
  }): Promise<{ message: string; adminUsername: string }> {
    const status = await this.getStatus()
    if (status.initialized) {
      throw new ConflictException('系统已初始化，无法重复执行')
    }

    const hashedPassword = await argon2.hash(input.password)

    try {
      await db.transaction(async (tx) => {
        // 创建默认角色（若已存在则跳过）
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

        // 创建 admin 用户并关联 admin 角色
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
      // 唯一约束冲突（并发初始化）
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        throw new ConflictException('用户名或邮箱已存在')
      }
      throw error
    }
  }
}
