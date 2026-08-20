import { existsSync } from 'node:fs'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { FileItem, UploadResult } from '@shared/schemas/file'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  generateSafeFilename,
  isPathSafe,
  scanForMalware,
  validateExtension,
  validateFileContent,
  validateFileMimeType,
  validateFilename,
  validateFileSize,
  validateMimeType,
} from '@/common/file-validator'
import { db } from '@/db'
import { maybeDeleted, notDeleted } from '@/db/helpers'
import { files, users } from '@/db/schema'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const TRASH_DIR = join(process.cwd(), 'uploads-trash')

/**
 * 跨卷安全的文件移动：优先 rename（同卷快），EXDEV 时回退 copyFile+unlink（跨卷兼容）
 */
async function safeMove(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await copyFile(src, dest)
      await unlink(src)
    } else {
      throw err
    }
  }
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)

  async upload(file: Express.Multer.File, uploadedBy?: number): Promise<UploadResult> {
    if (!file) {
      throw new NotFoundException('文件未上传')
    }

    // 校验链任一步失败都需清理 multer 落盘的临时文件，防恶意文件残留
    try {
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

      // 基于文件内容校验真实 MIME（不信任客户端 Content-Type），DB 存检测到的真实类型
      const detectedMime = await validateFileMimeType(file.path)
      if (detectedMime) {
        file.mimetype = detectedMime
      }
    } catch (err) {
      await unlink(file.path).catch(() => {})
      throw err
    }

    const safeFilename = generateSafeFilename(file.originalname)

    let created:
      | { id: number; filename: string; originalName: string; mimeType: string; size: number }
      | undefined
    try {
      ;[created] = await db
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
    } catch (e) {
      await unlink(file.path).catch(() => {})
      throw e
    }

    if (!created) {
      await unlink(file.path).catch(() => {})
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
    userId?: number,
  ): Promise<PaginatedResponse<FileItem>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize
    const deletedFilter = maybeDeleted(files.deletedAt, includeDeleted)
    const conditions = [deletedFilter]
    if (!includeDeleted && userId) {
      conditions.push(eq(files.uploadedBy, userId))
    }

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
        .where(and(...conditions))
        .orderBy(desc(files.createdAt))
        .limit(safePageSize)
        .offset(offset),
      db
        .select({ value: count() })
        .from(files)
        .where(and(...conditions)),
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
   * 返回原始记录（不带 deletedAt 过滤，由调用方判断）
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

    // 路径安全校验（与 preview/download/restore 保持一致，防 DB 篡改导致任意文件移动）
    if (!isPathSafe(file.path, UPLOAD_DIR)) {
      throw new BadRequestException('文件路径不安全')
    }

    // 预生成 trashPath，在同一次条件更新中同时设置 deletedAt 和 trashPath，消除 remove/restore 竞态窗口
    const trashFilename = `${Date.now()}-${file.filename}`
    const preTrashPath = join(TRASH_DIR, trashFilename)
    // 目标路径同样过安全校验（filename 来自 DB，防篡改后 rename 逃逸到隔离目录之外）
    if (!isPathSafe(preTrashPath, TRASH_DIR)) {
      throw new BadRequestException('文件路径不安全')
    }

    // 先 DB 条件更新抢锁（deletedAt isNull → now() + trashPath），消除"先搬盘后抢锁"的并发错配
    const [updated] = await db
      .update(files)
      .set({ deletedAt: new Date(), trashPath: preTrashPath })
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .returning()

    if (!updated) {
      return { message: `文件 ID ${id} 已删除` }
    }

    // 抢锁成功后搬盘到预生成的 trashPath；搬盘失败保留 trashPath 记录，后续 restore 会重试搬盘
    try {
      await mkdir(TRASH_DIR, { recursive: true })
      await safeMove(file.path, preTrashPath)
    } catch (err) {
      // 搬盘失败不阻塞软删流程，文件留在原路径，trashPath 记录预生成路径供 restore 重试
      this.logger.warn(
        `磁盘文件移到隔离目录失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    return { message: `文件 ID ${id} 已删除` }
  }

  /**
   * 恢复文件: DB 条件更新抢锁 + 凭 trash_path 精确还原磁盘文件
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

    // 路径安全校验（防路径穿越，基于已查到的 file 对象）
    if (
      file.trashPath &&
      (!isPathSafe(file.trashPath, TRASH_DIR) || !isPathSafe(file.path, UPLOAD_DIR))
    ) {
      throw new BadRequestException('文件路径不安全')
    }

    // DB 条件更新抢锁（deletedAt isNotNull → null），消除并发 restore 导致的重复 rename
    const [updated] = await db
      .update(files)
      .set({ deletedAt: null })
      .where(and(eq(files.id, id), isNotNull(files.deletedAt)))
      .returning()

    if (!updated) {
      throw new ConflictException('文件未被删除或已恢复')
    }

    // 抢锁成功者负责搬盘；搬盘失败回滚 deletedAt 并保留 trashPath，让用户可重试，避免孤儿文件
    if (file.trashPath) {
      try {
        await safeMove(file.trashPath, file.path)
      } catch (err) {
        // remove 时搬盘失败的场景：文件从未离开原位置，trashPath 指向不存在的隔离路径。
        // 此时若原路径文件仍在，视为磁盘已是正确状态，直接完成恢复（否则会陷入"重试永远 ENOENT"死锁）
        if (existsSync(file.path)) {
          this.logger.warn(
            `隔离目录无此文件但原路径存在，视为 remove 搬盘失败残留，直接恢复: ${file.trashPath}`,
          )
        } else {
          this.logger.warn(`磁盘文件恢复失败: ${err instanceof Error ? err.message : String(err)}`)
          // 搬盘失败：回滚 deletedAt 恢复为软删状态，保留 trashPath 让用户可重试
          // 条件带 isNull(deletedAt)：若期间并发 remove 已重新软删（写入新 trashPath），不覆盖其状态
          await db
            .update(files)
            .set({ deletedAt: new Date() })
            .where(and(eq(files.id, id), isNull(files.deletedAt)))
          throw new BadRequestException('磁盘文件恢复失败，请重试')
        }
      }
      // 搬盘成功后才清空 trashPath；
      // 条件带 isNull(deletedAt)：若期间并发 remove 已重新软删（trashPath 指向新的隔离文件），不清空其记录
      await db
        .update(files)
        .set({ trashPath: null })
        .where(and(eq(files.id, id), isNull(files.deletedAt)))
    }

    return { message: `文件 ID ${id} 已恢复` }
  }

  async ensureUploadDir(): Promise<void> {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export { UPLOAD_DIR }
