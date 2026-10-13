import { describe, expect, it, vi } from 'vitest'
import { NotificationsController } from './notifications.controller'
import type { NotificationsService } from './notifications.service'

describe('NotificationsController.list（L14 includeDeleted 固定 false）', () => {
  it('管理员 token 也不隐式带 includeDeleted（个人通知无"全局视图"语义）', async () => {
    const service = { list: vi.fn().mockResolvedValue({ list: [], total: 0 }) }
    const controller = new NotificationsController(service as unknown as NotificationsService)

    await controller.list(
      { sub: 1, username: 'admin', email: 'a@b.com', roleId: 1 } as never,
      '2',
      '20',
      'true',
    )

    // 修复前第五参为 isAdminUser(user)（roleId=1 时 true），管理员删自己通知后 refetch 仍见
    expect(service.list).toHaveBeenCalledWith(1, 2, 20, true, false)
  })

  it('普通用户与参数解析不受影响（page 默认 1/10、unreadOnly 非 true 为 false）', async () => {
    const service = { list: vi.fn().mockResolvedValue({ list: [], total: 0 }) }
    const controller = new NotificationsController(service as unknown as NotificationsService)

    await controller.list({ sub: 5, username: 'u', email: 'u@b.com', roleId: 2 } as never)

    expect(service.list).toHaveBeenCalledWith(5, 1, 10, false, false)
  })

  it('非数字 page/pageSize 抛 400（list 同步抛错）', () => {
    const service = { list: vi.fn() }
    const controller = new NotificationsController(service as unknown as NotificationsService)

    expect(() => controller.list({ sub: 1 } as never, 'abc', '10')).toThrow('page 必须为正整数')
    expect(service.list).not.toHaveBeenCalled()
  })
})
