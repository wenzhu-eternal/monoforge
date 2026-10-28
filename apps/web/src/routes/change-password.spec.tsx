import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  navigate: vi.fn(),
  clearUserScopedState: vi.fn(),
  messageApi: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => state.navigate,
}))

vi.mock('@/lib/route-guards', () => ({ requireAuth: () => () => {} }))

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}))

vi.mock('@/lib/auth-cleanup', () => ({
  clearUserScopedState: (...args: unknown[]) => state.clearUserScopedState(...args),
}))

vi.mock('@/hooks/use-auth', () => ({
  useChangePassword: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    message: Object.assign(() => {}, actual.message, {
      useMessage: () => [state.messageApi, null],
    }),
  }
})

import { ChangePasswordPage } from './change-password'

async function fillForm(oldPwd: string, newPwd: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: oldPwd } })
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: newPwd } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /确认修改/ }))
}

describe('change-password（强制改密页）', () => {
  beforeEach(() => {
    state.mutateAsync.mockReset().mockResolvedValue({})
    state.navigate.mockClear()
    state.clearUserScopedState.mockClear()
    state.messageApi.success.mockClear()
    state.messageApi.error.mockClear()
  })

  it('两次新密码不一致 → 表单校验拦截，不发请求', async () => {
    render(<ChangePasswordPage />)

    await fillForm('old-password-1', 'new-password-1', 'new-password-2')

    await waitFor(() => {
      expect(screen.getByText('两次输入的新密码不一致')).toBeInTheDocument()
    })
    expect(state.mutateAsync).not.toHaveBeenCalled()
  })

  it('修改成功 → 清本地登录态并回登录页（不触发登出请求）', async () => {
    render(<ChangePasswordPage />)

    await fillForm('old-password-1', 'new-password-1', 'new-password-1')

    await waitFor(() => {
      expect(state.mutateAsync).toHaveBeenCalledWith({
        oldPassword: 'old-password-1',
        newPassword: 'new-password-1',
      })
    })
    await waitFor(() => {
      expect(state.clearUserScopedState).toHaveBeenCalledOnce()
      expect(state.navigate).toHaveBeenCalledWith({ to: '/login' })
    })
    expect(state.messageApi.success).toHaveBeenCalledWith('密码修改成功，请重新登录')
  })

  it('后端拒绝（旧密码错误）→ 展示服务端文案且不跳转', async () => {
    state.mutateAsync.mockRejectedValue({
      response: { data: { message: '旧密码不正确' } },
    })
    render(<ChangePasswordPage />)

    await fillForm('wrong-password', 'new-password-1', 'new-password-1')

    await waitFor(() => {
      expect(state.messageApi.error).toHaveBeenCalledWith('旧密码不正确')
    })
    expect(state.clearUserScopedState).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
  })
})
