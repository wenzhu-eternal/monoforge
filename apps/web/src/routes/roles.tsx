import type { CreateRole, Role, UpdateRole } from '@shared'
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
import { useEffect, useRef, useState } from 'react'
import {
  useAllPermissions,
  useRolePermissions,
  useUpdateRolePermissions,
} from '@/hooks/use-permissions'
import { useCreateRole, useDeleteRole, useRoles, useUpdateRole } from '@/hooks/use-roles'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'
import { PermissionCodes } from '@/lib/permissions'
import { requirePermission } from '@/lib/route-guards'

const { Title } = Typography

export const Route = createFileRoute('/roles')({
  beforeLoad: requirePermission(PermissionCodes.ROLE_VIEW),
  component: RolesPage,
})

function RolePermissionCodes({ roleId }: { roleId: number }) {
  const { data: permissions } = useRolePermissions(roleId)
  const { data: allPermissions } = useAllPermissions()

  if (!permissions || permissions.length === 0) {
    return <span className="text-gray-400">-</span>
  }

  const getPermissionName = (code: string) => {
    const p = allPermissions?.find((item) => item.code === code)
    return p?.name || code
  }

  return (
    <Space size={[4, 8]} wrap>
      {permissions.map((code) => (
        <Tag key={code}>{getPermissionName(code)}</Tag>
      ))}
    </Space>
  )
}

function RolesPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false)
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState<string[]>([])
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error } = useRoles({ page, pageSize, order: 'desc' })
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const deleteRole = useDeleteRole()

  const { data: allPermissions, isLoading: allPermissionsLoading } = useAllPermissions()
  const { data: currentPermissions } = useRolePermissions(selectedRoleId || 0)
  const updateRolePermissions = useUpdateRolePermissions()

  const [roleForm] = Form.useForm<CreateRole & UpdateRole>()

  // 仅在切换到新角色时同步 server data，避免 invalidateQueries 后覆盖用户本地修改
  const initializedForRoleId = useRef<number | null>(null)

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  useEffect(() => {
    if (
      selectedRoleId !== null &&
      initializedForRoleId.current !== selectedRoleId &&
      currentPermissions
    ) {
      setSelectedPermissionCodes(currentPermissions)
      initializedForRoleId.current = selectedRoleId
    }
  }, [currentPermissions, selectedRoleId])

  const columns: ColumnsType<Role> = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '角色名', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '权限',
      key: 'permissions',
      render: (_, record) => <RolePermissionCodes roleId={record.id} />,
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
              <Button type="link" onClick={() => handleEditRole(record)}>
                编辑
              </Button>
            ),
          },
          {
            key: 'perm',
            node: (
              <Button type="link" onClick={() => handleOpenPermission(record)}>
                配置权限
              </Button>
            ),
          },
          {
            key: 'delete',
            node: (
              <Popconfirm
                title="确定要删除该角色吗？"
                onConfirm={() => handleDeleteRole(record.id)}
              >
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
                {i > 0 && <Divider orientation="vertical" style={{ margin: '0 4px' }} />}
                {item.node}
              </span>
            ))}
          </Space>
        )
      },
    },
  ]

  const handleEditRole = (role: Role) => {
    setEditingRole(role)
    roleForm.setFieldsValue({ ...role, description: role.description ?? undefined })
    setIsRoleModalOpen(true)
  }

  const handleDeleteRole = async (id: number) => {
    try {
      await deleteRole.mutateAsync(id)
      messageApi.success('删除成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '删除失败'))
    }
  }

  const handleRoleSubmit = async (values: CreateRole | UpdateRole) => {
    try {
      if (editingRole) {
        await updateRole.mutateAsync({ id: editingRole.id, data: values as UpdateRole })
        messageApi.success('更新成功')
      } else {
        await createRole.mutateAsync(values as CreateRole)
        messageApi.success('创建成功')
      }
      setIsRoleModalOpen(false)
      roleForm.resetFields()
      setEditingRole(null)
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '操作失败'))
    }
  }

  const handleOpenPermission = (role: Role) => {
    // 重置 ref 让 useEffect 走首次同步分支，确保二次打开能回显
    initializedForRoleId.current = null
    setSelectedRoleId(role.id)
    setSelectedPermissionCodes([])
    setIsPermissionModalOpen(true)
  }

  const handlePermissionSubmit = async () => {
    if (!selectedRoleId) return

    try {
      await updateRolePermissions.mutateAsync({
        roleId: selectedRoleId,
        permissions: selectedPermissionCodes,
      })
      messageApi.success('权限更新成功')
      setIsPermissionModalOpen(false)
      setSelectedRoleId(null)
      initializedForRoleId.current = null
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '权限更新失败'))
    }
  }

  const handlePermissionToggle = (code: string, checked: boolean) => {
    setSelectedPermissionCodes((prev) =>
      checked ? [...prev, code] : prev.filter((p) => p !== code),
    )
  }

  const handleToggleAll = (checked: boolean) => {
    if (!allPermissions) return
    setSelectedPermissionCodes(checked ? allPermissions.map((p) => p.code) : [])
  }

  const allSelected = allPermissions && selectedPermissionCodes.length === allPermissions.length

  return (
    <AuthenticatedLayout>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>角色管理</Title>
        <Button
          type="primary"
          onClick={() => {
            setEditingRole(null)
            roleForm.resetFields()
            setIsRoleModalOpen(true)
          }}
        >
          新建角色
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
        title={editingRole ? '编辑角色' : '新建角色'}
        open={isRoleModalOpen}
        onCancel={() => {
          setIsRoleModalOpen(false)
          roleForm.resetFields()
          setEditingRole(null)
        }}
        onOk={() => roleForm.submit()}
        confirmLoading={createRole.isPending || updateRole.isPending}
      >
        <Form form={roleForm} onFinish={handleRoleSubmit} layout="vertical">
          <Form.Item
            name="name"
            label="角色名"
            rules={[{ required: true, message: '请输入角色名' }]}
          >
            <Input disabled={!!editingRole} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="配置权限"
        open={isPermissionModalOpen}
        onCancel={() => {
          setIsPermissionModalOpen(false)
          setSelectedRoleId(null)
          initializedForRoleId.current = null
        }}
        onOk={handlePermissionSubmit}
        confirmLoading={updateRolePermissions.isPending}
        width={640}
      >
        <div className="max-h-96 overflow-y-auto">
          {allPermissionsLoading ? (
            <div className="text-center py-4 text-gray-400">加载中...</div>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 py-2 bg-gray-50 rounded mb-0">
                <Checkbox checked={allSelected} onChange={(e) => handleToggleAll(e.target.checked)}>
                  全选
                </Checkbox>
                <span className="text-xs text-gray-400">
                  {selectedPermissionCodes.length}/{allPermissions?.length ?? 0}
                </span>
              </div>
              <div className="py-1">
                {allPermissions?.map((p) => (
                  <div key={p.code} className="flex items-center px-2 py-2.5 hover:bg-gray-50">
                    <Checkbox
                      checked={selectedPermissionCodes.includes(p.code)}
                      onChange={(e) => handlePermissionToggle(p.code, e.target.checked)}
                    >
                      <span>{p.name}</span>
                      <span className="text-gray-400 text-xs ml-2">({p.code})</span>
                    </Checkbox>
                  </div>
                ))}
              </div>
              {(!allPermissions || allPermissions.length === 0) && (
                <div className="text-center text-gray-500 py-4">暂无可用权限</div>
              )}
            </>
          )}
        </div>
      </Modal>
    </AuthenticatedLayout>
  )
}
