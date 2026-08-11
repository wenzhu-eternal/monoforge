import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenPayload } from '@/modules/auth/auth.service'
import type { NotificationsService } from '@/modules/notifications/notifications.service'
import type { EventsService } from './events.service'
import { WebsocketController } from './websocket.controller'

describe('WebsocketController', () => {
  let controller: WebsocketController
  let eventsService: EventsService
  let notificationsService: NotificationsService

  beforeEach(() => {
    eventsService = {
      getOnlineUserIds: vi.fn(),
      isUserOnline: vi.fn(),
    } as unknown as EventsService

    notificationsService = {
      create: vi.fn(),
    } as unknown as NotificationsService

    controller = new WebsocketController(eventsService, notificationsService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('online', () => {
    it('返回在线用户 ID 列表与数量', async () => {
      vi.mocked(eventsService.getOnlineUserIds).mockResolvedValue([1, 2, 3])

      const result = await controller.online()

      expect(result).toEqual({ count: 3, userIds: [1, 2, 3] })
      expect(eventsService.getOnlineUserIds).toHaveBeenCalledOnce()
    })

    it('无在线用户时返回空列表', async () => {
      vi.mocked(eventsService.getOnlineUserIds).mockResolvedValue([])

      const result = await controller.online()

      expect(result).toEqual({ count: 0, userIds: [] })
    })
  })

  describe('me', () => {
    it('返回当前用户在线状态', async () => {
      const user = { sub: 5, username: 'alice', email: 'a@b.com' } as TokenPayload
      vi.mocked(eventsService.isUserOnline).mockResolvedValue(true)

      const result = await controller.me(user)

      expect(result).toEqual({ userId: 5, online: true })
      expect(eventsService.isUserOnline).toHaveBeenCalledWith(5)
    })

    it('用户离线时返回 online: false', async () => {
      const user = { sub: 5, username: 'alice', email: 'a@b.com' } as TokenPayload
      vi.mocked(eventsService.isUserOnline).mockResolvedValue(false)

      const result = await controller.me(user)

      expect(result.online).toBe(false)
    })
  })

  describe('notify', () => {
    const user = { sub: 5, username: 'alice', email: 'a@b.com' } as TokenPayload

    it('给自己发通知 → 成功并持久化', async () => {
      const dto = { userId: 5, type: 'test', title: 'hello', content: 'world' }
      const created = { id: 1, ...dto }
      vi.mocked(notificationsService.create).mockResolvedValue(created as never)
      vi.mocked(eventsService.isUserOnline).mockResolvedValue(true)

      const result = await controller.notify(dto, user)

      expect(result.message).toBe('通知已发送')
      expect(result.notification).toEqual(created)
      expect(result.delivered).toBe(true)
      expect(notificationsService.create).toHaveBeenCalledWith({
        userId: 5,
        type: 'test',
        title: 'hello',
        content: 'world',
      })
    })

    it('给他人发通知 → 抛 ForbiddenException（越权防护）', async () => {
      const dto = { userId: 999, type: 'test', title: 'hello', content: 'world' }

      await expect(controller.notify(dto, user)).rejects.toThrow(ForbiddenException)
      expect(notificationsService.create).not.toHaveBeenCalled()
    })

    it('用户离线时 delivered 为 false 但仍持久化', async () => {
      const dto = { userId: 5, type: 'test', title: 'hello', content: 'world' }
      vi.mocked(notificationsService.create).mockResolvedValue({ id: 1 } as never)
      vi.mocked(eventsService.isUserOnline).mockResolvedValue(false)

      const result = await controller.notify(dto, user)

      expect(result.delivered).toBe(false)
      expect(notificationsService.create).toHaveBeenCalledOnce()
    })
  })
})
