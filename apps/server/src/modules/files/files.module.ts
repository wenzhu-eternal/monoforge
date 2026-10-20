import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module'
import { ErrorLogsModule } from '@/modules/error-logs/error-logs.module'
import { FilesController } from './files.controller'
import { FilesService } from './files.service'

@Module({
  imports: [AuthModule, ErrorLogsModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
