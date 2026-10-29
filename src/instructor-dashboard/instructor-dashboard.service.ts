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
  orders,
  profiles,
  payoutRequests,
  refunds,
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
    // Ownership is enforced by loadInstructorPayoutList, which only ever
    // returns payout_requests whose instructor_id matches the caller.
    const profile = await this.requireStaff(request);
    return this.loadInstructorPayoutList(profile.id);
  }

  async requestPayout(request: Request) {
    const profile = await this.requireStaff(request);
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

  /**
   * Seller dashboard: teacher-scoped aggregation over EXISTING data only
   * (orders, refunds, payout requests, enrolments, progress, quiz
   * attempts). The caller only ever sees their own courses/students —
   * every query below filters by courses.instructor_id = caller id.
   * Definitions:
   * - dropOffLesson: first lecture (in course order) whose completion
   *   rate falls at least 20 percentage points below the previous
   *   lecture's rate. No such fall means null.
   * - atRiskStudent: active enrolment, not completed, with no activity
   *   for 14 days (lastWatchedAt, else enrolment date).
   * - topicWeakness is PER-QUIZ, not per topic: legacy quiz_questions
   *   carry no subject/chapter/topic tags, so no honest topic grouping
   *   exists for them. Model-test topics are reported by the model-test
   *   endpoints, which do carry tags.
   */
  async sellerDashboard(request: Request) {
    const profile = await this.requireStaff(request);
    const courseRows = await db
      .select({
        id: courses.id,
        title: courses.title,
      })
      .from(courses)
      .where(eq(courses.instructorId, profile.id))
      .orderBy(desc(courses.updatedAt));
    const courseIds = courseRows.map((row) => row.id);
    if (!courseIds.length) {
      return {
        atRiskStudents: [],
        completionPerCourse: [],
        couponPerformance: [],
        dropOffPerCourse: [],
        enrolmentsPerCourse: [],
        ordersByPaymentMethod: [],
        payoutBalance: {
          availableBalance: 0,
          pendingPayoutRequestCount: 0,
          reservedAmount: 0,
          totalRevenue: 0,
        },
        refundTotal: 0,
        sales: { paid: 0, pending: 0, refunded: 0, rejected: 0, total: 0 },
        topicWeakness: {
          note: 'Legacy quiz questions carry no topic tags, so weakness is reported per quiz.',
          quizzes: [],
          source: 'per_quiz',
        },
      };
    }
    const [orderRows, refundRows, enrollmentRows, payout] = await Promise.all([
      db
        .select({
          amount: orders.amount,
          couponCode: orders.couponCode,
          courseId: orders.courseId,
          discountAmount: orders.discountAmount,
          paymentMethod: orders.paymentMethod,
          status: orders.status,
        })
        .from(orders)
        .innerJoin(courses, eq(orders.courseId, courses.id))
        .where(eq(courses.instructorId, profile.id)),
      db
        .select({ amount: refunds.amount, status: refunds.status })
        .from(refunds)
        .innerJoin(orders, eq(refunds.orderId, orders.id))
        .innerJoin(courses, eq(orders.courseId, courses.id))
        .where(eq(courses.instructorId, profile.id)),
      db
        .select({
          courseId: enrollments.courseId,
          enrolledAt: enrollments.enrolledAt,
          status: enrollments.status,
          userId: enrollments.userId,
        })
        .from(enrollments)
        .where(inArray(enrollments.courseId, courseIds)),
      this.loadInstructorPayoutList(profile.id),
    ]);
    const paidOrders = orderRows.filter((row) => row.status === 'paid');
    const sales = {
      paid: paidOrders.length,
      pending: orderRows.filter(
        (row) => row.status === 'pending_verification',
      ).length,
      refunded: orderRows.filter((row) => row.status === 'refunded').length,
      rejected: orderRows.filter((row) => row.status === 'rejected').length,
      total: paidOrders.reduce((sum, row) => sum + Number(row.amount), 0),
    };
    const refundTotal = refundRows
      .filter((row) => ['approved', 'processed'].includes(row.status))
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const byMethod = new Map<string, { count: number; total: number }>();
    for (const row of orderRows) {
      const key = row.paymentMethod ?? 'unknown';
      const entry = byMethod.get(key) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += Number(row.amount);
      byMethod.set(key, entry);
    }
    const byCoupon = new Map<
      string,
      { couponCode: string; discountGiven: number; revenue: number; uses: number }
    >();
    for (const row of orderRows) {
      if (!row.couponCode) continue;
      const entry = byCoupon.get(row.couponCode) ?? {
        couponCode: row.couponCode,
        discountGiven: 0,
        revenue: 0,
        uses: 0,
      };
      entry.uses += 1;
      entry.discountGiven += Number(row.discountAmount);
      entry.revenue += Number(row.amount);
      byCoupon.set(row.couponCode, entry);
    }
    // Per-course lectures (published videos in course order), enrolments, progress.
    const videoRows = await db
      .select({
        courseId: sections.courseId,
        sectionPosition: sections.position,
        modulePosition: modules.position,
        videoId: videos.id,
        videoPosition: videos.position,
        videoTitle: videos.title,
      })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(
        and(
          eq(videos.isPublished, true),
          inArray(sections.courseId, courseIds),
        ),
      );
    const videosByCourse = new Map<string, typeof videoRows>();
    for (const row of videoRows) {
      const list = videosByCourse.get(row.courseId) ?? [];
      list.push(row);
      videosByCourse.set(row.courseId, list);
    }
    for (const list of videosByCourse.values()) {
      list.sort(
        (a, b) =>
          a.sectionPosition - b.sectionPosition ||
          a.modulePosition - b.modulePosition ||
          a.videoPosition - b.videoPosition,
      );
    }
    const studentIds = [...new Set(enrollmentRows.map((row) => row.userId))];
    const allVideoIds = videoRows.map((row) => row.videoId);
    const videoProgressRows =
      studentIds.length && allVideoIds.length
        ? await db
            .select({
              isCompleted: videoProgress.isCompleted,
              lastWatchedAt: videoProgress.lastWatchedAt,
              userId: videoProgress.userId,
              videoId: videoProgress.videoId,
            })
            .from(videoProgress)
            .where(
              and(
                inArray(videoProgress.userId, studentIds),
                inArray(videoProgress.videoId, allVideoIds),
              ),
            )
        : [];
    const completedSet = new Set(
      videoProgressRows
        .filter((row) => row.isCompleted)
        .map((row) => `${row.userId}:${row.videoId}`),
    );
    const lastActivity = new Map<string, Date>();
    for (const row of videoProgressRows) {
      const key = row.userId;
      const current = lastActivity.get(key);
      if (!current || row.lastWatchedAt > current) {
        lastActivity.set(key, row.lastWatchedAt);
      }
    }
    const studentRows = studentIds.length
      ? await db
          .select({
            email: users.email,
            fullName: profiles.fullName,
            id: profiles.id,
          })
          .from(profiles)
          .innerJoin(users, eq(profiles.userId, users.id))
          .where(inArray(profiles.id, studentIds))
      : [];
    const studentById = new Map(studentRows.map((row) => [row.id, row]));
    const courseTitleById = new Map(
      courseRows.map((row) => [row.id, row.title]),
    );
    const enrolmentsPerCourse: Array<{
      activeEnrolments: number;
      courseId: string;
      courseTitle: string;
      enrolments: number;
    }> = [];
    const completionPerCourse: Array<{
      completedEnrolments: number;
      completionRate: number;
      courseId: string;
      courseTitle: string;
    }> = [];
    const dropOffPerCourse: Array<{
      courseId: string;
      courseTitle: string;
      dropOffLesson: {
        lectureId: string;
        lectureTitle: string;
        rateAfter: number;
        rateBefore: number;
      } | null;
    }> = [];
    const atRiskStudents: Array<{
      courseId: string;
      courseTitle: string;
      enrolledAt: string;
      lastActivityAt: string;
      reason: string;
      studentEmail: string;
      studentName: string | null;
      userId: string;
    }> = [];
    const now = new Date();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    for (const course of courseRows) {
      const lectureList = videosByCourse.get(course.id) ?? [];
      const courseEnrolments = enrollmentRows.filter(
        (row) => row.courseId === course.id,
      );
      const active = courseEnrolments.filter(
        (row) => row.status === 'active',
      );
      const completedCount = active.filter(
        (row) =>
          lectureList.length > 0 &&
          lectureList.every((lecture) =>
            completedSet.has(`${row.userId}:${lecture.videoId}`),
          ),
      ).length;
      enrolmentsPerCourse.push({
        activeEnrolments: active.length,
        courseId: course.id,
        courseTitle: course.title,
        enrolments: courseEnrolments.length,
      });
      completionPerCourse.push({
        completedEnrolments: completedCount,
        completionRate: active.length
          ? Math.round((completedCount / active.length) * 100)
          : 0,
        courseId: course.id,
        courseTitle: course.title,
      });
      let dropOff: {
        lectureId: string;
        lectureTitle: string;
        rateAfter: number;
        rateBefore: number;
      } | null = null;
      if (active.length && lectureList.length > 1) {
        const rates = lectureList.map(
          (lecture) =>
            (active.filter((row) =>
              completedSet.has(`${row.userId}:${lecture.videoId}`),
            ).length /
              active.length) *
            100,
        );
        for (let i = 1; i < rates.length; i++) {
          if (rates[i]! <= rates[i - 1]! - 20) {
            dropOff = {
              lectureId: lectureList[i]!.videoId,
              lectureTitle: lectureList[i]!.videoTitle,
              rateAfter: Math.round(rates[i]!),
              rateBefore: Math.round(rates[i - 1]!),
            };
            break;
          }
        }
      }
      dropOffPerCourse.push({
        courseId: course.id,
        courseTitle: course.title,
        dropOffLesson: dropOff,
      });
      for (const enrolment of active) {
        const isCompleted =
          lectureList.length > 0 &&
          lectureList.every((lecture) =>
            completedSet.has(`${enrolment.userId}:${lecture.videoId}`),
          );
        if (isCompleted) continue;
        const last = lastActivity.get(enrolment.userId) ?? enrolment.enrolledAt;
        const hasProgress = lastActivity.has(enrolment.userId);
        if (now.getTime() - last.getTime() >= fourteenDaysMs) {
          const student = studentById.get(enrolment.userId);
          atRiskStudents.push({
            courseId: course.id,
            courseTitle: course.title,
            enrolledAt: enrolment.enrolledAt.toISOString(),
            lastActivityAt: last.toISOString(),
            reason: hasProgress
              ? 'inactive_14_days'
              : 'no_activity_since_enrolment',
            studentEmail: student?.email ?? '',
            studentName: student?.fullName ?? null,
            userId: enrolment.userId,
          });
        }
      }
    }
    // Per-quiz weakness (legacy quizzes have no topic tags — see method doc).
    const quizRows = await db
      .select({ courseId: quizzes.courseId, id: quizzes.id, title: quizzes.title })
      .from(quizzes)
      .where(inArray(quizzes.courseId, courseIds));
    const quizIds = quizRows.map((row) => row.id);
    const attemptRows = quizIds.length
      ? await db
          .select({
            quizId: quizAttempts.quizId,
            score: quizAttempts.score,
            totalQuestions: quizAttempts.totalQuestions,
          })
          .from(quizAttempts)
          .where(inArray(quizAttempts.quizId, quizIds))
      : [];
    const quizStats = quizRows
      .map((quiz) => {
        const attempts = attemptRows.filter(
          (row) => row.quizId === quiz.id,
        );
        const avg = attempts.length
          ? Math.round(
              (attempts.reduce(
                (sum, row) =>
                  sum +
                  (row.totalQuestions
                    ? (row.score / row.totalQuestions) * 100
                    : 0),
                0,
              ) /
                attempts.length) *
                100,
            ) / 100
          : null;
        return {
          attempts: attempts.length,
          averagePercentage: avg,
          courseId: quiz.courseId,
          courseTitle: courseTitleById.get(quiz.courseId) ?? '',
          quizId: quiz.id,
          quizTitle: quiz.title,
        };
      })
      .filter((row) => row.averagePercentage !== null)
      .sort((a, b) => (a.averagePercentage ?? 0) - (b.averagePercentage ?? 0));
    return {
      atRiskStudents,
      completionPerCourse,
      couponPerformance: [...byCoupon.values()],
      dropOffPerCourse,
      enrolmentsPerCourse,
      ordersByPaymentMethod: [...byMethod.entries()].map(
        ([paymentMethod, value]) => ({ ...value, paymentMethod }),
      ),
      payoutBalance: {
        availableBalance: payout.availableBalance,
        pendingPayoutRequestCount: payout.payouts.filter(
          (row) => row.status === 'pending',
        ).length,
        reservedAmount: payout.reservedAmount,
        totalRevenue: payout.totalRevenue,
      },
      refundTotal,
      sales,
      topicWeakness: {
        note: 'Legacy quiz questions carry no subject/chapter/topic tags, so weakness is reported per quiz (lowest average first). Model-test topic reports carry tags and are available per model test.',
        quizzes: quizStats.slice(0, 20),
        source: 'per_quiz',
      },
    };
  }

  /** CSV export of the teacher's own students (one row per enrolment). No mail is sent. */
  async sellerDashboardExport(request: Request): Promise<string> {
    const profile = await this.requireStaff(request);
    const courseRows = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.instructorId, profile.id));
    const courseIds = courseRows.map((row) => row.id);
    const titleById = new Map(courseRows.map((row) => [row.id, row.title]));
    if (!courseIds.length) return 'studentName,studentEmail,courseTitle,enrolledAt,completionRate,lastWatchedAt,status\n';
    const enrollmentRows = await db
      .select({
        courseId: enrollments.courseId,
        enrolledAt: enrollments.enrolledAt,
        status: enrollments.status,
        userId: enrollments.userId,
      })
      .from(enrollments)
      .where(inArray(enrollments.courseId, courseIds))
      .orderBy(desc(enrollments.enrolledAt));
    const studentIds = [...new Set(enrollmentRows.map((row) => row.userId))];
    const studentRows = studentIds.length
      ? await db
          .select({
            email: users.email,
            fullName: profiles.fullName,
            id: profiles.id,
          })
          .from(profiles)
          .innerJoin(users, eq(profiles.userId, users.id))
          .where(inArray(profiles.id, studentIds))
      : [];
    const studentById = new Map(studentRows.map((row) => [row.id, row]));
    const videoRows = await db
      .select({ courseId: sections.courseId, videoId: videos.id })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(
        and(
          eq(videos.isPublished, true),
          inArray(sections.courseId, courseIds),
        ),
      );
    const videosByCourse = new Map<string, string[]>();
    for (const row of videoRows) {
      const list = videosByCourse.get(row.courseId) ?? [];
      list.push(row.videoId);
      videosByCourse.set(row.courseId, list);
    }
    const allVideoIds = videoRows.map((row) => row.videoId);
    const progressRows =
      studentIds.length && allVideoIds.length
        ? await db
            .select({
              isCompleted: videoProgress.isCompleted,
              lastWatchedAt: videoProgress.lastWatchedAt,
              userId: videoProgress.userId,
              videoId: videoProgress.videoId,
            })
            .from(videoProgress)
            .where(
              and(
                inArray(videoProgress.userId, studentIds),
                inArray(videoProgress.videoId, allVideoIds),
              ),
            )
        : [];
    const completedSet = new Set(
      progressRows
        .filter((row) => row.isCompleted)
        .map((row) => `${row.userId}:${row.videoId}`),
    );
    const lastByUserCourse = new Map<string, Date>();
    for (const row of progressRows) {
      const courseId = videoRows.find(
        (video) => video.videoId === row.videoId,
      )?.courseId;
      if (!courseId) continue;
      const key = `${row.userId}:${courseId}`;
      const current = lastByUserCourse.get(key);
      if (!current || row.lastWatchedAt > current) {
        lastByUserCourse.set(key, row.lastWatchedAt);
      }
    }
    const escape = (value: string | null) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      'studentName,studentEmail,courseTitle,enrolledAt,completionRate,lastWatchedAt,status',
    ];
    for (const enrolment of enrollmentRows) {
      const lectureIds = videosByCourse.get(enrolment.courseId) ?? [];
      const completed = lectureIds.filter((id) =>
        completedSet.has(`${enrolment.userId}:${id}`),
      ).length;
      const rate = lectureIds.length
        ? Math.round((completed / lectureIds.length) * 100)
        : 0;
      const student = studentById.get(enrolment.userId);
      lines.push(
        [
          escape(student?.fullName ?? ''),
          escape(student?.email ?? ''),
          escape(titleById.get(enrolment.courseId) ?? ''),
          escape(enrolment.enrolledAt.toISOString()),
          String(rate),
          escape(
            lastByUserCourse
              .get(`${enrolment.userId}:${enrolment.courseId}`)
              ?.toISOString() ?? '',
          ),
          escape(enrolment.status),
        ].join(','),
      );
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Bulk announcement DRAFT only: returns the draft plus recipient
   * count/preview. Nothing is sent and no notification or announcement
   * record is created — the teacher reviews and sends it separately.
   */
  async sellerAnnouncementDraft(request: Request) {
    const profile = await this.requireStaff(request);
    const input = z
      .object({
        body: z.string().trim().min(2).max(5000),
        courseId: z.string().uuid().optional(),
        title: z.string().trim().min(2).max(180),
      })
      .parse(request.body);
    let courseIds: string[];
    if (input.courseId) {
      const [owned] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.id, input.courseId),
            eq(courses.instructorId, profile.id),
          ),
        )
        .limit(1);
      if (!owned) throw new UnauthorizedException('Course not found.');
      courseIds = [input.courseId];
    } else {
      const rows = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.instructorId, profile.id));
      courseIds = rows.map((row) => row.id);
    }
    if (!courseIds.length) {
      return {
        draft: { body: input.body, courseId: input.courseId ?? null, title: input.title },
        note: 'Draft only — nothing was sent and no record was created.',
        recipientCount: 0,
        recipientsPreview: [],
        sent: false,
      };
    }
    const recipients = await db
      .select({
        email: users.email,
        fullName: profiles.fullName,
        userId: enrollments.userId,
      })
      .from(enrollments)
      .innerJoin(profiles, eq(enrollments.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(
        and(
          inArray(enrollments.courseId, courseIds),
          eq(enrollments.status, 'active'),
        ),
      );
    const unique = [...new Map(recipients.map((r) => [r.userId, r])).values()];
    return {
      draft: { body: input.body, courseId: input.courseId ?? null, title: input.title },
      note: 'Draft only — nothing was sent and no record was created.',
      recipientCount: unique.length,
      recipientsPreview: unique.slice(0, 10).map((row) => ({
        email: row.email,
        fullName: row.fullName,
      })),
      sent: false,
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
      // Array.prototype.every on an empty array is true, so a course with
      // no published lectures must not count its enrolments as completed.
      const completedEnrollmentCount = activeEnrollments.filter(
        (row) =>
          lectureIds.length > 0 &&
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
