import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Result } from 'antd'

export const Route = createFileRoute('/403')({
  component: ForbiddenPage,
})

function ForbiddenPage() {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <Result
        status="403"
        title="403"
        subTitle="抱歉，你没有权限访问该页面。"
        extra={
          <Button type="primary" onClick={() => navigate({ to: '/dashboard' })}>
            返回首页
          </Button>
        }
      />
    </div>
  )
}
