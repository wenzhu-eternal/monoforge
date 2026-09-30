import type {
  ApiResponse,
  CreateRole,
  PaginatedResponse,
  PaginationQuery,
  Role,
  UpdateRole,
} from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const useRoles = (params: PaginationQuery) => {
  return useQuery({
    queryKey: ['roles', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<Role>>>('/api/v1/roles', {
        params,
      })
      return response.data.data!
    },
  })
}

/**
 * L15：角色下拉全量加载（逐页拉取，不受单页 100 上限截断；角色数少，staleTime 60s 降请求）
 */
export const useAllRoles = () => {
  return useQuery({
    queryKey: ['roles', 'all'],
    queryFn: async () => {
      const all: Role[] = []
      let page = 1
      for (;;) {
        const response = await api.get<ApiResponse<PaginatedResponse<Role>>>('/api/v1/roles', {
          params: { page, pageSize: 100, order: 'desc' },
        })
        const data = response.data.data!
        all.push(...data.list)
        if (all.length >= data.total || data.list.length === 0) break
        page += 1
      }
      return all
    },
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
