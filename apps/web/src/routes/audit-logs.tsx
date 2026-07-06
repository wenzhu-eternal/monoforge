import { createFileRoute } from '@tanstack/react-router'
import { Empty, message, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'
import { type AuditLog, useAuditLogs } from '@/hooks/use-logs'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'

const { Title, Text } = Typography

export const Route = createFileRoute('/audit-logs')({
  component: AuditLogsPage,
})

// 解析 UserAgent 字符串，提取关键信息
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

// 格式化新旧值，只显示变更的字段
function formatValue(v: unknown): string {
  if (!v) return '-'
  if (typeof v === 'object') {
    return JSON.stringify(v, null, 0)
  }
  return String(v)
}

function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [messageApi, contextHolder] = message.useMessage()
  const { data, isLoading, isError, error } = useAuditLogs({
    page,
    pageSize,
  })

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

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
        const { browser, os } = parseUserAgent(record.userAgent)
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
    <AuthenticatedLayout>
      {contextHolder}
      <Title level={3}>审计日志</Title>

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
    </AuthenticatedLayout>
  )
}
