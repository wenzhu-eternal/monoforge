import type {
  ApiResponse,
  CreatePermission,
  PaginatedResponse,
  Permission,
  RolePermission,
  RouteMeta,
  UpdatePermission,
} from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCan } from '@/hooks/use-auth'
import { api } from '@/lib/api'
import { PermissionCodes } from '@/lib/permissions'

export type { RouteMeta }

interface UsePermissionsParams {
  page?: number
  pageSize?: number
}

export function usePermissions(params: UsePermissionsParams = {}) {
  const { page = 1, pageSize = 10 } = params
  return useQuery({
    queryKey: ['permissions', page, pageSize],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PaginatedResponse<Permission>>>('/api/v1/permissions', {
        params: { page, pageSize },
      })
      return res.data.data
    },
  })
}

export function useAllPermissions() {
  // M5：无 permission:view 不发请求——GET /permissions/list 403 会把整个 roles 页踢 /403，
  // "仅持 role:*" 是权限细分的合法组合，辅助查询不得陪葬整页
  const can = useCan()
  return useQuery({
    queryKey: ['permissions', 'all'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Permission[]>>('/api/v1/permissions/list')
      return res.data.data
    },
    enabled: can(PermissionCodes.PERMISSION_VIEW),
  })
}

export function useRoutes() {
  return useQuery({
    queryKey: ['routes'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RouteMeta[]>>('/api/v1/routes')
      return res.data.data
    },
  })
}

export function useCreatePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CreatePermission) => {
      const res = await api.post<ApiResponse<Permission>>('/api/v1/permissions', data)
      return res.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
    },
  })
}

export function useUpdatePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdatePermission }) => {
      const res = await api.patch<ApiResponse<Permission>>(`/api/v1/permissions/${id}`, data)
      return res.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
    },
  })
}

export function useDeletePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await api.delete<ApiResponse<{ message: string }>>(`/api/v1/permissions/${id}`)
      return res.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
    },
  })
}

export function useRestorePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await api.post<ApiResponse<Permission>>(`/api/v1/permissions/${id}/restore`)
      return res.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
    },
  })
}

export function useRolePermissions(roleId: number) {
  // M5：与 useAllPermissions 同口径，GET role/:roleId 同样要求 PERMISSION_VIEW
  const can = useCan()
  return useQuery({
    queryKey: ['role-permissions', roleId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<string[]>>(`/api/v1/role-permissions/role/${roleId}`)
      return res.data.data
    },
    enabled: roleId > 0 && can(PermissionCodes.PERMISSION_VIEW),
  })
}

// L21：一次性拉取全量角色权限关联，供 roles 列表行内聚合——避免每行一个 GET 的 N+1
export function useAllRolePermissions() {
  const can = useCan()
  return useQuery({
    queryKey: ['role-permissions', 'all'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RolePermission[]>>('/api/v1/role-permissions')
      return res.data.data
    },
    enabled: can(PermissionCodes.PERMISSION_VIEW),
  })
}

export function useUpdateRolePermissions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ roleId, permissions }: { roleId: number; permissions: string[] }) => {
      const res = await api.put<ApiResponse<{ message: string }>>(
        `/api/v1/role-permissions/role/${roleId}`,
        { permissions },
      )
      return res.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] })
      // M13：角色权限变化后当前用户菜单/守卫也可能变化，刷新 auth.me（30s stale 内否则继续放行旧权限）
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
