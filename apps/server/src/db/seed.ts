import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from './index'
import { errorWhitelist, permissions, rolePermissions, roles, users } from './schema'

// argon2 hash for password "admin123"
const ADMIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$Bg27npZWqewGK3lVzGxg3Q$FLi41Lj2tS0ZVMmFmiQqxIwqmDmvQAeMa0MRuDrXGkk'

// 默认权限列表
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
    code: 'audit:view',
    name: '查看审计日志',
    description: '查看审计日志',
    routes: ['GET /audit-logs/', 'GET /audit-logs/:id'],
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

  // 创建 admin 角色
  const [adminRole] = await db
    .insert(roles)
    .values({
      name: 'admin',
      description: 'System administrator with full access',
    })
    .onConflictDoNothing()
    .returning()

  const role = adminRole ?? (await db.query.roles.findFirst({ where: eq(roles.name, 'admin') }))

  if (!role) {
    throw new Error('Failed to create or find admin role')
  }

  console.log('Admin role ready:', role)

  // 为 admin 角色分配所有权限（使用权限码字符串）
  for (const perm of defaultPermissions) {
    await db
      .insert(rolePermissions)
      .values({ roleId: role.id, permission: perm.code })
      .onConflictDoNothing()
  }
  console.log('Admin permissions assigned')

  // 创建默认管理员用户
  const [adminUser] = await db
    .insert(users)
    .values({
      username: 'admin',
      email: 'admin@example.com',
      password: ADMIN_PASSWORD_HASH,
      nickname: 'Administrator',
      roleId: role.id,
      status: true,
    })
    .onConflictDoNothing()
    .returning()

  console.log('Created admin user:', adminUser)

  // 创建初始错误白名单
  const whitelistEntries = await db
    .insert(errorWhitelist)
    .values([
      {
        pattern: 'ECONNREFUSED',
        description: 'Database connection refused - ignore during startup',
        isActive: true,
      },
      {
        pattern: 'ETIMEDOUT',
        description: 'Connection timeout - temporary network issues',
        isActive: true,
      },
      {
        pattern: 'healthcheck',
        description: 'Health check endpoint errors',
        isActive: false,
      },
    ])
    .onConflictDoNothing()
    .returning()

  console.log('Error whitelist entries:', whitelistEntries.length ? 'created' : 'already exist')

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
