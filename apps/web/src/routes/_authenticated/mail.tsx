import type { SendVerificationCodeMail, SendWelcomeMail } from '@shared'
import { createFileRoute } from '@tanstack/react-router'
import { Button, Divider, Form, Input, message, Radio, Space, Typography } from 'antd'
import { useState } from 'react'
import { useSendVerificationCodeMail, useSendWelcomeMail } from '@/hooks/use-mail'
import { extractErrorMessage } from '@/lib/error'
import { emailRule } from '@/lib/form-rules'

const { Title, Text } = Typography

export const Route = createFileRoute('/_authenticated/mail')({
  component: MailPage,
})

type MailType = 'welcome' | 'verification-code'

function MailPage() {
  const [mailType, setMailType] = useState<MailType>('welcome')
  const [messageApi, contextHolder] = message.useMessage()
  const welcomeMutation = useSendWelcomeMail()
  const verificationMutation = useSendVerificationCodeMail()

  const [welcomeForm] = Form.useForm<SendWelcomeMail>()
  const [verificationForm] = Form.useForm<SendVerificationCodeMail>()

  const handleSendWelcome = async (values: SendWelcomeMail) => {
    try {
      const res = await welcomeMutation.mutateAsync(values)
      messageApi.success(res.message)
      welcomeForm.resetFields()
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '发送失败'))
    }
  }

  const handleSendVerificationCode = async (values: SendVerificationCodeMail) => {
    try {
      const res = await verificationMutation.mutateAsync(values)
      messageApi.success(res.message)
      verificationForm.resetFields()
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '发送失败'))
    }
  }

  return (
    // J4：布局上移，此处直 render 内容
    <>
      {contextHolder}
      <Title level={3}>邮件发送</Title>

      <Space orientation="vertical" size="large" style={{ width: '100%', maxWidth: 640 }}>
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
          <Form<SendWelcomeMail> form={welcomeForm} layout="vertical" onFinish={handleSendWelcome}>
            <Form.Item
              name="to"
              label="收件人邮箱"
              rules={[{ required: true, message: '请输入邮箱' }, emailRule]}
            >
              <Input placeholder="user@example.com" />
            </Form.Item>
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true, message: '请输入用户名' },
                { max: 50, message: '用户名最多 50 个字符' },
              ]}
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
          <Form<SendVerificationCodeMail>
            form={verificationForm}
            layout="vertical"
            onFinish={handleSendVerificationCode}
          >
            <Form.Item
              name="to"
              label="收件人邮箱"
              rules={[{ required: true, message: '请输入邮箱' }, emailRule]}
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
    </>
  )
}
