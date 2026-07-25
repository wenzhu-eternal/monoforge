import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
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
import { maybeDeleted, notDeleted } from '@/db/helpers'
import { files, users } from '@/db/schema'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const TRASH_DIR = join(process.cwd(), 'uploads-trash')

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)

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

  async findAll(
    page = 1,
    pageSize = 10,
    includeDeleted = false,
  ): Promise<PaginatedResponse<FileItem>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize
    const deletedFilter = maybeDeleted(files.deletedAt, includeDeleted)

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
          deletedAt: files.deletedAt,
          createdAt: files.createdAt,
        })
        .from(files)
        .leftJoin(users, eq(files.uploadedBy, users.id))
        .where(and(deletedFilter))
        .orderBy(desc(files.createdAt))
        .limit(safePageSize)
        .offset(offset),
      db.select({ value: count() }).from(files).where(and(deletedFilter)),
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

  async findById(id: number, includeDeleted = false) {
    const deletedFilter = maybeDeleted(files.deletedAt, includeDeleted)
    const file = await db.query.files.findFirst({
      where: and(eq(files.id, id), deletedFilter),
    })
    if (!file) {
      throw new NotFoundException(`文件 ID ${id} 不存在`)
    }
    return file
  }

  /**
   * 检查文件是否已被软删（不管 includeDeleted）
   */
  async findByIdRaw(id: number) {
    const file = await db.query.files.findFirst({
      where: eq(files.id, id),
    })
    return file
  }

  /**
   * 删除文件: 仅管理员或上传者本人，磁盘文件移到隔离目录并记录 trash_path
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

    // 磁盘文件移到隔离目录，记录 trash_path
    const trashPath = await this.moveToTrash(file.path, file.filename)

    await db.update(files).set({ deletedAt: new Date(), trashPath }).where(eq(files.id, id))

    return { message: `文件 ID ${id} 已删除` }
  }

  /**
   * 恢复文件: 凭 trash_path 精确还原磁盘文件
   */
  async restore(id: number, currentUserId: number, isAdmin: boolean): Promise<{ message: string }> {
    const file = await db.query.files.findFirst({
      where: eq(files.id, id),
    })
    if (!file) {
      throw new NotFoundException(`文件 ID ${id} 不存在`)
    }

    if (!file.deletedAt) {
      throw new ConflictException('文件未被删除，无需恢复')
    }

    if (!isAdmin && file.uploadedBy !== currentUserId) {
      throw new ForbiddenException('无权恢复他人上传的文件')
    }

    // 凭 trash_path 精确还原磁盘文件
    if (file.trashPath) {
      try {
        await rename(file.trashPath, file.path)
      } catch (err) {
        this.logger.warn(`磁盘文件还原失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    await db.update(files).set({ deletedAt: null, trashPath: null }).where(eq(files.id, id))

    return { message: `文件 ID ${id} 已恢复` }
  }

  private async moveToTrash(filePath: string, filename: string): Promise<string> {
    try {
      await mkdir(TRASH_DIR, { recursive: true })
      // 隔离目录内用 时间戳+原名 避免冲突
      const trashPath = join(TRASH_DIR, `${Date.now()}-${filename}`)
      await rename(filePath, trashPath)
      return trashPath
    } catch (err) {
      // 文件可能已被外部删除，不阻塞软删流程
      this.logger.warn(
        `磁盘文件移到隔离目录失败: ${err instanceof Error ? err.message : String(err)}`,
      )
      return ''
    }
  }

  async ensureUploadDir(): Promise<void> {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export { UPLOAD_DIR }
