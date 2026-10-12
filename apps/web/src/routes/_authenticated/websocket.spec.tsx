import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocketDemo: () => ({
    connected: true,
    onlineUsers: { count: 1, userIds: [7] },
    me: { userId: 7, online: true },
    receivedNotifications: [],
    sendNotify: { mutateAsync: vi.fn().mockResolvedValue({ delivered: true }) },
  }),
}))

import { useAuthStore } from '@/store/auth-store'
import { WebSocketContent } from './websocket'

describe('L9：发送通知表单目标 ID 锁定为当前用户', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 7, username: 'tester' } as never })
  })

  it('目标用户 ID 输入框禁用且回显当前用户（填任意 ID 会被后端 403）', async () => {
    render(<WebSocketContent />)

    const input = (await screen.findByLabelText('目标用户 ID')) as HTMLInputElement
    expect(input).toBeDisabled()
    expect(input.value).toBe('7')
  })

  it('说明文案提示仅支持自发', async () => {
    render(<WebSocketContent />)

    expect(await screen.findByText(/仅支持给自己发送测试通知/)).toBeInTheDocument()
  })
})
