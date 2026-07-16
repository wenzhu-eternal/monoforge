import type { ApiResponse, AuthResponse, Login, User } from '@shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

export const useLogin = () => {
  const { login } = useAuthStore()

  return useMutation({
    mutationFn: async (data: Login) => {
      const response = await api.post<ApiResponse<AuthResponse>>('/api/v1/auth/login', data)
      return response.data.data!
    },
    onSuccess: (data) => {
      // refreshToken 已由后端写入 httpOnly cookie，前端只存 accessToken
      login(data.user, data.accessToken)
    },
  })
}

export const useLogout = () => {
  const { logout } = useAuthStore()

  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/api/v1/auth/logout')
      } catch {
        // 即使后端调用失败也继续前端登出
      }
    },
    onSuccess: () => {
      logout()
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
    retry: false,
  })

  useEffect(() => {
    if (query.data) setUser(query.data)
  }, [query.data, setUser])

  return query
}

export const useAuth = () => {
  const { user, token, isAuthenticated } = useAuthStore()
  const loginMutation = useLogin()
  const logoutMutation = useLogout()

  return {
    user,
    token,
    isAuthenticated,
    login: loginMutation,
    logout: logoutMutation,
  }
}
