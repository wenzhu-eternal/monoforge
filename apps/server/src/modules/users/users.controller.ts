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
  UseInterceptors,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Permissions } from '@/common/decorators/permissions.decorator'
import { PermissionsGuard } from '@/common/guards/permissions.guard'
import { AuthGuard } from '@/modules/auth/auth.guard'
import { CacheInterceptor } from '@/modules/cache/cache.interceptor'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UsersService } from './users.service'

@ApiTags('Users')
@Controller('users')
@UseGuards(AuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('user:view')
  @ApiOperation({ summary: '分页查询用户' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async findAll(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    // 防御 NaN: 非数字字符串 parseInt 后为 NaN，需回落到默认值
    const pageNum = page ? Number.parseInt(page, 10) : 1
    const size = pageSize ? Number.parseInt(pageSize, 10) : 10
    if (Number.isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须为正整数')
    }
    if (Number.isNaN(size) || size < 1) {
      throw new BadRequestException('pageSize 必须为正整数')
    }
    return this.usersService.findAll(pageNum, size)
  }

  @Get('stats')
  @Permissions('user:view')
  @ApiOperation({ summary: '用户统计（仪表盘用）' })
  async getStats() {
    return this.usersService.getStats()
  }

  @Get(':id')
  @Permissions('user:view')
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: '按ID查询用户（带缓存）' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findById(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('user:create')
  @ApiOperation({ summary: '创建用户' })
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto)
  }

  @Patch(':id')
  @Permissions('user:update')
  @ApiOperation({ summary: '更新用户' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('user:delete')
  @ApiOperation({ summary: '删除用户' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id)
  }
}
