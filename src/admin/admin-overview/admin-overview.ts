import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { sql } from '../../database/index.js';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';
import { getR2StorageUsage } from '../../lib/r2.js';

@Injectable()
export class AdminOverview {
  constructor(private readonly authService: AuthService) {}

  async health(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin')
      throw new ForbiddenException('Access denied.');
    const [counts] = await db.execute<{
      failed_uploads: number;
      failed_payments: number;
      unpublished_courses: number;
      empty_courses: number;
      storage_usage: string;
    }>(sql`select
      (select count(*)::int from videos where video_ref is null) as failed_uploads,
      (select count(*)::int from orders where status = 'rejected') as failed_payments,
      (select count(*)::int from courses where status <> 'published') as unpublished_courses,
      (select count(*)::int from courses c where not exists (select 1 from sections s where s.course_id = c.id)) as empty_courses,
      'unavailable'::text as storage_usage`);
    if (!counts) throw new Error('Health metrics are unavailable.');
    const storage = await getR2StorageUsage();
    return {
      failedUploads: Number(counts.failed_uploads),
      failedPayments: Number(counts.failed_payments),
      unpublishedCourses: Number(counts.unpublished_courses),
      emptyCourses: Number(counts.empty_courses),
      storageUsage: storage
        ? `${storage.objects} objects · ${(storage.bytes / 1024 ** 3).toFixed(2)} GB`
        : counts.storage_usage,
      errorMonitoring: 'Application logs',
    };
  }

  async report(reportName: string, request: Request) {
    await this.requireAdmin(request);
    const report = z
      .enum(['users', 'courses', 'payments', 'revenue', 'enrollments'])
      .parse(reportName);
    const queries = {
      users: sql`select u.email, p.full_name, p.role, u.created_at, u.suspended_at from users u join profiles p on p.user_id = u.id order by u.created_at desc`,
      courses: sql`select title, slug, status, price, currency, created_at, updated_at from courses order by created_at desc`,
      payments: sql`select reference_code, transaction_id, amount, currency, status, payment_method, created_at, updated_at from orders order by created_at desc`,
      revenue: sql`select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*)::int as orders, coalesce(sum(amount), 0)::text as revenue from orders where status = 'paid' group by date_trunc('month', created_at) order by date_trunc('month', created_at) desc`,
      enrollments: sql`select u.email as student_email, c.title as course_title, e.status, e.enrolled_at, e.revoked_at from enrollments e join profiles p on p.id = e.user_id join users u on u.id = p.user_id join courses c on c.id = e.course_id order by e.enrolled_at desc`,
    };
    return { rows: await db.execute(queries[report]) };
  }

  async revenue(request: Request) {
    await this.requireAdmin(request);
    const [totals] = await db.execute<{
      active_enrollments: number;
      active_users: number;
      paid_orders: number;
      paid_revenue: string;
      pending_courses: number;
      pending_orders: number;
      pending_revenue: string;
      published_courses: number;
      suspended_users: number;
    }>(sql`select
      (select count(*)::int from users where suspended_at is null) as active_users,
      (select count(*)::int from users where suspended_at is not null) as suspended_users,
      (select count(*)::int from courses where status = 'published') as published_courses,
      (select count(*)::int from courses where status = 'pending_review') as pending_courses,
      (select count(*)::int from enrollments where status = 'active') as active_enrollments,
      (select count(*)::int from orders where status = 'paid') as paid_orders,
      (select count(*)::int from orders where status = 'pending_verification') as pending_orders,
      (select coalesce(sum(amount), 0)::text from orders where status = 'paid') as paid_revenue,
      (select coalesce(sum(amount), 0)::text from orders where status = 'pending_verification') as pending_revenue`);

    const monthlyRows = await db.execute<{
      label: string;
      orders: number;
      revenue: string;
    }>(sql`
      select to_char(date_trunc('month', created_at), 'Mon YYYY') as label,
             count(*)::int as orders,
             coalesce(sum(amount), 0)::text as revenue
      from orders
      where status = 'paid'
        and created_at >= date_trunc('month', now()) - interval '5 months'
      group by date_trunc('month', created_at)
      order by date_trunc('month', created_at)`);

    const methodRows = await db.execute<{
      label: string;
      orders: number;
      revenue: string;
    }>(sql`
      select coalesce(payment_method::text, 'unrecorded') as label,
             count(*)::int as orders,
             coalesce(sum(amount), 0)::text as revenue
      from orders
      where status = 'paid'
      group by payment_method
      order by sum(amount) desc nulls last`);

    const number = (value: unknown) => Number(value ?? 0);
    return {
      byMethod: methodRows.map((row) => ({
        label: row.label.replace('_', ' '),
        orders: number(row.orders),
        revenue: number(row.revenue),
      })),
      byMonth: monthlyRows.map((row) => ({
        label: row.label,
        orders: number(row.orders),
        revenue: number(row.revenue),
      })),
      totals: {
        activeEnrollments: number(totals?.active_enrollments),
        activeUsers: number(totals?.active_users),
        paidOrders: number(totals?.paid_orders),
        paidRevenue: number(totals?.paid_revenue),
        pendingCourses: number(totals?.pending_courses),
        pendingOrders: number(totals?.pending_orders),
        pendingRevenue: number(totals?.pending_revenue),
        publishedCourses: number(totals?.published_courses),
        suspendedUsers: number(totals?.suspended_users),
      },
    };
  }

  private async requireAdmin(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin')
      throw new ForbiddenException('Access denied.');
    return profile;
  }
}
