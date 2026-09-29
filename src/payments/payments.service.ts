import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  courses,
  desc,
  enrollments,
  eq,
  orders,
  profiles,
  sql,
  users,
} from '../database/index.js';
import { randomBytes } from 'node:crypto';
import type {
  PaymentInstructionsResponse,
  PaymentOrderDto,
  StudentOrderListResponse,
} from '../types/index.js';
import { paymentMethods } from '../types/index.js';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createNotification } from '../lib/notifications.js';
import {
  applyCoupon,
  getInstructions,
  getOrderForViewer,
  notifyPaymentApproved,
  verifyPaymentWithPayConfirm,
} from './payments-helpers.js';

@Injectable()
export class PaymentsService {
  constructor(private readonly authService: AuthService) {}

  async couponPreview(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'student'].includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    const courseId = z.string().uuid().parse(request.body?.courseId);
    const couponCode = z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .parse(request.body?.couponCode);
    const [course] = await db
      .select({
        currency: courses.currency,
        price: courses.price,
        status: courses.status,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course || course.status !== 'published') {
      throw new BadRequestException('Course not found.');
    }
    const pricing = await applyCoupon(Number(course.price), couponCode);
    return {
      currency: course.currency,
      discountAmount: pricing.discountAmount,
      amount: pricing.amount,
      originalAmount: Number(course.price).toFixed(2),
      couponCode: pricing.couponCode,
    };
  }

  async myOrders(request: Request): Promise<StudentOrderListResponse> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'student'].includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }

    const rows = await db
      .select({
        amount: orders.amount,
        couponCode: orders.couponCode,
        courseId: orders.courseId,
        courseSlug: courses.slug,
        courseTitle: courses.title,
        thumbnailUrl: courses.thumbnailUrl,
        createdAt: orders.createdAt,
        currency: orders.currency,
        discountAmount: orders.discountAmount,
        id: orders.id,
        paymentMethod: orders.paymentMethod,
        proofScreenshotUrl: orders.proofScreenshotUrl,
        referenceCode: orders.referenceCode,
        rejectionReason: orders.rejectionReason,
        reviewedAt: orders.reviewedAt,
        senderNumber: orders.senderNumber,
        status: orders.status,
        studentEmail: users.email,
        studentName: profiles.fullName,
        studentProfileId: profiles.id,
        transactionId: orders.transactionId,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(courses, eq(orders.courseId, courses.id))
      .innerJoin(profiles, eq(orders.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(eq(orders.userId, profile.id))
      .orderBy(desc(orders.createdAt));

    return {
      orders: rows.map((row) => ({
        amount: row.amount,
        couponCode: row.couponCode,
        courseId: row.courseId,
        courseSlug: row.courseSlug,
        courseTitle: row.courseTitle,
        thumbnailUrl: row.thumbnailUrl,
        createdAt: row.createdAt.toISOString(),
        currency: row.currency,
        discountAmount: row.discountAmount,
        id: row.id,
        originalAmount: (
          Number(row.amount) + Number(row.discountAmount)
        ).toFixed(2),
        paymentMethod: row.paymentMethod,
        proofScreenshotUrl: row.proofScreenshotUrl,
        referenceCode: row.referenceCode,
        rejectionReason: row.rejectionReason,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        reviewedByEmail: null,
        senderNumber: row.senderNumber,
        status: row.status,
        studentEmail: row.studentEmail,
        studentName: row.studentName,
        transactionId: row.transactionId,
        updatedAt: row.updatedAt.toISOString(),
      })) as PaymentOrderDto[],
    };
  }

  async createInstructions(request: Request) {
    const profile = await this.requirePaymentUser(request);
    const input = z
      .object({
        couponCode: z.string().trim().min(1).max(64).optional(),
        courseId: z.string().uuid(),
      })
      .parse(request.body);
    const [course] = await db
      .select({
        currency: courses.currency,
        id: courses.id,
        price: courses.price,
        status: courses.status,
        title: courses.title,
      })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .limit(1);
    if (!course || course.status !== 'published')
      throw new BadRequestException('Course not found.');
    const [existingEnrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, course.id),
          eq(enrollments.userId, profile.id),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    if (existingEnrollment)
      throw new ConflictException('You are already enrolled in this course.');
    const [existingOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.courseId, course.id),
          eq(orders.userId, profile.id),
          sql`${orders.status} in ('pending_verification', 'rejected')`,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (existingOrder)
      return {
        instructions: await getInstructions(),
        order: toPaymentOrder(await getOrderForViewer(existingOrder.id)),
      } satisfies PaymentInstructionsResponse;
    const pricing = await applyCoupon(Number(course.price), input.couponCode);
    const isFree = Number(pricing.amount) === 0;
    const created = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          amount: pricing.amount,
          couponCode: pricing.couponCode,
          courseId: course.id,
          currency: course.currency,
          discountAmount: pricing.discountAmount,
          referenceCode: `ORD-${randomBytes(4).toString('hex').toUpperCase()}`,
          status: isFree ? 'paid' : 'pending_verification',
          userId: profile.id,
        })
        .returning({ id: orders.id });
      if (!order) throw new Error('Order could not be created.');
      if (isFree)
        await tx.insert(enrollments).values({
          courseId: course.id,
          orderId: order.id,
          userId: profile.id,
        });
      return order;
    });
    return {
      instructions: await getInstructions(),
      order: toPaymentOrder(await getOrderForViewer(created.id)),
    } satisfies PaymentInstructionsResponse;
  }

  async orderInstructions(orderId: string, request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    const id = z.string().uuid().parse(orderId);
    const order = await getOrderForViewer(id);
    if (!order) throw new NotFoundException('Order not found.');
    if (profile.role !== 'admin' && order.studentProfileId !== profile.id)
      throw new ForbiddenException('Access denied.');
    return {
      instructions: await getInstructions(),
      order: toPaymentOrder(order),
    } satisfies PaymentInstructionsResponse;
  }

  async submitProof(orderId: string, request: Request) {
    const profile = await this.requirePaymentUser(request);
    const id = z.string().uuid().parse(orderId);
    const input = z
      .object({
        paymentMethod: z.enum(paymentMethods).optional(),
        proofScreenshotUrl: z.string().trim().url().optional(),
        senderNumber: z.string().trim().min(4).max(64),
        transactionId: z.string().trim().min(3).max(255),
      })
      .parse(request.body);
    const order = await getOrderForViewer(id);
    if (!order) throw new NotFoundException('Order not found.');
    if (profile.role !== 'admin' && order.studentProfileId !== profile.id)
      throw new ForbiddenException('Access denied.');
    if (order.status === 'paid')
      throw new ConflictException('This order is already paid.');
    await verifyPaymentWithPayConfirm({
      amount: order.amount,
      senderNumber: input.senderNumber,
      transactionId: input.transactionId,
    });
    await db
      .update(orders)
      .set({
        paymentMethod: input.paymentMethod ?? order.paymentMethod,
        proofScreenshotUrl:
          input.proofScreenshotUrl ?? order.proofScreenshotUrl,
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedBy: null,
        senderNumber: input.senderNumber,
        status: 'paid',
        transactionId: input.transactionId,
      })
      .where(eq(orders.id, id));
    await db
      .insert(enrollments)
      .values({
        courseId: order.courseId,
        orderId: id,
        userId: order.studentProfileId,
      })
      .onConflictDoNothing();
    const updated = await getOrderForViewer(id);
    if (!updated) throw new Error('Updated order could not be loaded.');
    const dto = toPaymentOrder(updated);
    await notifyPaymentApproved(dto);
    const [course] = await db
      .select({
        id: courses.id,
        instructorId: courses.instructorId,
        title: courses.title,
      })
      .from(courses)
      .where(eq(courses.id, order.courseId))
      .limit(1);
    if (course)
      await createNotification({
        body: `A new student enrolled in ${course.title}.`,
        href: `/dashboard/instructor/courses/${course.id}/students`,
        profileId: course.instructorId,
        title: 'New course enrollment',
        type: 'new_enrollment',
      });
    return dto;
  }

  private async requirePaymentUser(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'student'].includes(profile.role))
      throw new ForbiddenException('Access denied.');
    return profile;
  }
}

function toPaymentOrder(order: Awaited<ReturnType<typeof getOrderForViewer>>) {
  if (!order) throw new Error('Order could not be loaded.');
  const amount = Number(order.amount);
  const discountAmount = Number(order.discountAmount);
  return {
    ...order,
    amount: order.amount,
    createdAt: order.createdAt.toISOString(),
    discountAmount: order.discountAmount,
    originalAmount: Math.max(0, amount + discountAmount).toFixed(2),
    reviewedAt: order.reviewedAt?.toISOString() ?? null,
    updatedAt: order.updatedAt.toISOString(),
  } as PaymentOrderDto;
}
