import type { ApiResponse, FileItem, PaginatedResponse, UploadResult } from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type { FileItem, UploadResult }

export interface FileQuery {
  page: number
  pageSize: number
}

export const useFiles = (params: FileQuery) => {
  return useQuery({
    queryKey: ['files', params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PaginatedResponse<FileItem>>>('/api/v1/files', {
        params,
      })
      return response.data.data!
    },
  })
}

export const useUploadFile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post<ApiResponse<UploadResult>>('/api/v1/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
    },
  })
}

export const useDeleteFile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/v1/files/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
    },
  })
}

export async function previewFile(id: number): Promise<string> {
  const response = await api.get(`/api/v1/files/${id}/preview`, {
    responseType: 'blob',
  })
  return URL.createObjectURL(response.data)
}

export async function downloadFile(id: number, filename: string): Promise<void> {
  const response = await api.get(`/api/v1/files/${id}/download`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(response.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟清理，避免 Safari/移动端下载未完成就被 revoke 导致 0 字节
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
