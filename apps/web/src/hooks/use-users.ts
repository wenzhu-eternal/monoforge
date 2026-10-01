import type {
  ApiResponse,
  CreateUser,
  PaginatedResponse,
  PaginationQuery,
  UpdateUser,
  User,
} from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const useUsers = (params: PaginationQuery) => {
  return useQuery({
    queryKey: ['users', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<User>>>('/api/v1/users', {
        params,
      })
      return response.data.data!
    },
  })
}

export const useUser = (id: number) => {
  return useQuery({
    queryKey: ['users', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<User>>(`/api/v1/users/${id}`)
      return response.data.data!
    },
    enabled: !!id,
  })
}

export const useCreateUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateUser) => {
      const response = await api.post<ApiResponse<User>>('/api/v1/users', data)
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      // L25：用户增删恢复同步刷新仪表盘计数（staleTime 60s，不失效则最长展示 60s 旧数据）
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
    },
  })
}

export const useUpdateUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateUser }) => {
      const response = await api.patch<ApiResponse<User>>(`/api/v1/users/${id}`, data)
      return response.data.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      // M13：改了用户角色时刷新 auth.me，否则 30s 内菜单/守卫仍按旧权限放行
      if (variables.data.roleId !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      }
    },
  })
}

export const useDeleteUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/v1/users/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
    },
  })
}

export const useRestoreUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<ApiResponse<User>>(`/api/v1/users/${id}/restore`)
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
    },
  })
}
