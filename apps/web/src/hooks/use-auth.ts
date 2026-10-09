import type { ApiResponse, AuthResponse, ChangePassword, Login, User } from '@shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { clearUserScopedState } from '@/lib/auth-cleanup'
import { useAuthStore } from '@/store/auth-store'

export const useLogin = () => {
  const { login } = useAuthStore()

  return useMutation({
    mutationFn: async (data: Login) => {
      const response = await api.post<ApiResponse<AuthResponse>>('/api/v1/auth/login', data)
      return response.data.data!
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken)
    },
  })
}

export const useLogout = () => {
  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/api/v1/auth/logout')
      } catch {
        // 即使后端调用失败也继续前端登出
      }
    },
    onSuccess: () => {
      clearUserScopedState()
    },
  })
}

export const useCurrentUser = () => {
  const { token, setUser } = useAuthStore()

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<User>>('/api/v1/auth/me')
      return response.data.data!
    },
    enabled: !!token,
    // M11：瞬时网络抖动重试 2 次；401/403 不重试（拦截器已跳转，勿浪费请求）
    retry: (count, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status === 401 || status === 403) return false
      return count < 2
    },
  })

  useEffect(() => {
    if (query.data) setUser(query.data)
  }, [query.data, setUser])

  return query
}

/**
 * M13：按钮级权限判定——读新鲜 me（布局层已预热同 key 缓存，react-query 按 key 去重），
 * store 仅兜底。未加载完成/无该权限一律 false（默认拒绝），与后端 PermissionsGuard 同码，
 * 避免无权限用户点按钮才被 403 打回
 */
export const useCan = () => {
  const { data: meUser } = useCurrentUser()
  const storeUser = useAuthStore((state) => state.user)
  const user = meUser ?? storeUser
  return (code: string) => user?.permissions?.includes(code) ?? false
}

export const useChangePassword = () => {
  return useMutation({
    mutationFn: async (data: ChangePassword) => {
      const response = await api.post<ApiResponse<{ message: string }>>(
        '/api/v1/users/me/password',
        data,
      )
      return response.data.data!
    },
  })
}
