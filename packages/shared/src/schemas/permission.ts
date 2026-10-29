import { z } from 'zod'

export const PermissionSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  routes: z.array(z.string()).nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

// L16：写侧统一 strictObject（同 role.ts）——多传字段显式 400，不得静默 strip 造成 200 假成功
export const CreatePermissionSchema = z.strictObject({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  // L19：DB description 可空，开放显式置空
  description: z.string().nullable().optional(),
  // L14：routes 元素格式"方法 + 空格 + /路径"并限长，数组限 50 条
  routes: z
    .array(
      z
        .string()
        .regex(/^(GET|POST|PATCH|PUT|DELETE) \//, '格式必须为"方法 /路径"')
        .max(100),
    )
    .max(50)
    .optional(),
})

export const UpdatePermissionSchema = z.strictObject({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  // L19：同 Create，开放显式置空
  description: z.string().nullable().optional(),
  routes: z
    .array(
      z
        .string()
        .regex(/^(GET|POST|PATCH|PUT|DELETE) \//, '格式必须为"方法 /路径"')
        .max(100),
    )
    .max(50)
    .optional(),
})

export const UpdateRolePermissionsSchema = z.strictObject({
  // L2：数组上限防超大 inArray 打穿 PG 65535 绑定参数上限（整单 500 且白耗 DB 往返 + 两条审计写）；
  // 元素限长 50 对齐 permissions.code varchar(50)
  permissions: z.array(z.string().min(1).max(50)).min(0).max(50),
})

export const RolePermissionSchema = z.object({
  roleId: z.number().int().positive(),
  permission: z.string(),
  permissionName: z.string().nullable().optional(),
  roleName: z.string().optional(),
})

export type Permission = z.infer<typeof PermissionSchema>
export type CreatePermission = z.infer<typeof CreatePermissionSchema>
export type UpdatePermission = z.infer<typeof UpdatePermissionSchema>
export type RolePermission = z.infer<typeof RolePermissionSchema>
