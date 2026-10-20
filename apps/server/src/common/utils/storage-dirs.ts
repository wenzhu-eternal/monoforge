import { join } from 'node:path'
import { getEnv } from '@/config/env'

/**
 * L13：上传/回收站目录的单一推导源——files 读写、schedule 孤儿清理、文档三处口径一致。
 * 回收站固定为上传目录同前缀的 `-trash` 目录，避免两处各写一份拼接逻辑。
 */
export function getUploadDir(): string {
  return getEnv().UPLOAD_DIR ?? join(process.cwd(), 'uploads')
}

export function getTrashDir(): string {
  return `${getUploadDir().replace(/\/+$/, '')}-trash`
}
