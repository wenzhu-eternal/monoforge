import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Notification } from '@shared/schemas/notification'
import type { PaginatedResponse } from '@shared/schemas/pagination'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { maybeDeleted, notDeleted } from '@/db/helpers'
import { notifications } from '@/db/schema'
import { EventsService } from '@/modules/websocket/events.service'

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(private readonly eventsService: EventsService) {}

  async list(
    userId: number,
    page = 1,
    pageSize = 10,
    unreadOnly = false,
    includeDeleted = false,
  ): Promise<PaginatedResponse<Notification>> {
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 100)
    const offset = (safePage - 1) * safePageSize
    const where = unreadOnly
      ? and(
          eq(notifications.userId, userId),
          eq(notifications.read, false),
          notDeleted(notifications.deletedAt),
        )
      : and(eq(notifications.userId, userId), maybeDeleted(notifications.deletedAt, includeDeleted))

    const [items, countResult] = await Promise.all([
      db.query.notifications.findMany({
        where,
        orderBy: [desc(notifications.createdAt)],
        limit: safePageSize,
        offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(where),
    ])
    const total = countResult[0]?.count ?? 0

    // L6：原先固定取 50 条且无分页参数，超过 50 条后更早通知永久不可达
    return {
      list: items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    }
  }

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

    // L5：推送失败只降级告警——通知已落库，整体 500 会让调用方重试并复制重复记录（Redis 故障期尤甚）
    try {
      await this.eventsService.pushToUser(input.userId, 'notification', created)
    } catch (err) {
      this.logger.warn(
        `通知推送失败（已落库不影响创建，用户下次拉取可见）: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    return created
  }

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
