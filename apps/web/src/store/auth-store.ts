import type { User } from '@shared'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  /**
   * P2-03：会话代次——登录/登出各递增一次，供请求与刷新链判定"结果是否属于当前会话"。
   * 旧会话晚到的 401、晚到的刷新成功/失败、旧排队请求一律不得改写新会话。
   * 不持久化：整页重载后旧请求已随页面销毁
   */
  sessionEpoch: number
  login: (user: User, token: string) => void
  logout: () => void
  setToken: (token: string) => void
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      sessionEpoch: 0,
      login: (user, token) =>
        set((state) => ({
          user,
          token,
          isAuthenticated: true,
          sessionEpoch: state.sessionEpoch + 1,
        })),
      logout: () =>
        set((state) => ({
          user: null,
          token: null,
          isAuthenticated: false,
          sessionEpoch: state.sessionEpoch + 1,
        })),
      setToken: (token) => set({ token }),
      setUser: (user) => set({ user }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
