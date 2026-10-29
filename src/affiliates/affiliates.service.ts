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
import { randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  affiliateAttributions,
  affiliateCommissions,
  affiliateLinks,
  affiliatePayouts,
  affiliateTracks,
  and,
  bundleCourses,
  bundles,
  courses,
  desc,
  enrollments,
  eq,
  orderItems,
  orders,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { notifySafely } from '../lib/notifications.js';
import {
  isMissingTableError,
  missingTable503,
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

function linkDto(row: typeof affiliateLinks.$inferSelect) {
  return {
    code: row.code,
    commissionType: row.commissionType,
    commissionValue: row.commissionValue,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    isReferral: row.isReferral,
    ownerId: row.ownerId,
    scopeId: row.scopeId,
    scopeType: row.scopeType,
  };
}

function commissionDto(row: typeof affiliateCommissions.$inferSelect) {
  return {
    amount: row.amount,
    buyerId: row.buyerId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    orderId: row.orderId,
    referrerId: row.referrerId,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function payoutDto(row: typeof affiliatePayouts.$inferSelect) {
  return {
    amount: row.amount,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    note: row.note,
    referrerId: row.referrerId,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function generateAffiliateCode(): string {
  return randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
}

/**
 * Post-PayConfirm hook. Called from payments.service.ts AFTER an order
 * is marked paid. Reads the order's attribution (if any) and creates
 * exactly one commission for it. No-op pre-migration (missing tables
 * swallowed) and no-op when there is no attribution. Self-referral
 * (referrer == buyer) is rejected at attribution time AND re-checked
 * here, so it can never earn a commission. No auto payout is created:
 * payouts are manual, admin-approved only.
 */
export async function recordAffiliateCommission(
  orderId: string,
  buyerId: string,
): Promise<void> {
  try {
    const [attribution] = await db
      .select()
      .from(affiliateAttributions)
      .where(eq(affiliateAttributions.orderId, orderId))
      .limit(1);
    if (!attribution) return;
    if (attribution.referrerId === buyerId) return;
    if (attribution.buyerId !== buyerId) return;
    const [existing] = await db
      .select({ id: affiliateCommissions.id })
      .from(affiliateCommissions)
      .where(eq(affiliateCommissions.orderId, orderId))
      .limit(1);
    if (existing) return;
    const [link] = await db
      .select()
      .from(affiliateLinks)
      .where(eq(affiliateLinks.id, attribution.linkId))
      .limit(1);
    if (!link) return;
    const [order] = await db
      .select({ amount: orders.amount })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order || order.amount === null) return;
    const amount =
      link.commissionType === 'percent'
        ? Math.round(Number(order.amount) * Number(link.commissionValue)) / 100
        : Number(link.commissionValue);
    await db.insert(affiliateCommissions).values({
      amount: amount.toFixed(2),
      attributionId: attribution.id,
      buyerId,
      orderId,
      referrerId: attribution.referrerId,
      status: 'pending',
    });
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
}

@Injectable()
export class AffiliatesService {
  constructor(private readonly authService: AuthService) {}

  private async requireRole(
    request: Request,
    roles: string[],
  ): Promise<{ id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) throw new UnauthorizedException('Authentication is required.');
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }

  private async assertScopeOwned(
    profile: { id: string; role: string },
    scopeType: string,
    scopeId: string | null,
  ) {
    if (profile.role === 'admin') return;
    if (scopeType === 'course' && scopeId) {
      const [course] = await db
        .select({ instructorId: courses.instructorId })
        .from(courses)
        .where(eq(courses.id, scopeId))
        .limit(1);
      if (!course || course.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
    }
    if (scopeType === 'bundle' && scopeId) {
      const [bundle] = await db
        .select({ instructorId: bundles.instructorId })
        .from(bundles)
        .where(eq(bundles.id, scopeId))
        .limit(1);
      if (!bundle || bundle.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
    }
  }

  async createLink(request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    const input = parseOr400(
      z.object({
        code: z
          .string()
          .trim()
          .min(3)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
        commissionType: z.enum(['percent', 'flat']),
        commissionValue: z.number().min(0),
        isReferral: z.boolean().optional(),
        scopeId: uuid.optional(),
        scopeType: z.enum(['course', 'bundle', 'all']).optional(),
      }),
      request.body,
    );
    try {
      const scopeType = input.scopeType ?? 'all';
      const scopeId = input.scopeId ?? null;
      if (profile.role === 'student') {
        // Students may only create their own referral links. A
        // course-scoped student link additionally requires enrolment.
        if (scopeType === 'course' && scopeId) {
          const [enrolment] = await db
            .select({ id: enrollments.id })
            .from(enrollments)
            .where(
              and(
                eq(enrollments.courseId, scopeId),
                eq(enrollments.userId, profile.id),
                eq(enrollments.status, 'active'),
              ),
            )
            .limit(1);
          if (!enrolment) {
            throw new ForbiddenException('Active enrollment is required.');
          }
        }
        if (scopeType === 'bundle') {
          throw new ForbiddenException(
            'Students cannot create bundle affiliate links.',
          );
        }
      } else {
        await this.assertScopeOwned(profile, scopeType, scopeId);
      }
      if (input.commissionType === 'percent' && input.commissionValue > 100) {
        throw new BadRequestException('Percent commission cannot exceed 100.');
      }
      let code = input.code ?? generateAffiliateCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const [clash] = await db
          .select({ id: affiliateLinks.id })
          .from(affiliateLinks)
          .where(eq(affiliateLinks.code, code))
          .limit(1);
        if (!clash) break;
        if (input.code) {
          throw new ConflictException('This affiliate code is already taken.');
        }
        code = generateAffiliateCode();
      }
      const [link] = await db
        .insert(affiliateLinks)
        .values({
          code,
          commissionType: input.commissionType,
          commissionValue: input.commissionValue.toFixed(2),
          isReferral: profile.role === 'student' ? true : (input.isReferral ?? false),
          ownerId: profile.id,
          scopeId,
          scopeType,
        })
        .returning();
      if (!link) throw new Error('Affiliate link could not be created.');
      return { link: linkDto(link) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listLinks(request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    try {
      const rows = await db
        .select()
        .from(affiliateLinks)
        .where(eq(affiliateLinks.ownerId, profile.id))
        .orderBy(desc(affiliateLinks.createdAt));
      return { links: rows.map(linkDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  /**
   * Best-effort click tracking. Never throws for an unknown code or a
   * missing table: checkout must never break because of tracking.
   */
  async track(request: Request) {
    const input = parseOr400(
      z.object({ code: z.string().trim().min(1).max(64) }),
      request.body,
    );
    try {
      const [link] = await db
        .select({ id: affiliateLinks.id })
        .from(affiliateLinks)
        .where(eq(affiliateLinks.code, input.code))
        .limit(1);
      if (link) {
        await db
          .insert(affiliateTracks)
          .values({ code: input.code, linkId: link.id });
      }
    } catch {
      // Best-effort only.
    }
    return { tracked: true };
  }

  async attribute(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const input = parseOr400(
      z.object({ code: z.string().trim().min(1).max(64), orderId: uuid }),
      request.body,
    );
    try {
      const [link] = await db
        .select()
        .from(affiliateLinks)
        .where(eq(affiliateLinks.code, input.code))
        .limit(1);
      if (!link) throw new NotFoundException('Affiliate link not found.');
      if (link.ownerId === profile.id) {
        // Self-referral is void at attribution time (and again at
        // commission time) — it is never recorded.
        throw new BadRequestException('You cannot refer yourself.');
      }
      const [order] = await db
        .select({
          courseId: orders.courseId,
          status: orders.status,
          userId: orders.userId,
        })
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1);
      if (!order) throw new NotFoundException('Order not found.');
      if (profile.role !== 'admin' && order.userId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
      if (order.status === 'paid') {
        throw new ConflictException(
          'Attribution must happen before payment.',
        );
      }
      // Scope check: a course/bundle link only attributes orders for
      // that scope; an 'all' link attributes any order.
      if (link.scopeType === 'course' && link.scopeId) {
        const [scoped] = await db
          .select({ courseId: orders.courseId })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1);
        if (!scoped || scoped.courseId !== link.scopeId) {
          throw new BadRequestException(
            'This link does not apply to this order.',
          );
        }
      }
      if (link.scopeType === 'bundle' && link.scopeId) {
        const bundleRows = await db
          .select({ courseId: bundleCourses.courseId })
          .from(bundleCourses)
          .where(eq(bundleCourses.bundleId, link.scopeId));
        const bundleCourseIds = bundleRows.map((row) => row.courseId);
        const orderCourseIds = [order.courseId];
        try {
          const items = await db
            .select({ courseId: orderItems.courseId })
            .from(orderItems)
            .where(eq(orderItems.orderId, input.orderId));
          for (const item of items) {
            if (!orderCourseIds.includes(item.courseId)) {
              orderCourseIds.push(item.courseId);
            }
          }
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
          // Pre-migration: an order covers only its own course.
        }
        if (!orderCourseIds.some((id) => bundleCourseIds.includes(id))) {
          throw new BadRequestException(
            'This link does not apply to this order.',
          );
        }
      }
      const [attribution] = await db
        .insert(affiliateAttributions)
        .values({
          buyerId: order.userId,
          linkId: link.id,
          orderId: input.orderId,
          referrerId: link.ownerId,
        })
        .onConflictDoNothing()
        .returning();
      if (attribution) {
        return {
          attribution: {
            buyerId: attribution.buyerId,
            createdAt: attribution.createdAt.toISOString(),
            id: attribution.id,
            linkId: attribution.linkId,
            orderId: attribution.orderId,
            referrerId: attribution.referrerId,
          },
        };
      }
      const [existing] = await db
        .select()
        .from(affiliateAttributions)
        .where(eq(affiliateAttributions.orderId, input.orderId))
        .limit(1);
      if (!existing) throw new Error('Attribution could not be created.');
      return {
        attribution: {
          buyerId: existing.buyerId,
          createdAt: existing.createdAt.toISOString(),
          id: existing.id,
          linkId: existing.linkId,
          orderId: existing.orderId,
          referrerId: existing.referrerId,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async dashboard(request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    try {
      const attributions = await db
        .select()
        .from(affiliateAttributions)
        .where(eq(affiliateAttributions.referrerId, profile.id));
      const commissions = await db
        .select()
        .from(affiliateCommissions)
        .where(eq(affiliateCommissions.referrerId, profile.id))
        .orderBy(desc(affiliateCommissions.createdAt));
      const sum = (status: string) =>
        commissions
          .filter((row) => row.status === status)
          .reduce((total, row) => total + Number(row.amount), 0)
          .toFixed(2);
      return {
        commissions: {
          approved: sum('approved'),
          paid: sum('paid'),
          pending: sum('pending'),
        },
        ledger: commissions.map(commissionDto),
        referrals: attributions.length,
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async requestPayout(request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    const input = parseOr400(
      z.object({
        amount: z.number().positive(),
        note: z.string().trim().max(500).optional(),
      }),
      request.body,
    );
    try {
      const [payout] = await db
        .insert(affiliatePayouts)
        .values({
          amount: input.amount.toFixed(2),
          note: input.note ?? null,
          referrerId: profile.id,
          status: 'pending',
        })
        .returning();
      if (!payout) throw new Error('Payout request could not be created.');
      return { payout: payoutDto(payout), status: 'pending' };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listPayouts(request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    try {
      // Admin sees every payout request (the approval queue); everyone else
      // sees only their own ledger. Previously this filtered by the caller
      // for all roles, so the admin page could never list others' requests.
      const rows =
        profile.role === 'admin'
          ? await db
              .select()
              .from(affiliatePayouts)
              .orderBy(desc(affiliatePayouts.createdAt))
          : await db
              .select()
              .from(affiliatePayouts)
              .where(eq(affiliatePayouts.referrerId, profile.id))
              .orderBy(desc(affiliatePayouts.createdAt));
      return { payouts: rows.map(payoutDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async adminPayoutAction(
    payoutIdInput: string,
    action: 'approve' | 'reject' | 'mark-paid',
    request: Request,
  ) {
    const profile = await this.requireRole(request, ['admin']);
    void profile;
    const payoutId = parseOr400(uuid, payoutIdInput);
    try {
      const [payout] = await db
        .select()
        .from(affiliatePayouts)
        .where(eq(affiliatePayouts.id, payoutId))
        .limit(1);
      if (!payout) throw new NotFoundException('Payout not found.');
      const next =
        action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'paid';
      if (action === 'approve' && payout.status !== 'pending') {
        throw new ConflictException('Only a pending payout can be approved.');
      }
      if (
        action === 'reject' &&
        !['pending', 'approved'].includes(payout.status)
      ) {
        throw new ConflictException('This payout cannot be rejected.');
      }
      if (action === 'mark-paid' && payout.status !== 'approved') {
        throw new ConflictException(
          'Only an approved payout can be marked paid.',
        );
      }
      const [updated] = await db
        .update(affiliatePayouts)
        .set({ status: next })
        .where(eq(affiliatePayouts.id, payoutId))
        .returning();
      if (!updated) throw new Error('Payout could not be updated.');
      // Manual approval only: no money movement or auto payout happens
      // here; mark-paid records the admin's manual payment.
      // Best-effort in-app notification to the referrer. Never throws.
      const payoutLabel =
        action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'marked as paid';
      await notifySafely({
        body: `Your affiliate payout request was ${payoutLabel}.`,
        href: '/dashboard/instructor/affiliates',
        profileId: updated.referrerId,
        title: `Affiliate payout ${payoutLabel}`,
        type: 'affiliate_payout_decided',
      });
      return { payout: payoutDto(updated) };
    } catch (error) {
      missingTable503(error);
    }
  }
}
