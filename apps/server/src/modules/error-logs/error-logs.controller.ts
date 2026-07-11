import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { Public } from '@/common/decorators/public.decorator'
import { Roles } from '@/common/decorators/roles.decorator'
import { RolesGuard } from '@/common/guards/roles.guard'
import { BatchResolveDto } from './dto/batch-resolve.dto'
import { CreateWhitelistDto } from './dto/create-whitelist.dto'
import { ReportErrorDto } from './dto/report-error.dto'
import { UpdateWhitelistDto } from './dto/update-whitelist.dto'
import { ErrorLogsService } from './error-logs.service'

@ApiTags('ErrorLogs')
@Controller('error-logs')
export class ErrorLogsController {
  constructor(private readonly errorLogsService: ErrorLogsService) {}

  // ===== 前端错误上报（公开，不需要 admin）=====

  @Post('report')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '前端/后端错误上报（公开）' })
  async reportError(@Body() dto: ReportErrorDto) {
    return this.errorLogsService.report(dto)
  }

  // ===== 需要 admin 权限的接口 =====

  @Get()
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: '分页查询错误日志（仅管理员）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'keyword', required: false, type: String })
  @ApiQuery({ name: 'source', required: false, type: String })
  @ApiQuery({ name: 'isResolved', required: false, type: String })
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('source') source?: string,
    @Query('isResolved') isResolved?: string,
  ) {
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    return this.errorLogsService.findAll(pageNum, size, keyword, source, isResolved)
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: '错误统计（仅管理员）' })
  async getStats() {
    return this.errorLogsService.getStats()
  }

  @Get('grouped')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: '相同报错聚合 Top N（仅管理员）' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findGrouped(@Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : 10
    if (Number.isNaN(n) || n < 1) {
      throw new BadRequestException('limit 必须为正整数')
    }
    return this.errorLogsService.findGrouped(n)
  }

  @Get('whitelist')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: '查询全部白名单（仅管理员）' })
  async findWhitelist() {
    return this.errorLogsService.findWhitelist()
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: '按ID查询错误日志（仅管理员）' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.errorLogsService.findById(id)
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记错误已处理（仅管理员）' })
  async resolve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { sub: number }) {
    return this.errorLogsService.resolve(id, user.sub)
  }

  @Post('batch-resolve')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量标记相同报错已处理（仅管理员）' })
  async batchResolve(@Body() dto: BatchResolveDto, @CurrentUser() user: { sub: number }) {
    return this.errorLogsService.batchResolve(dto.message, dto.source, user.sub)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除错误日志（仅管理员）' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.errorLogsService.remove(id)
  }

  // ===== 白名单 CRUD =====

  @Post('whitelist')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建白名单规则（仅管理员）' })
  async createWhitelist(@Body() dto: CreateWhitelistDto) {
    return this.errorLogsService.createWhitelist(dto)
  }

  @Patch('whitelist/:id')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: '更新白名单规则（仅管理员）' })
  async updateWhitelist(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWhitelistDto) {
    return this.errorLogsService.updateWhitelist(id, dto)
  }

  @Delete('whitelist/:id')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除白名单规则（仅管理员）' })
  async removeWhitelist(@Param('id', ParseIntPipe) id: number) {
    return this.errorLogsService.removeWhitelist(id)
  }
}
