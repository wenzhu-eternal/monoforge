import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { FileItem, UploadResult } from '@shared/schemas/file'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, count, desc, eq } from 'drizzle-orm'
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
import { notDeleted } from '@/db/helpers'
import { files, users } from '@/db/schema'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

@Injectable()
export class FilesService {
  async upload(file: Express.Multer.File, uploadedBy?: number): Promise<UploadResult> {
    if (!file) {
      throw new NotFoundException('文件未上传')
    }

    validateFilename(file.originalname)
    validateFileSize(file.size)
    validateMimeType(file.mimetype)
    validateExtension(file.originalname)

    if (!isPathSafe(file.path, UPLOAD_DIR)) {
      throw new ForbiddenException('文件路径非法')
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
    await validateFileContent(file.path, ext)

    await scanForMalware(file.path)

    const safeFilename = generateSafeFilename(file.originalname)

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

  async findAll(page = 1, pageSize = 10): Promise<PaginatedResponse<FileItem>> {
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
        .where(notDeleted(files.deletedAt))
        .orderBy(desc(files.createdAt))
        .limit(safePageSize)
        .offset(offset),
      db.select({ value: count() }).from(files).where(notDeleted(files.deletedAt)),
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
    const file = await db.query.files.findFirst({
      where: and(eq(files.id, id), notDeleted(files.deletedAt)),
    })
    if (!file) {
      throw new NotFoundException(`文件 ID ${id} 不存在`)
    }
    return file
  }

  /**
   * 删除文件: 仅管理员或上传者本人
   */
  async remove(id: number, currentUserId: number, isAdmin: boolean): Promise<{ message: string }> {
    const file = await db.query.files.findFirst({
      where: and(eq(files.id, id), notDeleted(files.deletedAt)),
    })
    if (!file) {
      throw new NotFoundException(`文件 ID ${id} 不存在`)
    }

    if (!isAdmin && file.uploadedBy !== currentUserId) {
      throw new ForbiddenException('无权删除他人上传的文件')
    }

    // 不删除磁盘文件
    await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id))

    return { message: `文件 ID ${id} 已删除` }
  }

  async ensureUploadDir(): Promise<void> {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export { UPLOAD_DIR }
