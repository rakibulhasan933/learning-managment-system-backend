import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  courses,
  desc,
  eq,
  orders,
  profiles,
  siteSettings,
  users,
} from '../../database/index.js';
import { isNotNull } from 'drizzle-orm';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';

@Injectable()
export class AdminCoupons {
  constructor(private readonly authService: AuthService) {}

  async usage(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin') throw new ForbiddenException('Access denied.');

    const rows = await db
      .select({
        code: orders.couponCode,
        courseId: courses.id,
        courseTitle: courses.title,
        createdAt: orders.createdAt,
        discountAmount: orders.discountAmount,
        email: users.email,
        fullName: profiles.fullName,
        orderId: orders.id,
        status: orders.status,
      })
      .from(orders)
      .innerJoin(profiles, eq(orders.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .innerJoin(courses, eq(orders.courseId, courses.id))
      .where(isNotNull(orders.couponCode))
      .orderBy(desc(orders.createdAt));

    const [couponSetting] = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, 'payment_coupons'))
      .limit(1);

    const grouped = new Map<string, {
      active: boolean;
      code: string;
      claims: number;
      expiresAt: string | null;
      limit: number | null;
      totalDiscount: number;
      students: Array<{
        courseId: string;
        courseTitle: string;
        createdAt: string;
        discountAmount: string;
        email: string;
        fullName: string | null;
        orderId: string;
        status: string;
      }>;
    }>();

    for (const entry of (couponSetting?.value ?? '').split(',')) {
      const [rawCode, rawType, rawValue, rawState, rawLimit, rawExpiresAt] = entry.split(':');
      const code = rawCode?.trim().toUpperCase();
      const value = Number(rawValue);
      if (
        code &&
        (rawType === 'amount' || rawType === 'percent') &&
        Number.isFinite(value) &&
        value > 0
      ) {
        grouped.set(code, {
          active: rawState?.trim().toLowerCase() !== 'disabled',
          claims: 0,
          code,
          expiresAt: rawExpiresAt && Number(rawExpiresAt) > 0
            ? new Date(Number(rawExpiresAt)).toISOString()
            : null,
          limit: rawLimit && Number(rawLimit) > 0 ? Number(rawLimit) : null,
          students: [],
          totalDiscount: 0,
        });
      }
    }

    for (const row of rows) {
      if (!row.code) continue;
      const coupon = grouped.get(row.code) ?? {
        active: true,
        claims: 0,
        code: row.code,
        expiresAt: null,
        limit: null,
        students: [],
        totalDiscount: 0,
      };
      coupon.claims += 1;
      coupon.totalDiscount += Number(row.discountAmount);
      coupon.students.push({
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        createdAt: row.createdAt.toISOString(),
        discountAmount: row.discountAmount,
        email: row.email,
        fullName: row.fullName,
        orderId: row.orderId,
        status: row.status,
      });
      grouped.set(row.code, coupon);
    }

    return {
      coupons: [...grouped.values()].map((coupon) => ({
        ...coupon,
        totalDiscount: coupon.totalDiscount.toFixed(2),
      })),
    };
  }
}
