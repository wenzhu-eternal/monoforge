import type { CreateUser, UpdateUser, User } from '@shared'
import { DEFAULT_PAGE_SIZE, UpdateUserSchema } from '@shared'
import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  Divider,
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
import { renderListEmpty } from '@/components/list-empty'
import { useCan, useCurrentUser } from '@/hooks/use-auth'
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
import {
  emailRule,
  passwordRule,
  phoneRule,
  schemaLengthRule,
  usernameRule,
} from '@/lib/form-rules'
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

export function UsersContent() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // L1：行级 pending，仅转正在操作的那行，避免全表同时转圈及重复点击
  // L1：Set 类型，完成只删自己，避免并发行操作互抹 loading
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [restoringIds, setRestoringIds] = useState<Set<number>>(new Set())
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error, isSuccess, refetch } = useUsers({
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
  // M5：角色下拉走 role:view 门控，无权限时给显式占位而非静默空下拉
  const canViewRoles = can(PermissionCodes.ROLE_VIEW)
  // L19：行级初始管理员判定所需 adminRoleId（与 useCan 同 key ['auth','me']，无额外请求）
  const { data: me } = useCurrentUser()
  // L8：与后端 403 同条件——改自己须走 /me/password，改他人须 USER_ROLE_MANAGE
  const isSelf = editingUser != null && me?.id === editingUser.id

  const [form] = Form.useForm<
    CreateUser & UpdateUser & { roleId?: number; mustChangePassword?: boolean }
  >()

  useEffect(() => {
    if (isError) {
      messageApi.error(extractErrorMessage(error, '加载失败'))
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
            {isDeleted ? '已停用' : '正常'}
          </span>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => {
        // L19：行级判定读 /auth/me 下发的配置派生 adminRoleId（服务端单源），
        // 替代硬编码 roleId===1 与角色名判定——ADMIN_ROLE_ID 改配后同步跟随
        const isAdmin = record.roleId != null && record.roleId === me?.adminRoleId
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
                <Button
                  type="link"
                  danger
                  disabled={isAdmin || isDeleted}
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
      // M3：首登强制改密当前值（微信占位密码死锁的解锁入口）
      mustChangePassword: user.mustChangePassword,
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    setDeletingIds((prev) => new Set(prev).add(id))
    try {
      await deleteUser.mutateAsync(id)
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
      await restoreUser.mutateAsync(id)
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

  const handleSubmit = async (values: CreateUser & UpdateUser & { roleId?: number }) => {
    try {
      if (editingUser) {
        // 编辑时仅提交 schema 允许的字段，避免携带 avatar/roleName/roles 等
        // 额外字段触发 Zod 校验失败（avatar 必须是合法 URL）
        const updateData: UpdateUser = {
          nickname: values.nickname,
        }
        // M3：改他人手机号后端要求 USER_ROLE_MANAGE（L7 闸）——无权限/未变更时不提交，
        // 否则"仅改昵称"也会因恒带 phone 整弹窗 403；清空提交 null（'' 会被 regex 拒 400）
        const nextPhone = values.phone || null
        if ((canManageRole || isSelf) && nextPhone !== (editingUser.phone || null)) {
          updateData.phone = nextPhone
        }
        // 邮箱/角色/状态变更后端要求 USER_ROLE_MANAGE，无权限时不提交避免 403
        if (canManageRole) {
          updateData.email = values.email
        }
        // M2：自改 roleId/status 后端一律 403（不比对是否同值），isSelf 时不提交——
        // 否则编辑弹窗整功能失效（哪怕只改昵称也会被"不能修改自己的角色"打回）
        if (canManageRole && !isSelf) {
          // J5：编辑时清空角色选择 = 解绑角色（显式 null）；undefined=未改动不提交。
          // 初值有角色而提交为 undefined，说明用户点了清除
          updateData.roleId =
            values.roleId ?? (editingUser.roles?.[0]?.id != null ? null : undefined)
          updateData.status = values.status
          // M3：仅在值与当前不同才上送——避免"只改昵称"也重置强制改密态；
          // 后端对该字段要求 USER_ROLE_MANAGE，与 roleId/status 同一闸
          if (
            values.mustChangePassword !== undefined &&
            values.mustChangePassword !== editingUser.mustChangePassword
          ) {
            updateData.mustChangePassword = values.mustChangePassword
          }
        }
        // L8：与后端 403 条件对齐——改自己须走 /me/password，改他人须 USER_ROLE_MANAGE
        if (values.password && !isSelf && canManageRole) {
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
          // L13：未填/清空统一提交 null（'' 会被 regex 拒 400）
          phone: values.phone || null,
        }
        // 仅持角色管理权限时才提交 roleId（后端对越权指定返回 403）
        if (canManageRole && values.roleId) {
          createData.roleId = values.roleId
        }
        // L16：新建补同款解锁开关——默认强制首登改密（后端缺省 true），显式关闭才提交；
        // 原编辑弹窗独有此控件，管理员按交付场景批量建号后须逐个回列表解锁
        if (canManageRole && values.mustChangePassword === false) {
          createData.mustChangePassword = false
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
        locale={{
          emptyText: renderListEmpty({ isError, onRetry: refetch, emptyText: '暂无用户' }),
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
                extra={
                  isSelf
                    ? '修改自己的密码请使用「修改密码」功能'
                    : canManageRole
                      ? '留空则不修改密码'
                      : '无权限修改他人密码'
                }
              >
                <Input.Password disabled={isSelf || !canManageRole} placeholder="留空则不修改" />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="nickname"
            label="昵称"
            rules={[schemaLengthRule(UpdateUserSchema.shape.nickname, '昵称')]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[phoneRule]}
            extra={editingUser && !canManageRole && !isSelf ? '无权限修改他人手机号' : undefined}
          >
            <Input placeholder="选填" disabled={!!editingUser && !canManageRole && !isSelf} />
          </Form.Item>
          <Form.Item
            name="roleId"
            label="角色"
            rules={canManageRole && !editingUser ? [{ required: true, message: '请选择角色' }] : []}
            extra={
              roleDeletedHint ??
              (!canManageRole
                ? '无角色管理权限，将默认分配普通用户角色'
                : canViewRoles
                  ? undefined
                  : '无角色查看权限，无法加载角色列表')
            }
          >
            <Select
              placeholder={canViewRoles ? '请选择角色' : '无角色查看权限'}
              // J5：编辑时允许清空以解绑角色；新建仍必填（rules 保证）
              allowClear={!canManageRole || !!editingUser}
              disabled={isSelf || !canManageRole}
              options={allRoles?.map((role) => ({
                value: role.id,
                label: role.name,
              }))}
            />
          </Form.Item>
          {editingUser && (
            <Form.Item name="status" label="状态" valuePropName="checked">
              <Switch
                checkedChildren="启用"
                unCheckedChildren="禁用"
                disabled={isSelf || !canManageRole}
              />
            </Form.Item>
          )}
          {editingUser && canManageRole && !isSelf && (
            <Form.Item
              name="mustChangePassword"
              label="首登强制改密"
              valuePropName="checked"
              extra="微信登录用户的占位密码不可验证：关闭此项即解锁其登录"
            >
              <Switch checkedChildren="强制" unCheckedChildren="已解锁" />
            </Form.Item>
          )}
          {!editingUser && canManageRole && (
            <Form.Item
              name="mustChangePassword"
              label="首登强制改密"
              valuePropName="checked"
              initialValue
              extra="默认开启：用户首次登录须先修改密码；关闭后首次登录即可直接使用"
            >
              <Switch checkedChildren="强制" unCheckedChildren="已解锁" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  )
}
