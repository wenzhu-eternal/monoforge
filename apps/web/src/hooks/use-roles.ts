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
