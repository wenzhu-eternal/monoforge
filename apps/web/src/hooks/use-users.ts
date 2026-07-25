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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
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
    },
  })
}
