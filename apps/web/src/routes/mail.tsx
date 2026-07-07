import { createFileRoute } from '@tanstack/react-router'
import { Button, Divider, Form, Input, message, Radio, Space, Typography } from 'antd'
import { useState } from 'react'
import { useSendVerificationCodeMail, useSendWelcomeMail } from '@/hooks/use-mail'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'

const { Title, Text } = Typography

export const Route = createFileRoute('/mail')({
  component: MailPage,
})

type MailType = 'welcome' | 'verification-code'

interface WelcomeFormValues {
  to: string
  username: string
}

interface VerificationCodeFormValues {
  to: string
  name?: string
}

function MailPage() {
  const [mailType, setMailType] = useState<MailType>('welcome')
  const [messageApi, contextHolder] = message.useMessage()
  const welcomeMutation = useSendWelcomeMail()
  const verificationMutation = useSendVerificationCodeMail()

  const [welcomeForm] = Form.useForm<WelcomeFormValues>()
  const [verificationForm] = Form.useForm<VerificationCodeFormValues>()

  const handleSendWelcome = async (values: WelcomeFormValues) => {
    try {
      const res = await welcomeMutation.mutateAsync(values)
      messageApi.success(res.message)
      welcomeForm.resetFields()
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '发送失败'))
    }
  }

  const handleSendVerificationCode = async (values: VerificationCodeFormValues) => {
    try {
      const res = await verificationMutation.mutateAsync(values)
      messageApi.success(res.message)
      verificationForm.resetFields()
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '发送失败'))
    }
  }

  return (
    <AuthenticatedLayout>
      {contextHolder}
      <Title level={3}>邮件发送</Title>

      <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 640 }}>
        <div>
          <Text strong>邮件类型</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={mailType}
              onChange={(e) => setMailType(e.target.value as MailType)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="welcome">欢迎邮件</Radio.Button>
              <Radio.Button value="verification-code">验证码邮件</Radio.Button>
            </Radio.Group>
          </div>
        </div>

        <Divider style={{ margin: '8px 0' }} />

        {mailType === 'welcome' ? (
          <Form<WelcomeFormValues>
            form={welcomeForm}
            layout="vertical"
            onFinish={handleSendWelcome}
          >
            <Form.Item
              name="to"
              label="收件人邮箱"
              rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
            >
              <Input placeholder="user@example.com" />
            </Form.Item>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input placeholder="请输入收件人用户名" />
            </Form.Item>
            <Form.Item>
              <Space size={0}>
                <Button type="primary" htmlType="submit" loading={welcomeMutation.isPending}>
                  发送欢迎邮件
                </Button>
              </Space>
            </Form.Item>
          </Form>
        ) : (
          <Form<VerificationCodeFormValues>
            form={verificationForm}
            layout="vertical"
            onFinish={handleSendVerificationCode}
          >
            <Form.Item
              name="to"
              label="收件人邮箱"
              rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
            >
              <Input placeholder="user@example.com" />
            </Form.Item>
            <Form.Item name="name" label="称呼（可选）">
              <Input placeholder="如：张三" />
            </Form.Item>
            <Form.Item>
              <Space size={0}>
                <Button type="primary" htmlType="submit" loading={verificationMutation.isPending}>
                  发送验证码邮件
                </Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Space>
    </AuthenticatedLayout>
  )
}
