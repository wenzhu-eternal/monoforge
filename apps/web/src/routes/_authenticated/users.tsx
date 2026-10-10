import type { CreateUser, UpdateUser, User } from '@shared'
import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useCan } from '@/hooks/use-auth'
import { usePagedFallback } from '@/hooks/use-paged-fallback'
import { useAllRoles } from '@/hooks/use-roles'
import {
  useCreateUser,
  useDeleteUser,
  useRestoreUser,
  useUpdateUser,
  useUsers,
} from '@/hooks/use-users'
import { extractErrorMessage } from '@/lib/error'
import { emailRule, passwordRule, phoneRule, usernameRule } from '@/lib/form-rules'
import { PermissionCodes } from '@/lib/permissions'

const { Title } = Typography

export const Route = createFileRoute('/_authenticated/users')({
  component: UsersPage,
})

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
function UsersPage() {
  // J4：布局与守卫上移 _authenticated pathless layout，此处直 render 内容
  return <UsersContent />
}

function UsersContent() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error, isSuccess } = useUsers({
    page,
    pageSize,
  })
  usePagedFallback(data?.list.length, isSuccess, page, setPage)
  const { data: allRoles } = useAllRoles()
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const deleteUser = useDeleteUser()
  const restoreUser = useRestoreUser()

  // L18/M13：按钮级权限统一走 useCan——读新鲜 me（布局层已预热，query 去重），
  // 与后端 PermissionsGuard 同码，无权限的写操作按钮直接不渲染
  const can = useCan()
  const canManageRole = can(PermissionCodes.USER_ROLE_MANAGE)

  const [form] = Form.useForm<CreateUser & UpdateUser & { roleId?: number }>()

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  const columns: ColumnsType<User> = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname' },
    {
      title: '角色',
      key: 'role',
      render: (_, record) => {
        const role = record.roles?.[0]
        return role?.name ?? '-'
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: boolean) => (
        <span className={status ? 'text-green-500' : 'text-red-500'}>
          {status ? '启用' : '禁用'}
        </span>
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
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => {
        // L19：按角色名判定初始管理员（原硬编码 roleId===1，ADMIN_ROLE_ID 改配后误放行/误禁用）
        const isAdmin = record.roles?.[0]?.name === 'admin'
        const isDeleted = !!record.deletedAt
        // M13：动作按钮按 USER_* 权限码渲染，与后端守卫同码
        const actions: { key: string; node: ReactNode }[] = []
        if (can(PermissionCodes.USER_UPDATE)) {
          actions.push({
            key: 'edit',
            node: (
              <Button type="link" onClick={() => handleEdit(record)} disabled={isDeleted}>
                编辑
              </Button>
            ),
          })
        }
        if (can(PermissionCodes.USER_DELETE)) {
          actions.push({
            key: 'restore',
            node: (
              <Popconfirm title="确定要恢复该用户吗？" onConfirm={() => handleRestore(record.id)}>
                <Button type="link" disabled={!isDeleted}>
                  恢复
                </Button>
              </Popconfirm>
            ),
          })
          actions.push({
            key: 'delete',
            node: (
              <Popconfirm
                title={
                  isAdmin
                    ? '初始管理员账号不可删除'
                    : isDeleted
                      ? '用户已禁用'
                      : '确定要禁用该用户吗？'
                }
                disabled={isAdmin || isDeleted}
                onConfirm={() => handleDelete(record.id)}
              >
                <Button type="link" danger disabled={isAdmin || isDeleted}>
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

  const handleEdit = (user: User) => {
    setEditingUser(user)
    // 仅写入表单需要的字段，避免 avatar/roles/permissions/createdAt 等污染 form store
    form.setFieldsValue({
      username: user.username,
      email: user.email,
      nickname: user.nickname ?? undefined,
      phone: user.phone ?? undefined,
      roleId: user.roles?.[0]?.id,
      status: user.status,
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteUser.mutateAsync(id)
      messageApi.success('禁用成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '禁用失败'))
    }
  }

  const handleRestore = async (id: number) => {
    try {
      await restoreUser.mutateAsync(id)
      messageApi.success('恢复成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '恢复失败'))
    }
  }

  const handleSubmit = async (values: CreateUser & UpdateUser & { roleId?: number }) => {
    try {
      if (editingUser) {
        // 编辑时仅提交 schema 允许的字段，避免携带 avatar/roleName/roles 等
        // 额外字段触发 Zod 校验失败（avatar 必须是合法 URL）
        const updateData: UpdateUser = {
          nickname: values.nickname,
          phone: values.phone,
        }
        // 邮箱/角色/状态变更后端要求 USER_ROLE_MANAGE，无权限时不提交避免 403
        if (canManageRole) {
          updateData.email = values.email
          // J5：编辑时清空角色选择 = 解绑角色（显式 null）；undefined=未改动不提交。
          // 初值有角色而提交为 undefined，说明用户点了清除
          updateData.roleId =
            values.roleId ?? (editingUser.roles?.[0]?.id != null ? null : undefined)
          updateData.status = values.status
        }
        if (values.password) {
          updateData.password = values.password
        }
        await updateUser.mutateAsync({ id: editingUser.id, data: updateData })
        messageApi.success('更新成功')
      } else {
        const createData: CreateUser = {
          username: values.username,
          email: values.email,
          password: values.password,
          nickname: values.nickname,
          phone: values.phone,
        }
        // 仅持角色管理权限时才提交 roleId（后端对越权指定返回 403）
        if (canManageRole && values.roleId) {
          createData.roleId = values.roleId
        }
        await createUser.mutateAsync(createData)
        messageApi.success('创建成功')
      }
      setIsModalOpen(false)
      form.resetFields()
      setEditingUser(null)
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '操作失败'))
    }
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    form.resetFields()
    setEditingUser(null)
  }

  // L29：角色列表已过滤软删角色——下拉为空 ≠ 无角色，须视觉区分
  //（保存时不提交 roleId，绑定保持不变，不会触发后端"角色已被禁用"409）
  const roleDeletedHint =
    editingUser?.roleId != null && editingUser.roles?.[0]?.id == null
      ? `原角色已被删除（ID ${editingUser.roleId}），仍保持绑定；重新选择角色可更换`
      : undefined

  return (
    <>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>用户管理</Title>
        {can(PermissionCodes.USER_CREATE) && (
          <Button
            type="primary"
            onClick={() => {
              setEditingUser(null)
              form.resetFields()
              setIsModalOpen(true)
            }}
          >
            新建用户
          </Button>
        )}
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={data?.list}
        rowKey="id"
        loading={isLoading}
        locale={{ emptyText: <Empty description="暂无用户" /> }}
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
        title={editingUser ? '编辑用户' : '新建用户'}
        open={isModalOpen}
        onCancel={handleModalClose}
        onOk={() => form.submit()}
        confirmLoading={createUser.isPending || updateUser.isPending}
      >
        <Form form={form} onFinish={handleSubmit} layout="vertical">
          {!editingUser && (
            <>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }, usernameRule]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ required: true, message: '请输入邮箱' }, emailRule]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: '请输入密码' }, passwordRule]}
              >
                <Input.Password />
              </Form.Item>
            </>
          )}
          {editingUser && (
            <>
              <Form.Item name="username" label="用户名">
                <Input disabled />
              </Form.Item>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ required: true, message: '请输入邮箱' }, emailRule]}
              >
                <Input disabled={!canManageRole} />
              </Form.Item>
              <Form.Item
                name="password"
                label="新密码"
                rules={[passwordRule]}
                extra="留空则不修改密码"
              >
                <Input.Password placeholder="留空则不修改" />
              </Form.Item>
            </>
          )}
          <Form.Item name="nickname" label="昵称" rules={[{ max: 50, message: '昵称最多 50 字' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机号" rules={[phoneRule]}>
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item
            name="roleId"
            label="角色"
            rules={canManageRole && !editingUser ? [{ required: true, message: '请选择角色' }] : []}
            extra={
              roleDeletedHint ??
              (canManageRole ? undefined : '无角色管理权限，将默认分配普通用户角色')
            }
          >
            <Select
              placeholder="请选择角色"
              // J5：编辑时允许清空以解绑角色；新建仍必填（rules 保证）
              allowClear={!canManageRole || !!editingUser}
              disabled={!canManageRole}
              options={allRoles?.map((role) => ({
                value: role.id,
                label: role.name,
              }))}
            />
          </Form.Item>
          {editingUser && (
            <Form.Item name="status" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" disabled={!canManageRole} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  )
}
