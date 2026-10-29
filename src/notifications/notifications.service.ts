import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { and, count, desc, eq, isNull, notifications, sql } from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { z } from 'zod';

const LIMIT = 50;

function dto(row: typeof notifications.$inferSelect) {
  return {
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    href: row.href,
    id: row.id,
    readAt: row.readAt?.toISOString() ?? null,
    title: row.title,
    type: row.type,
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly authService: AuthService) {}

  private async requireProfile(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['student', 'instructor', 'admin'].includes(profile.role))
      throw new ForbiddenException('Access denied.');
    return profile;
  }

  async list(request: Request) {
    const profile = await this.requireProfile(request);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.profileId, profile.id))
      // Unread first, then newest.
      .orderBy(
        sql`CASE WHEN ${notifications.readAt} IS NULL THEN 0 ELSE 1 END`,
        desc(notifications.createdAt),
      )
      .limit(LIMIT);
    const [{ value: unreadCount }] = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.profileId, profile.id),
          isNull(notifications.readAt),
        ),
      );
    return { notifications: rows.map(dto), unreadCount };
  }

  async unreadCount(request: Request) {
    const profile = await this.requireProfile(request);
    const [{ value }] = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.profileId, profile.id),
          isNull(notifications.readAt),
        ),
      );
    return { unreadCount: value };
  }

  async markRead(id: string, request: Request) {
    const profile = await this.requireProfile(request);
    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) throw new NotFoundException('Notification not found.');
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, parsed.data),
          eq(notifications.profileId, profile.id),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id, readAt: notifications.readAt });
    if (!updated) {
      // Either not found or not owned: 404 without leaking which.
      throw new NotFoundException('Notification not found.');
    }
    return { id: updated.id, readAt: updated.readAt!.toISOString() };
  }

  async markAllRead(request: Request) {
    const profile = await this.requireProfile(request);
    const rows = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.profileId, profile.id),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { marked: rows.length };
  }
}
