import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Card, Form, Input, message, Typography } from 'antd'
import { useEffect } from 'react'
import { APP_NAME } from '@/config/brand'
import { useChangePassword, useLogout } from '@/hooks/use-auth'
import { extractErrorMessage } from '@/lib/error'
import { requireAuth } from '@/lib/route-guards'
import { useAuthStore } from '@/store/auth-store'

const { Title } = Typography

export const Route = createFileRoute('/change-password')({
  beforeLoad: requireAuth(),
  component: ChangePasswordPage,
})

function ChangePasswordPage() {
  const navigate = useNavigate()
  const changePasswordMutation = useChangePassword()
  const logoutMutation = useLogout()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm<{
    oldPassword: string
    newPassword: string
    confirmPassword: string
  }>()

  // 未登录兜底（beforeLoad requireAuth 已拦截，此分支为防御性冗余）
  useEffect(() => {
    if (!isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [isAuthenticated, navigate])

  const handleSubmit = async (values: {
    oldPassword: string
    newPassword: string
    confirmPassword: string
  }) => {
    if (values.newPassword !== values.confirmPassword) {
      messageApi.error('两次输入的新密码不一致')
      return
    }
    try {
      await changePasswordMutation.mutateAsync({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      })
      messageApi.success('密码修改成功，请重新登录')
      // 改密成功后立即清空本地登录态（旧 token 已全部吊销），跳转交给下方 isAuthenticated 兜底 effect；
      // 后端登出（清 refreshToken cookie）异步进行
      useAuthStore.getState().logout()
      logoutMutation.mutate()
      navigate({ to: '/login' })
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '密码修改失败'))
    }
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      {contextHolder}
      <Card className="w-full max-w-md shadow-md">
        <Title level={3} className="text-center mb-2">
          {APP_NAME}
        </Title>
        <p className="text-center text-gray-500 mb-6">首次登录或密码被重置，请修改密码后继续使用</p>
        <Form form={form} onFinish={handleSubmit} layout="vertical" autoComplete="off">
          <Form.Item
            label="旧密码"
            name="oldPassword"
            rules={[{ required: true, message: '请输入旧密码' }]}
          >
            <Input.Password placeholder="请输入旧密码" />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 100, message: '密码至少 6 个字符' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirmPassword"
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={changePasswordMutation.isPending}
              block
            >
              确认修改
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
