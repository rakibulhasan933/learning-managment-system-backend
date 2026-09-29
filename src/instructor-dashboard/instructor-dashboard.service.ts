import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  alias,
  announcements,
  courses,
  desc,
  discussionPosts,
  enrollments,
  eq,
  inArray,
  modules,
  notifications,
  profiles,
  payoutRequests,
  quizAttempts,
  quizzes,
  sections,
  sql,
  users,
  videoProgress,
  videos,
} from '../database/index.js';
import { randomBytes } from 'node:crypto';
import type {
  InstructorPayoutListResponse,
  InstructorQuizResultsResponse,
  PayoutRequestDto,
} from '../types/index.js';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createNotification } from '../lib/notifications.js';

@Injectable()
export class InstructorDashboardService {
  constructor(private readonly authService: AuthService) {}

  async overview(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) {
      throw new UnauthorizedException('Authentication is required.');
    }
    if (!['admin', 'instructor'].includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }

    const analytics = await this.loadInstructorAnalytics(profile.id);
    if (profile.role === 'instructor') {
      return {
        courses: analytics.courses.map(
          ({ revenue: _revenue, ...course }) => course,
        ),
        totals: (() => {
          const { revenue: _revenue, ...totals } = analytics.totals;
          return totals;
        })(),
      };
    }
    return { courses: analytics.courses, totals: analytics.totals };
  }

  async notifications(request: Request) {
    const profile = await this.requireStaff(request);
    const rows = await db
      .select({
        body: notifications.body,
        createdAt: notifications.createdAt,
        href: notifications.href,
        id: notifications.id,
        readAt: notifications.readAt,
        title: notifications.title,
        type: notifications.type,
      })
      .from(notifications)
      .where(eq(notifications.profileId, profile.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return {
      notifications: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      })),
      unreadCount: rows.filter((row) => !row.readAt).length,
    };
  }

  async markNotificationRead(notificationId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const id = z.string().uuid().parse(notificationId);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.profileId, profile.id)),
      );
  }

  async quizResults(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const id = z.string().uuid().parse(courseId);
    const [ownedCourse] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.instructorId, profile.id)))
      .limit(1);
    if (!ownedCourse) throw new UnauthorizedException('Course not found.');

    const rows = await db
      .select({
        attemptId: quizAttempts.id,
        completedAt: quizAttempts.completedAt,
        courseId: courses.id,
        courseTitle: courses.title,
        quizId: quizzes.id,
        quizTitle: quizzes.title,
        score: quizAttempts.score,
        studentId: profiles.id,
        studentName: profiles.fullName,
        studentEmail: users.email,
        totalQuestions: quizAttempts.totalQuestions,
      })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
      .innerJoin(courses, eq(quizzes.courseId, courses.id))
      .innerJoin(profiles, eq(quizAttempts.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(eq(quizzes.courseId, id))
      .orderBy(desc(quizAttempts.completedAt));

    return {
      results: rows.map((row) => ({
        ...row,
        completedAt: row.completedAt.toISOString(),
        percentage: row.totalQuestions
          ? Math.round((row.score / row.totalQuestions) * 100)
          : 0,
      })),
    } satisfies InstructorQuizResultsResponse;
  }

  async discussions(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const id = z.string().uuid().parse(courseId);
    const [ownedCourse] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.instructorId, profile.id)))
      .limit(1);
    if (!ownedCourse) throw new UnauthorizedException('Course not found.');

    const rows = await db
      .select({
        authorId: profiles.id,
        authorName: profiles.fullName,
        authorRole: profiles.role,
        body: discussionPosts.body,
        courseId: discussionPosts.courseId,
        createdAt: discussionPosts.createdAt,
        id: discussionPosts.id,
        lectureId: discussionPosts.lectureId,
        parentId: discussionPosts.parentId,
      })
      .from(discussionPosts)
      .innerJoin(profiles, eq(discussionPosts.authorId, profiles.id))
      .where(eq(discussionPosts.courseId, id))
      .orderBy(desc(discussionPosts.createdAt));

    return {
      posts: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async createDiscussion(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const id = z.string().uuid().parse(courseId);
    const input = z
      .object({
        body: z.string().trim().min(2).max(5000),
        lectureId: z.string().uuid().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
      })
      .parse(request.body);
    const [ownedCourse] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.instructorId, profile.id)))
      .limit(1);
    if (!ownedCourse) throw new UnauthorizedException('Course not found.');

    const [post] = await db
      .insert(discussionPosts)
      .values({
        authorId: profile.id,
        body: input.body,
        courseId: id,
        lectureId: input.lectureId ?? null,
        parentId: input.parentId ?? null,
      })
      .returning({ id: discussionPosts.id });

    if (input.parentId) {
      const [parent] = await db
        .select({ authorId: discussionPosts.authorId })
        .from(discussionPosts)
        .where(eq(discussionPosts.id, input.parentId))
        .limit(1);
      if (parent && parent.authorId !== profile.id) {
        await createNotification({
          body: input.body,
          href: `/learn/${id}`,
          profileId: parent.authorId,
          title: 'Your discussion received a reply',
          type: 'discussion_reply',
        });
      }
    }
    return { id: post!.id };
  }

  async createAnnouncement(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const id = z.string().uuid().parse(courseId);
    const input = z
      .object({
        body: z.string().trim().min(2).max(5000),
        title: z.string().trim().min(2).max(180),
      })
      .parse(request.body);
    const [ownedCourse] = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.instructorId, profile.id)))
      .limit(1);
    if (!ownedCourse) throw new UnauthorizedException('Course not found.');

    const [announcement] = await db
      .insert(announcements)
      .values({
        body: input.body,
        courseId: id,
        instructorId: profile.id,
        title: input.title,
      })
      .returning({ id: announcements.id, createdAt: announcements.createdAt });
    const students = await db
      .select({ profileId: enrollments.userId })
      .from(enrollments)
      .where(
        and(eq(enrollments.courseId, id), eq(enrollments.status, 'active')),
      );
    if (students.length) {
      await db.insert(notifications).values(
        students.map((student) => ({
          body: input.body,
          href: `/learn/${id}`,
          profileId: student.profileId,
          title: `${ownedCourse.title}: ${input.title}`,
          type: 'course_announcement' as const,
        })),
      );
    }
    return {
      announcements: [
        {
          body: input.body,
          courseId: id,
          courseTitle: ownedCourse.title,
          createdAt: announcement!.createdAt.toISOString(),
          id: announcement!.id,
          title: input.title,
        },
      ],
    };
  }

  async payouts(request: Request) {
    const profile = await this.requireStaff(request);
    if (profile.role === 'instructor') {
      throw new ForbiddenException('Instructor payout access is disabled.');
    }
    return this.loadInstructorPayoutList(profile.id);
  }

  async requestPayout(request: Request) {
    const profile = await this.requireStaff(request);
    if (profile.role === 'instructor') {
      throw new ForbiddenException('Instructor payout access is disabled.');
    }
    const input = z
      .object({
        amount: z.coerce.number().positive(),
        currency: z.string().trim().length(3).default('BDT'),
        note: z.string().trim().max(2000).optional(),
      })
      .parse(request.body);
    const current = await this.loadInstructorPayoutList(profile.id);
    if (input.amount > current.availableBalance) {
      throw new UnauthorizedException(
        'Requested payout exceeds your available balance.',
      );
    }
    const [created] = await db
      .insert(payoutRequests)
      .values({
        amount: input.amount.toFixed(2),
        currency: input.currency.toUpperCase(),
        instructorId: profile.id,
        note: input.note ?? null,
        referenceCode: `PAYOUT-${randomBytes(3).toString('hex').toUpperCase()}`,
        status: 'pending',
      })
      .returning({ id: payoutRequests.id });
    if (!created)
      throw new UnauthorizedException('Payout request could not be created.');
    return this.loadInstructorPayoutList(profile.id);
  }

  async students(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const id = z.string().uuid().parse(courseId);
    const [course] = await db
      .select({ id: courses.id, slug: courses.slug, title: courses.title })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.instructorId, profile.id)))
      .limit(1);
    if (!course) throw new UnauthorizedException('Course not found.');

    const lectureRows = await db
      .select({ lectureId: videos.id })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(and(eq(sections.courseId, id), eq(videos.isPublished, true)));
    const lectureIds = lectureRows.map((row) => row.lectureId);
    const enrollmentRows = await db
      .select({
        enrolledAt: enrollments.enrolledAt,
        enrollmentId: enrollments.id,
        email: users.email,
        fullName: profiles.fullName,
        revokedAt: enrollments.revokedAt,
        status: enrollments.status,
        userId: enrollments.userId,
      })
      .from(enrollments)
      .innerJoin(profiles, eq(enrollments.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(eq(enrollments.courseId, id))
      .orderBy(desc(enrollments.enrolledAt));
    const studentIds = enrollmentRows.map((row) => row.userId);
    const progressRows =
      lectureIds.length && studentIds.length
        ? await db
            .select({
              completedAt: videoProgress.completedAt,
              isCompleted: videoProgress.isCompleted,
              lastWatchedAt: videoProgress.lastWatchedAt,
              lectureId: videoProgress.videoId,
              userId: videoProgress.userId,
            })
            .from(videoProgress)
            .where(
              and(
                inArray(videoProgress.userId, studentIds),
                inArray(videoProgress.videoId, lectureIds),
              ),
            )
        : [];
    const progress = new Map(
      progressRows.map((row) => [`${row.userId}:${row.lectureId}`, row]),
    );
    const students = enrollmentRows.map((row) => {
      const snapshots = lectureIds
        .map((lectureId) => progress.get(`${row.userId}:${lectureId}`))
        .filter((value): value is (typeof progressRows)[number] =>
          Boolean(value),
        );
      const completedLectureCount = snapshots.filter(
        (value) => value.isCompleted,
      ).length;
      const lastWatchedAt = snapshots.reduce<Date | null>(
        (current, value) =>
          !current || value.lastWatchedAt > current
            ? value.lastWatchedAt
            : current,
        null,
      );
      const completedAt = snapshots
        .filter((value) => value.isCompleted && value.completedAt)
        .reduce<Date | null>(
          (current, value) =>
            !current || value.completedAt! > current
              ? value.completedAt
              : current,
          null,
        );
      const isCompleted =
        lectureIds.length > 0 && completedLectureCount === lectureIds.length;
      return {
        completedAt: isCompleted ? (completedAt?.toISOString() ?? null) : null,
        completionRate: lectureIds.length
          ? Math.round((completedLectureCount / lectureIds.length) * 100)
          : 0,
        completedLectureCount,
        email: row.email,
        enrolledAt: row.enrolledAt.toISOString(),
        enrollmentId: row.enrollmentId,
        enrollmentStatus: row.status,
        fullName: row.fullName,
        isCompleted,
        lastWatchedAt: lastWatchedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        totalLectureCount: lectureIds.length,
        userId: row.userId,
      };
    });
    const revenueRows = await db.execute<{
      orders_count: number;
      revenue: string;
    }>(
      sql`select count(*)::int as orders_count, coalesce(sum(amount), 0)::text as revenue from orders where course_id = ${id} and status = 'paid'`,
    );
    const revenue = Number(revenueRows[0]?.revenue ?? 0);
    const active = enrollmentRows.filter((row) => row.status === 'active');
    const completed = students.filter(
      (student) => student.enrollmentStatus === 'active' && student.isCompleted,
    ).length;
    return {
      course,
      metrics: {
        activeEnrollmentCount: active.length,
        completionRate: active.length
          ? Math.round((completed / active.length) * 100)
          : 0,
        completedEnrollmentCount: completed,
        enrollmentCount: enrollmentRows.length,
        revenue: profile.role === 'admin' ? revenue : 0,
        totalLectureCount: lectureIds.length,
      },
      students,
    };
  }

  private async loadInstructorAnalytics(instructorId: string) {
    const courseRows = await db
      .select({
        currency: courses.currency,
        id: courses.id,
        price: courses.price,
        slug: courses.slug,
        status: courses.status,
        title: courses.title,
      })
      .from(courses)
      .where(eq(courses.instructorId, instructorId))
      .orderBy(desc(courses.updatedAt));
    if (!courseRows.length) {
      return {
        courses: [],
        totals: {
          activeEnrollmentCount: 0,
          availablePayoutBalance: 0,
          completedEnrollmentCount: 0,
          completionRate: 0,
          courseCount: 0,
          pendingPayoutRequestCount: 0,
          reservedPayoutAmount: 0,
          revenue: 0,
        },
      };
    }
    const courseIds = courseRows.map((course) => course.id);
    const lectureRows = await db
      .select({ courseId: sections.courseId, lectureId: videos.id })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(
        and(
          eq(videos.isPublished, true),
          inArray(sections.courseId, courseIds),
        ),
      );
    const lectureIdsByCourse = new Map<string, string[]>();
    const allLectureIds = new Set<string>();
    for (const row of lectureRows) {
      allLectureIds.add(row.lectureId);
      const ids = lectureIdsByCourse.get(row.courseId) ?? [];
      ids.push(row.lectureId);
      lectureIdsByCourse.set(row.courseId, ids);
    }
    const enrollmentRows = await db
      .select({
        courseId: enrollments.courseId,
        email: users.email,
        enrolledAt: enrollments.enrolledAt,
        enrollmentId: enrollments.id,
        fullName: profiles.fullName,
        revokedAt: enrollments.revokedAt,
        status: enrollments.status,
        userId: enrollments.userId,
      })
      .from(enrollments)
      .innerJoin(profiles, eq(enrollments.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(inArray(enrollments.courseId, courseIds))
      .orderBy(desc(enrollments.enrolledAt));
    const studentIds = [...new Set(enrollmentRows.map((row) => row.userId))];
    const progressRows =
      studentIds.length && allLectureIds.size
        ? await db
            .select({
              completedAt: videoProgress.completedAt,
              isCompleted: videoProgress.isCompleted,
              lastWatchedAt: videoProgress.lastWatchedAt,
              lectureId: videoProgress.videoId,
              userId: videoProgress.userId,
            })
            .from(videoProgress)
            .where(
              and(
                inArray(videoProgress.userId, studentIds),
                inArray(videoProgress.videoId, [...allLectureIds]),
              ),
            )
        : [];
    const progressByUserLecture = new Map<
      string,
      { completedAt: Date | null; isCompleted: boolean; lastWatchedAt: Date }
    >();
    for (const row of progressRows)
      progressByUserLecture.set(`${row.userId}:${row.lectureId}`, {
        completedAt: row.completedAt,
        isCompleted: row.isCompleted,
        lastWatchedAt: row.lastWatchedAt,
      });
    const revenueRows = await db.execute<{
      course_id: string;
      orders_count: number;
      revenue: string;
    }>(
      sql`select c.id as course_id, count(o.id)::int as orders_count, coalesce(sum(o.amount), 0)::text as revenue from courses c left join orders o on o.course_id = c.id and o.status = 'paid' where c.instructor_id = ${instructorId} group by c.id`,
    );
    const revenueByCourse = new Map(
      revenueRows.map((row) => [
        row.course_id,
        {
          ordersCount: Number(row.orders_count ?? 0),
          revenue: Number(row.revenue ?? 0),
        },
      ]),
    );
    const payoutSummaryRows = await db.execute<{
      pending_payout_count: number;
      reserved_amount: string;
      total_revenue: string;
    }>(
      sql`select coalesce((select count(*) from payout_requests where instructor_id = ${instructorId} and status = 'pending'), 0)::int as pending_payout_count, coalesce((select sum(amount) from payout_requests where instructor_id = ${instructorId} and status in ('pending', 'approved', 'paid')), 0)::text as reserved_amount, coalesce((select sum(amount) from orders inner join courses on courses.id = orders.course_id where courses.instructor_id = ${instructorId} and orders.status = 'paid'), 0)::text as total_revenue`,
    );
    const summary = payoutSummaryRows[0] ?? {
      pending_payout_count: 0,
      reserved_amount: '0',
      total_revenue: '0',
    };
    const coursesWithMetrics = courseRows.map((course) => {
      const lectureIds = lectureIdsByCourse.get(course.id) ?? [];
      const courseEnrollments = enrollmentRows.filter(
        (row) => row.courseId === course.id,
      );
      const activeEnrollments = courseEnrollments.filter(
        (row) => row.status === 'active',
      );
      const completedEnrollmentCount = activeEnrollments.filter((row) =>
        lectureIds.every(
          (lectureId) =>
            progressByUserLecture.get(`${row.userId}:${lectureId}`)
              ?.isCompleted,
        ),
      ).length;
      return {
        activeEnrollmentCount: activeEnrollments.length,
        completedEnrollmentCount,
        completionRate: activeEnrollments.length
          ? Math.round(
              (completedEnrollmentCount / activeEnrollments.length) * 100,
            )
          : 0,
        currency: course.currency,
        enrollmentCount: courseEnrollments.length,
        id: course.id,
        price: course.price,
        revenue: revenueByCourse.get(course.id)?.revenue ?? 0,
        slug: course.slug,
        status: course.status,
        title: course.title,
        totalLectureCount: lectureIds.length,
      };
    });
    const activeEnrollmentCount = coursesWithMetrics.reduce(
      (total, course) => total + course.activeEnrollmentCount,
      0,
    );
    const completedEnrollmentCount = coursesWithMetrics.reduce(
      (total, course) => total + course.completedEnrollmentCount,
      0,
    );
    const totalRevenue = Number(summary.total_revenue ?? 0);
    const reservedPayoutAmount = Number(summary.reserved_amount ?? 0);
    const availablePayoutBalance = Math.max(
      totalRevenue - reservedPayoutAmount,
      0,
    );
    return {
      courses: coursesWithMetrics,
      payouts: {
        availablePayoutBalance,
        pendingPayoutRequestCount: Number(summary.pending_payout_count ?? 0),
        reservedPayoutAmount,
        totalRevenue,
      },
      totals: {
        activeEnrollmentCount,
        availablePayoutBalance,
        completedEnrollmentCount,
        completionRate: activeEnrollmentCount
          ? Math.round((completedEnrollmentCount / activeEnrollmentCount) * 100)
          : 0,
        courseCount: courseRows.length,
        pendingPayoutRequestCount: Number(summary.pending_payout_count ?? 0),
        reservedPayoutAmount,
        revenue: totalRevenue,
      },
    };
  }

  private async loadInstructorPayoutList(
    instructorId: string,
  ): Promise<InstructorPayoutListResponse> {
    const ip = alias(profiles, 'instructor_payout_instructor_profiles');
    const iu = alias(users, 'instructor_payout_instructor_users');
    const rp = alias(profiles, 'instructor_payout_reviewer_profiles');
    const ru = alias(users, 'instructor_payout_reviewer_users');
    const [summaryRows, rows] = await Promise.all([
      db.execute<{
        pending_payout_count: number;
        reserved_amount: string;
        total_revenue: string;
      }>(
        sql`select coalesce((select count(*) from payout_requests where instructor_id = ${instructorId} and status = 'pending'), 0)::int as pending_payout_count, coalesce((select sum(amount) from payout_requests where instructor_id = ${instructorId} and status in ('pending', 'approved', 'paid')), 0)::text as reserved_amount, coalesce((select sum(amount) from orders inner join courses on courses.id = orders.course_id where courses.instructor_id = ${instructorId} and orders.status = 'paid'), 0)::text as total_revenue`,
      ),
      db
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
        .where(eq(payoutRequests.instructorId, instructorId))
        .orderBy(desc(payoutRequests.createdAt)),
    ]);
    const summary = summaryRows[0] ?? {
      pending_payout_count: 0,
      reserved_amount: '0',
      total_revenue: '0',
    };
    const totalRevenue = Number(summary.total_revenue ?? 0);
    const reservedAmount = Number(summary.reserved_amount ?? 0);
    return {
      availableBalance: Math.max(totalRevenue - reservedAmount, 0),
      payouts: rows.map(
        (row) =>
          ({
            ...row,
            amount: String(row.amount),
            createdAt: row.createdAt.toISOString(),
            paidAt: row.paidAt?.toISOString() ?? null,
            reviewedAt: row.reviewedAt?.toISOString() ?? null,
            updatedAt: row.updatedAt.toISOString(),
          }) as PayoutRequestDto,
      ),
      reservedAmount,
      totalRevenue,
    };
  }

  private async requireStaff(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'instructor'].includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }
}
