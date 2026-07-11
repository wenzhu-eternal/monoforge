import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Divider, Form, Input, Modal, message, Typography } from 'antd'
import { useState } from 'react'
import { useLogin, useWechatLogin, useWechatQrCode, useWechatStatus } from '@/hooks/use-auth'
import { extractErrorMessage } from '@/lib/error'

const { Title } = Typography

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const loginMutation = useLogin()
  const navigate = useNavigate()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm<{ username: string; password: string }>()

  // 微信登录相关
  const { data: wechatStatus } = useWechatStatus()
  const qrCodeMutation = useWechatQrCode()
  const wechatLoginMutation = useWechatLogin()
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  const onSubmit = async (values: { username: string; password: string }) => {
    try {
      await loginMutation.mutateAsync(values)
      messageApi.success('登录成功')
      navigate({ to: '/dashboard' })
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '登录失败，请检查账号密码'))
    }
  }

  const onWechatLogin = async () => {
    try {
      const data = await qrCodeMutation.mutateAsync()
      setQrUrl(data.qrCodeUrl)
      setQrModalOpen(true)
      messageApi.info('请使用微信扫码登录，扫完后请在跳转页面拿 code 回填')
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '获取二维码失败'))
    }
  }

  // 扫码后用户拿到的 code 回填登录（简化版: 手动粘贴 code）
  const [codeInput, setCodeInput] = useState('')
  const onCodeSubmit = async () => {
    if (!codeInput.trim()) {
      messageApi.error('请输入微信回调返回的 code')
      return
    }
    try {
      await wechatLoginMutation.mutateAsync({ code: codeInput.trim(), loginType: 'qrcode' })
      messageApi.success('微信登录成功')
      setQrModalOpen(false)
      navigate({ to: '/dashboard' })
    } catch (error: unknown) {
      messageApi.error(extractErrorMessage(error, '微信登录失败'))
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      {contextHolder}
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <Title level={2} className="text-center mb-8">
          MB 管理后台登录
        </Title>
        <Form form={form} onFinish={onSubmit} layout="vertical" autoComplete="off">
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
            <Button type="primary" htmlType="submit" loading={loginMutation.isPending} block>
              登录
            </Button>
          </Form.Item>
        </Form>

        {wechatStatus?.enabled && (
          <>
            <Divider plain>或</Divider>
            <Button block onClick={onWechatLogin} loading={qrCodeMutation.isPending}>
              微信扫码登录
            </Button>
          </>
        )}
      </div>

      <Modal
        title="微信扫码登录"
        open={qrModalOpen}
        onCancel={() => setQrModalOpen(false)}
        footer={null}
      >
        {qrUrl && (
          <div className="flex flex-col items-center gap-4 py-4">
            <iframe
              src={qrUrl}
              title="微信扫码"
              className="w-full h-64 border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
            <p className="text-sm text-gray-500 text-center">
              扫码并在微信中确认后，请把回调 URL 中的 code 参数复制到下方完成登录
            </p>
            <div className="flex gap-2 w-full">
              <Input
                placeholder="粘贴微信回调返回的 code"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
              />
              <Button type="primary" onClick={onCodeSubmit} loading={wechatLoginMutation.isPending}>
                登录
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
