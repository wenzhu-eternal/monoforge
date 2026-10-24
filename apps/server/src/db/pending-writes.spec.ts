import { afterEach, describe, expect, it } from 'vitest'
import { drainDbWrites, trackDbWrite } from './pending-writes'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('pending-writes（关闭前排空 fire-and-forget 写入）', () => {
  afterEach(async () => {
    // 兜底排空，避免用例间相互影响
    await drainDbWrites(10)
  })

  it('无登记写入时立即返回', async () => {
    await expect(drainDbWrites()).resolves.toBeUndefined()
  })

  it('drain 等待已登记的写入落定', async () => {
    const task = deferred<void>()
    trackDbWrite(task.promise)

    let drained = false
    const drain = drainDbWrites(5_000).then(() => {
      drained = true
    })

    await Promise.resolve()
    expect(drained).toBe(false)

    task.resolve(undefined)
    await drain
    expect(drained).toBe(true)
  })

  it('写入失败不产生未捕获拒绝，drain 仍正常返回', async () => {
    const task = deferred<void>()
    trackDbWrite(task.promise)

    const drain = drainDbWrites(5_000)
    task.reject(new Error('insert failed'))

    await expect(drain).resolves.toBeUndefined()
  })

  it('超时后放弃等待（挂起写入不阻塞关闭）', async () => {
    const task = deferred<void>()
    trackDbWrite(task.promise)

    const startedAt = Date.now()
    await drainDbWrites(10)
    expect(Date.now() - startedAt).toBeLessThan(1_000)

    task.resolve(undefined)
  })
})
