import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module'
import { ErrorLogsModule } from '@/modules/error-logs/error-logs.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [AuthModule, ErrorLogsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
