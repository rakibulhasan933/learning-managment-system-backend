import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  alias,
  and,
  courses,
  eq,
  orders,
  profiles,
  siteSettings,
  sql,
  users,
} from '../database/index.js';
import type {
  ManualPaymentInstructionsDto,
  PaymentOrderDto,
} from '../types/index.js';
import { env } from '../config/env.js';
import { db } from '../lib/database.js';
import { sendPaymentApprovedEmail } from '../lib/mailer.js';

const studentProfiles = alias(profiles, 'payment_student_profiles');
const studentUsers = alias(users, 'payment_student_users');
const reviewerProfiles = alias(profiles, 'payment_reviewer_profiles');
const reviewerUsers = alias(users, 'payment_reviewer_users');

export type PaymentOrderRow = {
  amount: string;
  couponCode: string | null;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  thumbnailUrl: string | null;
  createdAt: Date;
  currency: string;
  discountAmount: string;
  id: string;
  paymentMethod: PaymentOrderDto['paymentMethod'];
  proofScreenshotUrl: string | null;
  referenceCode: string;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewedByEmail: string | null;
  senderNumber: string | null;
  status: PaymentOrderDto['status'];
  studentEmail: string;
  studentName: string | null;
  studentProfileId: string;
  transactionId: string | null;
  updatedAt: Date;
};

const money = (value: number) => Math.max(0, value).toFixed(2);
async function setting(key: string) {
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}
export async function getInstructions(): Promise<ManualPaymentInstructionsDto> {
  const [bank, instructions, bkash, nagad, rocket] = await Promise.all([
    setting('payment_bank_details'),
    setting('payment_instructions'),
    setting('payment_bkash_number'),
    setting('payment_nagad_number'),
    setting('payment_rocket_number'),
  ]);
  return {
    bankDetails:
      bank ?? instructions ?? env.MANUAL_PAYMENT_BANK_DETAILS ?? null,
    bkashNumber: bkash ?? env.MANUAL_PAYMENT_BKASH_NUMBER ?? null,
    nagadNumber: nagad ?? env.MANUAL_PAYMENT_NAGAD_NUMBER ?? null,
    rocketNumber: rocket ?? env.MANUAL_PAYMENT_ROCKET_NUMBER ?? null,
  };
}
async function coupons() {
  const result: Record<string, { type: 'amount' | 'percent'; value: number }> =
    {};
  const configured =
    (await setting('payment_coupons')) ?? env.MANUAL_PAYMENT_COUPONS ?? '';
  for (const entry of configured.split(',')) {
    const [rawCode, rawType, rawValue] = entry.split(':');
    const code = rawCode?.trim().toUpperCase();
    const type = rawType?.trim();
    const value = Number(rawValue);
    if (
      code &&
      (type === 'amount' || type === 'percent') &&
      Number.isFinite(value) &&
      value > 0
    )
      result[code] = { type, value };
  }
  return result;
}
export async function applyCoupon(price: number, couponCode?: string) {
  if (!couponCode)
    return { amount: money(price), couponCode: null, discountAmount: '0.00' };
  const code = couponCode.toUpperCase();
  const coupon = (await coupons())[code];
  if (!coupon) throw new BadRequestException('Coupon code is invalid.');
  const discount =
    coupon.type === 'percent' ? (price * coupon.value) / 100 : coupon.value;
  const discountAmount = Math.min(price, discount);
  return {
    amount: money(price - discountAmount),
    couponCode: code,
    discountAmount: money(discountAmount),
  };
}
export async function getOrderForViewer(
  orderId: string,
): Promise<PaymentOrderRow | undefined> {
  const [order] = await db
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
      reviewedByEmail: reviewerUsers.email,
      senderNumber: orders.senderNumber,
      status: orders.status,
      studentEmail: studentUsers.email,
      studentName: studentProfiles.fullName,
      studentProfileId: studentProfiles.id,
      transactionId: orders.transactionId,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .innerJoin(courses, eq(orders.courseId, courses.id))
    .innerJoin(studentProfiles, eq(orders.userId, studentProfiles.id))
    .innerJoin(studentUsers, eq(studentProfiles.userId, studentUsers.id))
    .leftJoin(reviewerProfiles, eq(orders.reviewedBy, reviewerProfiles.id))
    .leftJoin(reviewerUsers, eq(reviewerProfiles.userId, reviewerUsers.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  return order as PaymentOrderRow | undefined;
}
export async function notifyPaymentApproved(order: PaymentOrderDto) {
  try {
    await sendPaymentApprovedEmail({
      amount: order.amount,
      courseTitle: order.courseTitle,
      dashboardUrl: new URL('/dashboard/student', env.CORS_ORIGIN).toString(),
      email: order.studentEmail,
      referenceCode: order.referenceCode,
      transactionId: order.transactionId,
    });
  } catch (error) {
    console.error('Payment approval email failed.', error);
  }
}
const mask = (value: string) =>
  value.trim().length <= 4
    ? '****'
    : `${value.trim().slice(0, 2)}****${value.trim().slice(-2)}`;
export async function verifyPaymentWithPayConfirm({
  amount,
  senderNumber,
  transactionId,
}: {
  amount: string;
  senderNumber: string;
  transactionId: string;
}) {
  const url =
    env.PAYCONFIRM_API_URL ??
    'https://api-payconfirm.duckdns.org/api/v1/verify';
  if (!env.PAYCONFIRM_API_KEY)
    throw new ServiceUnavailableException(
      'Payment verification is not configured yet.',
    );
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({
        amount,
        sender_phone_number: senderNumber,
        trx_id: transactionId,
      }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${env.PAYCONFIRM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BadGatewayException(
      'Payment verification service is unavailable. Try again shortly.',
    );
  }
  const text = await response.text();
  let payload: { reason?: string; status?: string; error?: string } | null =
    null;
  try {
    payload = JSON.parse(text);
  } catch {}
  if (response.ok && payload?.status === 'approved') return;
  const reason =
    payload?.reason ??
    payload?.status ??
    payload?.error ??
    'verification_failed';
  const messages: Record<string, string> = {
    already_used: 'This transaction has already been used.',
    amount_mismatch: 'The payment amount does not match this order.',
    invalid_amount: 'The order amount could not be verified.',
    invalid_request: 'The payment verification request is invalid.',
    invalid_sender: 'Please enter a valid sender phone number.',
    pending_or_not_found:
      'This transaction has not arrived yet. Try again after a few minutes.',
    reversed: 'This payment was reversed or refunded.',
    sender_mismatch: 'The sender phone number does not match the transaction.',
    sender_unverifiable:
      'The payment sender could not be verified. Try another transaction.',
  };
  if (response.status === 404)
    throw new ServiceUnavailableException(
      'Payment verification endpoint is unavailable. Check PAYCONFIRM_API_URL.',
    );
  throw new BadRequestException(
    messages[reason] ?? 'Payment could not be verified.',
  );
}
