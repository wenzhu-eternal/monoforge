import type { ApiResponse } from '@shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface SendWelcomeMailInput {
  to: string
  username: string
}

export interface SendVerificationCodeMailInput {
  to: string
  name?: string
}

export interface MailSendResult {
  message: string
}

export const useSendWelcomeMail = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: SendWelcomeMailInput) => {
      const response = await api.post<ApiResponse<MailSendResult>>('/api/v1/mail/welcome', data)
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail'] })
    },
  })
}

export const useSendVerificationCodeMail = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: SendVerificationCodeMailInput) => {
      const response = await api.post<ApiResponse<MailSendResult>>(
        '/api/v1/mail/verification-code',
        data,
      )
      return response.data.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail'] })
    },
  })
}
