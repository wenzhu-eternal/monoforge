import { createFileRoute } from '@tanstack/react-router'
import { Button, Card, Col, message, Result, Row, Spin, Typography } from 'antd'
import { useEffect } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'

const { Title } = Typography

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
function DashboardPage() {
  // J4：布局与守卫上移 _authenticated pathless layout，此处直 render 内容
  return <DashboardContent />
}

function DashboardContent() {
  const { data, isLoading, isError, error, refetch } = useDashboardStats()
  const [messageApi, contextHolder] = message.useMessage()

  const status = (error as { response?: { status?: number } })?.response?.status
  // 无统计权限时只在右侧内容区提示，左侧菜单照常显示（路由本身无需权限）
  const isForbidden = isError && status === 403

  useEffect(() => {
    if (isError && !isForbidden) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, isForbidden, error, messageApi])

  return (
    <>
      {contextHolder}
      <Title level={3}>仪表盘</Title>
      {isForbidden ? (
        <Result
          status="403"
          title="无查看统计权限"
          subTitle="当前账号没有仪表盘统计权限，可使用左侧菜单的其他功能"
          extra={
            <Button type="primary" onClick={() => refetch()}>
              重试
            </Button>
          }
        />
      ) : (
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
      )}
    </>
  )
}
