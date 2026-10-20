import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_USER_ROLE_PERMISSIONS,
} from '@shared/constants/default-seed'
import argon2 from 'argon2'
import { config } from 'dotenv'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { getEnv } from '../config/env'
import { notDeleted } from './helpers'
import { db } from './index'
import { permissions, rolePermissions, roles, users } from './schema'

// L17③：与 db/index.ts 一致，按当前 cwd 解析 ../../.env（apps/server 下运行即仓库根）
config({ path: '../../.env' })

// admin 默认密码（首次登录后请立即修改）。新项目可通过环境变量 SEED_ADMIN_PASSWORD 覆盖
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '888888'
// 首登强制改密：默认沿用默认密码 888888 时强制（安全默认），自定义密码则不强制。
// 本地开发想跳过改密流程可显式设 SEED_ADMIN_MUST_CHANGE_PASSWORD=false；生产不应关闭
const mustChangePassword =
  process.env.SEED_ADMIN_MUST_CHANGE_PASSWORD === 'false'
    ? false
    : process.env.SEED_ADMIN_MUST_CHANGE_PASSWORD === 'true'
      ? true
      : ADMIN_PASSWORD === '888888'

async function seed() {
  console.log('Seeding database...')

  // L16：全流程单事务——中途失败整体回滚不留半态；密码哈希在事务外算好，
  // 避免占着连接做 CPU 密集运算
  const passwordHash = await argon2.hash(ADMIN_PASSWORD)

  await db.transaction(async (tx) => {
    // M11：与 setup 共用 @shared 的 DEFAULT_PERMISSIONS，两条初始化路径权限集单一来源
    // 创建默认权限（已存在则跳过，匹配部分唯一索引 permissions_code_unique）
    await tx.insert(permissions).values(DEFAULT_PERMISSIONS).onConflictDoNothing()
    console.log(`Default permissions seeded (${DEFAULT_PERMISSIONS.length} items)`)

    // L2：与 setup 同款——软删 'admin'/'user' 不命中部分唯一索引，插入会新建 serial
    // 续号角色（admin id 漂移后 isAdminUser 恒 false）。无同名活跃行时复活原行复用
    // 原 id，随后的插入即被索引拦下
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

    const [adminRole] = await tx
      .insert(roles)
      .values(DEFAULT_ROLES[0]!)
      .onConflictDoNothing()
      .returning()

    // L16：查找兜底必须过滤软删——复用软删角色会绑上"幽灵角色"（innerJoin 匹配不到，权限静默失效）
    const role =
      adminRole ??
      (await tx.query.roles.findFirst({
        where: and(eq(roles.name, 'admin'), notDeleted(roles.deletedAt)),
      }))

    if (!role) {
      throw new Error('Failed to create or find admin role')
    }

    // L2：admin id 必须与 ADMIN_ROLE_ID 一致，否则超管判定恒失败——显式失败指路
    if (role.id !== getEnv().ADMIN_ROLE_ID) {
      throw new Error(
        `admin 角色 id ${role.id} 与 ADMIN_ROLE_ID ${getEnv().ADMIN_ROLE_ID} 不一致，请核对 roles 表`,
      )
    }

    console.log('Admin role ready:', role)

    // 创建普通用户角色（通过注册进来的用户）
    const [userRole] = await tx
      .insert(roles)
      .values(DEFAULT_ROLES[1]!)
      .onConflictDoNothing()
      .returning()

    const userRoleRecord =
      userRole ??
      (await tx.query.roles.findFirst({
        where: and(eq(roles.name, 'user'), notDeleted(roles.deletedAt)),
      }))

    if (userRoleRecord && userRoleRecord.id !== getEnv().DEFAULT_USER_ROLE_ID) {
      throw new Error(
        `user 角色 id ${userRoleRecord.id} 与 DEFAULT_USER_ROLE_ID ${getEnv().DEFAULT_USER_ROLE_ID} 不一致，请核对 roles 表`,
      )
    }

    if (userRoleRecord && DEFAULT_USER_ROLE_PERMISSIONS.length > 0) {
      // M3：user 角色默认零权限（原先 mail:send 构成 SMTP 开放中继）；空集跳过 insert（drizzle 不接受空 values）
      await tx
        .insert(rolePermissions)
        .values(
          DEFAULT_USER_ROLE_PERMISSIONS.map((permission) => ({
            roleId: userRoleRecord.id,
            permission,
          })),
        )
        .onConflictDoNothing()
      console.log('User role permissions assigned')
    }

    console.log('User role ready:', userRole ?? 'already exists')

    // 为 admin 角色分配所有权限（使用权限码字符串）
    await tx
      .insert(rolePermissions)
      .values(DEFAULT_PERMISSIONS.map((perm) => ({ roleId: role.id, permission: perm.code })))
      .onConflictDoNothing()
    console.log('Admin permissions assigned')

    // M11/L17②：已初始化检测按"是否存在 admin 角色用户"——原按任意未软删用户判断，
    // 公开注册环境先有普通用户则 admin 永不补建；同时 setup 初始化的管理员（admin 角色）
    // 仍能拦住 seed，避免默认密码 888888 静默重置已设置的管理员密码
    const [existingAdmins] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.roleId, role.id)))

    if ((existingAdmins?.count ?? 0) > 0) {
      console.log('Admin user exists, skip admin user creation (permissions/roles backfilled only)')
      return
    }

    // admin 邮箱/昵称可通过环境变量覆盖，默认使用通用占位符（新项目接入时无需改源码）
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com'
    const adminNickname = process.env.SEED_ADMIN_NICKNAME ?? 'Administrator'

    // admin 已存在时同步密码与改密标志：否则改了 SEED_ADMIN_PASSWORD /
    // SEED_ADMIN_MUST_CHANGE_PASSWORD 后重跑 seed 不生效（onConflictDoNothing 会静默跳过）
    const [adminUser] = await tx
      .insert(users)
      .values({
        username: 'admin',
        email: adminEmail,
        password: passwordHash,
        nickname: adminNickname,
        roleId: role.id,
        status: true,
        mustChangePassword,
      })
      .onConflictDoUpdate({
        target: users.username,
        // users_username_unique 是部分唯一索引（WHERE deleted_at IS NULL），
        // 必须带同款 targetWhere 才能被 PG 推断为冲突目标
        targetWhere: sql`deleted_at IS NULL`,
        set: { password: passwordHash, mustChangePassword, updatedAt: new Date() },
      })
      .returning()

    console.log('Created admin user:', adminUser)
  })

  console.log('Database seeded successfully!')
}

seed()
  .then(() => {
    process.exit(0)
  })
  .catch((error: Error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
