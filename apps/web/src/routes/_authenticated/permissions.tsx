import type { Permission } from '@shared'
import { CreatePermissionSchema, DEFAULT_PAGE_SIZE } from '@shared'
import { createFileRoute } from '@tanstack/react-router'
import {
  Alert,
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
import { renderListEmpty } from '@/components/list-empty'
import { useCan } from '@/hooks/use-auth'
import { usePagedFallback } from '@/hooks/use-paged-fallback'
import type { RouteMeta } from '@/hooks/use-permissions'
import {
  useCreatePermission,
  useDeletePermission,
  usePermissions,
  useRestorePermission,
  useRoutes,
  useUpdatePermission,
} from '@/hooks/use-permissions'
import { extractErrorMessage } from '@/lib/error'
import { schemaLengthRule } from '@/lib/form-rules'
import { PermissionCodes } from '@/lib/permissions'

const { Title } = Typography

export const Route = createFileRoute('/_authenticated/permissions')({
  component: PermissionCodesPage,
})

function PermissionCodesPage() {
  // J4：布局与守卫上移 _authenticated pathless layout，此处直 render 内容
  return <PermissionCodesContent />
}

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
export function PermissionCodesContent() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingPermission, setEditingPermission] = useState<Permission | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false)
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([])
  const [messageApi, contextHolder] = message.useMessage()
  // L1：行级 pending，仅转正在操作的那行
  // L1：Set 类型，完成只删自己，避免并发行操作互抹 loading
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [restoringIds, setRestoringIds] = useState<Set<number>>(new Set())

  const { data, isLoading, isError, error, isSuccess, refetch } = usePermissions({ page, pageSize })
  usePagedFallback(data?.list.length, isSuccess, page, setPage)
  const {
    data: allRoutes,
    isError: routesError,
    error: routesErr,
    isLoading: routesLoading,
    refetch: refetchRoutes,
  } = useRoutes()
  const createPermission = useCreatePermission()
  const updatePermission = useUpdatePermission()
  const deletePermission = useDeletePermission()
  const restorePermission = useRestorePermission()

  // M13：按钮级权限（与后端 PERMISSION_* 守卫同码），无权限不渲染
  const can = useCan()

  const [form] = Form.useForm()

  useEffect(() => {
    if (isError) {
      messageApi.error(extractErrorMessage(error, '加载失败'))
    }
  }, [isError, error, messageApi])

  useEffect(() => {
    if (routesError) {
      messageApi.error(extractErrorMessage(routesErr, '路由加载失败'))
    }
  }, [routesError, routesErr, messageApi])

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
      title: '删除状态',
      key: 'deleteStatus',
      render: (_, record) => {
        const isDeleted = !!record.deletedAt
        return (
          <span className={isDeleted ? 'text-red-500' : 'text-green-500'}>
            {isDeleted ? '已禁用' : '正常'}
          </span>
        )
      },
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
      width: 280,
      render: (_, record) => {
        const isDeleted = !!record.deletedAt
        // M13：编辑与配置路由提交均走 PATCH /permissions/:id（PERMISSION_UPDATE）
        const actions: { key: string; node: ReactNode }[] = []
        if (can(PermissionCodes.PERMISSION_UPDATE)) {
          actions.push({
            key: 'edit',
            node: (
              <Button type="link" onClick={() => handleEdit(record)} disabled={isDeleted}>
                编辑
              </Button>
            ),
          })
          actions.push({
            key: 'routes',
            node: (
              <Button
                type="link"
                onClick={() => handleConfigureRoutes(record)}
                disabled={isDeleted}
              >
                配置路由
              </Button>
            ),
          })
        }
        if (can(PermissionCodes.PERMISSION_DELETE)) {
          actions.push({
            key: 'restore',
            node: (
              <Popconfirm title="确定要恢复该权限吗？" onConfirm={() => handleRestore(record.id)}>
                <Button type="link" disabled={!isDeleted} loading={restoringIds.has(record.id)}>
                  恢复
                </Button>
              </Popconfirm>
            ),
          })
          actions.push({
            key: 'delete',
            node: (
              <Popconfirm
                title={isDeleted ? '权限已禁用' : '确定要禁用该权限吗？'}
                onConfirm={() => handleDelete(record.id)}
              >
                <Button
                  type="link"
                  danger
                  disabled={isDeleted}
                  loading={deletingIds.has(record.id)}
                >
                  禁用
                </Button>
              </Popconfirm>
            ),
          })
        }
        return (
          <Space size={0}>
            {actions.map((item, i) => (
              <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <Divider orientation="vertical" style={{ margin: '0 4px' }} />}
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
    form.setFieldsValue({
      code: permission.code,
      name: permission.name,
      description: permission.description ?? undefined,
    })
    setIsModalOpen(true)
  }

  const handleConfigureRoutes = (permission: Permission) => {
    setEditingPermission(permission)
    setSelectedRoutes(permission.routes || [])
    setIsRouteModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    setDeletingIds((prev) => new Set(prev).add(id))
    try {
      await deletePermission.mutateAsync(id)
      messageApi.success('禁用成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '禁用失败'))
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleRestore = async (id: number) => {
    setRestoringIds((prev) => new Set(prev).add(id))
    try {
      await restorePermission.mutateAsync(id)
      messageApi.success('恢复成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '恢复失败'))
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleSubmit = async (values: { code: string; name: string; description?: string }) => {
    try {
      if (editingPermission) {
        // L22：编辑时 code 不可改（后端一旦收紧即 400），仅提交允许字段（对齐 users 编辑仅提交 schema 字段）
        const { code: _code, ...rest } = values
        await updatePermission.mutateAsync({ id: editingPermission.id, data: rest })
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
    <>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>权限管理</Title>
        {can(PermissionCodes.PERMISSION_CREATE) && (
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
        )}
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={data?.list}
        rowKey="id"
        loading={isLoading}
        locale={{
          emptyText: renderListEmpty({ isError, onRetry: refetch, emptyText: '暂无权限码' }),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => {
            // L15：pageSize 变更重置到第 1 页，避免第 N 页改条数后逐页串行回退
            setPageSize(ps)
            setPage(ps === pageSize ? p : 1)
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
            rules={[
              { required: true, message: '请输入权限码' },
              schemaLengthRule(CreatePermissionSchema.shape.code, '权限码'),
            ]}
          >
            <Input placeholder="如: user:view" disabled={!!editingPermission} />
          </Form.Item>
          <Form.Item
            name="name"
            label="权限名"
            rules={[
              { required: true, message: '请输入权限名' },
              schemaLengthRule(CreatePermissionSchema.shape.name, '权限名'),
            ]}
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
        okButtonProps={{ disabled: routesLoading || routesError }}
        width={800}
      >
        {routesError && (
          <Alert
            type="error"
            showIcon
            className="mb-2"
            title="路由清单加载失败，完成加载前不能保存配置"
            action={
              <Button size="small" onClick={() => refetchRoutes()}>
                重试
              </Button>
            }
          />
        )}
        <div className="max-h-96 overflow-y-auto">
          {routesLoading ? (
            <div className="text-center text-gray-500 py-4">路由加载中...</div>
          ) : routesError ? (
            <div className="text-center text-red-500 py-4">
              路由加载失败：{(routesErr as Error)?.message ?? '未知错误'}
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
