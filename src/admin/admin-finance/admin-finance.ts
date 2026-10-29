import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  alias,
  and,
  auditLogs,
  courses,
  desc,
  enrollments,
  eq,
  orders,
  payoutRequests,
  profiles,
  refunds,
  users,
} from '../../database/index.js';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';
import { notifySafely } from '../../lib/notifications.js';

const idSchema = z.string().uuid();
const rejectSchema = z.object({
  rejectionReason: z.string().trim().min(1).max(2000),
});
const refundSchema = z.object({
  amount: z.coerce.number().positive(),
  orderId: idSchema,
  reason: z.string().trim().min(1).max(2000),
});
const refundDecisionSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
const date = (value: Date | null) => value?.toISOString() ?? null;

@Injectable()
export class AdminFinance {
  constructor(private readonly authService: AuthService) {}
  private async admin(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin')
      throw new ForbiddenException('Access denied.');
    return profile;
  }
  async listPayouts(request: Request) {
    await this.admin(request);
    const ip = alias(profiles, 'admin_payout_instructor_profiles');
    const iu = alias(users, 'admin_payout_instructor_users');
    const rp = alias(profiles, 'admin_payout_reviewer_profiles');
    const ru = alias(users, 'admin_payout_reviewer_users');
    const rows = await db
      .select({
        amount: payoutRequests.amount,
        createdAt: payoutRequests.createdAt,
        currency: payoutRequests.currency,
        id: payoutRequests.id,
        instructorEmail: iu.email,
        instructorId: payoutRequests.instructorId,
        instructorName: ip.fullName,
        note: payoutRequests.note,
        paidAt: payoutRequests.paidAt,
        referenceCode: payoutRequests.referenceCode,
        rejectionReason: payoutRequests.rejectionReason,
        reviewedAt: payoutRequests.reviewedAt,
        reviewedByEmail: ru.email,
        status: payoutRequests.status,
        updatedAt: payoutRequests.updatedAt,
      })
      .from(payoutRequests)
      .innerJoin(ip, eq(payoutRequests.instructorId, ip.id))
      .innerJoin(iu, eq(ip.userId, iu.id))
      .leftJoin(rp, eq(payoutRequests.reviewedBy, rp.id))
      .leftJoin(ru, eq(rp.userId, ru.id))
      .orderBy(desc(payoutRequests.createdAt));
    return {
      payouts: rows.map((row) => ({
        ...row,
        amount: String(row.amount),
        createdAt: row.createdAt.toISOString(),
        paidAt: date(row.paidAt),
        reviewedAt: date(row.reviewedAt),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }
  async decidePayout(
    id: string,
    action: 'approve' | 'reject' | 'paid',
    request: Request,
  ) {
    const profile = await this.admin(request);
    const input =
      action === 'reject'
        ? rejectSchema.parse(request.body)
        : { rejectionReason: null };
    const expected = action === 'paid' ? 'approved' : 'pending';
    const values =
      action === 'approve'
        ? {
            paidAt: null,
            rejectionReason: null,
            reviewedAt: new Date(),
            reviewedBy: profile.id,
            status: 'approved' as const,
          }
        : action === 'reject'
          ? {
              paidAt: null,
              rejectionReason: input.rejectionReason,
              reviewedAt: new Date(),
              reviewedBy: profile.id,
              status: 'rejected' as const,
            }
          : {
              paidAt: new Date(),
              reviewedAt: new Date(),
              reviewedBy: profile.id,
              status: 'paid' as const,
            };
    const [updated] = await db
      .update(payoutRequests)
      .set(values)
      .where(
        and(eq(payoutRequests.id, id), eq(payoutRequests.status, expected)),
      )
      .returning({
        id: payoutRequests.id,
        instructorId: payoutRequests.instructorId,
      });
    if (!updated)
      throw new NotFoundException(
        `${action === 'paid' ? 'Approved' : 'Pending'} payout request not found.`,
      );
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: `payout_${action === 'paid' ? 'paid' : action + 'd'}`,
      entityType: 'payout',
      entityId: id,
      metadata: {},
    });
    // Best-effort in-app notification to the instructor. Never throws.
    const payoutLabel =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : 'marked as paid';
    await notifySafely({
      body: `Your payout request was ${payoutLabel}.`,
      href: '/dashboard/instructor/payouts',
      profileId: updated.instructorId,
      title: `Payout ${payoutLabel}`,
      type: 'payout_decided',
    });
  }
  async listRefunds(request: Request) {
    await this.admin(request);
    const sp = alias(profiles, 'admin_refund_student_profiles');
    const su = alias(users, 'admin_refund_student_users');
    const rp = alias(profiles, 'admin_refund_reviewer_profiles');
    const ru = alias(users, 'admin_refund_reviewer_users');
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
        reviewedByEmail: ru.email,
        status: refunds.status,
        studentEmail: su.email,
        processedAt: refunds.processedAt,
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .innerJoin(courses, eq(orders.courseId, courses.id))
      .innerJoin(sp, eq(orders.userId, sp.id))
      .innerJoin(su, eq(sp.userId, su.id))
      .leftJoin(rp, eq(refunds.reviewedBy, rp.id))
      .leftJoin(ru, eq(rp.userId, ru.id))
      .orderBy(desc(refunds.createdAt));
    return {
      refunds: rows.map((row) => ({
        ...row,
        amount: String(row.amount),
        createdAt: row.createdAt.toISOString(),
        processedAt: date(row.processedAt),
        reviewedAt: date(row.reviewedAt),
      })),
    };
  }
  async createRefund(request: Request) {
    const profile = await this.admin(request);
    const input = refundSchema.parse(request.body);
    const [order] = await db
      .select({
        amount: orders.amount,
        currency: orders.currency,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    if (!order || order.status !== 'paid')
      throw new BadRequestException('Only paid orders can be refunded.');
    if (input.amount > Number(order.amount))
      throw new BadRequestException('Refund amount exceeds the paid amount.');
    const [created] = await db
      .insert(refunds)
      .values({
        amount: input.amount.toFixed(2),
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
      metadata: { orderId: input.orderId },
    });
    return created;
  }
  async decideRefund(
    id: string,
    action: 'approve' | 'reject' | 'process',
    request: Request,
  ) {
    const profile = await this.admin(request);
    const input = refundDecisionSchema.parse(request.body ?? {});
    const status =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : 'processed';
    const [updated] = await db
      .update(refunds)
      .set({
        reason: input.reason ?? undefined,
        reviewedBy: profile.id,
        reviewedAt: new Date(),
        processedAt: status === 'processed' ? new Date() : undefined,
        status,
      })
      .where(eq(refunds.id, id))
      .returning({ id: refunds.id, orderId: refunds.orderId });
    if (!updated) throw new NotFoundException('Refund not found.');
    if (status === 'approved') {
      // Access is revoked on approval: every enrolment granted by this
      // order (bundle/add-on enrolments all carry the order id) moves to
      // revoked with a timestamp. Money movement stays manual — no code
      // touches payments here.
      await db
        .update(enrollments)
        .set({ revokedAt: new Date(), status: 'revoked' })
        .where(eq(enrollments.orderId, updated.orderId));
    }
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: `refund_${action}d`,
      entityType: 'refund',
      entityId: id,
      metadata: {},
    });
    // Best-effort in-app notification to the student. Never throws.
    await this.notifyRefundDecided(updated.orderId, status);
  }

  private async notifyRefundDecided(orderId: string, status: string) {
    try {
      const [order] = await db
        .select({ courseId: orders.courseId, userId: orders.userId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) return;
      const [course] = await db
        .select({ title: courses.title })
        .from(courses)
        .where(eq(courses.id, order.courseId))
        .limit(1);
      const label =
        status === 'approved'
          ? 'approved'
          : status === 'rejected'
            ? 'rejected'
            : 'processed';
      await notifySafely({
        body: `Your refund request for "${course?.title ?? 'the course'}" was ${label}.`,
        href: '/dashboard/student/orders',
        profileId: order.userId,
        title: `Refund ${label}`,
        type: 'refund_decided',
      });
    } catch (error) {
      console.error('Refund-decision notification failed.', error);
    }
  }
}
