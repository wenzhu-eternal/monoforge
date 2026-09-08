import { createFileRoute } from '@tanstack/react-router'
import { Card, Col, message, Row, Spin, Typography } from 'antd'
import { useEffect } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { requireAuth } from '@/lib/route-guards'

const { Title } = Typography

export const Route = createFileRoute('/dashboard')({
  beforeLoad: requireAuth(),
  component: DashboardPage,
})

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
function DashboardPage() {
  return (
    <AuthenticatedLayout>
      <DashboardContent />
    </AuthenticatedLayout>
  )
}

function DashboardContent() {
  const { data, isLoading, isError, error } = useDashboardStats()
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  return (
    <>
      {contextHolder}
      <Title level={3}>仪表盘</Title>
      <Spin spinning={isLoading}>
        <Row gutter={[16, 16]}>
          <Col span={8}>
            <Card title="用户总数" hoverable>
              <div className="text-3xl font-bold">{data?.totalUsers ?? '-'}</div>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="活跃用户" hoverable>
              <div className="text-3xl font-bold text-green-500">{data?.activeUsers ?? '-'}</div>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="系统状态" hoverable>
              <div className="text-3xl font-bold text-green-500">在线</div>
            </Card>
          </Col>
        </Row>
      </Spin>
    </>
  )
}
