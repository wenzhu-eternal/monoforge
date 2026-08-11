import argon2 from 'argon2'
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { db } from './index'
import { permissions, rolePermissions, roles, users } from './schema'

// 显式加载根目录 .env，与 db/index.ts 保持一致，避免从 cwd 加载到错误文件
config({ path: '../../.env' })

// admin 默认密码（首次登录后请立即修改）。新项目可通过环境变量 SEED_ADMIN_PASSWORD 覆盖
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '888888'
// 使用默认密码 888888 时首登强制改密，自定义密码则不强制（建议生产设 SEED_ADMIN_PASSWORD）
const mustChangePassword = ADMIN_PASSWORD === '888888'

const defaultPermissions = [
  {
    code: 'user:view',
    name: '查看用户',
    description: '查看用户列表和详情',
    routes: ['GET /users/', 'GET /users/:id'],
  },
  { code: 'user:create', name: '创建用户', description: '创建新用户', routes: ['POST /users/'] },
  {
    code: 'user:update',
    name: '更新用户',
    description: '编辑用户信息',
    routes: ['PATCH /users/:id'],
  },
  {
    code: 'user:delete',
    name: '删除用户',
    description: '删除用户',
    routes: ['DELETE /users/:id'],
  },
  {
    code: 'role:view',
    name: '查看角色',
    description: '查看角色列表和详情',
    routes: ['GET /roles/', 'GET /roles/:id'],
  },
  { code: 'role:create', name: '创建角色', description: '创建新角色', routes: ['POST /roles/'] },
  {
    code: 'role:update',
    name: '更新角色',
    description: '编辑角色信息',
    routes: ['PATCH /roles/:id'],
  },
  {
    code: 'role:delete',
    name: '删除角色',
    description: '删除角色',
    routes: ['DELETE /roles/:id'],
  },
  {
    code: 'permission:view',
    name: '查看权限',
    description: '查看权限列表',
    routes: ['GET /permissions/', 'GET /permissions/list', 'GET /permissions/:id'],
  },
  {
    code: 'permission:create',
    name: '创建权限',
    description: '创建新权限',
    routes: ['POST /permissions/'],
  },
  {
    code: 'permission:update',
    name: '更新权限',
    description: '编辑权限信息',
    routes: ['PATCH /permissions/:id'],
  },
  {
    code: 'permission:delete',
    name: '删除权限',
    description: '删除权限',
    routes: ['DELETE /permissions/:id'],
  },
  { code: 'file:view', name: '查看文件', description: '查看文件列表', routes: ['GET /files/'] },
  {
    code: 'file:upload',
    name: '上传文件',
    description: '上传新文件',
    routes: ['POST /files/upload'],
  },
  {
    code: 'file:delete',
    name: '删除文件',
    description: '删除文件',
    routes: ['DELETE /files/:id'],
  },
  {
    code: 'audit:view',
    name: '查看审计日志',
    description: '查看审计日志',
    routes: ['GET /audit-logs/', 'GET /audit-logs/:id'],
  },
  {
    code: 'mail:send',
    name: '发送邮件',
    description: '发送欢迎邮件和验证码',
    routes: ['POST /mail/welcome', 'POST /mail/verification-code'],
  },
  {
    code: 'schedule:backup',
    name: '触发备份',
    description: '手动触发数据库备份',
    routes: ['POST /schedule/backup'],
  },
  {
    code: 'error_log:view',
    name: '查看错误日志',
    description: '查看错误日志',
    routes: [
      'GET /error-logs/',
      'GET /error-logs/:id',
      'GET /error-logs/stats',
      'GET /error-logs/whitelist',
    ],
  },
  {
    code: 'error_log:manage',
    name: '管理错误日志',
    description: '处理和管理错误日志',
    routes: [
      'GET /error-logs/',
      'GET /error-logs/:id',
      'GET /error-logs/stats',
      'GET /error-logs/whitelist',
      'POST /error-logs/report',
      'POST /error-logs/:id/resolve',
      'DELETE /error-logs/:id',
      'POST /error-logs/whitelist',
      'PATCH /error-logs/whitelist/:id',
      'DELETE /error-logs/whitelist/:id',
    ],
  },
]

async function seed() {
  console.log('Seeding database...')

  // 创建默认权限（已存在则跳过，匹配部分唯一索引 permissions_code_active_uniq）
  for (const perm of defaultPermissions) {
    await db.insert(permissions).values(perm).onConflictDoNothing()
  }
  console.log('Default permissions seeded')

  const [adminRole] = await db
    .insert(roles)
    .values({
      name: 'admin',
      description: '系统管理员，拥有全部权限',
    })
    .onConflictDoNothing()
    .returning()

  const role = adminRole ?? (await db.query.roles.findFirst({ where: eq(roles.name, 'admin') }))

  if (!role) {
    throw new Error('Failed to create or find admin role')
  }

  console.log('Admin role ready:', role)

  // 创建普通用户角色（通过注册进来的用户）
  const [userRole] = await db
    .insert(roles)
    .values({
      name: 'user',
      description: '普通用户，通过注册进入系统',
    })
    .onConflictDoNothing()
    .returning()

  const userRoleRecord =
    userRole ?? (await db.query.roles.findFirst({ where: eq(roles.name, 'user') }))

  if (userRoleRecord) {
    // 普通用户：仅邮件发送（user:view 会泄露全员 email/phone 等敏感字段，注册用户不应具备）
    await db
      .insert(rolePermissions)
      .values([{ roleId: userRoleRecord.id, permission: 'mail:send' }])
      .onConflictDoNothing()
    console.log('User role permissions assigned')
  }

  console.log('User role ready:', userRole ?? 'already exists')

  // 为 admin 角色分配所有权限（使用权限码字符串）
  for (const perm of defaultPermissions) {
    await db
      .insert(rolePermissions)
      .values({ roleId: role.id, permission: perm.code })
      .onConflictDoNothing()
  }
  console.log('Admin permissions assigned')

  // admin 邮箱/昵称可通过环境变量覆盖，默认使用通用占位符（新项目接入时无需改源码）
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com'
  const adminNickname = process.env.SEED_ADMIN_NICKNAME ?? 'Administrator'
  const passwordHash = await argon2.hash(ADMIN_PASSWORD)

  const [adminUser] = await db
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
    .onConflictDoNothing()
    .returning()

  console.log('Created admin user:', adminUser)

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
