import { Button, Empty, Result } from 'antd'

/**
 * 列表空态统一分支：加载失败与「确无数据」必须可辨。
 * isError 时 data 恒为 undefined，若仍沿用「暂无xx」空文案，管理员会把
 * 500/断网误判成数据被清空；此处改渲染带重试的 Result，与一次性 toast 互补。
 */
export function renderListEmpty(opts: {
  isError: boolean
  onRetry?: () => void
  emptyText: string
}) {
  const { isError, onRetry, emptyText } = opts
  if (isError) {
    return (
      <Result
        status="error"
        title="加载失败"
        subTitle="数据加载出错，请稍后重试"
        extra={
          onRetry ? (
            <Button type="primary" onClick={onRetry}>
              重试
            </Button>
          ) : null
        }
      />
    )
  }
  return <Empty description={emptyText} />
}
