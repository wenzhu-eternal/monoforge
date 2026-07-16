import type {
  ApiResponse,
  AuditLog,
  CreateErrorWhitelist,
  ErrorLog,
  ErrorLogGroup,
  ErrorStats,
  ErrorWhitelist,
  PaginatedResponse,
  Role,
  UpdateErrorWhitelist,
} from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type { AuditLog, ErrorLog, ErrorLogGroup, ErrorWhitelist }

// 日志查询参数（不使用 shared 的 PaginationQuery，避免 order 必填约束）
export interface LogQuery {
  page: number
  pageSize: number
  keyword?: string
}

export const useAuditLogs = (params: LogQuery) => {
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<AuditLog>>>(
        '/api/v1/audit-logs',
        { params },
      )
      return response.data.data!
    },
  })
}

export interface ErrorLogQuery extends LogQuery {
  source?: string
  isResolved?: string
}

export const useErrorLogs = (params: ErrorLogQuery) => {
  return useQuery({
    queryKey: ['error-logs', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<ErrorLog>>>(
        '/api/v1/error-logs',
        { params },
      )
      return response.data.data!
    },
  })
}

export const useErrorStats = () => {
  return useQuery({
    queryKey: ['error-stats'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ErrorStats>>('/api/v1/error-logs/stats')
      return response.data.data!
    },
  })
}

export const useErrorLogsGrouped = (limit = 10) => {
  return useQuery({
    queryKey: ['error-logs-grouped', limit],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ErrorLogGroup[]>>('/api/v1/error-logs/grouped', {
        params: { limit },
      })
      return response.data.data!
    },
  })
}

export const useResolveErrorLog = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/api/v1/error-logs/${id}/resolve`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] })
      queryClient.invalidateQueries({ queryKey: ['error-stats'] })
      queryClient.invalidateQueries({ queryKey: ['error-logs-grouped'] })
    },
  })
}

export const useBatchResolveErrorLog = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ message, source }: { message: string; source: string }) => {
      const response = await api.post<ApiResponse<{ message: string; affected: number }>>(
        '/api/v1/error-logs/batch-resolve',
        { message, source },
      )
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] })
      queryClient.invalidateQueries({ queryKey: ['error-stats'] })
      queryClient.invalidateQueries({ queryKey: ['error-logs-grouped'] })
    },
  })
}

export const useDeleteErrorLog = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/v1/error-logs/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] })
    },
  })
}

export const useWhitelist = () => {
  return useQuery({
    queryKey: ['error-whitelist'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ErrorWhitelist[]>>('/api/v1/error-logs/whitelist')
      return response.data.data!
    },
  })
}

export const useCreateWhitelist = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CreateErrorWhitelist) => {
      const response = await api.post<ApiResponse<ErrorWhitelist>>(
        '/api/v1/error-logs/whitelist',
        data,
      )
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-whitelist'] })
    },
  })
}

export const useUpdateWhitelist = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateErrorWhitelist }) => {
      const response = await api.patch<ApiResponse<ErrorWhitelist>>(
        `/api/v1/error-logs/whitelist/${id}`,
        data,
      )
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-whitelist'] })
    },
  })
}

export const useDeleteWhitelist = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/v1/error-logs/whitelist/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-whitelist'] })
    },
  })
}

export const useRoles = (params: LogQuery) => {
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
