import type {
  ApiResponse,
  CreateUser,
  PaginatedResponse,
  PaginationQuery,
  UpdateUser,
  User,
} from '@shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

export const useUsers = (params: PaginationQuery) => {
  return useQuery({
    queryKey: ['users', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<User>>>('/api/v1/users', {
        params,
      })
      return response.data.data!
    },
    // L20：翻页/筛选时保留上一页数据，避免 data 瞬时 undefined 导致表格闪空
    placeholderData: keepPreviousData,
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
      // L17：写操作后审计页 30s 内仍走缓存，看不到刚产生的记录
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
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
      // L25：改的是自己（如昵称）时同样失效 me，否则 Header 最长 30s 仍显示旧昵称
      const editingSelf = useAuthStore.getState().user?.id === variables.id
      if (variables.data.roleId !== undefined || editingSelf) {
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      }
      // L14：启停 Switch 直接改 status，仪表盘计数需同步失效（同 create/delete/restore 口径）
      if (variables.data.status !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
      }
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
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
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
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
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  })
}
