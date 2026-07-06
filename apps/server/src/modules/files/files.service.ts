import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { count, desc, eq } from 'drizzle-orm'
import {
  generateSafeFilename,
  isPathSafe,
  scanForMalware,
  validateExtension,
  validateFileContent,
  validateFilename,
  validateFileSize,
  validateMimeType,
} from '@/common/file-validator'
import { db } from '@/db'
import { files, users } from '@/db/schema'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

export interface PaginatedFiles {
  list: Array<{
    id: number
    filename: string
    originalName: string
    mimeType: string
    size: number
    uploadedBy: number | null
    uploadedByUsername: string | null
    createdAt: Date
  }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

@Injectable()
export class FilesService {
  async upload(
    file: Express.Multer.File,
    uploadedBy?: number,
  ): Promise<{
    id: number
    filename: string
    originalName: string
    mimeType: string
    size: number
  }> {
    if (!file) {
      throw new NotFoundException('文件未上传')
    }

    // 1. 文件名 + 大小 + MIME + 扩展名校验
    validateFilename(file.originalname)
    validateFileSize(file.size)
    validateMimeType(file.mimetype)
    validateExtension(file.originalname)

    // 2. 路径穿越防护
    if (!isPathSafe(file.path, UPLOAD_DIR)) {
      throw new ForbiddenException('文件路径非法')
    }

    // 3. magic number 校验
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
    await validateFileContent(file.path, ext)

    // 4. 恶意内容扫描
    await scanForMalware(file.path)

    // 5. 生成安全文件名并重命名（diskStorage 已用 filename 函数处理，这里直接用）
    const safeFilename = generateSafeFilename(file.originalname)

    // 6. 入库
    const [created] = await db
      .insert(files)
      .values({
        filename: safeFilename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: file.path,
        uploadedBy,
      })
      .returning()

    if (!created) {
      throw new NotFoundException('文件上传失败')
    }

    return {
      id: created.id,
      filename: created.filename,
      originalName: created.originalName,
      mimeType: created.mimeType,
      size: created.size,
    }
  }

  async findAll(page = 1, pageSize = 10): Promise<PaginatedFiles> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize

    const [items, countResult] = await Promise.all([
      db
        .select({
          id: files.id,
          filename: files.filename,
          originalName: files.originalName,
          mimeType: files.mimeType,
          size: files.size,
          uploadedBy: files.uploadedBy,
          uploadedByUsername: users.username,
          createdAt: files.createdAt,
        })
        .from(files)
        .leftJoin(users, eq(files.uploadedBy, users.id))
        .orderBy(desc(files.createdAt))
        .limit(safePageSize)
        .offset(offset),
      db.select({ value: count() }).from(files),
    ])

    const total = countResult[0]?.value ?? 0
    return {
      list: items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize) || 1,
    }
  }

  async findById(id: number) {
    const file = await db.query.files.findFirst({ where: eq(files.id, id) })
    if (!file) {
      throw new NotFoundException(`文件 ID ${id} 不存在`)
    }
    return file
  }

  /**
   * 删除文件: 仅管理员或上传者本人
   */
  async remove(id: number, currentUserId: number, isAdmin: boolean): Promise<{ message: string }> {
    const file = await db.query.files.findFirst({ where: eq(files.id, id) })
    if (!file) {
      throw new NotFoundException(`文件 ID ${id} 不存在`)
    }

    if (!isAdmin && file.uploadedBy !== currentUserId) {
      throw new ForbiddenException('无权删除他人上传的文件')
    }

    // 软删除: 设置 deletedAt 时间戳，不删除磁盘文件
    await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id))

    return { message: `文件 ID ${id} 已删除` }
  }

  /**
   * 确保上传目录存在
   */
  async ensureUploadDir(): Promise<void> {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export { UPLOAD_DIR }
