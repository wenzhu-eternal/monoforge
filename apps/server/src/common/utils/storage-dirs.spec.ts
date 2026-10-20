import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }))

vi.mock('@/config/env', () => ({ getEnv: getEnvMock }))

import { getTrashDir, getUploadDir } from './storage-dirs'

describe('storage-dirs（L13）', () => {
  beforeEach(() => {
    getEnvMock.mockReset()
  })

  it('未配置时按 cwd 推导 uploads / uploads-trash', () => {
    getEnvMock.mockReturnValue({})
    expect(getUploadDir()).toBe(join(process.cwd(), 'uploads'))
    expect(getTrashDir()).toBe(join(process.cwd(), 'uploads-trash'))
  })

  it('配置目录时回收站为同前缀 -trash（尾斜杠不重复）', () => {
    getEnvMock.mockReturnValue({ UPLOAD_DIR: '/data/files' })
    expect(getTrashDir()).toBe('/data/files-trash')

    getEnvMock.mockReturnValue({ UPLOAD_DIR: '/data/files/' })
    expect(getUploadDir()).toBe('/data/files/')
    expect(getTrashDir()).toBe('/data/files-trash')
  })
})
