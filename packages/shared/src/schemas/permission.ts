import { z } from 'zod'

export const PermissionSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  routes: z.array(z.string()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const CreatePermissionSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  routes: z.array(z.string()).optional(),
})

export const UpdatePermissionSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  routes: z.array(z.string()).optional(),
})

// 更新角色权限
export const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)).min(0),
})

export type Permission = z.infer<typeof PermissionSchema>
export type CreatePermission = z.infer<typeof CreatePermissionSchema>
export type UpdatePermission = z.infer<typeof UpdatePermissionSchema>
export type UpdateRolePermissions = z.infer<typeof UpdateRolePermissionsSchema>
