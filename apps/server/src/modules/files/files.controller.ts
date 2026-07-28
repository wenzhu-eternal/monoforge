import { createReadStream, statSync } from 'node:fs'
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

    // 软删文件返回 404
    if (file.deletedAt) {
      response.status(404).json({ message: '文件不存在' })
      return
    }

    // 校验权限: 管理员或上传者本人
    if (!isAdmin && file.uploadedBy !== currentUser.sub) {
      response.status(403).json({ message: '无权访问该文件' })
      return
    }

    response.setHeader('Content-Type', file.mimeType)
    response.setHeader('Cache-Control', 'public, max-age=31536000')

    // 支持 Range 请求（大文件分片）
    const stat = statSync(file.path)
    response.setHeader('Accept-Ranges', 'bytes')

    const range = response.req.headers.range
    if (range) {
      const parsed = parseRange(range as string, stat.size)
      if (parsed) {
        const { start, end } = parsed
        response.status(206)
        response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        response.setHeader('Content-Length', end - start + 1)
        const stream = createReadStream(file.path, { start, end })
        stream.on('error', () => response.end())
        stream.pipe(response)
        return
      }
      response.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end()
      return
    }

    response.setHeader('Content-Length', stat.size)
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

    response.setHeader('Content-Type', file.mimeType)
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
