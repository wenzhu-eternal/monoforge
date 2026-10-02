import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from '@shared'
import { createFileRoute } from '@tanstack/react-router'
import type { UploadProps } from 'antd'
import {
  Alert,
  Button,
  Divider,
  Empty,
  Image,
  message,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  downloadFile,
  type FileItem,
  previewFile,
  useDeleteFile,
  useFiles,
  useRestoreFile,
  useUploadFile,
} from '@/hooks/use-files'
import { usePagedFallback } from '@/hooks/use-paged-fallback'
import { AuthenticatedLayout } from '@/layouts/authenticated-layout'
import { extractErrorMessage } from '@/lib/error'
import { requireAuth } from '@/lib/route-guards'

const { Title, Text } = Typography

export const Route = createFileRoute('/files')({
  beforeLoad: requireAuth(),
  component: FilesPage,
})

/**
 * 业务数据请求必须放在 AuthenticatedLayout 内层子组件：
 * Layout 的 mustChangePassword / 权限重定向要先于业务请求执行，
 * 否则强制改密用户会先打出白名单外请求拿到 401 被拦截器踢走
 */
function FilesPage() {
  return (
    <AuthenticatedLayout>
      <FilesContent />
    </AuthenticatedLayout>
  )
}

function FilesContent() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // L26：objectURL 的当前值镜像——卸载回收必须直接 revoke，借道 setState updater 在
  // 组件卸载后不保证执行（React 契约），ref 读取无此限制
  const previewUrlRef = useRef<string | null>(null)

  // 预览 blob 卸载兜底：直接切路由时回收，否则驻留到页签关闭
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])
  const [messageApi, contextHolder] = message.useMessage()

  const { data, isLoading, isError, error, isSuccess } = useFiles({ page, pageSize })
  usePagedFallback(data?.list.length, isSuccess, page, setPage)
  const deleteMutation = useDeleteFile()
  const restoreMutation = useRestoreFile()
  const uploadMutation = useUploadFile()

  useEffect(() => {
    if (isError) {
      messageApi.error(`加载失败: ${(error as Error)?.message ?? '未知错误'}`)
    }
  }, [isError, error, messageApi])

  const uploadProps: UploadProps = {
    name: 'file',
    showUploadList: false,
    // L27：传前客户端预检（扩展名白名单 + 大小，与服务端共用 @shared 常量）——
    // 超限文件不再白传完才收 400，浪费带宽；魔数等深度校验仍由服务端兜底
    beforeUpload: (file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        messageApi.error(`不支持 .${ext || '(无扩展名)'} 类型文件`)
        return Upload.LIST_IGNORE
      }
      if (file.size > MAX_FILE_SIZE) {
        messageApi.error(`文件超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 大小限制`)
        return Upload.LIST_IGNORE
      }
      return true
    },
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        await uploadMutation.mutateAsync(file as File)
        onSuccess?.({})
        messageApi.success('上传成功')
      } catch (err) {
        onError?.(err as never)
        messageApi.error(extractErrorMessage(err, '上传失败'))
      }
    },
  }

  const handlePreview = async (record: FileItem) => {
    try {
      const url = await previewFile(record.id)
      // L12：连续预览先回收旧 objectURL，否则旧 blob 常驻内存
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = url
      setPreviewUrl(url)
    } catch (err) {
      messageApi.error(extractErrorMessage(err, '预览失败'))
    }
  }

  const closePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      previewUrlRef.current = null
      setPreviewUrl(null)
    }
  }

  const handleDownload = async (record: FileItem) => {
    try {
      await downloadFile(record.id, record.originalName)
      messageApi.success('下载已开始')
    } catch (err) {
      messageApi.error(extractErrorMessage(err, '下载失败'))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      messageApi.success('禁用成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '禁用失败'))
    }
  }

  const handleRestore = async (id: number) => {
    try {
      await restoreMutation.mutateAsync(id)
      messageApi.success('恢复成功')
    } catch (error) {
      messageApi.error(extractErrorMessage(error, '恢复失败'))
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  const isImage = (mimeType: string): boolean => mimeType.startsWith('image/')

  const columns: ColumnsType<FileItem> = [
    {
      title: '原文件名',
      dataIndex: 'originalName',
      ellipsis: true,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'mimeType',
      width: 140,
      ellipsis: true,
      render: (v: string) => (
        <Tag style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</Tag>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 100,
      render: (v: number) => formatSize(v),
    },
    {
      title: '上传者',
      dataIndex: 'uploadedBy',
      width: 120,
      render: (v: number | null, record: FileItem) =>
        v ? `${record.uploadedByUsername ?? '-'}(${v})` : '-',
    },
    {
      title: '删除状态',
      key: 'deleteStatus',
      width: 100,
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
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 260,
      render: (_: unknown, record: FileItem) => {
        const isDeleted = !!record.deletedAt
        const actions: { key: string; node: ReactNode }[] = []
        if (isImage(record.mimeType) && !isDeleted) {
          actions.push({
            key: 'preview',
            node: (
              <Button type="link" size="small" onClick={() => handlePreview(record)}>
                预览
              </Button>
            ),
          })
        }
        if (!isDeleted) {
          actions.push({
            key: 'download',
            node: (
              <Button type="link" size="small" onClick={() => handleDownload(record)}>
                下载
              </Button>
            ),
          })
        }
        actions.push({
          key: 'restore',
          node: (
            <Popconfirm title="确定要恢复该文件吗？" onConfirm={() => handleRestore(record.id)}>
              <Button type="link" size="small" disabled={!isDeleted}>
                恢复
              </Button>
            </Popconfirm>
          ),
        })
        actions.push({
          key: 'delete',
          node: (
            <Popconfirm
              title={isDeleted ? '文件已禁用' : '确定要禁用该文件吗？'}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="link" size="small" danger disabled={isDeleted}>
                禁用
              </Button>
            </Popconfirm>
          ),
        })
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

  return (
    <>
      {contextHolder}
      <div className="flex justify-between items-center mb-4">
        <Title level={3}>文件管理</Title>
        <Upload {...uploadProps}>
          <Button type="primary">上传文件</Button>
        </Upload>
      </div>

      <Alert
        title={`支持上传图片（jpg/png/gif/webp）、文档（pdf/doc/xls）、文本、压缩包等，单文件最大 ${MAX_FILE_SIZE / 1024 / 1024}MB`}
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Table<FileItem>
        rowKey="id"
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={isLoading}
        locale={{ emptyText: <Empty description="暂无文件" /> }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 个文件`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          },
        }}
      />

      {previewUrl && (
        <Image
          src={previewUrl}
          preview={{
            open: true,
            onOpenChange: (open) => {
              if (!open) closePreview()
            },
          }}
          style={{ display: 'none' }}
        />
      )}
    </>
  )
}
