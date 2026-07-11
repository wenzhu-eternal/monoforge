import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert, Button, Form, Input, message, Typography } from 'antd'
import { useEffect } from 'react'
import { useSetup, useSetupStatus } from '@/hooks/use-setup'
import { extractErrorMessage } from '@/lib/error'

const { Title, Paragraph } = Typography

export const Route = createFileRoute('/setup')({
  component: SetupPage,
})

function SetupPage() {
  const navigate = useNavigate()
  const { data: status, isLoading } = useSetupStatus()
  const setupMutation = useSetup()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm<{
    username: string
    email: string
    password: string
    nickname?: string
  }>()

  // 已初始化则跳转登录页
  useEffect(() => {
    if (!isLoading && status?.initialized) {
      navigate({ to: '/login', replace: true })
    }
  }, [isLoading, status, navigate])

  const onSubmit = async (values: {
    username: string
    email: string
    password: string
    nickname?: string
  }) => {
    try {
      await setupMutation.mutateAsync(values)
      messageApi.success('系统初始化成功，请登录')
      // 初始化成功后跳转登录
      navigate({ to: '/login', replace: true })
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '初始化失败'))
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      {contextHolder}
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <Title level={2} className="text-center mb-2">
          系统初始化
        </Title>
        <Paragraph type="secondary" className="text-center mb-6">
          欢迎使用 MB Admin，请创建首个管理员账号以启用系统
        </Paragraph>

        <Alert
          type="info"
          showIcon
          title="初始化将自动创建 admin / editor / viewer 三个默认角色"
          className="mb-6"
        />

        <Form
          form={form}
          onFinish={onSubmit}
          layout="vertical"
          autoComplete="off"
          initialValues={{ username: 'admin' }}
        >
          <Form.Item
            label="管理员用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, max: 50, message: '用户名长度 3-50 个字符' },
              {
                pattern: /^[a-zA-Z0-9_]+$/,
                message: '用户名只能包含字母、数字、下划线',
              },
            ]}
          >
            <Input placeholder="字母/数字/下划线" />
          </Form.Item>
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="admin@example.com" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, max: 100, message: '密码至少 8 个字符' },
            ]}
          >
            <Input.Password placeholder="至少 8 个字符" />
          </Form.Item>
          <Form.Item label="昵称（可选）" name="nickname">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={setupMutation.isPending}
              block
              size="large"
            >
              初始化系统
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
