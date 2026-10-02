import { useEffect } from 'react'

/**
 * L23：列表末页删空后自动回退一页（删光当前页数据时不再停留空页）。
 * 仅成功态触发——加载中 list 为空不得回退；回退后查询自动重跑，若仍空则继续回退。
 */
export function usePagedFallback(
  listLength: number | undefined,
  isSuccess: boolean,
  page: number,
  setPage: (page: number) => void,
) {
  useEffect(() => {
    if (isSuccess && listLength === 0 && page > 1) {
      setPage(page - 1)
    }
  }, [isSuccess, listLength, page, setPage])
}
