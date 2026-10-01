import { DEFAULT_PERMISSIONS, DEFAULT_USER_ROLE_PERMISSIONS } from '@shared/constants/default-seed'
import argon2 from 'argon2'
import { config } from 'dotenv'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { notDeleted } from './helpers'
import { db } from './index'
import { permissions, rolePermissions, roles, users } from './schema'

// 显式加载根目录 .env，与 db/index.ts 保持一致，避免从 cwd 加载到错误文件
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

    const [adminRole] = await tx
      .insert(roles)
      .values({
        name: 'admin',
        description: '系统管理员，拥有全部权限',
      })
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

    console.log('Admin role ready:', role)

    // 创建普通用户角色（通过注册进来的用户）
    const [userRole] = await tx
      .insert(roles)
      .values({
        name: 'user',
        description: '普通用户，通过注册进入系统',
      })
      .onConflictDoNothing()
      .returning()

    const userRoleRecord =
      userRole ??
      (await tx.query.roles.findFirst({
        where: and(eq(roles.name, 'user'), notDeleted(roles.deletedAt)),
      }))

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

    // M11：已初始化检测（存在未软删用户，与 setup.getStatus 同口径）——
    // setup 初始化过的库补跑 seed 只幂等补齐权限/角色/绑定，不再创建/覆盖 admin 用户，
    // 否则 onConflictDoUpdate 会用默认密码 888888 静默重置已设置的管理员密码
    const [existingUsers] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(isNull(users.deletedAt))

    if ((existingUsers?.count ?? 0) > 0) {
      console.log('Users exist, skip admin user creation (permissions/roles backfilled only)')
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
