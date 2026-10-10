import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  Empty,
  Form,
  Input,
  message,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'
import { type AuditLog, useAuditLogs } from '@/hooks/use-logs'
import { usePagedFallback } from '@/hooks/use-paged-fallback'

const { Title, Text } = Typography

export const Route = createFileRoute('/_authenticated/audit-logs')({
  component: AuditLogsPage,
})

function parseUserAgent(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: '-', os: '-' }

  let browser = '-'
  // L28：新 Edge 的 UA 同时含 "Edg/" 与 "Chrome/"，必须先判 Edge，否则全部误显示为 Chrome
  if (ua.includes('Edg/') || ua.includes('Edge/')) browser = 'Edge'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/')) browser = 'Safari'

  let os = '-'
  if (ua.includes('Windows NT 10.0')) os = 'Windows 10/11'
  else if (ua.includes('Windows NT 6.3')) os = 'Windows 8.1'
  else if (ua.includes('Mac OS X')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
  else if (ua.includes('Android')) os = 'Android'

  return { browser, os }
}

// 格式化值用于表格展示
function formatValue(v: unknown): string {
  // L24：仅 null/undefined/空串显示占位——falsy 真值（status:false、roleId:0）必须如实展示
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'object') {
    return JSON.stringify(v, null, 0)
  }
  return String(v)
}

// L25：动作色卡与筛选下拉共用同一词表（后端 ACTION_MAP + HANDLER_ACTION_MAP + @AuditAction 全集），防两处漂移
const ACTION_COLORS: Record<string, string> = {
  创建: 'green',
  更新: 'blue',
  删除: 'red',
  登录: 'cyan',
  注册: 'green',
  登出: 'default',
  刷新令牌: 'blue',
  发送验证码: 'purple',
  改密: 'orange',
  处理: 'geekblue',
  批量处理: 'geekblue',
  恢复: 'cyan',
  触发备份: 'volcano',
  发送通知: 'purple',
  发送欢迎邮件: 'purple',
  发送测试邮件: 'purple',
}

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
function AuditLogsPage() {
  // J4：布局与守卫上移 _authenticated pathless layout，此处直 render 内容
  return <AuditLogsContent />
}

function AuditLogsContent() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filters, setFilters] = useState<{
    userId?: number
    action?: string
    resource?: string
    keyword?: string
  }>({})
  const [searchForm] = Form.useForm()
  const [messageApi, contextHolder] = message.useMessage()
  const { data, isLoading, isError, error, isSuccess } = useAuditLogs({
    page,
    pageSize,
    ...filters,
  })
  usePagedFallback(data?.list.length, isSuccess, page, setPage)

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  const handleSearch = (values: {
    userId?: string
    action?: string
    resource?: string
    keyword?: string
  }) => {
    setFilters({
      // L14：用户ID仅纯数字才进请求（原 NaN 直接进请求，后端 400）；非法输入静默转全量，配合输入框 trim
      userId:
        values.userId && /^\d+$/.test(values.userId.trim())
          ? Number(values.userId.trim())
          : undefined,
      action: values.action || undefined,
      resource: values.resource?.trim() || undefined,
      keyword: values.keyword?.trim() || undefined,
    })
    setPage(1)
  }

  const handleReset = () => {
    searchForm.resetFields()
    setFilters({})
    setPage(1)
  }

  const columns: ColumnsType<AuditLog> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '用户',
      width: 150,
      render: (_, record) =>
        // userId 0 为匿名哨兵（登录失败等无身份请求），展示为 - 而非 0
        record.username ? (
          <span>{`${record.username}(${record.userId})`}</span>
        ) : (
          <span>{record.userId ? record.userId : '-'}</span>
        ),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (v: string) => {
        return <Tag color={ACTION_COLORS[v] ?? 'default'}>{v}</Tag>
      },
    },
    { title: '资源', dataIndex: 'resource', width: 100 },
    { title: '资源ID', dataIndex: 'resourceId', width: 80, render: (v: number | null) => v || '-' },
    {
      title: '旧值',
      dataIndex: 'oldValue',
      width: 150,
      ellipsis: true,
      render: (v: unknown) => (
        <Tooltip title={formatValue(v)}>
          <Text ellipsis style={{ maxWidth: 120 }}>
            {formatValue(v)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '新值',
      dataIndex: 'newValue',
      width: 150,
      ellipsis: true,
      render: (v: unknown) => (
        <Tooltip title={formatValue(v)}>
          <Text ellipsis style={{ maxWidth: 120 }}>
            {formatValue(v)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 140,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '客户端',
      width: 150,
      render: (_, record) => {
        const { browser, os } = parseUserAgent(record.userAgent ?? null)
        return (
          <Tooltip title={record.userAgent}>
            <span>
              {browser} / {os}
            </span>
          </Tooltip>
        )
      },
    },
  ]

  return (
    <>
      {contextHolder}
      <Title level={3}>审计日志</Title>
      {/* 审计值中令牌/密码/邮箱/手机号等敏感字段已脱敏为 ***（N4），用户身份以"用户"列为准 */}
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        旧值/新值中的敏感字段（令牌、密码、邮箱、手机号等）已脱敏为
        ***，如需定位具体用户请参考"用户"列。
      </Text>

      <Form form={searchForm} layout="inline" onFinish={handleSearch} style={{ marginBottom: 16 }}>
        <Form.Item name="userId" label="用户ID">
          <Input placeholder="用户ID" style={{ width: 120 }} allowClear />
        </Form.Item>
        <Form.Item name="action" label="动作">
          <Select
            placeholder="全部"
            style={{ width: 120 }}
            allowClear
            options={Object.keys(ACTION_COLORS).map((a) => ({ label: a, value: a }))}
          />
        </Form.Item>
        <Form.Item name="resource" label="资源">
          <Input placeholder="资源" style={{ width: 120 }} allowClear />
        </Form.Item>
        <Form.Item name="keyword" label="关键词">
          <Input placeholder="关键词" style={{ width: 150 }} allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={isLoading}>
              搜索
            </Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table<AuditLog>
        rowKey="id"
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={isLoading}
        locale={{ emptyText: <Empty description="暂无审计日志" /> }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          },
        }}
      />
    </>
  )
}
