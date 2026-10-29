import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  and,
  bundleCourses,
  enrollments,
  eq,
  orderItems,
  orders,
  subscriptions,
} from '../database/index.js';
import { db } from '../lib/database.js';

/**
 * REFUND / PRORATION RULES (explicit, applied by refundEstimate in
 * sales.service.ts — these estimate; the existing refunds table / admin
 * flow still decides any actual refund):
 * - Bundle: refundable ONLY before any course in the bundle is started
 *   (no completed lecture and no watch position > 0). Once started: 0.
 * - Subscription: refundable ONLY within 14 days of activation, prorated
 *   by unused days: price * unusedDays / totalDays. After day 14: 0.
 * - Instalment: refund = amount actually paid minus the value of the
 *   access period already consumed. Never more than the amount paid.
 *
 * INSTALMENT ACCESS RULE (one rule, applied consistently):
 * Access is granted when the FIRST instalment is paid. Later instalments
 * being late or unpaid do NOT revoke access already granted; they are
 * flagged overdue in the schedule response. The full-order PayConfirm
 * proof flow still grants access immediately when the whole order is paid.
 *
 * SUBSCRIPTION EXPIRY ENFORCEMENT: assertSubscriptionNotExpired() throws
 * 403 when the student has an active subscription covering this course
 * whose expiresAt has passed. If the subscriptions table does not exist
 * yet (migration not applied) the check is skipped, so existing
 * enrolments keep working pre-migration.
 */

export function isMissingTableError(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  if (code === '42P01' || code === '42703') {
    return /relation "([^"]+)"/.exec(message)?.[1] ?? 'a new feature table';
  }
  if (/relation .* does not exist/.test(message)) {
    return /relation "([^"]+)"/.exec(message)?.[1] ?? 'a new feature table';
  }
  return null;
}

export function missingTable503(error: unknown): never {
  const table = isMissingTableError(error);
  if (!table) throw error;
  throw new ServiceUnavailableException(
    `This feature requires the database migration for table "${table}". ` +
      `Generate and apply it first (see MIGRATION-NOTES-5-FEATURES.md).`,
  );
}

/** Deterministic shuffle (mulberry32 seeded from a string) — one attempt keeps one order. */
export function seededShuffle<T>(items: T[], seedText: string): T[] {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Grant (or keep) an active enrolment for each course id. Idempotent. */
export async function grantEnrolments(
  userId: string,
  courseIds: string[],
  orderId?: string,
): Promise<void> {
  for (const courseId of courseIds) {
    await db
      .insert(enrollments)
      .values({ courseId, orderId: orderId ?? null, userId })
      .onConflictDoNothing();
  }
}

/** Course ids an order grants: its own course plus any order_items rows. */
export async function orderCourseIds(orderId: string): Promise<string[]> {
  const [row] = await db
    .select({ courseId: orders.courseId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!row) return [];
  const ids = [row.courseId];
  try {
    const items = await db
      .select({ courseId: orderItems.courseId })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      if (!ids.includes(item.courseId)) ids.push(item.courseId);
    }
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    // Pre-migration: an order grants only its own course.
  }
  return ids;
}

/** Course ids contained in a bundle (empty pre-migration). */
export async function bundleCourseIds(bundleId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ courseId: bundleCourses.courseId })
      .from(bundleCourses)
      .where(eq(bundleCourses.bundleId, bundleId))
      .orderBy(bundleCourses.position);
    return rows.map((row) => row.courseId);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

/**
 * Throws 403 when the student has an active subscription covering this
 * course whose expiresAt has passed. Skipped pre-migration.
 */
export async function assertSubscriptionNotExpired(
  userId: string,
  courseId: string,
): Promise<void> {
  try {
    const rows = await db
      .select({
        expiresAt: subscriptions.expiresAt,
        status: subscriptions.status,
        targetId: subscriptions.targetId,
        targetType: subscriptions.targetType,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, 'active'),
        ),
      );
    const now = new Date();
    for (const row of rows) {
      if (!row.expiresAt || row.expiresAt > now) continue;
      if (row.targetType === 'course' && row.targetId === courseId) {
        throw new ForbiddenException(
          'Your subscription for this course has expired.',
        );
      }
      if (row.targetType === 'bundle') {
        const memberIds = await bundleCourseIds(row.targetId);
        if (memberIds.includes(courseId)) {
          throw new ForbiddenException(
            'Your bundle subscription for this course has expired.',
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof ForbiddenException) throw error;
    if (isMissingTableError(error)) return;
    throw error;
  }
}

/**
 * Called from the existing PayConfirm proof flow (payments.service.ts)
 * after an order is marked paid. Enrols every order_items course and
 * activates any pending subscription linked to the order. Safe to call
 * pre-migration: missing-table errors are swallowed, leaving the
 * original single-course enrolment untouched.
 */
export async function activateOrderExtras(
  orderId: string,
  userId: string,
): Promise<void> {
  try {
    const courseIds = await orderCourseIds(orderId);
    await grantEnrolments(userId, courseIds, orderId);
    const pending = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.orderId, orderId),
          eq(subscriptions.status, 'pending'),
        ),
      );
    const now = new Date();
    for (const sub of pending) {
      const expiresAt = sub.durationDays
        ? addDays(now, sub.durationDays)
        : addMonths(now, sub.months);
      await db
        .update(subscriptions)
        .set({ expiresAt, startsAt: now, status: 'active' })
        .where(eq(subscriptions.id, sub.id));
    }
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
}

export function addMonths(date: Date, months: number): Date {
  const out = new Date(date);
  out.setMonth(out.getMonth() + months);
  return out;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysBetween(start: Date, end: Date): number {
  return Math.max(
    0,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
  );
}

/** Pure refund estimators — see the rules comment at the top of this file. */
export const refundRules = {
  bundleRefund: ({
    anyCourseStarted,
    price,
  }: {
    anyCourseStarted: boolean;
    price: number;
  }): { eligible: boolean; amount: number; rule: string } =>
    anyCourseStarted
      ? {
          amount: 0,
          eligible: false,
          rule: 'Bundle refund only before any course in the bundle is started.',
        }
      : {
          amount: price,
          eligible: true,
          rule: 'Bundle refund only before any course in the bundle is started.',
        },
  subscriptionRefund: ({
    daysSinceStart,
    price,
    totalDays,
    unusedDays,
  }: {
    daysSinceStart: number;
    price: number;
    totalDays: number;
    unusedDays: number;
  }): { eligible: boolean; amount: number; rule: string } =>
    daysSinceStart > 14
      ? {
          amount: 0,
          eligible: false,
          rule: 'Subscription refund prorated by unused days only within 14 days of activation.',
        }
      : {
          amount: Math.min(
            price,
            Math.round(
              ((price * unusedDays) / Math.max(1, totalDays)) * 100,
            ) / 100,
          ),
          eligible: true,
          rule: 'Subscription refund prorated by unused days only within 14 days of activation.',
        },
  instalmentRefund: ({
    consumedValue,
    paidTotal,
  }: {
    consumedValue: number;
    paidTotal: number;
  }): { eligible: boolean; amount: number; rule: string } => ({
    amount: Math.max(0, Math.round((paidTotal - consumedValue) * 100) / 100),
    eligible: paidTotal > consumedValue,
    rule: 'Instalment refund = amount paid minus the value of the access period already consumed.',
  }),
};
