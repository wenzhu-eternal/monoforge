import type { Permission } from '@shared'
import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  message,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { RouteMeta } from '@/hooks/use-permissions'
import {
  useCreatePermission,
  useDeletePermission,
  usePermissions,
  useRoutes,
  useUpdatePermission,
} from '@/hooks/use-permissions'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'

const { Title } = Typography

export const Route = createFileRoute('/permissions')({
  component: PermissionsPage,
})

function PermissionsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editingPermission, setEditingPermission] = useState<Permission | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false)
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([])
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error } = usePermissions({ page, pageSize })
  const { data: allRoutes } = useRoutes()
  const createPermission = useCreatePermission()
  const updatePermission = useUpdatePermission()
  const deletePermission = useDeletePermission()

  const [form] = Form.useForm()

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  const columns: ColumnsType<Permission> = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '权限码', dataIndex: 'code', key: 'code' },
    { title: '权限名', dataIndex: 'name', key: 'name' },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v: string | null) => v ?? '-',
    },
    {
      title: 'API 路由',
      dataIndex: 'routes',
      key: 'routes',
      render: (routes: string[] | null) => (
        <Space size={[4, 8]} wrap>
          {routes?.map((route) => (
            <Tag key={route}>{route}</Tag>
          ))}
          {(!routes || routes.length === 0) && <span className="text-gray-400">未配置</span>}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_, record) => {
        const actions: { key: string; node: ReactNode }[] = [
          {
            key: 'edit',
            node: (
              <Button type="link" onClick={() => handleEdit(record)}>
                编辑
              </Button>
            ),
          },
          {
            key: 'routes',
            node: (
              <Button type="link" onClick={() => handleConfigureRoutes(record)}>
                配置路由
              </Button>
            ),
          },
          {
            key: 'delete',
            node: (
              <Popconfirm title="确定要删除该权限吗？" onConfirm={() => handleDelete(record.id)}>
                <Button type="link" danger>
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

  const handleEdit = (permission: Permission) => {
    setEditingPermission(permission)
    form.setFieldsValue(permission)
    setIsModalOpen(true)
  }

  const handleConfigureRoutes = (permission: Permission) => {
    setEditingPermission(permission)
    setSelectedRoutes(permission.routes || [])
    setIsRouteModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await deletePermission.mutateAsync(id)
      messageApi.success('删除成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '删除失败'))
    }
  }

  const handleSubmit = async (values: { code: string; name: string; description?: string }) => {
    try {
      if (editingPermission) {
        await updatePermission.mutateAsync({ id: editingPermission.id, data: values })
        messageApi.success('更新成功')
      } else {
        await createPermission.mutateAsync(values)
        messageApi.success('创建成功')
      }
      setIsModalOpen(false)
      form.resetFields()
      setEditingPermission(null)
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '操作失败'))
    }
  }

  const handleRouteSubmit = async () => {
    if (!editingPermission) return
    try {
      await updatePermission.mutateAsync({
        id: editingPermission.id,
        data: { routes: selectedRoutes },
      })
      messageApi.success('路由配置更新成功')
      setIsRouteModalOpen(false)
      setSelectedRoutes([])
      setEditingPermission(null)
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '路由配置更新失败'))
    }
  }

  const handleRouteToggle = (route: string, checked: boolean) => {
    if (checked) {
      setSelectedRoutes((prev) => [...prev, route])
    } else {
      setSelectedRoutes((prev) => prev.filter((r) => r !== route))
    }
  }

  return (
    <AuthenticatedLayout>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>权限管理</Title>
        <Button
          type="primary"
          onClick={() => {
            setEditingPermission(null)
            form.resetFields()
            setIsModalOpen(true)
          }}
        >
          新建权限
        </Button>
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={data?.list}
        rowKey="id"
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
      />
      <Modal
        title={editingPermission ? '编辑权限' : '新建权限'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false)
          form.resetFields()
          setEditingPermission(null)
        }}
        onOk={() => form.submit()}
        confirmLoading={createPermission.isPending || updatePermission.isPending}
      >
        <Form form={form} onFinish={handleSubmit} layout="vertical">
          <Form.Item
            name="code"
            label="权限码"
            rules={[{ required: true, message: '请输入权限码' }]}
          >
            <Input placeholder="如: user:view" disabled={!!editingPermission} />
          </Form.Item>
          <Form.Item
            name="name"
            label="权限名"
            rules={[{ required: true, message: '请输入权限名' }]}
          >
            <Input placeholder="如: 查看用户" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`配置路由 - ${editingPermission?.name || ''}`}
        open={isRouteModalOpen}
        onCancel={() => {
          setIsRouteModalOpen(false)
          setSelectedRoutes([])
          setEditingPermission(null)
        }}
        onOk={handleRouteSubmit}
        confirmLoading={updatePermission.isPending}
        width={800}
      >
        <div className="max-h-96 overflow-y-auto">
          {allRoutes?.map((route: RouteMeta) => (
            <div key={`${route.method} ${route.path}`} className="py-1">
              <Checkbox
                checked={selectedRoutes.includes(`${route.method} ${route.path}`)}
                onChange={(e) =>
                  handleRouteToggle(`${route.method} ${route.path}`, e.target.checked)
                }
              >
                <span className="font-mono text-sm">
                  <span className="text-blue-600">{route.method}</span>{' '}
                  <span className="text-gray-800">{route.path}</span>
                </span>
                <span className="text-gray-400 text-xs ml-2">
                  ({route.controller}.{route.handlerName})
                </span>
              </Checkbox>
            </div>
          ))}
          {(!allRoutes || allRoutes.length === 0) && (
            <div className="text-center text-gray-500 py-4">暂无可用路由</div>
          )}
        </div>
      </Modal>
    </AuthenticatedLayout>
  )
}
