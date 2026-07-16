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
import type { Response } from 'express'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
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
  async findAll(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    return this.filesService.findAll(pageNum, size)
  }

  @Get(':id/preview')
  @Permissions(PermissionCodes.FILE_VIEW)
  @ApiOperation({ summary: '预览文件（支持 Range 请求）' })
  async preview(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const file = await this.filesService.findById(id)

    response.setHeader('Content-Type', file.mimeType)
    response.setHeader('Cache-Control', 'public, max-age=31536000')

    // 支持 Range 请求（大文件分片）
    const stat = statSync(file.path)
    response.setHeader('Accept-Ranges', 'bytes')

    const range = response.req.headers.range
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? Number.parseInt(match[1], 10) : 0
        const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1
        response.status(206)
        response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        response.setHeader('Content-Length', end - start + 1)
        createReadStream(file.path, { start, end }).pipe(response)
        return
      }
    }

    response.setHeader('Content-Length', stat.size)
    createReadStream(file.path).pipe(response)
  }

  @Get(':id/download')
  @Permissions(PermissionCodes.FILE_VIEW)
  @ApiOperation({ summary: '下载文件' })
  async download(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const file = await this.filesService.findById(id)

    response.setHeader('Content-Type', file.mimeType)
    const encodedName = encodeURIComponent(file.originalName)
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
    )

    createReadStream(file.path).pipe(response)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions(PermissionCodes.FILE_DELETE)
  @ApiOperation({ summary: '删除文件' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { sub: number; username: string },
  ) {
    return this.filesService.remove(id, user.sub, user.username === 'admin')
  }
}
