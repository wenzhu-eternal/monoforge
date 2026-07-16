import type {
  ApiResponse,
  MailSendResult,
  SendVerificationCodeMail,
  SendWelcomeMail,
} from '@shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const useSendWelcomeMail = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: SendWelcomeMail) => {
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
    mutationFn: async (data: SendVerificationCodeMail) => {
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
