import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePagedFallback } from './use-paged-fallback'

describe('usePagedFallback（L23 列表末页回退）', () => {
  it('成功态下当前页为空且非首页 → 回退一页', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(0, true, 3, setPage))

    expect(setPage).toHaveBeenCalledWith(2)
  })

  it('加载中（未成功）即便 list 为空也不回退', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(0, false, 3, setPage))

    expect(setPage).not.toHaveBeenCalled()
  })

  it('首页为空不回退（防止 page 跌到 0）', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(0, true, 1, setPage))

    expect(setPage).not.toHaveBeenCalled()
  })

  it('有数据时不回退', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(5, true, 3, setPage))

    expect(setPage).not.toHaveBeenCalled()
  })

  it('list 尚未返回（undefined）时不回退', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(undefined, true, 3, setPage))

    expect(setPage).not.toHaveBeenCalled()
  })

  it('P2-04：占位数据（keepPreviousData 的上一页快照）为空时不回退，等本页真实结果', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(0, true, 4, setPage, true))

    expect(setPage).not.toHaveBeenCalled()
  })

  it('P2-04：占位数据为空但非占位（真实本页结果）→ 只回退一页', () => {
    const setPage = vi.fn()

    renderHook(() => usePagedFallback(0, true, 4, setPage, false))

    expect(setPage).toHaveBeenCalledTimes(1)
    expect(setPage).toHaveBeenCalledWith(3)
  })
})
