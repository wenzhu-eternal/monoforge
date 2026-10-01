import { createRouter, RouterProvider } from '@tanstack/react-router'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { APP_NAME } from '@/config/brand'
import { bootstrapAuth } from '@/lib/api'
import { env } from '@/lib/env'
import { installGlobalErrorHandlers } from '@/lib/error-reporter'
import './index.css'
import { NotFoundPage } from './routes/not-found'
import { routeTree } from './routeTree.gen'

// 动态设置页面标题（由品牌配置驱动，不依赖 Vite HTML 插值）
document.title = APP_NAME

const router = createRouter({
  routeTree,
  // L29：不配置时未知路由渲染 TanStack 英文裸 Not Found，精心排版的 404 页永不可达
  defaultNotFoundComponent: NotFoundPage,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// MSW 仅在显式开启 mock 时启用（VITE_ENABLE_MOCK=true），避免开发环境总拦截请求
async function enableMocking() {
  if (import.meta.env.DEV && env.VITE_ENABLE_MOCK === 'true') {
    const { worker } = await import('./mocks/browser')
    return worker.start({
      onUnhandledRequest: 'bypass',
    })
  }
  return undefined
}

const rootElement = document.getElementById('root')!

// 先注册全局错误处理器，再启动 mock，避免 mock 启动失败时错误无人接管
installGlobalErrorHandlers()
enableMocking()
  .then(() => bootstrapAuth())
  .then(() => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>,
    )
  })
  .catch((err) => {
    console.error('[bootstrap] mock 启动失败，跳过 mock 直接渲染:', err)
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>,
    )
  })
