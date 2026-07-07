import type { CreateUser, UpdateUser, User } from '@shared'
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
import { useRoles } from '@/hooks/use-roles'
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from '@/hooks/use-users'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'

const { Title } = Typography

export const Route = createFileRoute('/users')({
  component: UsersPage,
})

function UsersPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error } = useUsers({
    page,
    pageSize,
    order: 'desc',
  })
  const { data: rolesData } = useRoles({
    page: 1,
    pageSize: 100,
    order: 'desc',
  })
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const deleteUser = useDeleteUser()

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
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, record) => {
        const isAdmin = record.username === 'admin'
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
            key: 'delete',
            node: (
              <Popconfirm
                title={isAdmin ? '初始管理员账号不可删除' : '确定要删除该用户吗？'}
                disabled={isAdmin}
                onConfirm={() => handleDelete(record.id)}
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
                {i > 0 && <Divider type="vertical" style={{ margin: '0 4px' }} />}
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
    form.setFieldsValue({
      ...user,
      roleId: user.roles?.[0]?.id,
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteUser.mutateAsync(id)
      messageApi.success('删除成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '删除失败'))
    }
  }

  const handleSubmit = async (values: CreateUser & UpdateUser & { roleId?: number }) => {
    try {
      if (editingUser) {
        // 编辑时仅提交 schema 允许的字段，避免携带 avatar/roleName/roles 等
        // 额外字段触发 Zod 校验失败（avatar 必须是合法 URL）
        const updateData: UpdateUser = {
          email: values.email,
          nickname: values.nickname,
          phone: values.phone,
          roleId: values.roleId,
          status: values.status,
        }
        // 密码留空则不传
        if (values.password) {
          updateData.password = values.password
        }
        await updateUser.mutateAsync({ id: editingUser.id, data: updateData })
        messageApi.success('更新成功')
      } else {
        await createUser.mutateAsync(values as CreateUser)
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

  return (
    <AuthenticatedLayout>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>用户管理</Title>
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
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, min: 6, message: '密码至少 6 个字符' }]}
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
                rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="password"
                label="新密码"
                rules={[{ min: 6, message: '密码至少 6 个字符' }]}
                extra="留空则不修改密码"
              >
                <Input.Password placeholder="留空则不修改" />
              </Form.Item>
            </>
          )}
          <Form.Item name="nickname" label="昵称">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input />
          </Form.Item>
          <Form.Item name="roleId" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select
              placeholder="请选择角色"
              options={rolesData?.list.map((role) => ({
                value: role.id,
                label: role.name,
              }))}
            />
          </Form.Item>
          {editingUser && (
            <Form.Item name="status" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </AuthenticatedLayout>
  )
}
