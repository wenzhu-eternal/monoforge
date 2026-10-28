import type {
  ApiResponse,
  CreateRole,
  PaginatedResponse,
  PaginationQuery,
  Role,
  UpdateRole,
} from '@shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCan } from '@/hooks/use-auth'
import { api } from '@/lib/api'
import { PermissionCodes } from '@/lib/permissions'

export const useRoles = (params: PaginationQuery) => {
  return useQuery({
    queryKey: ['roles', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<Role>>>('/api/v1/roles', {
        params,
      })
      return response.data.data!
    },
    // L20：翻页时保留上一页数据，避免表格闪空
    placeholderData: keepPreviousData,
  })
}

/**
 * L15：角色下拉全量加载（逐页拉取，不受单页 100 上限截断；角色数少，staleTime 60s 降请求）
 */
export const useAllRoles = () => {
  // M5：无 role:view 不发请求——GET /roles 要求 ROLE_VIEW，403 被拦截器整页踢 /403，
  // "仅持 user:*" 是权限细分的合法组合，不能让辅助下拉陪葬整个 users 页
  const can = useCan()
  return useQuery({
    queryKey: ['roles', 'all'],
    queryFn: async () => {
      const all: Role[] = []
      let page = 1
      for (;;) {
        const response = await api.get<ApiResponse<PaginatedResponse<Role>>>('/api/v1/roles', {
          params: { page, pageSize: 100 },
        })
        const data = response.data.data!
        all.push(...data.list)
        if (all.length >= data.total || data.list.length === 0) break
        page += 1
      }
      return all
    },
    enabled: can(PermissionCodes.ROLE_VIEW),
    staleTime: 60_000,
  })
}

export const useRole = (id: number) => {
  return useQuery({
    queryKey: ['roles', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Role>>(`/api/v1/roles/${id}`)
      return response.data.data!
    },
    enabled: !!id,
  })
}

export const useCreateRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateRole) => {
      const response = await api.post<ApiResponse<Role>>('/api/v1/roles', data)
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}

export const useUpdateRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateRole }) => {
      const response = await api.patch<ApiResponse<Role>>(`/api/v1/roles/${id}`, data)
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      // L19：改角色名后 users 列表 30s 内仍旧名（staleTime），同步失效
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useDeleteRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/v1/roles/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}

export const useRestoreRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<ApiResponse<Role>>(`/api/v1/roles/${id}/restore`)
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}
