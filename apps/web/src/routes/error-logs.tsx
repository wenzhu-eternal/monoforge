import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  message,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import {
  type ErrorLog,
  type ErrorLogGroup,
  type ErrorWhitelist,
  useBatchResolveErrorLog,
  useCreateWhitelist,
  useDeleteErrorLog,
  useDeleteWhitelist,
  useErrorLogs,
  useErrorLogsGrouped,
  useErrorStats,
  useResolveErrorLog,
  useUpdateWhitelist,
  useWhitelist,
} from '@/hooks/use-logs'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'

const { Title, Text, Paragraph } = Typography

export const Route = createFileRoute('/error-logs')({
  component: ErrorLogsPage,
})

function ErrorLogsPage() {
  return (
    <AuthenticatedLayout>
      <Title level={3}>错误日志</Title>

      <Tabs
        defaultActiveKey="logs"
        items={[
          {
            key: 'logs',
            label: '错误日志',
            children: <LogsTab />,
          },
          {
            key: 'whitelist',
            label: '白名单规则',
            children: <WhitelistTab />,
          },
        ]}
      />
    </AuthenticatedLayout>
  )
}

// ===== 错误日志 Tab =====

function LogsTab() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [keyword, setKeyword] = useState<string | undefined>(undefined)
  const [searchInput, setSearchInput] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined)
  const [resolvedFilter, setResolvedFilter] = useState<string | undefined>(undefined)
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error } = useErrorLogs({
    page,
    pageSize,
    keyword,
    source: sourceFilter,
    isResolved: resolvedFilter,
  })
  const { data: stats } = useErrorStats()
  const { data: grouped } = useErrorLogsGrouped(10)
  const deleteMutation = useDeleteErrorLog()
  const resolveMutation = useResolveErrorLog()
  const batchResolveMutation = useBatchResolveErrorLog()

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  const handleBatchResolve = (item: ErrorLogGroup) => {
    batchResolveMutation.mutate(
      { message: item.message, source: item.source },
      {
        onSuccess: (res) => {
          messageApi.success(`已批量处理 ${res.affected} 条相同错误`)
        },
        onError: (err) => {
          messageApi.error(extractErrorMessage(err, '批量处理失败'))
        },
      },
    )
  }

  const handleResolve = async (id: number) => {
    try {
      await resolveMutation.mutateAsync(id)
      messageApi.success('已标记为已处理')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '标记失败'))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      messageApi.success('删除成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '删除失败'))
    }
  }

  // 联动筛选: 点击聚合项"查看详情"后，用 message 作为关键词筛选列表
  const handleViewGroupDetails = (item: ErrorLogGroup) => {
    setKeyword(item.message)
    setSearchInput(item.message)
    setSourceFilter(item.source)
    setResolvedFilter(undefined)
    setPage(1)
  }

  const columns: ColumnsType<ErrorLog> = [
    {
      title: '来源',
      dataIndex: 'source',
      width: 90,
      render: (v: string) => (
        <Tag color={v === 'frontend' ? 'blue' : v === 'backend' ? 'red' : 'green'}>
          {v === 'frontend' ? '前端' : v === 'backend' ? '后端' : v}
        </Tag>
      ),
    },
    {
      title: '类型',
      dataIndex: 'errorType',
      width: 110,
      render: (v: string | null) => {
        const map: Record<string, string> = {
          js_error: 'JS 错误',
          http_error: 'HTTP 错误',
          unhandled_promise: 'Promise 异常',
          resource_error: '资源错误',
          api_error: 'API 错误',
        }
        return v ? <Tag>{map[v] ?? v}</Tag> : '-'
      },
    },
    {
      title: '状态',
      dataIndex: 'isResolved',
      width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'error'}>{v ? '已处理' : '未处理'}</Tag>,
    },
    {
      title: '消息',
      dataIndex: 'message',
      ellipsis: true,
      render: (v: string) => <Text type="danger">{v}</Text>,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 220,
      render: (_: unknown, record: ErrorLog) => {
        const actions: { key: string; node: ReactNode }[] = [
          {
            key: 'detail',
            node: (
              <Button type="link" size="small" onClick={() => setSelectedLog(record)}>
                详情
              </Button>
            ),
          },
        ]
        if (!record.isResolved) {
          actions.push({
            key: 'resolve',
            node: (
              <Button
                type="link"
                size="small"
                loading={resolveMutation.isPending}
                onClick={() => handleResolve(record.id)}
              >
                标记已处理
              </Button>
            ),
          })
        }
        actions.push({
          key: 'delete',
          node: (
            <Popconfirm title="确认删除该错误日志？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          ),
        })
        return (
          <Space size={0}>
            {actions.map((item, i) => (
              <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <Divider type="vertical" style={{ margin: '0 4px' }} />}
                {item.node}
              </span>
            ))}
          </Space>
        )
      },
    },
  ]

  return (
    <>
      {contextHolder}

      {/* 统计面板 - 紧凑横排 */}
      {stats && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="总错误数" value={stats.total} />
            </Col>
            <Col span={6}>
              <Statistic
                title="未处理"
                value={stats.unresolved}
                valueStyle={{ color: '#cf1322' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="前端错误"
                value={stats.bySource.frontend ?? 0}
                valueStyle={{ color: '#1677ff' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="后端错误"
                value={stats.bySource.backend ?? 0}
                valueStyle={{ color: '#cf1322' }}
              />
            </Col>
          </Row>
        </Card>
      )}

      {/* 相同报错聚合 Top 10 - 可折叠 */}
      {grouped && grouped.length > 0 && (
        <Collapse
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'grouped',
              label: `相似错误聚合 Top 10（共 ${grouped.length} 组）`,
              children: (
                <List
                  size="small"
                  dataSource={grouped}
                  renderItem={(item: ErrorLogGroup) => (
                    <List.Item
                      actions={[
                        <Button
                          key="view"
                          type="link"
                          size="small"
                          onClick={() => handleViewGroupDetails(item)}
                        >
                          查看详情
                        </Button>,
                        <Popconfirm
                          key="batch-resolve"
                          title={`确认将这 ${item.count} 条相同错误全部标记为已处理？`}
                          onConfirm={() => handleBatchResolve(item)}
                        >
                          <Button type="link" size="small" loading={batchResolveMutation.isPending}>
                            全部已处理
                          </Button>
                        </Popconfirm>,
                      ]}
                    >
                      <Space style={{ width: '100%' }} direction="vertical" size={0}>
                        <Space>
                          <Tag color={item.source === 'frontend' ? 'blue' : 'red'}>
                            {item.source === 'frontend' ? '前端' : '后端'}
                          </Tag>
                          <Text type="danger" ellipsis style={{ maxWidth: 500 }}>
                            {item.message}
                          </Text>
                          <Tag color="orange">×{item.count}</Tag>
                        </Space>
                        <Text type="secondary" className="text-xs">
                          首次: {new Date(item.firstCreatedAt).toLocaleString('zh-CN')} · 最后:
                          {new Date(item.lastCreatedAt).toLocaleString('zh-CN')} · 样本ID:{' '}
                          {item.sampleId}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ),
            },
          ]}
        />
      )}

      {/* 搜索区 */}
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索错误消息"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => {
            setKeyword(v || undefined)
            setPage(1)
          }}
          style={{ width: 260 }}
          allowClear
        />
        <Select
          placeholder="来源"
          value={sourceFilter}
          onChange={(v) => {
            setSourceFilter(v)
            setPage(1)
          }}
          allowClear
          style={{ width: 120 }}
          options={[
            { value: 'frontend', label: '前端' },
            { value: 'backend', label: '后端' },
          ]}
        />
        <Select
          placeholder="状态"
          value={resolvedFilter}
          onChange={(v) => {
            setResolvedFilter(v)
            setPage(1)
          }}
          allowClear
          style={{ width: 120 }}
          options={[
            { value: 'false', label: '未处理' },
            { value: 'true', label: '已处理' },
          ]}
        />
      </Space>

      <Table<ErrorLog>
        rowKey="id"
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={isLoading}
        locale={{ emptyText: <Empty description="暂无错误日志" /> }}
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

      <Drawer title="错误详情" open={!!selectedLog} onClose={() => setSelectedLog(null)} size={640}>
        {selectedLog && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong>来源：</Text>
              <Tag color={selectedLog.source === 'frontend' ? 'blue' : 'red'}>
                {selectedLog.source}
              </Tag>
            </div>
            <div>
              <Text strong>类型：</Text>
              <Text>{selectedLog.errorType ?? '-'}</Text>
            </div>
            <div>
              <Text strong>状态：</Text>
              <Tag color={selectedLog.isResolved ? 'green' : 'error'}>
                {selectedLog.isResolved ? '已处理' : '未处理'}
              </Tag>
            </div>
            <div>
              <Text strong>消息：</Text>
              <Paragraph type="danger">{selectedLog.message}</Paragraph>
            </div>
            {selectedLog.file && (
              <div>
                <Text strong>文件：</Text>
                <Text>
                  {selectedLog.file}:{selectedLog.line}:{selectedLog.column}
                </Text>
              </div>
            )}
            {selectedLog.url && (
              <div>
                <Text strong>URL：</Text>
                <Text>{selectedLog.url}</Text>
              </div>
            )}
            {selectedLog.method && (
              <div>
                <Text strong>方法：</Text>
                <Text>{selectedLog.method}</Text>
              </div>
            )}
            {selectedLog.statusCode && (
              <div>
                <Text strong>状态码：</Text>
                <Text>{selectedLog.statusCode}</Text>
              </div>
            )}
            <div>
              <Text strong>用户ID：</Text>
              <Text>{selectedLog.userId ?? '-'}</Text>
            </div>
            <div>
              <Text strong>IP：</Text>
              <Text>{selectedLog.ip ?? '-'}</Text>
            </div>
            <div>
              <Text strong>UserAgent：</Text>
              <Text>{selectedLog.userAgent ?? '-'}</Text>
            </div>
            <div>
              <Text strong>时间：</Text>
              <Text>{new Date(selectedLog.createdAt).toLocaleString('zh-CN')}</Text>
            </div>
            {selectedLog.resolvedAt && (
              <div>
                <Text strong>处理时间：</Text>
                <Text>{new Date(selectedLog.resolvedAt).toLocaleString('zh-CN')}</Text>
              </div>
            )}
            <div>
              <Text strong>堆栈：</Text>
              <Paragraph>
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 12,
                    overflow: 'auto',
                    fontSize: 12,
                    maxHeight: 320,
                  }}
                >
                  {selectedLog.stack ?? '无堆栈信息'}
                </pre>
              </Paragraph>
            </div>
            <div>
              <Text strong>上下文：</Text>
              <Paragraph>
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 12,
                    overflow: 'auto',
                    fontSize: 12,
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(selectedLog.context, null, 2)}
                </pre>
              </Paragraph>
            </div>
          </Space>
        )}
      </Drawer>
    </>
  )
}

// ===== 白名单 Tab =====

interface WhitelistFormValues {
  pattern: string
  matchType: 'message' | 'url'
  description?: string
  isActive: boolean
}

function WhitelistTab() {
  const { data, isLoading, isError, error } = useWhitelist()
  const createMutation = useCreateWhitelist()
  const updateMutation = useUpdateWhitelist()
  const deleteMutation = useDeleteWhitelist()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm<WhitelistFormValues>()
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  const openCreate = () => {
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({
      matchType: 'message',
      isActive: true,
    })
    setModalOpen(true)
  }

  const openEdit = (record: ErrorWhitelist) => {
    setEditingId(record.id)
    form.setFieldsValue({
      pattern: record.pattern,
      matchType: record.matchType,
      description: record.description ?? undefined,
      isActive: record.isActive,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: values })
        messageApi.success('更新成功')
      } else {
        await createMutation.mutateAsync(values)
        messageApi.success('创建成功')
      }
      setModalOpen(false)
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '操作失败'))
    }
  }

  const handleToggleActive = async (record: ErrorWhitelist, checked: boolean) => {
    try {
      await updateMutation.mutateAsync({ id: record.id, data: { isActive: checked } })
      messageApi.success(checked ? '已启用' : '已禁用')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '操作失败'))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      messageApi.success('删除成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '删除失败'))
    }
  }

  const columns: ColumnsType<ErrorWhitelist> = [
    {
      title: '匹配模式',
      dataIndex: 'pattern',
      ellipsis: true,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '匹配类型',
      dataIndex: 'matchType',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'url' ? 'blue' : 'orange'}>{v === 'url' ? 'URL' : '消息'}</Tag>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      render: (v: boolean, record: ErrorWhitelist) => (
        <Switch
          checked={v}
          size="small"
          onChange={(checked) => handleToggleActive(record, checked)}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, record: ErrorWhitelist) => {
        const actions: { key: string; node: ReactNode }[] = [
          {
            key: 'edit',
            node: (
              <Button type="link" size="small" onClick={() => openEdit(record)}>
                编辑
              </Button>
            ),
          },
          {
            key: 'delete',
            node: (
              <Popconfirm title="确认删除该白名单规则？" onConfirm={() => handleDelete(record.id)}>
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]
        return (
          <Space size={0}>
            {actions.map((item, i) => (
              <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <Divider type="vertical" style={{ margin: '0 4px' }} />}
                {item.node}
              </span>
            ))}
          </Space>
        )
      },
    },
  ]

  return (
    <>
      {contextHolder}

      <div className="flex justify-end mb-4">
        <Button type="primary" onClick={openCreate}>
          新增白名单
        </Button>
      </div>

      <Table<ErrorWhitelist>
        rowKey="id"
        bordered
        columns={columns}
        dataSource={data ?? []}
        loading={isLoading}
        locale={{ emptyText: <Empty description="暂无白名单规则" /> }}
        pagination={false}
      />

      <Modal
        title={editingId ? '编辑白名单' : '新增白名单'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
      >
        <Form<WhitelistFormValues> form={form} layout="vertical">
          <Form.Item
            name="pattern"
            label="匹配模式"
            rules={[{ required: true, message: '请输入匹配模式' }]}
            extra="匹配类型为消息时，错误消息包含此字符串则过滤；为 URL 时，请求 URL 包含此字符串则过滤"
          >
            <Input placeholder="如 ECONNRESET 或 /api/v1/health" />
          </Form.Item>
          <Form.Item name="matchType" label="匹配类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'message', label: '消息（错误消息包含）' },
                { value: 'url', label: 'URL（请求路径包含）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="可选，说明此规则的用途" />
          </Form.Item>
          <Form.Item name="isActive" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
