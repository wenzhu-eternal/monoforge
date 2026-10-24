import { Global, Module, type OnModuleDestroy } from '@nestjs/common'
import { client, db } from './index'
import { drainDbWrites } from './pending-writes'

@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE',
      useValue: db,
    },
  ],
  exports: ['DATABASE'],
})
export class DatabaseModule implements OnModuleDestroy {
  // 优雅关闭: 先排空 fire-and-forget 写入（错误日志等），再释放连接池，避免 CONNECTION_ENDED 噪声
  async onModuleDestroy() {
    await drainDbWrites()
    await client.end({ timeout: 5 })
  }
}
