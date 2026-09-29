import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  auditLogs,
  desc,
  enrollments,
  eq,
  notifications,
  profiles,
  siteSettings,
  users,
  courses,
} from '../../database/index.js';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';

@Injectable()
export class AdminSettings {
  constructor(private readonly authService: AuthService) {}
  private async admin(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin')
      throw new ForbiddenException('Access denied.');
    return profile;
  }
  async settings(request: Request) {
    await this.admin(request);
    const rows = await db.select().from(siteSettings);
    return {
      settings: Object.fromEntries(rows.map((row) => [row.key, row.value])),
    };
  }
  async updateSettings(request: Request) {
    const profile = await this.admin(request);
    const input = z
      .object({ settings: z.record(z.string(), z.string().max(10000)) })
      .parse(request.body);
    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(input.settings))
        await tx
          .insert(siteSettings)
          .values({ key, updatedBy: profile.id, value })
          .onConflictDoUpdate({
            target: siteSettings.key,
            set: { updatedBy: profile.id, updatedAt: new Date(), value },
          });
    });
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'settings_updated',
      entityType: 'site_settings',
      entityId: null,
      metadata: { keys: Object.keys(input.settings) },
    });
  }
  async announce(request: Request) {
    const profile = await this.admin(request);
    const input = z
      .object({
        audience: z.enum(['students', 'instructors', 'all']),
        body: z.string().trim().min(1).max(10000),
        title: z.string().trim().min(1).max(255),
      })
      .parse(request.body);
    const role =
      input.audience === 'all'
        ? undefined
        : eq(
            profiles.role,
            input.audience === 'students' ? 'student' : 'instructor',
          );
    const recipients = await db
      .select({ profileId: profiles.id })
      .from(profiles)
      .where(role);
    if (recipients.length)
      await db.insert(notifications).values(
        recipients.map((recipient) => ({
          body: input.body,
          profileId: recipient.profileId,
          title: input.title,
          type: 'admin_announcement' as const,
        })),
      );
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'announcement_sent',
      entityType: 'notification',
      entityId: null,
      metadata: {
        audience: input.audience,
        recipientCount: recipients.length,
      },
    });
    return { recipientCount: recipients.length };
  }
  async audit(request: Request) {
    await this.admin(request);
    const limit = Math.min(
      Math.max(Number(request.query.limit ?? 100), 1),
      500,
    );
    const rows = await db
      .select({
        action: auditLogs.action,
        actorEmail: users.email,
        createdAt: auditLogs.createdAt,
        entityId: auditLogs.entityId,
        entityType: auditLogs.entityType,
        id: auditLogs.id,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .leftJoin(profiles, eq(auditLogs.actorId, profiles.id))
      .leftJoin(users, eq(profiles.userId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    return {
      logs: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
