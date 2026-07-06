import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * 创建带 QueryClientProvider 的 test wrapper
 */
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, networkMode: 'offlineFirst' },
      mutations: { retry: false },
    },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  return { queryClient, Wrapper }
}

/**
 * 渲染 hook 并自动包装 QueryClientProvider
 */
export function renderHookWithQuery<T>(hook: () => T) {
  const { queryClient, Wrapper } = createQueryWrapper()
  const result = renderHook(hook, { wrapper: Wrapper })
  return { ...result, queryClient }
}

export { waitFor }
