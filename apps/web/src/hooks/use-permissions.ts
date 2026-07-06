import type { ApiResponse, Permission } from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface PaginatedPermissions {
  list: Permission[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface UsePermissionsParams {
  page?: number
  pageSize?: number
}

export interface RouteMeta {
  path: string
  method: string
  controller: string
  handlerName: string
}

export function usePermissions(params: UsePermissionsParams = {}) {
  const { page = 1, pageSize = 10 } = params
  return useQuery({
    queryKey: ['permissions', page, pageSize],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PaginatedPermissions>>('/api/v1/permissions', {
        params: { page, pageSize },
      })
      return res.data.data
    },
  })
}

export function useAllPermissions() {
  return useQuery({
    queryKey: ['permissions', 'all'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Permission[]>>('/api/v1/permissions/list')
      return res.data.data
    },
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
    mutationFn: async (data: {
      code: string
      name: string
      description?: string
      routes?: string[]
    }) => {
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
    mutationFn: async ({
      id,
      data,
    }: {
      id: number
      data: { code?: string; name?: string; description?: string; routes?: string[] }
    }) => {
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

export function useRolePermissions(roleId: number) {
  return useQuery({
    queryKey: ['role-permissions', roleId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<string[]>>(`/api/v1/role-permissions/role/${roleId}`)
      return res.data.data
    },
    enabled: roleId > 0,
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
    },
  })
}
