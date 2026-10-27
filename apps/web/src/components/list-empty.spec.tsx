import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderListEmpty } from './list-empty'

describe('renderListEmpty', () => {
  it('M2：加载失败态渲染「加载失败」与重试按钮，而非空库文案', () => {
    const onRetry = vi.fn()
    render(renderListEmpty({ isError: true, onRetry, emptyText: '暂无用户' }))

    expect(screen.getByText('加载失败')).toBeInTheDocument()
    expect(screen.queryByText('暂无用户')).not.toBeInTheDocument()

    // antd 对两字中文按钮自动插空格（「重 试」），用正则匹配
    const retryBtn = screen.getByRole('button', { name: /重\s*试/ })
    expect(retryBtn).toBeInTheDocument()
    retryBtn.click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('非失败态渲染空库文案，不出现「加载失败」', () => {
    render(renderListEmpty({ isError: false, emptyText: '暂无用户' }))

    expect(screen.getByText('暂无用户')).toBeInTheDocument()
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
  })
})
