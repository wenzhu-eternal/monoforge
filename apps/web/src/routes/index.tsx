import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, Typography } from 'antd'
import { APP_NAME } from '@/config/brand'

const { Title, Paragraph } = Typography

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <Title level={1}>{APP_NAME}</Title>
      <Paragraph>全栈 monorepo - 前后端共享 zod 契约</Paragraph>
      <Link to="/dashboard">
        <Button type="primary">开始使用</Button>
      </Link>
    </div>
  )
}
