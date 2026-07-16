import type { ApiResponse, AuthResponse, RegisterWithCode, SendRegisterCode } from '@shared'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

export const useSendRegisterCode = () => {
  return useMutation({
    mutationFn: async (data: SendRegisterCode) => {
      const response = await api.post<ApiResponse<{ message: string }>>(
        '/api/v1/auth/send-register-code',
        data,
      )
      return response.data.data!
    },
  })
}

export const useRegister = () => {
  const { login } = useAuthStore()

  return useMutation({
    mutationFn: async (data: RegisterWithCode) => {
      const response = await api.post<ApiResponse<AuthResponse>>('/api/v1/auth/register', data)
      return response.data.data!
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken)
    },
  })
}
