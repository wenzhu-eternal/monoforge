import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  navigate: vi.fn(),
  messageApi: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => state.navigate,
}))

vi.mock('@/hooks/use-setup', () => ({
  useSetup: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
  useSetupStatus: () => ({ data: { initialized: false }, isLoading: false }),
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

import { SetupPage } from './setup'

async function fillRequiredFields(nickname?: string) {
  fireEvent.change(screen.getByLabelText('管理员用户名'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'admin@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Pass1234' } })
  if (nickname !== undefined) {
    fireEvent.change(screen.getByLabelText('昵称（可选）'), { target: { value: nickname } })
  }
  fireEvent.click(screen.getByRole('button', { name: /初始化系统/ }))
}

describe('setup（L14 昵称置空口径）', () => {
  beforeEach(() => {
    state.mutateAsync.mockReset().mockResolvedValue({})
    state.navigate.mockClear()
    state.messageApi.success.mockClear()
    state.messageApi.error.mockClear()
  })

  it('昵称留空 → 提交 null 而非空串', async () => {
    render(<SetupPage />)

    await fillRequiredFields('')

    await waitFor(() =>
      expect(state.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', nickname: null }),
      ),
    )
  })

  it('填写昵称 → 原值提交', async () => {
    render(<SetupPage />)

    await fillRequiredFields('管理员')

    await waitFor(() =>
      expect(state.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: '管理员' }),
      ),
    )
  })
})
