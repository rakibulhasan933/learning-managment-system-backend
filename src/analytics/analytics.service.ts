import { Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  courseReviews,
  courses,
  count,
  desc,
  enrollments,
  eq,
  inArray,
  modules,
  orders,
  profiles,
  refunds,
  sections,
  users,
  videoProgress,
  videos,
} from '../database/index.js';
import { db } from '../lib/database.js';
import { isMissingTableError } from '../sales/sales-helpers.js';

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

const monthKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

interface EnrolmentRow {
  courseId: string;
  enrolledAt: Date;
  instructorId: string;
  orderId: string | null;
  status: string;
  userId: string;
}

/**
 * Admin-only analytics over EXISTING data only. Every number is computed
 * from real rows; there is no visit tracking, so no "visits" step or
 * estimated counts appear anywhere. Completion follows the seller
 * dashboard definition exactly: an active enrolment is complete when the
 * course has at least one published lecture and the student completed all
 * of them (a course with no published lectures never counts as
 * completed).
 */
@Injectable()
export class AnalyticsService {
  async funnel() {
    const [signupRow] = await db
      .select({ total: count() })
      .from(users);
    const [paidRow] = await db
      .select({ total: count() })
      .from(orders)
      .where(eq(orders.status, 'paid'));
    const signups = Number(signupRow?.total ?? 0);
    const paidOrders = Number(paidRow?.total ?? 0);
    const { activeEnrolments, completedKeys } = await this.loadEnrolments();
    const completedCourses = activeEnrolments.filter((row) =>
      completedKeys.has(this.enrolKey(row)),
    ).length;
    return {
      completedCourses,
      note: 'Page-visit tracking is not implemented, so the funnel starts at signup — there is no visits step and no estimated visit counts. Completion means every published lecture of the course is completed by the student.',
      paidOrders,
      paidToCompletedPct: pct(completedCourses, paidOrders),
      signups,
      signupToPaidPct: pct(paidOrders, signups),
    };
  }

  async cohorts() {
    const { allEnrolments, completedKeys } = await this.loadEnrolments();
    const refundedOrderIds = await this.refundedOrderIds();
    const byMonth = new Map<string, typeof allEnrolments>();
    for (const row of allEnrolments) {
      const key = monthKey(row.enrolledAt);
      const list = byMonth.get(key) ?? [];
      list.push(row);
      byMonth.set(key, list);
    }
    const cohorts = [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, rows]) => {
        const enrolled = rows.length;
        const completed = rows.filter((row) =>
          completedKeys.has(this.enrolKey(row)),
        ).length;
        const refunded = rows.filter(
          (row) => row.orderId && refundedOrderIds.has(row.orderId),
        ).length;
        return {
          completedPct: pct(completed, enrolled),
          enrolled,
          month,
          refundPct: pct(refunded, enrolled),
        };
      });
    return { cohorts };
  }

  async refundReasons() {
    const rows = await db
      .select({ reason: refunds.reason })
      .from(refunds)
      .orderBy(desc(refunds.createdAt));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const reason = (row.reason ?? '').trim();
      if (!reason) continue;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    const reasons = [...counts.entries()]
      .map(([reason, countValue]) => ({ count: countValue, reason }))
      .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1))
      .slice(0, 50);
    return { reasons, total: rows.length };
  }

  async teachers() {
    const instructorRows = await db
      .select({ fullName: profiles.fullName, id: profiles.id })
      .from(profiles)
      .where(eq(profiles.role, 'instructor'));
    const paidOrderRows = await db
      .select({
        amount: orders.amount,
        courseId: orders.courseId,
        id: orders.id,
        instructorId: courses.instructorId,
      })
      .from(orders)
      .innerJoin(courses, eq(orders.courseId, courses.id))
      .where(eq(orders.status, 'paid'));
    const { activeEnrolments, completedKeys } = await this.loadEnrolments();
    const avgRatings = await this.avgRatingByInstructor();
    const refundedOrderIds = await this.refundedOrderIds();
    const paidOrderIdsByInstructor = new Map<string, Set<string>>();
    for (const row of paidOrderRows) {
      const set =
        paidOrderIdsByInstructor.get(row.instructorId) ?? new Set<string>();
      set.add(row.id);
      paidOrderIdsByInstructor.set(row.instructorId, set);
    }
    const teachers = instructorRows.map((instructor) => {
      const sales = paidOrderRows
        .filter((row) => row.instructorId === instructor.id)
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const instructorEnrolments = activeEnrolments.filter(
        (row) => row.instructorId === instructor.id,
      );
      const completed = instructorEnrolments.filter((row) =>
        completedKeys.has(this.enrolKey(row)),
      ).length;
      const paidOrderIds =
        paidOrderIdsByInstructor.get(instructor.id) ?? new Set<string>();
      const refunded = [...paidOrderIds].filter((orderId) =>
        refundedOrderIds.has(orderId),
      ).length;
      return {
        avgRating: avgRatings.get(instructor.id) ?? null,
        completionPct: pct(completed, instructorEnrolments.length),
        refundPct: pct(refunded, paidOrderIds.size),
        sales: Math.round(sales * 100) / 100,
        teacherId: instructor.id,
        teacherName: instructor.fullName ?? 'শিক্ষক',
      };
    });
    teachers.sort((a, b) => b.sales - a.sales);
    return { teachers };
  }

  async exportReport(report: string): Promise<{ csv: string; filename: string }> {
    if (report === 'funnel') {
      const data = await this.funnel();
      const csv = this.toCsv(
        ['metric', 'value'],
        [
          ['signups', String(data.signups)],
          ['paid_orders', String(data.paidOrders)],
          ['completed_courses', String(data.completedCourses)],
          ['signup_to_paid_pct', String(data.signupToPaidPct)],
          ['paid_to_completed_pct', String(data.paidToCompletedPct)],
        ],
      );
      return { csv, filename: 'analytics-funnel.csv' };
    }
    if (report === 'cohorts') {
      const data = await this.cohorts();
      const csv = this.toCsv(
        ['month', 'enrolled', 'completed_pct', 'refund_pct'],
        data.cohorts.map((row) => [
          row.month,
          String(row.enrolled),
          String(row.completedPct),
          String(row.refundPct),
        ]),
      );
      return { csv, filename: 'analytics-cohorts.csv' };
    }
    if (report === 'refund-reasons') {
      const data = await this.refundReasons();
      const csv = this.toCsv(
        ['reason', 'count'],
        data.reasons.map((row) => [row.reason, String(row.count)]),
      );
      return { csv, filename: 'analytics-refund-reasons.csv' };
    }
    if (report === 'teachers') {
      const data = await this.teachers();
      const csv = this.toCsv(
        [
          'teacher_id',
          'teacher_name',
          'sales',
          'completion_pct',
          'avg_rating',
          'refund_pct',
        ],
        data.teachers.map((row) => [
          row.teacherId,
          row.teacherName,
          String(row.sales),
          String(row.completionPct),
          row.avgRating === null ? '' : String(row.avgRating),
          String(row.refundPct),
        ]),
      );
      return { csv, filename: 'analytics-teachers.csv' };
    }
    throw new NotFoundException('Report not found.');
  }

  // ---------------- shared computation ----------------

  private enrolKey(row: { userId: string; courseId: string }): string {
    return `${row.userId}:${row.courseId}`;
  }

  /**
   * Loads ALL enrolments (with their course instructor) plus the set of
   * (userId, courseId) enrolments that are complete per the seller
   * dashboard definition. activeEnrolments is the active-only subset
   * most reports need.
   */
  private async loadEnrolments(): Promise<{
    activeEnrolments: EnrolmentRow[];
    allEnrolments: EnrolmentRow[];
    completedKeys: Set<string>;
  }> {
    const allEnrolments: EnrolmentRow[] = await db
      .select({
        courseId: enrollments.courseId,
        enrolledAt: enrollments.enrolledAt,
        instructorId: courses.instructorId,
        orderId: enrollments.orderId,
        status: enrollments.status,
        userId: enrollments.userId,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id));
    const activeEnrolments = allEnrolments.filter(
      (row) => row.status === 'active',
    );
    const videoRows = await db
      .select({ courseId: sections.courseId, videoId: videos.id })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(eq(videos.isPublished, true));
    const videosByCourse = new Map<string, string[]>();
    for (const row of videoRows) {
      const list = videosByCourse.get(row.courseId) ?? [];
      list.push(row.videoId);
      videosByCourse.set(row.courseId, list);
    }
    const userIds = [...new Set(allEnrolments.map((row) => row.userId))];
    const videoIds = videoRows.map((row) => row.videoId);
    const progressRows =
      userIds.length && videoIds.length
        ? await db
            .select({
              userId: videoProgress.userId,
              videoId: videoProgress.videoId,
            })
            .from(videoProgress)
            .where(
              and(
                eq(videoProgress.isCompleted, true),
                inArray(videoProgress.userId, userIds),
                inArray(videoProgress.videoId, videoIds),
              ),
            )
        : [];
    const completedVideos = new Set(
      progressRows.map((row) => `${row.userId}:${row.videoId}`),
    );
    const completedKeys = new Set<string>();
    for (const row of activeEnrolments) {
      const lectureList = videosByCourse.get(row.courseId) ?? [];
      if (
        lectureList.length > 0 &&
        lectureList.every((videoId) =>
          completedVideos.has(`${row.userId}:${videoId}`),
        )
      ) {
        completedKeys.add(this.enrolKey(row));
      }
    }
    return { activeEnrolments, allEnrolments, completedKeys };
  }

  private async refundedOrderIds(): Promise<Set<string>> {
    const rows = await db
      .select({ orderId: refunds.orderId })
      .from(refunds)
      .where(inArray(refunds.status, ['approved', 'processed']));
    return new Set(rows.map((row) => row.orderId));
  }

  /**
   * Average visible-review rating per instructor. Returns an empty map
   * when the reviews tables don't exist yet (migration not applied) so
   * the teachers report still works — avgRating is then null.
   */
  private async avgRatingByInstructor(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const rows = await db
        .select({
          instructorId: courses.instructorId,
          rating: courseReviews.rating,
        })
        .from(courseReviews)
        .innerJoin(courses, eq(courseReviews.courseId, courses.id))
        .where(eq(courseReviews.isHidden, false));
      const sums = new Map<string, { count: number; sum: number }>();
      for (const row of rows) {
        const entry = sums.get(row.instructorId) ?? { count: 0, sum: 0 };
        entry.count += 1;
        entry.sum += row.rating;
        sums.set(row.instructorId, entry);
      }
      for (const [instructorId, entry] of sums) {
        out.set(
          instructorId,
          Math.round((entry.sum / entry.count) * 10) / 10,
        );
      }
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
    return out;
  }

  private toCsv(header: string[], rows: string[][]): string {
    const escape = (value: string): string =>
      /[",\n\r]/.test(value)
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    const lines = [header, ...rows].map((row) =>
      row.map(escape).join(','),
    );
    return lines.join('\r\n') + '\r\n';
  }
}
