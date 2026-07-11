import {
  DashboardOutlined,
  FileOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MailOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Navigate, useLocation, useNavigate } from '@tanstack/react-router'
import type { MenuProps } from 'antd'
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useCurrentUser, useLogout } from '@/hooks/use-auth'
import { Permissions } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth-store'

const { Sider, Header, Content } = Layout
const { Text } = Typography

/**
 * 外层守卫: 未认证直接 redirect 并返回 null，不挂任何业务 hook
 */
export const AuthenticatedLayout = ({ children }: { children: ReactNode }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <AuthenticatedLayoutInner>{children}</AuthenticatedLayoutInner>
}

/**
 * 内层: 已认证后才渲染
 * 布局: Sider 固定左侧，Header 固定顶部，只有 Content 区滚动
 */
function AuthenticatedLayoutInner({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const logoutMutation = useLogout()
  const user = useAuthStore((state) => state.user)
  const [collapsed, setCollapsed] = useState(false)

  // 自动刷新用户信息（包括 roles 字段）
  const { isLoading } = useCurrentUser()

  // 等待用户信息加载完成后再判断权限
  if (isLoading) {
    return null
  }

  // 权限判断函数
  const hasPermission = (permission: string) => {
    return user?.permissions?.includes(permission) ?? false
  }

  // 构建内容管理子菜单
  const contentChildren = [
    hasPermission(Permissions.USER_VIEW) && {
      key: '/users',
      icon: <UserOutlined />,
      label: '用户管理',
    },
    hasPermission(Permissions.FILE_VIEW) && {
      key: '/files',
      icon: <FileOutlined />,
      label: '文件管理',
    },
  ].filter(Boolean) as MenuProps['items']

  // 构建系统配置子菜单
  const systemChildren = [
    hasPermission(Permissions.ROLE_VIEW) && {
      key: '/roles',
      icon: <UserOutlined />,
      label: '角色管理',
    },
    hasPermission(Permissions.PERMISSION_VIEW) && {
      key: '/permissions',
      icon: <SettingOutlined />,
      label: '权限管理',
    },
  ].filter(Boolean) as MenuProps['items']

  // 构建日志审计子菜单
  const logChildren = [
    hasPermission(Permissions.AUDIT_VIEW) && {
      key: '/audit-logs',
      icon: <FileTextOutlined />,
      label: '审计日志',
    },
    hasPermission(Permissions.ERROR_LOG_VIEW) && {
      key: '/error-logs',
      icon: <WarningOutlined />,
      label: '错误日志',
    },
  ].filter(Boolean) as MenuProps['items']

  const menuItems: MenuProps['items'] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/websocket', icon: <ThunderboltOutlined />, label: 'WebSocket 演示' },
    // 邮件发送仅对 admin 角色开放
    ...(user?.roles?.some((r) => r.name === 'admin')
      ? [{ key: '/mail', icon: <MailOutlined />, label: '邮件发送' }]
      : []),
    contentChildren &&
      contentChildren.length > 0 && {
        key: 'content',
        icon: <UserOutlined />,
        label: '内容管理',
        children: contentChildren,
      },
    systemChildren &&
      systemChildren.length > 0 && {
        key: 'system',
        icon: <SettingOutlined />,
        label: '系统配置',
        children: systemChildren,
      },
    logChildren &&
      logChildren.length > 0 && {
        key: 'log',
        icon: <FileTextOutlined />,
        label: '日志审计',
        children: logChildren,
      },
  ].filter(Boolean) as MenuProps['items']

  const handleMenuClick = ({ key }: { key: string }) => {
    // 仅叶子节点（以 / 开头的路由路径）才跳转，分组节点 key（如 'system'/'log'）不跳转
    if (key.startsWith('/')) {
      navigate({ to: key })
    }
  }

  const handleLogout = () => {
    logoutMutation.mutate()
    navigate({ to: '/login' })
  }

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  const getSelectedKeys = () => {
    const pathname = location.pathname
    if (
      pathname.startsWith('/audit-logs') ||
      pathname.startsWith('/error-logs') ||
      pathname.startsWith('/roles') ||
      pathname.startsWith('/permissions')
    ) {
      return [pathname]
    }
    return [pathname]
  }

  const getOpenKeys = () => {
    const pathname = location.pathname
    // 内容管理分组
    if (pathname === '/users' || pathname === '/files') {
      return ['content']
    }
    // 系统配置分组
    if (pathname === '/roles' || pathname === '/permissions') {
      return ['system']
    }
    // 日志审计分组
    if (pathname.startsWith('/audit-logs') || pathname.startsWith('/error-logs')) {
      return ['log']
    }
    return []
  }

  return (
    <Layout className="h-screen">
      <Sider
        theme="dark"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div className="h-8 m-4 text-white text-center font-bold leading-8 overflow-hidden">
          {collapsed ? (
            <span className="text-lg">M</span>
          ) : (
            <span className="text-lg">MB Admin</span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={getSelectedKeys()}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            width: '100%',
            background: '#001529',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 24px',
          }}
        >
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Space className="cursor-pointer">
              <Avatar size="small" icon={<UserOutlined />} />
              <Text style={{ color: '#ffffff' }}>{user?.nickname || user?.username || '用户'}</Text>
            </Space>
          </Dropdown>
        </Header>
        <Content className="m-4 p-6 bg-white rounded-lg overflow-y-auto">{children}</Content>
      </Layout>
    </Layout>
  )
}
