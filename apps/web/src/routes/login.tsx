import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button, Form, Input, message, Tabs, Typography } from 'antd'
import { useState } from 'react'
import { APP_NAME } from '@/config/brand'
import { useLogin } from '@/hooks/use-auth'
import { useRegister, useSendRegisterCode } from '@/hooks/use-register'
import { extractErrorMessage } from '@/lib/error'
import { useAuthStore } from '@/store/auth-store'

const { Title } = Typography

export const Route = createFileRoute('/login')({
  // 已登录用户访问 /login 时重定向到 /dashboard，避免重复登录
  beforeLoad: () => {
    const { isAuthenticated, token } = useAuthStore.getState()
    if (isAuthenticated && token) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const loginMutation = useLogin()
  const registerMutation = useRegister()
  const sendCodeMutation = useSendRegisterCode()
  const navigate = useNavigate()
  const [messageApi, contextHolder] = message.useMessage()
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')
  const [countdown, setCountdown] = useState(0)

  const [loginForm] = Form.useForm<{ username: string; password: string }>()
  const [registerForm] = Form.useForm<{
    email: string
    code: string
    username: string
    password: string
    confirmPassword: string
  }>()

  const onLoginSubmit = async (values: { username: string; password: string }) => {
    try {
      await loginMutation.mutateAsync(values)
      messageApi.success('登录成功')
      navigate({ to: '/dashboard' })
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '登录失败，请检查账号密码'))
    }
  }

  const onSendCode = async () => {
    try {
      const email = registerForm.getFieldValue('email')
      await registerForm.validateFields(['email'])
      await sendCodeMutation.mutateAsync({ email })
      messageApi.success('验证码已发送')
      setCountdown(60)
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'errorFields' in error) {
        return
      }
      messageApi.error(extractErrorMessage(error, '发送验证码失败'))
    }
  }

  const onRegisterSubmit = async (values: {
    email: string
    code: string
    username: string
    password: string
    confirmPassword: string
  }) => {
    try {
      if (values.password !== values.confirmPassword) {
        messageApi.error('两次输入的密码不一致')
        return
      }
      await registerMutation.mutateAsync({
        email: values.email,
        code: values.code,
        username: values.username,
        password: values.password,
      })
      messageApi.success('注册成功')
      navigate({ to: '/dashboard' })
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '注册失败'))
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      {contextHolder}
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <Title level={2} className="text-center mb-8">
          {APP_NAME} 管理后台
        </Title>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'login' | 'register')}
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form
                  form={loginForm}
                  onFinish={onLoginSubmit}
                  layout="vertical"
                  autoComplete="off"
                >
                  <Form.Item
                    label="用户名"
                    name="username"
                    rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 3, max: 50, message: '用户名长度 3-50 个字符' },
                    ]}
                  >
                    <Input placeholder="请输入用户名" />
                  </Form.Item>
                  <Form.Item
                    label="密码"
                    name="password"
                    rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, max: 100, message: '密码至少 6 个字符' },
                    ]}
                  >
                    <Input.Password placeholder="请输入密码" />
                  </Form.Item>
                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loginMutation.isPending}
                      block
                    >
                      登录
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form
                  form={registerForm}
                  onFinish={onRegisterSubmit}
                  layout="vertical"
                  autoComplete="off"
                >
                  <Form.Item
                    label="邮箱"
                    name="email"
                    rules={[
                      { required: true, message: '请输入邮箱' },
                      { type: 'email', message: '请输入有效的邮箱地址' },
                    ]}
                  >
                    <Input placeholder="请输入邮箱" />
                  </Form.Item>
                  <Form.Item label="验证码" required>
                    <div className="flex gap-2">
                      <Form.Item
                        name="code"
                        noStyle
                        rules={[
                          { required: true, message: '请输入验证码' },
                          { len: 6, message: '验证码为 6 位数字' },
                        ]}
                      >
                        <Input placeholder="请输入验证码" className="flex-1" />
                      </Form.Item>
                      <Button
                        onClick={onSendCode}
                        loading={sendCodeMutation.isPending}
                        disabled={countdown > 0}
                      >
                        {countdown > 0 ? `${countdown}s` : '发送验证码'}
                      </Button>
                    </div>
                  </Form.Item>
                  <Form.Item
                    label="用户名"
                    name="username"
                    rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 3, max: 50, message: '用户名长度 3-50 个字符' },
                    ]}
                  >
                    <Input placeholder="请输入用户名" />
                  </Form.Item>
                  <Form.Item
                    label="密码"
                    name="password"
                    rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, max: 100, message: '密码至少 6 个字符' },
                    ]}
                  >
                    <Input.Password placeholder="请输入密码" />
                  </Form.Item>
                  <Form.Item
                    label="确认密码"
                    name="confirmPassword"
                    rules={[
                      { required: true, message: '请确认密码' },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!value || getFieldValue('password') === value) {
                            return Promise.resolve()
                          }
                          return Promise.reject(new Error('两次输入的密码不一致'))
                        },
                      }),
                    ]}
                  >
                    <Input.Password placeholder="请确认密码" />
                  </Form.Item>
                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={registerMutation.isPending}
                      block
                    >
                      注册
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}
