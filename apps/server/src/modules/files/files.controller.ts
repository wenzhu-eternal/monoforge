import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PermissionCodes } from '@shared/constants/permissions'
import { FileItemSchema, UploadResultSchema } from '@shared/schemas/file'
import { PaginatedResponseSchema } from '@shared/schemas/pagination'
import type { Response } from 'express'
import { ZodSerializerDto } from 'nestjs-zod'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { isPathSafe } from '@/common/file-validator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { isAdminUser } from '@/common/utils/is-admin'
import { type TokenPayload } from '@/modules/auth/auth.service'
import { FilesService, UPLOAD_DIR } from './files.service'

@ApiTags('Files')
@Controller('files')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @Permissions(PermissionCodes.FILE_UPLOAD)
  @ApiOperation({ summary: '上传文件（单文件，字段名 file）' })
  @UseInterceptors(
    FileInterceptor('file', {
      dest: UPLOAD_DIR,
      limits: { fileSize: 10 * 1024 * 1024 },
      defParamCharset: 'utf-8',
    }),
  )
  @ZodSerializerDto(UploadResultSchema)
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: number; username: string },
  ) {
    return this.filesService.upload(file, user.sub)
  }

  @Get()
  @Permissions(PermissionCodes.FILE_VIEW)
  @ApiOperation({ summary: '分页查询文件列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ZodSerializerDto(PaginatedResponseSchema(FileItemSchema))
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() currentUser?: TokenPayload,
  ) {
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    const isAdmin = isAdminUser(currentUser)
    return this.filesService.findAll(pageNum, size, isAdmin, currentUser?.sub)
  }

  @Get(':id/preview')
  @Permissions(PermissionCodes.FILE_VIEW)
  @ApiOperation({ summary: '预览文件（支持 Range 请求）' })
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    const isAdmin = isAdminUser(currentUser)
    const file = await this.filesService.findByIdRaw(id)

    if (!file) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    if (file.deletedAt) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    if (!isAdmin && file.uploadedBy !== currentUser.sub) {
      response.status(403).json({ message: '无权访问该文件' })
      return
    }

    // 路径安全校验（防 DB 篡改导致任意文件读取）
    if (!isPathSafe(file.path, UPLOAD_DIR)) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    // 可 inline 预览的安全白名单（图片/PDF），其余类型一律 attachment 下载防 XSS
    const INLINE_SAFE_MIME_TYPES = new Set([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'application/pdf',
    ])
    const isInlineSafe = INLINE_SAFE_MIME_TYPES.has(file.mimeType)

    response.setHeader('Content-Type', file.mimeType)
    // 纵深防御：阻止 MIME 嗅探，与 download 接口保持一致
    response.setHeader('X-Content-Type-Options', 'nosniff')
    // 文件含归属校验属私有资源，用 private 防止共享代理/CDN 跨用户串读；缩短缓存时间避免权限变更后旧缓存命中
    response.setHeader('Cache-Control', 'private, max-age=300')
    // 对可执行类型（svg/html 等）强制 attachment，防 inline 渲染执行脚本
    const encodedName = encodeURIComponent(file.originalName)
    response.setHeader(
      'Content-Disposition',
      isInlineSafe
        ? `inline; filename="preview"; filename*=UTF-8''${encodedName}`
        : `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
    )

    // 支持 Range 请求（大文件分片）；异步 stat 避免阻塞事件循环，文件被删时 404 兜底
    let statResult: { size: number }
    try {
      statResult = await stat(file.path)
    } catch {
      response.status(404).json({ message: '文件不存在' })
      return
    }
    response.setHeader('Accept-Ranges', 'bytes')

    const range = response.req.headers.range
    if (range) {
      const parsed = parseRange(range as string, statResult.size)
      if (parsed) {
        const { start, end } = parsed
        response.status(206)
        response.setHeader('Content-Range', `bytes ${start}-${end}/${statResult.size}`)
        response.setHeader('Content-Length', end - start + 1)
        const stream = createReadStream(file.path, { start, end })
        stream.on('error', () => response.end())
        stream.pipe(response)
        return
      }
      response.status(416).setHeader('Content-Range', `bytes */${statResult.size}`).end()
      return
    }

    response.setHeader('Content-Length', statResult.size)
    const stream = createReadStream(file.path)
    stream.on('error', () => response.end())
    stream.pipe(response)
  }

  @Get(':id/download')
  @Permissions(PermissionCodes.FILE_VIEW)
  @ApiOperation({ summary: '下载文件' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
    @CurrentUser() currentUser: TokenPayload,
  ) {
    const isAdmin = isAdminUser(currentUser)
    const file = await this.filesService.findByIdRaw(id)

    if (!file) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    if (file.deletedAt) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    if (!isAdmin && file.uploadedBy !== currentUser.sub) {
      response.status(403).json({ message: '无权访问该文件' })
      return
    }

    // 路径安全校验（防 DB 篡改导致任意文件读取）
    if (!isPathSafe(file.path, UPLOAD_DIR)) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    response.setHeader('Content-Type', file.mimeType)
    // 纵深防御：即便走 attachment 下载也阻止 MIME 嗅探
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const encodedName = encodeURIComponent(file.originalName)
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
    )

    const stream = createReadStream(file.path)
    stream.on('error', () => response.end())
    stream.pipe(response)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.FILE_DELETE)
  @ApiOperation({ summary: '删除文件' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { sub: number; username: string; roleId?: number | null },
  ) {
    return this.filesService.remove(id, user.sub, isAdminUser(user))
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.FILE_DELETE)
  @ApiOperation({ summary: '恢复已删除文件' })
  async restore(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { sub: number; username: string; roleId?: number | null },
  ) {
    return this.filesService.restore(id, user.sub, isAdminUser(user))
  }
}

function parseRange(range: string, size: number): { start: number; end: number } | null {
  const match = range.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null
  const startStr = match[1] ?? ''
  const endStr = match[2] ?? ''
  if (startStr === '' && endStr === '') return null
  if (startStr === '') {
    const suffix = Number(endStr)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    const start = Math.max(0, size - suffix)
    const end = size - 1
    if (start >= size) return null
    return { start, end }
  }
  const start = Number.parseInt(startStr, 10)
  if (!Number.isFinite(start) || start < 0) return null
  if (endStr === '') {
    const end = size - 1
    if (start >= size) return null
    return { start, end }
  }
  const end = Number.parseInt(endStr, 10)
  if (!Number.isFinite(end) || end < start || end >= size) return null
  return { start, end }
}
