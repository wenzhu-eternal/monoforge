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
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { requireAuth } from '@/lib/route-guards'

const { Title, Text } = Typography

export const Route = createFileRoute('/audit-logs')({
  beforeLoad: requireAuth(),
  component: AuditLogsPage,
})

function parseUserAgent(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: '-', os: '-' }

  let browser = '-'
  if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/')) browser = 'Safari'
  else if (ua.includes('Edge/')) browser = 'Edge'

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
  if (!v) return '-'
  if (typeof v === 'object') {
    return JSON.stringify(v, null, 0)
  }
  return String(v)
}

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
function AuditLogsPage() {
  return (
    <AuthenticatedLayout>
      <AuditLogsContent />
    </AuthenticatedLayout>
  )
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
  const { data, isLoading, isError, error } = useAuditLogs({
    page,
    pageSize,
    ...filters,
  })

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
      resource: values.resource || undefined,
      keyword: values.keyword || undefined,
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
      render: (_, record) => (
        <span>{record.username ? `${record.username}(${record.userId})` : record.userId}</span>
      ),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (v: string) => {
        const colorMap: Record<string, string> = {
          创建: 'green',
          更新: 'blue',
          删除: 'red',
        }
        return <Tag color={colorMap[v] ?? 'default'}>{v}</Tag>
      },
    },
    { title: '资源', dataIndex: 'resource', width: 100 },
    { title: '资源ID', dataIndex: 'resourceId', width: 80, render: (v: number | null) => v ?? '-' },
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

      <Form form={searchForm} layout="inline" onFinish={handleSearch} style={{ marginBottom: 16 }}>
        <Form.Item name="userId" label="用户ID">
          <Input placeholder="用户ID" style={{ width: 120 }} allowClear />
        </Form.Item>
        <Form.Item name="action" label="动作">
          <Select
            placeholder="全部"
            style={{ width: 100 }}
            allowClear
            options={[
              { label: '创建', value: '创建' },
              { label: '更新', value: '更新' },
              { label: '删除', value: '删除' },
            ]}
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
