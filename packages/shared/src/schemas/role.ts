import { z } from 'zod'

export const RoleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(50),
  description: z.string().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const RoleBriefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(50),
  description: z.string().nullable().optional(),
})

/**
 * L24：strictObject——配权只能走 PUT /role-permissions/role/:roleId。
 * 原普通 object 会把调用方顺带传的 permissionIds 静默 strip，建/改角色 200 假成功但零关联，
 * 这里改为 400 明示"多余字段不被接受"，避免 RESTful 直觉写入静默失配
 */
export const CreateRoleSchema = z.strictObject({
  name: z.string().min(1).max(50),
  // L19：DB description 可空，开放显式置空
  description: z.string().nullable().optional(),
})

export const UpdateRoleSchema = z.strictObject({
  name: z.string().min(1).max(50).optional(),
  // L19：同 Create，开放显式置空
  description: z.string().nullable().optional(),
})

export type Role = z.infer<typeof RoleSchema>
export type RoleBrief = z.infer<typeof RoleBriefSchema>
export type CreateRole = z.infer<typeof CreateRoleSchema>
export type UpdateRole = z.infer<typeof UpdateRoleSchema>
