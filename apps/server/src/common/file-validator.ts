import { randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import { ErrorCodes, ErrorMessages } from '@shared/constants/errors'

export const MAX_FILE_SIZE = 10 * 1024 * 1024

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
  'application/x-sql',
]

export const ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'txt',
  'html',
  'css',
  'json',
  'mp4',
  'mp3',
  'wav',
  'zip',
  'rar',
  'sql',
]

// 危险扩展名黑名单（即使改后缀也拒绝）
export const DANGEROUS_EXTENSIONS = [
  'exe',
  'bat',
  'cmd',
  'sh',
  'ps1',
  'vbs',
  'js',
  'jar',
  'php',
  'asp',
  'aspx',
  'jsp',
  'cgi',
  'pl',
]

const MAGIC_NUMBERS: Array<{ ext: string; bytes: number[] }> = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { ext: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { ext: 'docx', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { ext: 'xlsx', bytes: [0x50, 0x4b, 0x03, 0x04] },
]

const MALICIOUS_PATTERNS = [/<script[\s\S]*?>/i, /javascript:/i, /\son\w+\s*=/i, /data:text\/html/i]

/**
 * 校验文件名安全性: 拒绝路径穿越、空字节、危险扩展名
 */
export function validateFilename(filename: string): void {
  if (!filename || typeof filename !== 'string') {
    throw new BadRequestException('文件名不能为空')
  }

  // 文件名可能是 UTF-8 原文或 percent-encoded，安全解码
  let decoded: string
  try {
    decoded = decodeURIComponent(filename)
  } catch {
    decoded = filename
  }

  if (
    decoded.includes('..') ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('.') ||
    decoded.endsWith('.')
  ) {
    throw new BadRequestException('文件名包含非法字符')
  }

  const ext = decoded.split('.').pop()?.toLowerCase() ?? ''
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(`不允许上传 ${ext} 类型文件`)
  }
}

export function validateFileSize(size: number): void {
  if (size <= 0) {
    throw new BadRequestException('文件为空')
  }
  if (size > MAX_FILE_SIZE) {
    throw new BadRequestException(`文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`)
  }
}

export function validateMimeType(mimeType: string): void {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new BadRequestException(`不允许的文件类型: ${mimeType}`)
  }
}

export function validateExtension(filename: string): void {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(`不允许的文件扩展名: ${ext}`)
  }
}

/**
 * 校验文件内容 magic number（防止改后缀伪装）
 * 仅对 jpg/png/gif/pdf 进行校验
 */
export async function validateFileContent(filePath: string, declaredExt: string): Promise<void> {
  const expected = MAGIC_NUMBERS.find((m) => m.ext === declaredExt)
  if (!expected) {
    return
  }

  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(expected.bytes.length)
    await handle.read(buffer, 0, expected.bytes.length, 0)
    const header = Array.from(buffer)
    const matches = expected.bytes.every((byte, i) => header[i] === byte)
    if (!matches) {
      throw new BadRequestException('文件内容与扩展名不匹配')
    }
  } catch (err) {
    if (err instanceof BadRequestException) throw err
    throw new BadRequestException('文件内容校验失败')
  } finally {
    await handle.close()
  }
}

export async function scanForMalware(filePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    // 只读前 64KB 进行扫描（恶意脚本通常在头部）
    handle = await open(filePath, 'r')
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, 64 * 1024, 0)
    await handle.close()
    handle = null
    const content = buffer.subarray(0, bytesRead).toString('utf8')

    for (const pattern of MALICIOUS_PATTERNS) {
      if (pattern.test(content)) {
        throw new BadRequestException(
          `${ErrorMessages[ErrorCodes.FILE_QUARANTINED]}: ${ErrorMessages[ErrorCodes.INVALID_FILE_TYPE]}`,
        )
      }
    }
  } catch (err) {
    if (err instanceof BadRequestException) throw err
    // 文件读取异常（权限/IO 错误）应拒绝，不静默放行
    throw new BadRequestException('文件读取失败，无法完成安全扫描')
  } finally {
    handle?.close().catch(() => {})
  }
}

/**
 * 校验路径是否在指定目录内（防路径穿越）
 */
export function isPathSafe(filePath: string, baseDir: string): boolean {
  const resolvedPath = resolve(filePath)
  const resolvedBase = resolve(baseDir)
  return resolvedPath.startsWith(`${resolvedBase}/`) || resolvedPath === resolvedBase
}

/**
 * 生成安全的磁盘文件名: timestamp-random-sanitized.ext
 */
export function generateSafeFilename(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? ''
  const baseName = originalName.replace(/\.[^.]+$/, '')
  const sanitized = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '').slice(0, 100) || 'file'
  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  return `${timestamp}-${random}-${sanitized}.${ext}`
}
