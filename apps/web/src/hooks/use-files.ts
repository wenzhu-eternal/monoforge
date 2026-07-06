import type { ApiResponse, PaginatedResponse } from '@shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface FileItem {
  id: number
  filename: string
  originalName: string
  mimeType: string
  size: number
  uploadedBy: number | null
  uploadedByUsername: string | null
  createdAt: string
}

export interface FileQuery {
  page: number
  pageSize: number
}

export interface UploadResult {
  id: number
  filename: string
  originalName: string
  mimeType: string
  size: number
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

/**
 * 预览文件: 通过 axios 带 token 下载 blob，生成 object URL
 */
export async function previewFile(id: number): Promise<string> {
  const response = await api.get(`/api/v1/files/${id}/preview`, {
    responseType: 'blob',
  })
  return URL.createObjectURL(response.data)
}

/**
 * 下载文件: 通过 axios 带 token 下载 blob，触发浏览器下载
 */
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
  URL.revokeObjectURL(url)
}
