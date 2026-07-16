import { z } from 'zod'

export const PermissionSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  routes: z.array(z.string()).nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
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

export const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)).min(0),
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
export type UpdateRolePermissions = z.infer<typeof UpdateRolePermissionsSchema>
export type RolePermission = z.infer<typeof RolePermissionSchema>
