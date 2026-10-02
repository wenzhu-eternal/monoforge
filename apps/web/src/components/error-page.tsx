import { useNavigate } from '@tanstack/react-router'
import { Button, Result } from 'antd'

// L20：路由渲染异常兜底页（仿 NotFoundPage）。挂到 router defaultErrorComponent，
// loader/component 抛错时中文展示而非 TanStack 英文裸页。放 components 而非 routes，避免被文件路由收成 /error 路由。
export function ErrorPage({ error }: { error?: unknown }) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <Result
        status="error"
        title="页面加载出错"
        subTitle={error instanceof Error ? error.message : '未知错误，请重试或返回首页'}
        extra={
          <Button type="primary" onClick={() => navigate({ to: '/dashboard' })}>
            返回首页
          </Button>
        }
      />
    </div>
  )
}
