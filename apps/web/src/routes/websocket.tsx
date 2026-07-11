import { createFileRoute } from '@tanstack/react-router'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useWebSocketDemo } from '@/hooks/use-websocket'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'
import { useAuthStore } from '@/store/auth-store'

const { Title, Paragraph, Text } = Typography

export const Route = createFileRoute('/websocket')({
  component: WebSocketPage,
})

function WebSocketPage() {
  const user = useAuthStore((state) => state.user)
  const { connected, onlineUsers, me, receivedNotifications, sendNotify } = useWebSocketDemo()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm<{
    userId: number
    title: string
    content?: string
  }>()

  const onSend = async (values: { userId: number; title: string; content?: string }) => {
    try {
      const result = await sendNotify.mutateAsync(values)
      messageApi.success(
        result.delivered
          ? `通知已实时推送给用户 ${values.userId}`
          : `通知已持久化，用户 ${values.userId} 当前离线，上线后可见`,
      )
      form.resetFields()
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '发送失败'))
    }
  }

  // 默认给自己发（userId 填当前用户 ID）
  const initialValues = user?.id ? { userId: user.id, title: '', content: '' } : undefined

  return (
    <AuthenticatedLayout>
      {contextHolder}
      <Title level={3} className="mb-2">
        WebSocket 演示
      </Title>
      <Paragraph type="secondary" className="mb-6">
        演示 WebSocket 实时通信能力：连接状态、在线用户、通知推送。登录后自动建立连接，30s
        心跳保活，断线自动重连。
      </Paragraph>

      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card title="连接状态" size="small">
            <Statistic
              title="当前连接"
              valueRender={() =>
                connected ? (
                  <Badge status="success" text="已连接" />
                ) : (
                  <Badge status="error" text="未连接" />
                )
              }
            />
            <Divider style={{ margin: '12px 0' }} />
            <Statistic
              title="当前用户在线"
              valueRender={() =>
                me?.online ? <Tag color="success">在线</Tag> : <Tag color="default">离线</Tag>
              }
            />
            <Divider style={{ margin: '12px 0' }} />
            <Statistic title="在线用户数" value={onlineUsers?.count ?? 0} suffix="人" />
            {onlineUsers && onlineUsers.userIds.length > 0 && (
              <div className="mt-2">
                <Text type="secondary" className="text-xs">
                  在线用户 ID:
                </Text>
                <div className="mt-1 flex flex-wrap gap-1">
                  {onlineUsers.userIds.map((id) => (
                    <Tag key={id} color="blue">
                      {id}
                    </Tag>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </Col>

        <Col span={16}>
          <Card title="发送测试通知" size="small">
            <Alert
              type="info"
              showIcon
              title="说明"
              description="通知会先持久化到数据库，若目标用户在线则同时通过 WebSocket 实时推送；离线用户上线后可在通知列表查看。"
              className="mb-4"
            />
            <Form
              form={form}
              onFinish={onSend}
              layout="vertical"
              initialValues={initialValues}
              autoComplete="off"
            >
              <Form.Item
                label="目标用户 ID"
                name="userId"
                rules={[{ required: true, message: '请输入用户 ID' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} placeholder="输入用户 ID" />
              </Form.Item>
              <Form.Item
                label="标题"
                name="title"
                rules={[
                  { required: true, message: '请输入标题' },
                  { max: 200, message: '标题最多 200 字符' },
                ]}
              >
                <Input placeholder="如：系统测试通知" />
              </Form.Item>
              <Form.Item
                label="内容（可选）"
                name="content"
                rules={[{ max: 2000, message: '内容最多 2000 字符' }]}
              >
                <Input.TextArea rows={3} placeholder="通知内容" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={sendNotify.isPending}>
                  发送通知
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col span={24}>
          <Card
            title="实时收到的通知"
            size="small"
            extra={
              <Space>
                <Text type="secondary" className="text-xs">
                  仅展示本页打开后通过 WebSocket 推送的通知
                </Text>
              </Space>
            }
          >
            {receivedNotifications.length === 0 ? (
              <Alert
                type="info"
                showIcon
                title="暂无实时通知"
                description="给自己发一条通知试试（上方表单填你的用户 ID），如果在线会立即显示在这里。"
              />
            ) : (
              <List
                size="small"
                dataSource={receivedNotifications}
                renderItem={(n) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <Tag color="blue">{n.type}</Tag>
                          <span>{n.title}</span>
                        </Space>
                      }
                      description={
                        <div>
                          {n.content && <div className="text-sm">{n.content}</div>}
                          <div className="text-xs text-gray-400">
                            {dayjs(n.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                          </div>
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
    </AuthenticatedLayout>
  )
}
