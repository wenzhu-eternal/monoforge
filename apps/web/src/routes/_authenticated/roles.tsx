import type { CreateRole, Role, UpdateRole } from '@shared'
import { CreateRoleSchema, DEFAULT_PAGE_SIZE } from '@shared'
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
import { useEffect, useRef, useState } from 'react'
import { renderListEmpty } from '@/components/list-empty'
import { useCan } from '@/hooks/use-auth'
import { usePagedFallback } from '@/hooks/use-paged-fallback'
import {
  useAllPermissions,
  useAllRolePermissions,
  useRolePermissions,
  useUpdateRolePermissions,
} from '@/hooks/use-permissions'
import {
  useCreateRole,
  useDeleteRole,
  useRestoreRole,
  useRoles,
  useUpdateRole,
} from '@/hooks/use-roles'
import { extractErrorMessage } from '@/lib/error'
import { schemaLengthRule } from '@/lib/form-rules'
import { PermissionCodes } from '@/lib/permissions'

const { Title } = Typography

export const Route = createFileRoute('/_authenticated/roles')({
  component: RolesPage,
})

function RolePermissionCodes({ roleId }: { roleId: number }) {
  const can = useCan()
  // L21：一次性拉全量角色权限关联做行内聚合，避免每行一个 useRolePermissions 的 N+1
  const { data: allRolePermissions, isError } = useAllRolePermissions()
  const { data: allPermissions } = useAllPermissions()

  // M5：查询按 permission:view 门控，无权限时显式占位区分"没权限"与"没有权限项"
  if (!can(PermissionCodes.PERMISSION_VIEW)) {
    return <span className="text-gray-400">无查看权限</span>
  }

  // L19：请求失败（429/网络错）与"确无权限"都曾显示 '-'，失败态必须可辨
  if (isError) {
    return <span className="text-gray-400">加载失败</span>
  }

  const permissions = allRolePermissions
    ?.filter((rp) => rp.roleId === roleId)
    .map((rp) => rp.permission)

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

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
export function RolesContent() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false)
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState<string[]>([])
  const [messageApi, contextHolder] = message.useMessage()
  // L1：行级 pending，仅转正在操作的那行
  // L1：Set 类型，完成只删自己，避免并发行操作互抹 loading
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [restoringIds, setRestoringIds] = useState<Set<number>>(new Set())

  const { data, isLoading, isError, error, isSuccess, refetch } = useRoles({ page, pageSize })
  usePagedFallback(data?.list.length, isSuccess, page, setPage)
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const deleteRole = useDeleteRole()
  const restoreRole = useRestoreRole()

  // M13：按钮级权限（与后端 ROLE_*/PERMISSION_UPDATE 守卫同码），无权限不渲染
  const can = useCan()
  // M5：权限下拉按 permission:view 门控，无权限时配置弹窗给显式占位
  const canViewPerms = can(PermissionCodes.PERMISSION_VIEW)

  const { data: allPermissions, isLoading: allPermissionsLoading } = useAllPermissions()
  const {
    data: currentPermissions,
    isFetching: currentPermsFetching,
    isError: currentPermsError,
    refetch: refetchCurrentPerms,
  } = useRolePermissions(selectedRoleId || 0)
  const updateRolePermissions = useUpdateRolePermissions()

  const [roleForm] = Form.useForm<CreateRole & UpdateRole>()

  // 仅在切换到新角色时同步 server data，避免 invalidateQueries 后覆盖用户本地修改
  const initializedForRoleId = useRef<number | null>(null)

  useEffect(() => {
    if (isError) {
      messageApi.error(extractErrorMessage(error, '加载失败'))
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
        // M13：动作按钮按权限码渲染——编辑/禁用/恢复 ROLE_*，配置权限对应后端 PERMISSION_UPDATE
        const actions: { key: string; node: ReactNode }[] = []
        if (can(PermissionCodes.ROLE_UPDATE)) {
          actions.push({
            key: 'edit',
            node: (
              <Button type="link" onClick={() => handleEditRole(record)} disabled={isDeleted}>
                编辑
              </Button>
            ),
          })
        }
        if (can(PermissionCodes.PERMISSION_UPDATE)) {
          actions.push({
            key: 'perm',
            node: (
              <Button type="link" onClick={() => handleOpenPermission(record)} disabled={isDeleted}>
                配置权限
              </Button>
            ),
          })
        }
        if (can(PermissionCodes.ROLE_DELETE)) {
          actions.push({
            key: 'restore',
            node: (
              <Popconfirm
                title="确定要恢复该角色吗？"
                onConfirm={() => handleRestoreRole(record.id)}
              >
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
                title={isDeleted ? '角色已禁用' : '确定要禁用该角色吗？'}
                onConfirm={() => handleDeleteRole(record.id)}
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

  const handleEditRole = (role: Role) => {
    setEditingRole(role)
    roleForm.setFieldsValue({ name: role.name, description: role.description ?? undefined })
    setIsRoleModalOpen(true)
  }

  const handleDeleteRole = async (id: number) => {
    setDeletingIds((prev) => new Set(prev).add(id))
    try {
      await deleteRole.mutateAsync(id)
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

  const handleRestoreRole = async (id: number) => {
    setRestoringIds((prev) => new Set(prev).add(id))
    try {
      await restoreRole.mutateAsync(id)
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
    // L13/M4：allPermissions 未就绪或权限回显出错/仍在加载时禁用提交，防空勾选集覆盖清空角色权限
    if (!allPermissions || currentPermsError || currentPermsFetching) {
      messageApi.warning('权限回显加载失败或仍在加载，请稍后再提交')
      return
    }

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

  // L10：首次打开且服务端回显仍在途——期间禁用勾选/确定，防晚到数据覆盖用户已勾选项后静默丢失
  const permsSyncing =
    selectedRoleId !== null &&
    initializedForRoleId.current !== selectedRoleId &&
    currentPermsFetching

  return (
    <>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>角色管理</Title>
        {can(PermissionCodes.ROLE_CREATE) && (
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
        )}
      </div>

      <Table
        bordered
        columns={columns}
        dataSource={data?.list}
        rowKey="id"
        loading={isLoading}
        locale={{
          emptyText: renderListEmpty({ isError, onRetry: refetch, emptyText: '暂无角色' }),
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
            rules={[
              { required: true, message: '请输入角色名' },
              schemaLengthRule(CreateRoleSchema.shape.name, '角色名'),
            ]}
          >
            <Input />
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
        confirmLoading={updateRolePermissions.isPending || permsSyncing}
        okButtonProps={{
          disabled: permsSyncing || !allPermissions || currentPermsError || currentPermsFetching,
        }}
        width={640}
      >
        {currentPermsError && (
          <Alert
            type="error"
            showIcon
            className="mb-2"
            title="权限回显加载失败，请关闭弹窗后重试"
            action={
              <Button size="small" onClick={() => refetchCurrentPerms()}>
                重试
              </Button>
            }
          />
        )}
        <div className="max-h-96 overflow-y-auto">
          {allPermissionsLoading ? (
            <div className="text-center py-4 text-gray-400">加载中...</div>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 py-2 bg-gray-50 rounded mb-0">
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedPermissionCodes.length > 0 && !allSelected}
                  onChange={(e) => handleToggleAll(e.target.checked)}
                  disabled={permsSyncing}
                >
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
                      disabled={permsSyncing}
                    >
                      <span>{p.name}</span>
                      <span className="text-gray-400 text-xs ml-2">({p.code})</span>
                    </Checkbox>
                  </div>
                ))}
              </div>
              {(!allPermissions || allPermissions.length === 0) && (
                <div className="text-center text-gray-500 py-4">
                  {canViewPerms ? '暂无可用权限' : '无权限查看权限列表'}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  )
}

function RolesPage() {
  // J4：布局与守卫上移 _authenticated pathless layout，此处直 render 内容
  return <RolesContent />
}
