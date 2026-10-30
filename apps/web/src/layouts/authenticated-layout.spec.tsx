import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    pathname: '/users',
    user: null as null | {
      id: number
      mustChangePassword?: boolean
      permissions?: string[]
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  useLocation: () => ({ pathname: state.pathname }),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/hooks/use-auth', () => ({
  useCurrentUser: () => ({
    data: state.user,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useLogout: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/auth-cleanup', () => ({ clearUserScopedState: vi.fn() }))

import { useAuthStore } from '@/store/auth-store'
import { AuthenticatedLayout } from './authenticated-layout'

describe('AuthenticatedLayout 判定顺序', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: 'tok', isAuthenticated: true })
    state.pathname = '/users'
  })

  it('未认证 → 直接跳 /login', () => {
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
    render(<AuthenticatedLayout>content</AuthenticatedLayout>)

    expect(screen.getByTestId('navigate').dataset.to).toBe('/login')
  })

  it('mustChangePassword 优先于权限校验（缺权限也先跳改密页）', () => {
    state.user = { id: 1, mustChangePassword: true, permissions: [] }
    render(<AuthenticatedLayout>content</AuthenticatedLayout>)

    expect(screen.getByTestId('navigate').dataset.to).toBe('/change-password')
  })

  it('无 mustChangePassword 且缺权限 → 跳 /403', () => {
    state.user = { id: 1, mustChangePassword: false, permissions: [] }
    render(<AuthenticatedLayout>content</AuthenticatedLayout>)

    expect(screen.getByTestId('navigate').dataset.to).toBe('/403')
  })
})
