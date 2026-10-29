import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import {
  and,
  auditLogs,
  courses,
  desc,
  eq,
  inArray,
  lectures,
  modules,
  orderInstalments,
  orderItems,
  orders,
  profiles,
  progress,
  refunds,
  sections,
  subscriptions,
  videoProgress,
  videos,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { notifyManySafely } from '../lib/notifications.js';
import {
  daysBetween,
  isMissingTableError,
  orderCourseIds,
  refundRules,
} from '../sales/sales-helpers.js';

function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpException(
        { message: 'Invalid request payload.', issues: error.issues },
        400,
      );
    }
    throw error;
  }
}

const uuid = z.string().uuid();
const createRequestSchema = z.object({
  orderId: uuid,
  reason: z.string().trim().min(1).max(2000),
});
const serializeDate = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Student-facing refund requests. Reuses the existing refunds table (and
 * the admin approve/reject/process flow): the student only files the
 * request; eligibility is estimated with the same refundRules the sales
 * module uses, and admin decides manually — no money movement happens
 * here.
 */
@Injectable()
export class RefundRequestsService {
  constructor(private readonly authService: AuthService) {}

  async createRequest(request: Request) {
    const profile = await this.requireRole(request, ['student']);
    const input = parseOr400(createRequestSchema, request.body ?? {});
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    if (!order) throw new NotFoundException('Order not found.');
    if (order.userId !== profile.id) {
      throw new ForbiddenException('Access denied.');
    }
    if (order.status !== 'paid') {
      throw new BadRequestException(
        'Only paid orders can have a refund request.',
      );
    }
    // Only an OPEN request blocks a new one. A rejected request leaves no
    // active row behind (partial unique index), so the student may re-apply.
    const [existing] = await db
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.orderId, input.orderId),
          inArray(refunds.status, ['requested', 'approved', 'processed']),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException(
        'A refund request is already open for this order.',
      );
    }

    const { kind, rule, amount } = await this.estimateEligibility(
      input.orderId,
      profile.id,
      Number(order.amount),
    );

    const [created] = await db
      .insert(refunds)
      .values({
        amount: amount.toFixed(2),
        currency: order.currency,
        orderId: input.orderId,
        reason: input.reason,
        requestedBy: profile.id,
      })
      .returning();
    if (!created) throw new Error('Refund request could not be created.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'refund_requested',
      entityType: 'refund',
      entityId: created.id,
      metadata: { kind, orderId: input.orderId },
    });
    // Best-effort in-app notifications to the course instructor(s) and all
    // admins. Never throws, so the request itself always succeeds.
    await this.notifyRefundRequested(input.orderId, profile.id);
    return {
      refund: {
        amount: String(created.amount),
        currency: created.currency,
        id: created.id,
        kind,
        orderId: created.orderId,
        reason: created.reason,
        rule,
        status: created.status,
      },
    };
  }

  async listMine(request: Request) {
    const profile = await this.requireRole(request, ['student']);
    const rows = await db
      .select({
        amount: refunds.amount,
        courseTitle: courses.title,
        createdAt: refunds.createdAt,
        currency: refunds.currency,
        id: refunds.id,
        orderId: refunds.orderId,
        reason: refunds.reason,
        reviewedAt: refunds.reviewedAt,
        status: refunds.status,
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .innerJoin(courses, eq(orders.courseId, courses.id))
      .where(eq(refunds.requestedBy, profile.id))
      .orderBy(desc(refunds.createdAt));
    return {
      refunds: rows.map((row) => ({
        ...row,
        amount: String(row.amount),
        createdAt: row.createdAt.toISOString(),
        reviewedAt: serializeDate(row.reviewedAt),
      })),
    };
  }

  async listForInstructor(request: Request) {
    const profile = await this.requireRole(request, ['instructor']);
    const courseRows = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.instructorId, profile.id));
    const courseIds = courseRows.map((row) => row.id);
    if (!courseIds.length) return { refunds: [] };
    const orderIdSet = new Set<string>();
    const orderRows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(inArray(orders.courseId, courseIds));
    for (const row of orderRows) orderIdSet.add(row.id);
    try {
      const itemRows = await db
        .select({ orderId: orderItems.orderId })
        .from(orderItems)
        .where(inArray(orderItems.courseId, courseIds));
      for (const row of itemRows) orderIdSet.add(row.orderId);
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      // Pre-migration: bundle/add-on items don't exist yet.
    }
    const orderIds = [...orderIdSet];
    if (!orderIds.length) return { refunds: [] };
    const student = profiles;
    const rows = await db
      .select({
        amount: refunds.amount,
        courseTitle: courses.title,
        createdAt: refunds.createdAt,
        currency: refunds.currency,
        id: refunds.id,
        orderId: refunds.orderId,
        reason: refunds.reason,
        reviewedAt: refunds.reviewedAt,
        status: refunds.status,
        studentName: student.fullName,
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .innerJoin(courses, eq(orders.courseId, courses.id))
      .innerJoin(student, eq(orders.userId, student.id))
      .where(inArray(refunds.orderId, orderIds))
      .orderBy(desc(refunds.createdAt));
    return {
      refunds: rows.map((row) => ({
        ...row,
        amount: String(row.amount),
        createdAt: row.createdAt.toISOString(),
        reviewedAt: serializeDate(row.reviewedAt),
        studentName: row.studentName ?? 'একজন শিক্ষার্থী',
      })),
    };
  }

  // ---------------- eligibility (same rules as refundEstimate) ----------------

  /**
   * Best-effort in-app notifications for a new refund request: the
   * instructor of the order's course (plus any bundle/add-on courses) and
   * every admin. Never throws.
   */
  private async notifyRefundRequested(orderId: string, requesterId: string) {
    try {
      const [order] = await db
        .select({ courseId: orders.courseId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) return;
      const courseIds = new Set<string>([order.courseId]);
      try {
        const items = await db
          .select({ courseId: orderItems.courseId })
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        for (const item of items) courseIds.add(item.courseId);
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
        // Pre-migration: bundle/add-on items don't exist yet.
      }
      const instructorRows = await db
        .select({ instructorId: courses.instructorId, title: courses.title })
        .from(courses)
        .where(inArray(courses.id, [...courseIds]));
      const [student] = await db
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.id, requesterId))
        .limit(1);
      const adminRows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.role, 'admin'));
      const title = 'New refund request';
      const body = `${student?.fullName ?? 'A student'} requested a refund for "${instructorRows[0]?.title ?? 'a course'}".`;
      const targets: Array<{ href: string; profileId: string }> = [];
      for (const row of instructorRows) {
        targets.push({
          href: '/dashboard/instructor/refund-requests',
          profileId: row.instructorId,
        });
      }
      for (const admin of adminRows) {
        targets.push({
          href: '/dashboard/admin/refunds',
          profileId: admin.id,
        });
      }
      await notifyManySafely(
        targets.map((target) => ({
          body,
          href: target.href,
          profileId: target.profileId,
          title,
          type: 'refund_requested',
        })),
      );
    } catch (error) {
      console.error('Refund-request notification failed.', error);
    }
  }

  /**
   * Determines the refund kind exactly like SalesService.refundEstimate:
   * subscription -> instalment -> bundle -> standard, with a graceful
   * fallback to standard when the sales feature tables are missing
   * (pre-migration). Throws 400 with the rule text when ineligible.
   */
  private async estimateEligibility(
    orderId: string,
    userId: string,
    orderAmount: number,
  ): Promise<{ kind: string; rule: string; amount: number }> {
    const standard = {
      amount: orderAmount,
      kind: 'standard',
      rule: 'Single-course refund: the amount above is indicative only; admin decides the final refund manually.',
    };
    const courseIds = await orderCourseIds(orderId);
    try {
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.orderId, orderId))
        .limit(1);
      if (subscription?.startsAt && subscription.expiresAt) {
        const totalDays = daysBetween(
          subscription.startsAt,
          subscription.expiresAt,
        );
        const daysSinceStart = daysBetween(subscription.startsAt, new Date());
        const unusedDays = daysBetween(new Date(), subscription.expiresAt);
        const result = refundRules.subscriptionRefund({
          daysSinceStart,
          price: orderAmount,
          totalDays,
          unusedDays,
        });
        this.throwIfIneligible(result);
        return { amount: result.amount, kind: 'subscription', rule: result.rule };
      }
      const instalments = await db
        .select()
        .from(orderInstalments)
        .where(eq(orderInstalments.orderId, orderId));
      if (instalments.length) {
        const paidTotal = instalments
          .filter((row) => row.status === 'paid')
          .reduce((sum, row) => sum + Number(row.amount), 0);
        const firstPaid = instalments
          .filter((row) => row.status === 'paid')
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
        const result = refundRules.instalmentRefund({
          consumedValue: firstPaid ? Number(firstPaid.amount) : 0,
          paidTotal,
        });
        this.throwIfIneligible(result);
        return { amount: result.amount, kind: 'instalment', rule: result.rule };
      }
      if (courseIds.length > 1) {
        const started = await this.anyCourseStarted(userId, courseIds);
        const result = refundRules.bundleRefund({
          anyCourseStarted: started,
          price: orderAmount,
        });
        this.throwIfIneligible(result);
        return { amount: result.amount, kind: 'bundle', rule: result.rule };
      }
      return standard;
    } catch (error) {
      if (isMissingTableError(error)) return standard;
      throw error;
    }
  }

  private throwIfIneligible(result: { eligible: boolean; amount: number; rule: string }): void {
    if (!result.eligible || result.amount <= 0) {
      throw new BadRequestException(result.rule);
    }
  }

  private async anyCourseStarted(
    userId: string,
    courseIds: string[],
  ): Promise<boolean> {
    if (!courseIds.length) return false;
    const sectionRows = await db
      .select({ id: sections.id })
      .from(sections)
      .where(inArray(sections.courseId, courseIds));
    const sectionIds = sectionRows.map((row) => row.id);
    if (!sectionIds.length) return false;
    const lectureRows = await db
      .select({ id: videos.id })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .where(inArray(modules.milestoneId, sectionIds));
    const videoIds = lectureRows.map((row) => row.id);
    const legacyLectureRows = await db
      .select({ id: lectures.id })
      .from(lectures)
      .where(inArray(lectures.sectionId, sectionIds));
    const legacyIds = legacyLectureRows.map((row) => row.id);
    if (legacyIds.length) {
      const [row] = await db
        .select({ id: progress.id })
        .from(progress)
        .where(
          and(eq(progress.userId, userId), inArray(progress.lectureId, legacyIds)),
        )
        .limit(1);
      if (row) return true;
    }
    if (videoIds.length) {
      const [row] = await db
        .select({ id: videoProgress.id })
        .from(videoProgress)
        .where(
          and(
            eq(videoProgress.userId, userId),
            inArray(videoProgress.videoId, videoIds),
          ),
        )
        .limit(1);
      if (row) return true;
    }
    return false;
  }

  private async requireRole(
    request: Request,
    roles: string[],
  ): Promise<{ id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) {
      throw new UnauthorizedException('Authentication is required.');
    }
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }
}
