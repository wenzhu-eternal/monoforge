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
    // P2-14：邮件发送会落审计记录，同步失效审计列表
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
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
    // P2-14：同上，写操作后审计列表不得继续展示旧快照
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  })
}
