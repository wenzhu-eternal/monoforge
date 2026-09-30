import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Result } from 'antd'

export const Route = createFileRoute('/not-found')({
  component: NotFoundPage,
})

function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <Result
        status="404"
        title="404"
        subTitle="抱歉，你访问的页面不存在。"
        extra={
          <Button type="primary" onClick={() => navigate({ to: '/dashboard' })}>
            返回首页
          </Button>
        }
      />
    </div>
  )
}
