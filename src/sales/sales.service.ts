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
  abandonedCarts,
  and,
  asc,
  bundleCourses,
  bundles,
  courses,
  desc,
  enrollments,
  eq,
  inArray,
  lectures,
  modules,
  orderInstalments,
  orderItems,
  orders,
  profiles,
  progress,
  sections,
  subscriptions,
  users,
  videoProgress,
  videos,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { verifyPaymentWithPayConfirm } from '../payments/payments-helpers.js';
import {
  bundleCourseIds,
  daysBetween,
  grantEnrolments,
  isMissingTableError,
  missingTable503,
  orderCourseIds,
  refundRules,
} from './sales-helpers.js';

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

@Injectable()
export class SalesService {
  constructor(private readonly authService: AuthService) {}

  // ---------------- Bundles ----------------

  async listBundles() {
    try {
      const rows = await db
        .select()
        .from(bundles)
        .where(eq(bundles.isPublished, true))
        .orderBy(desc(bundles.createdAt));
      const withCourses = await Promise.all(
        rows.map(async (row) => ({
          courseIds: await bundleCourseIds(row.id),
          currency: row.currency,
          description: row.description,
          durationDays: row.durationDays,
          id: row.id,
          instructorId: row.instructorId,
          isPublished: row.isPublished,
          originalPrice: row.originalPrice,
          price: row.price,
          title: row.title,
        })),
      );
      return { bundles: withCourses };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createBundle(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const input = parseOr400(
      z.object({
        courseIds: z.array(uuid).min(1).max(50),
        currency: z.string().trim().length(3).default('BDT'),
        description: z.string().trim().max(5000).optional(),
        durationDays: z.number().int().positive().optional(),
        originalPrice: z.coerce.number().nonnegative().optional(),
        price: z.coerce.number().nonnegative(),
        title: z.string().trim().min(2).max(180),
      }),
      request.body,
    );
    const uniqueCourseIds = [...new Set(input.courseIds)];
    try {
      const found = await db
        .select({ id: courses.id, instructorId: courses.instructorId })
        .from(courses)
        .where(inArray(courses.id, uniqueCourseIds));
      if (found.length !== uniqueCourseIds.length) {
        throw new BadRequestException('One or more courses were not found.');
      }
      if (
        profile.role === 'instructor' &&
        found.some((course) => course.instructorId !== profile.id)
      ) {
        throw new ForbiddenException(
          'A bundle may only contain your own courses.',
        );
      }
      const [bundle] = await db
        .insert(bundles)
        .values({
          currency: input.currency.toUpperCase(),
          description: input.description ?? null,
          durationDays: input.durationDays ?? null,
          instructorId: profile.id,
          originalPrice:
            input.originalPrice !== undefined
              ? input.originalPrice.toFixed(2)
              : null,
          price: input.price.toFixed(2),
          title: input.title,
        })
        .returning({ id: bundles.id });
      if (!bundle) throw new Error('Bundle could not be created.');
      await db.insert(bundleCourses).values(
        uniqueCourseIds.map((courseId, index) => ({
          bundleId: bundle.id,
          courseId,
          position: index,
        })),
      );
      return {
        bundle: {
          courseIds: uniqueCourseIds,
          currency: input.currency.toUpperCase(),
          description: input.description ?? null,
          durationDays: input.durationDays ?? null,
          id: bundle.id,
          originalPrice:
            input.originalPrice !== undefined
              ? input.originalPrice.toFixed(2)
              : null,
          price: input.price.toFixed(2),
          title: input.title,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  /** Bundle order: one order, paid through the existing PayConfirm proof flow unchanged. */
  async createBundleOrder(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const input = parseOr400(
      z.object({ bundleId: uuid }),
      request.body,
    );
    try {
      const [bundle] = await db
        .select()
        .from(bundles)
        .where(eq(bundles.id, input.bundleId))
        .limit(1);
      if (!bundle || !bundle.isPublished) {
        throw new NotFoundException('Bundle not found.');
      }
      const courseIds = await bundleCourseIds(bundle.id);
      if (!courseIds.length) {
        throw new BadRequestException('This bundle has no courses.');
      }
      const already = await db
        .select({ courseId: enrollments.courseId })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.userId, profile.id),
            inArray(enrollments.courseId, courseIds),
            eq(enrollments.status, 'active'),
          ),
        );
      if (already.length === courseIds.length) {
        throw new ConflictException(
          'You are already enrolled in every course in this bundle.',
        );
      }
      const created = await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            amount: bundle.price,
            courseId: courseIds[0]!,
            currency: bundle.currency,
            referenceCode: `ORD-${randomBytes(4).toString('hex').toUpperCase()}`,
            status: 'pending_verification',
            userId: profile.id,
          })
          .returning({ id: orders.id, referenceCode: orders.referenceCode });
        if (!order) throw new Error('Order could not be created.');
        await tx.insert(orderItems).values(
          courseIds.map((courseId) => ({
            amount: '0.00',
            courseId,
            isOrderBump: false,
            orderId: order.id,
          })),
        );
        if (bundle.durationDays) {
          await tx.insert(subscriptions).values({
            durationDays: bundle.durationDays,
            months: Math.max(1, Math.ceil(bundle.durationDays / 30)),
            orderId: order.id,
            status: 'pending',
            targetId: bundle.id,
            targetType: 'bundle',
            userId: profile.id,
          });
        }
        return order;
      });
      await this.markCartsRecovered(profile.id, {
        bundleId: bundle.id,
      }).catch(() => undefined);
      return {
        bundleId: bundle.id,
        courseIds,
        order: {
          amount: bundle.price,
          currency: bundle.currency,
          id: created.id,
          referenceCode: created.referenceCode,
          status: 'pending_verification',
        },
        // The order id above is what the student pays for via the existing
        // POST /payments/orders/:orderId/proof PayConfirm flow; on approval
        // every bundle course is enrolled (see payments.service.ts).
        payVia: 'POST /payments/orders/:orderId/proof (PayConfirm, unchanged)',
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- Subscriptions ----------------

  async createSubscription(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const input = parseOr400(
      z.object({
        months: z.number().int().min(1).max(24),
        targetId: uuid,
        targetType: z.enum(['course', 'bundle']),
      }),
      request.body,
    );
    try {
      let firstCourseId: string;
      let price: string;
      let currency: string;
      let courseIds: string[];
      if (input.targetType === 'course') {
        const [course] = await db
          .select()
          .from(courses)
          .where(eq(courses.id, input.targetId))
          .limit(1);
        if (!course || course.status !== 'published') {
          throw new BadRequestException('Course not found.');
        }
        firstCourseId = course.id;
        price = course.price;
        currency = course.currency;
        courseIds = [course.id];
      } else {
        const [bundle] = await db
          .select()
          .from(bundles)
          .where(eq(bundles.id, input.targetId))
          .limit(1);
        if (!bundle || !bundle.isPublished) {
          throw new NotFoundException('Bundle not found.');
        }
        courseIds = await bundleCourseIds(bundle.id);
        if (!courseIds.length) {
          throw new BadRequestException('This bundle has no courses.');
        }
        firstCourseId = courseIds[0]!;
        price = bundle.price;
        currency = bundle.currency;
      }
      // Subscription price is the target's listed price for the whole
      // period (not per month); months is the access duration only.
      const created = await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            amount: price,
            courseId: firstCourseId,
            currency,
            referenceCode: `ORD-${randomBytes(4).toString('hex').toUpperCase()}`,
            status: 'pending_verification',
            userId: profile.id,
          })
          .returning({ id: orders.id });
        if (!order) throw new Error('Order could not be created.');
        if (courseIds.length > 1) {
          await tx.insert(orderItems).values(
            courseIds.map((courseId) => ({
              amount: '0.00',
              courseId,
              isOrderBump: false,
              orderId: order.id,
            })),
          );
        }
        const [subscription] = await tx
          .insert(subscriptions)
          .values({
            months: input.months,
            orderId: order.id,
            status: 'pending',
            targetId: input.targetId,
            targetType: input.targetType,
            userId: profile.id,
          })
          .returning({ id: subscriptions.id });
        if (!subscription) throw new Error('Subscription could not be created.');
        return { order, subscription };
      });
      return {
        order: {
          amount: price,
          currency,
          id: created.order.id,
          status: 'pending_verification',
        },
        payVia: 'POST /payments/orders/:orderId/proof (PayConfirm, unchanged)',
        subscription: {
          expiresAt: null,
          id: created.subscription.id,
          months: input.months,
          startsAt: null,
          status: 'pending',
          targetId: input.targetId,
          targetType: input.targetType,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- Instalments ----------------

  async defineInstalments(orderId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const id = parseOr400(uuid, orderId);
    const input = parseOr400(
      z.object({
        instalments: z
          .array(
            z.object({
              amount: z.coerce.number().positive(),
              dueDate: z.string().datetime(),
            }),
          )
          .min(2)
          .max(12),
      }),
      request.body,
    );
    const order = await this.ownOrder(id, profile);
    if (order.status === 'paid') {
      throw new ConflictException('This order is already paid in full.');
    }
    const total = input.instalments.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    if (Math.abs(total - Number(order.amount)) > 0.01) {
      throw new BadRequestException(
        'Instalment amounts must add up to the order amount.',
      );
    }
    try {
      const existing = await db
        .select({ status: orderInstalments.status })
        .from(orderInstalments)
        .where(eq(orderInstalments.orderId, id));
      if (existing.some((row) => row.status === 'paid')) {
        throw new ConflictException(
          'Instalments already partially paid cannot be redefined.',
        );
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(orderInstalments)
          .where(eq(orderInstalments.orderId, id));
        await tx.insert(orderInstalments).values(
          input.instalments.map((item) => ({
            amount: item.amount.toFixed(2),
            dueDate: new Date(item.dueDate),
            orderId: id,
            status: 'pending' as const,
          })),
        );
      });
      return this.instalmentSchedule(id, profile);
    } catch (error) {
      missingTable503(error);
    }
  }

  async getInstalments(orderId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const id = parseOr400(uuid, orderId);
    await this.ownOrder(id, profile);
    return this.instalmentSchedule(id, profile);
  }

  async payInstalment(orderId: string, instalmentId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const id = parseOr400(uuid, orderId);
    const instId = parseOr400(uuid, instalmentId);
    const input = parseOr400(
      z.object({
        senderNumber: z.string().trim().min(4).max(64),
        transactionId: z.string().trim().min(3).max(255),
      }),
      request.body,
    );
    const order = await this.ownOrder(id, profile);
    try {
      const [instalment] = await db
        .select()
        .from(orderInstalments)
        .where(
          and(
            eq(orderInstalments.id, instId),
            eq(orderInstalments.orderId, id),
          ),
        )
        .limit(1);
      if (!instalment) throw new NotFoundException('Instalment not found.');
      if (instalment.status === 'paid') {
        throw new ConflictException('This instalment is already paid.');
      }
      await verifyPaymentWithPayConfirm({
        amount: instalment.amount,
        senderNumber: input.senderNumber,
        transactionId: input.transactionId,
      });
      await db
        .update(orderInstalments)
        .set({
          paidAt: new Date(),
          senderNumber: input.senderNumber,
          status: 'paid',
          transactionId: input.transactionId,
        })
        .where(eq(orderInstalments.id, instId));
      // ACCESS RULE: the first paid instalment grants access.
      const paid = await db
        .select({ id: orderInstalments.id })
        .from(orderInstalments)
        .where(
          and(
            eq(orderInstalments.orderId, id),
            eq(orderInstalments.status, 'paid'),
          ),
        );
      if (paid.length === 1) {
        await grantEnrolments(
          order.userId,
          await orderCourseIds(id),
          id,
        );
      }
      return this.instalmentSchedule(id, profile);
    } catch (error) {
      missingTable503(error);
    }
  }

  private async instalmentSchedule(orderId: string, profile: { id: string }) {
    try {
      const [order] = await db
        .select({ amount: orders.amount })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      const rows = await db
        .select()
        .from(orderInstalments)
        .where(eq(orderInstalments.orderId, orderId))
        .orderBy(asc(orderInstalments.dueDate));
      const now = new Date();
      const paidTotal = rows
        .filter((row) => row.status === 'paid')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      return {
        accessRule:
          'Access is granted when the first instalment is paid; later instalments being overdue does not revoke access.',
        instalments: rows.map((row) => ({
          amount: row.amount,
          dueDate: row.dueDate.toISOString(),
          id: row.id,
          paidAt: row.paidAt?.toISOString() ?? null,
          status:
            row.status === 'pending' && row.dueDate < now
              ? 'overdue'
              : row.status,
          transactionId: row.transactionId,
        })),
        orderAmount: order?.amount ?? null,
        orderId,
        paidTotal: paidTotal.toFixed(2),
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- Order bump (upsell) ----------------

  async addOrderBump(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const input = parseOr400(
      z.object({ courseId: uuid, orderId: uuid }),
      request.body,
    );
    const order = await this.ownOrder(input.orderId, profile);
    if (order.status !== 'pending_verification') {
      throw new ConflictException(
        'An order bump can only be added to a pending order.',
      );
    }
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .limit(1);
    if (!course || course.status !== 'published') {
      throw new BadRequestException('Course not found.');
    }
    if (course.id === order.courseId) {
      throw new ConflictException('This course is already in the order.');
    }
    try {
      await db
        .insert(orderItems)
        .values({
          amount: course.price,
          courseId: course.id,
          isOrderBump: true,
          orderId: order.id,
        })
        .onConflictDoNothing();
      const newAmount = (Number(order.amount) + Number(course.price)).toFixed(2);
      await db
        .update(orders)
        .set({ amount: newAmount })
        .where(eq(orders.id, order.id));
      return {
        courseId: course.id,
        courseTitle: course.title,
        newOrderAmount: newAmount,
        orderId: order.id,
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- Abandoned carts ----------------

  async recordAbandonedCart(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const input = parseOr400(
      z.object({
        items: z
          .array(
            z.object({
              bundleId: uuid.optional(),
              courseId: uuid.optional(),
            }),
          )
          .min(1)
          .max(20)
          .refine((items) =>
            items.every((item) => item.courseId || item.bundleId),
          ),
        startedAt: z.string().datetime().optional(),
      }),
      request.body,
    );
    try {
      const [cart] = await db
        .insert(abandonedCarts)
        .values({
          items: input.items,
          startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
          userId: profile.id,
        })
        .returning({ id: abandonedCarts.id });
      return {
        cart: {
          id: cart!.id,
          items: input.items,
          recovered: false,
          userId: profile.id,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async teacherAbandonedCarts(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    try {
      const myCourseRows = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.instructorId, profile.id));
      const myCourseIds = new Set(myCourseRows.map((row) => row.id));
      const bundleRows = await db
        .select({ bundleId: bundleCourses.bundleId, courseId: bundleCourses.courseId })
        .from(bundleCourses);
      const bundleToCourses = new Map<string, string[]>();
      for (const row of bundleRows) {
        const list = bundleToCourses.get(row.bundleId) ?? [];
        list.push(row.courseId);
        bundleToCourses.set(row.bundleId, list);
      }
      const carts = await db
        .select()
        .from(abandonedCarts)
        .orderBy(desc(abandonedCarts.startedAt))
        .limit(200);
      const userIds = [...new Set(carts.map((cart) => cart.userId))];
      const studentRows = userIds.length
        ? await db
            .select({
              email: users.email,
              fullName: profiles.fullName,
              id: profiles.id,
            })
            .from(profiles)
            .innerJoin(users, eq(profiles.userId, users.id))
            .where(inArray(profiles.id, userIds))
        : [];
      const studentById = new Map(studentRows.map((row) => [row.id, row]));
      const mine = carts.filter((cart) =>
        cart.items.some(
          (item) =>
            (item.courseId && myCourseIds.has(item.courseId)) ||
            (item.bundleId &&
              (bundleToCourses.get(item.bundleId) ?? []).some((id) =>
                myCourseIds.has(id),
              )),
        ),
      );
      return {
        carts: mine.map((cart) => ({
          id: cart.id,
          items: cart.items,
          recovered: cart.recovered,
          recoveredAt: cart.recoveredAt?.toISOString() ?? null,
          startedAt: cart.startedAt.toISOString(),
          studentEmail: studentById.get(cart.userId)?.email ?? null,
          studentName: studentById.get(cart.userId)?.fullName ?? null,
          userId: cart.userId,
        })),
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- Refund estimate ----------------

  async refundEstimate(orderId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const id = parseOr400(uuid, orderId);
    const order = await this.ownOrder(id, profile);
    const courseIds = await orderCourseIds(id);
    const started = await this.anyCourseStarted(profile.id, courseIds);
    try {
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.orderId, id))
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
          price: Number(order.amount),
          totalDays,
          unusedDays,
        });
        return { estimatedAmount: result.amount, kind: 'subscription', orderId: id, ...result };
      }
      const instalments = await db
        .select()
        .from(orderInstalments)
        .where(eq(orderInstalments.orderId, id));
      if (instalments.length) {
        const paidTotal = instalments
          .filter((row) => row.status === 'paid')
          .reduce((sum, row) => sum + Number(row.amount), 0);
        // Consumed value: if a subscription period exists it is handled
        // above; otherwise the first paid instalment (which granted
        // access) counts as consumed, the rest as refundable.
        const firstPaid = instalments
          .filter((row) => row.status === 'paid')
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
        const result = refundRules.instalmentRefund({
          consumedValue: firstPaid ? Number(firstPaid.amount) : 0,
          paidTotal,
        });
        return { estimatedAmount: result.amount, kind: 'instalment', orderId: id, ...result };
      }
      if (courseIds.length > 1) {
        const result = refundRules.bundleRefund({
          anyCourseStarted: started,
          price: Number(order.amount),
        });
        return { estimatedAmount: result.amount, kind: 'bundle', orderId: id, ...result };
      }
      return {
        eligible: false,
        estimatedAmount: null,
        kind: 'standard',
        orderId: id,
        rule: 'Single-course refunds use the existing refund request flow; no automatic estimate applies.',
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        // Pre-migration there are no subscriptions/instalments/items, so
        // a single-course order falls back to the standard rule.
        return {
          eligible: false,
          estimatedAmount: null,
          kind: 'standard',
          orderId: id,
          rule: 'Single-course refunds use the existing refund request flow; no automatic estimate applies.',
        };
      }
      throw error;
    }
  }

  // ---------------- helpers ----------------

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
    // Legacy lecture hierarchy: progress rows for lectures of these sections.
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
          and(
            eq(progress.userId, userId),
            inArray(progress.lectureId, legacyIds),
          ),
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

  private async markCartsRecovered(
    userId: string,
    match: { bundleId?: string; courseId?: string },
  ): Promise<void> {
    try {
      const carts = await db
        .select()
        .from(abandonedCarts)
        .where(
          and(
            eq(abandonedCarts.userId, userId),
            eq(abandonedCarts.recovered, false),
          ),
        );
      for (const cart of carts) {
        const hit = cart.items.some(
          (item) =>
            (match.bundleId && item.bundleId === match.bundleId) ||
            (match.courseId && item.courseId === match.courseId),
        );
        if (hit) {
          await db
            .update(abandonedCarts)
            .set({ recovered: true, recoveredAt: new Date() })
            .where(eq(abandonedCarts.id, cart.id));
        }
      }
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }

  private async ownOrder(
    orderId: string,
    profile: { id: string; role: string },
  ) {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) throw new NotFoundException('Order not found.');
    if (profile.role !== 'admin' && order.userId !== profile.id) {
      throw new ForbiddenException('Access denied.');
    }
    return order;
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
