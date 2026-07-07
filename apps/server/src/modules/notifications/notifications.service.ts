import { Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { notDeleted } from '@/db/helpers'
import { notifications } from '@/db/schema'
import { EventsService } from '@/modules/websocket/events.service'

@Injectable()
export class NotificationsService {
  constructor(private readonly eventsService: EventsService) {}

  /**
   * 拉取用户通知列表（默认最近 50 条，可选只看未读）
   */
  async list(userId: number, unreadOnly = false) {
    const where = unreadOnly
      ? and(
          eq(notifications.userId, userId),
          eq(notifications.read, false),
          notDeleted(notifications.deletedAt),
        )
      : and(eq(notifications.userId, userId), notDeleted(notifications.deletedAt))

    return db.query.notifications.findMany({
      where,
      limit: 50,
      orderBy: [desc(notifications.createdAt)],
    })
  }

  /**
   * 统计未读数
   */
  async unreadCount(userId: number): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.read, false),
          notDeleted(notifications.deletedAt),
        ),
      )
    return result?.count ?? 0
  }

  /**
   * 创建通知: 持久化 + 在线则推送
   */
  async create(input: { userId: number; type: string; title: string; content?: string }) {
    const [created] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        content: input.content,
      })
      .returning()

    if (!created) {
      throw new Error('通知创建失败')
    }

    // 在线则即时推送
    this.eventsService.pushToUser(input.userId, 'notification', created)

    return created
  }

  /**
   * 标记单条已读
   */
  async markAsRead(userId: number, id: number) {
    const [updated] = await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          notDeleted(notifications.deletedAt),
        ),
      )
      .returning()

    if (!updated) {
      throw new NotFoundException(`通知 ID ${id} 不存在`)
    }
    return updated
  }

  /**
   * 标记全部已读
   */
  async markAllRead(userId: number): Promise<{ updated: number }> {
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.read, false),
          notDeleted(notifications.deletedAt),
        ),
      )
      .returning()
    return { updated: result.length }
  }

  /**
   * 删除单条通知（软删除）
   */
  async remove(userId: number, id: number) {
    const [deleted] = await db
      .update(notifications)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          notDeleted(notifications.deletedAt),
        ),
      )
      .returning()
    if (!deleted) {
      throw new NotFoundException(`通知 ID ${id} 不存在`)
    }
    return { message: `通知 ID ${id} 已删除` }
  }
}
