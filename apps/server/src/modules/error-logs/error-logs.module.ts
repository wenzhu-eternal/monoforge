import { forwardRef, Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module'
import { ErrorLogsController } from './error-logs.controller'
import { ErrorLogsService } from './error-logs.service'

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [ErrorLogsController],
  providers: [ErrorLogsService],
  exports: [ErrorLogsService],
})
export class ErrorLogsModule {}
