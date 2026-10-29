import { createRouter, RouterProvider } from '@tanstack/react-router'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { APP_NAME } from '@/config/brand'
import { bootstrapAuth } from '@/lib/api'
import { installGlobalErrorHandlers } from '@/lib/error-reporter'
import './index.css'
import { ErrorPage } from './components/error-page'
import { NotFoundPage } from './routes/not-found'
import { routeTree } from './routeTree.gen'

// 动态设置页面标题（由品牌配置驱动，不依赖 Vite HTML 插值）
document.title = APP_NAME

const router = createRouter({
  routeTree,
  // L29：不配置时未知路由渲染 TanStack 英文裸 Not Found，精心排版的 404 页永不可达
  defaultNotFoundComponent: NotFoundPage,
  // L20：loader/component 抛错时中文兜底（同上，默认英文裸页）
  defaultErrorComponent: ErrorPage,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')!

// 先注册全局错误处理器
installGlobalErrorHandlers()

// L33：bootstrapAuth 仅在"已认证但 token 为空"的遗留态才发 refresh（内部串 15s 超时），
// 后端不可达时首屏白屏干等；加 3s 短超时兜底，到点先渲染（持久化 store 已就绪，路由守卫照常工作）
const bootstrapWithTimeout = Promise.race([
  bootstrapAuth().catch((err) => {
    console.error('[bootstrap] 恢复会话失败，继续渲染:', err)
  }),
  new Promise<void>((resolve) => setTimeout(resolve, 3000)),
])

bootstrapWithTimeout.then(() => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  )
})
