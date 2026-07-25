import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    query: {
      notifications: {
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/db/helpers', () => ({
  notDeleted: vi.fn(() => undefined),
  maybeDeleted: vi.fn(() => undefined),
}))

const { db: mockDb } = await import('@/db')

import { NotificationsService } from './notifications.service'

describe('NotificationsService', () => {
  let service: NotificationsService
  let eventsService: { pushToUser: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    eventsService = {
      pushToUser: vi.fn(),
    }
    service = new NotificationsService(eventsService as never)
  })

  describe('list', () => {
    it('返回用户全部通知（unreadOnly=false）', async () => {
      const mockList = [
        { id: 1, userId: 1, type: 'system', title: 'hello', read: false },
        { id: 2, userId: 1, type: 'mention', title: 'mentioned you', read: true },
      ]
      vi.mocked(mockDb.query.notifications.findMany).mockResolvedValue(mockList as never)

      const result = await service.list(1, false)
      expect(result).toEqual(mockList)
      expect(mockDb.query.notifications.findMany).toHaveBeenCalledOnce()
    })

    it('unreadOnly=true 只返回未读', async () => {
      const mockList = [{ id: 1, userId: 1, type: 'system', title: 'hello', read: false }]
      vi.mocked(mockDb.query.notifications.findMany).mockResolvedValue(mockList as never)

      const result = await service.list(1, true)
      expect(result).toEqual(mockList)
    })

    it('includeDeleted=true 时包含已删除记录（管理员）', async () => {
      const mockList = [
        { id: 1, userId: 1, type: 'system', title: 'hello', read: false },
        { id: 2, userId: 1, type: 'mention', title: 'deleted', read: true, deletedAt: new Date() },
      ]
      vi.mocked(mockDb.query.notifications.findMany).mockResolvedValue(mockList as never)

      const result = await service.list(1, false, true)
      expect(result).toEqual(mockList)
    })
  })

  describe('unreadCount', () => {
    it('返回未读通知数量', async () => {
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 5 }]),
        }),
      } as never)

      const result = await service.unreadCount(1)
      expect(result).toBe(5)
    })

    it('无未读时返回 0', async () => {
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as never)

      const result = await service.unreadCount(1)
      expect(result).toBe(0)
    })

    it('includeDeleted=true 时包含已删除记录计数（管理员）', async () => {
      vi.mocked(mockDb.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 8 }]),
        }),
      } as never)

      const result = await service.unreadCount(1, true)
      expect(result).toBe(8)
    })
  })

  describe('create', () => {
    it('创建通知并推送给用户', async () => {
      const created = { id: 1, userId: 1, type: 'system', title: 'hello', content: 'world' }
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      } as never)

      const result = await service.create({
        userId: 1,
        type: 'system',
        title: 'hello',
        content: 'world',
      })

      expect(result).toEqual(created)
      expect(eventsService.pushToUser).toHaveBeenCalledWith(1, 'notification', created)
    })

    it('插入返回空时抛错', async () => {
      vi.mocked(mockDb.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      } as never)

      await expect(service.create({ userId: 1, type: 'system', title: 'hello' })).rejects.toThrow(
        '通知创建失败',
      )
      expect(eventsService.pushToUser).not.toHaveBeenCalled()
    })
  })

  describe('markAsRead', () => {
    it('标记存在的通知为已读', async () => {
      const updated = { id: 1, userId: 1, read: true }
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      } as never)

      const result = await service.markAsRead(1, 1)
      expect(result).toEqual(updated)
    })

    it('通知不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never)

      await expect(service.markAsRead(1, 999)).rejects.toThrow(NotFoundException)
    })
  })

  describe('markAllRead', () => {
    it('批量标记未读通知为已读并返回更新数', async () => {
      const updatedList = [
        { id: 1, read: true },
        { id: 2, read: true },
        { id: 3, read: true },
      ]
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(updatedList),
          }),
        }),
      } as never)

      const result = await service.markAllRead(1)
      expect(result).toEqual({ updated: 3 })
    })

    it('无未读通知时返回 updated: 0', async () => {
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never)

      const result = await service.markAllRead(1)
      expect(result).toEqual({ updated: 0 })
    })
  })

  describe('remove', () => {
    it('软删除存在的通知', async () => {
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, deletedAt: new Date() }]),
          }),
        }),
      } as never)

      const result = await service.remove(1, 1)
      expect(result.message).toContain('1')
    })

    it('通知不存在时抛 NotFoundException', async () => {
      vi.mocked(mockDb.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never)

      await expect(service.remove(1, 999)).rejects.toThrow(NotFoundException)
    })
  })
})
