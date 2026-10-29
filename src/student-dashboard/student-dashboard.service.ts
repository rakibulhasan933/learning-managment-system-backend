import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  assignments,
  assignmentSubmissions,
  asc,
  courses,
  desc,
  enrollments,
  eq,
  inArray,
  modules,
  quizAttempts,
  quizzes,
  sections,
  videoProgress,
  videos,
} from '../database/index.js';
import type { StudentAnalyticsResponse } from '../types/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';

@Injectable()
export class StudentDashboardService {
  constructor(private readonly authService: AuthService) {}

  async getAnalytics(request: Request): Promise<StudentAnalyticsResponse> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'student')
      throw new ForbiddenException('Access denied.');

    const profileId = profile.id;
    const enrollmentRows = await db
      .select({
        courseId: enrollments.courseId,
        courseTitle: courses.title,
        enrolledAt: enrollments.enrolledAt,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(
        and(
          eq(enrollments.userId, profileId),
          eq(enrollments.status, 'active'),
        ),
      )
      .orderBy(desc(enrollments.enrolledAt));

    const courseIds = enrollmentRows.map((row) => row.courseId);
    if (courseIds.length === 0) {
      return {
        activeCourses: 0,
        assignmentAveragePercentage: 0,
        assignmentsPending: 0,
        assignmentsGraded: 0,
        assignmentsSubmitted: 0,
        completedLectures: 0,
        completionPercentage: 0,
        courses: [],
        lastActivityAt: null,
        learningStreakDays: 0,
        quizAttempts: 0,
        quizAveragePercentage: 0,
        totalLectures: 0,
        quizPerformance: [],
        weeklyActivity: createWeeklyActivity([]),
        watchTimeSeconds: 0,
      } satisfies StudentAnalyticsResponse;
    }

    const lectureRows = await db
      .select({
        courseId: sections.courseId,
        durationSeconds: videos.durationSeconds,
        id: videos.id,
      })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(
        and(
          inArray(sections.courseId, courseIds),
          eq(videos.isPublished, true),
        ),
      )
      .orderBy(
        asc(sections.position),
        asc(modules.position),
        asc(videos.position),
      );
    const lectureIds = lectureRows.map((row) => row.id);
    const progressRows = lectureIds.length
      ? await db
          .select({
            isCompleted: videoProgress.isCompleted,
            lastWatchedAt: videoProgress.lastWatchedAt,
            lectureId: videoProgress.videoId,
            positionSeconds: videoProgress.positionSeconds,
          })
          .from(videoProgress)
          .where(
            and(
              eq(videoProgress.userId, profileId),
              inArray(videoProgress.videoId, lectureIds),
            ),
          )
      : [];

    const quizRows = await db
      .select({ id: quizzes.id, title: quizzes.title })
      .from(quizzes)
      .where(
        and(
          inArray(quizzes.courseId, courseIds),
          eq(quizzes.isPublished, true),
        ),
      );
    const quizIds = quizRows.map((row) => row.id);
    const quizAttemptRows = quizIds.length
      ? await db
          .select({
            completedAt: quizAttempts.completedAt,
            quizId: quizAttempts.quizId,
            score: quizAttempts.score,
            totalQuestions: quizAttempts.totalQuestions,
          })
          .from(quizAttempts)
          .where(
            and(
              eq(quizAttempts.userId, profileId),
              inArray(quizAttempts.quizId, quizIds),
            ),
          )
      : [];

    const assignmentRows = await db
      .select({ id: assignments.id, maxScore: assignments.maxScore })
      .from(assignments)
      .where(
        and(
          inArray(assignments.courseId, courseIds),
          eq(assignments.isPublished, true),
        ),
      );
    const assignmentIds = assignmentRows.map((row) => row.id);
    const submissionRows = assignmentIds.length
      ? await db
          .select({
            assignmentId: assignmentSubmissions.assignmentId,
            gradeScore: assignmentSubmissions.gradeScore,
            submittedAt: assignmentSubmissions.submittedAt,
            updatedAt: assignmentSubmissions.updatedAt,
          })
          .from(assignmentSubmissions)
          .where(
            and(
              eq(assignmentSubmissions.userId, profileId),
              inArray(assignmentSubmissions.assignmentId, assignmentIds),
            ),
          )
      : [];

    const progressByLecture = new Map(
      progressRows.map((row) => [row.lectureId, row]),
    );
    const courseProgress = enrollmentRows.map((course) => {
      const courseLectureIds = lectureRows
        .filter((lecture) => lecture.courseId === course.courseId)
        .map((lecture) => lecture.id);
      const courseProgressRows = courseLectureIds
        .map((lectureId) => progressByLecture.get(lectureId))
        .filter((row): row is (typeof progressRows)[number] => Boolean(row));
      const completedLectures = courseProgressRows.filter(
        (row) => row.isCompleted,
      ).length;
      // Same genuine-activity rule as the overall streak: a zero-position,
      // non-completed row must not set a course's last-activity date.
      const lastActivityAt = courseProgressRows
        .filter((row) => row.isCompleted || row.positionSeconds > 0)
        .map((row) => row.lastWatchedAt)
        .sort((left, right) => right.getTime() - left.getTime())[0];

      return {
        completedLectures,
        completionPercentage: courseLectureIds.length
          ? Math.round((completedLectures / courseLectureIds.length) * 100)
          : 0,
        courseId: course.courseId,
        courseTitle: course.courseTitle,
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
        totalLectures: courseLectureIds.length,
      };
    });

    // Genuine watch activity only: a progress row with position 0 that was
    // never completed is just a page view, not a learning day. Quiz
    // attempts and assignment submissions are genuine activity on their own.
    const genuineProgressRows = progressRows.filter(
      (row) => row.isCompleted || row.positionSeconds > 0,
    );
    const durationByLecture = new Map(
      lectureRows.map((row) => [row.id, row.durationSeconds]),
    );
    // Watch time: a completed video counts at least its known duration,
    // because a completion sent with position 0 (e.g. "Mark complete"
    // without playing) would otherwise report 0 seconds watched. If the
    // video has no recorded duration, only the sent position can count.
    const watchTimeSeconds = progressRows.reduce((total, row) => {
      const duration = durationByLecture.get(row.lectureId) ?? null;
      const seconds = row.isCompleted
        ? Math.max(row.positionSeconds, duration ?? 0)
        : row.positionSeconds;
      return total + seconds;
    }, 0);
    const allActivityDates = [
      ...genuineProgressRows.map((row) => row.lastWatchedAt),
      ...quizAttemptRows.map((row) => row.completedAt),
      ...submissionRows.map((row) => row.updatedAt),
    ];
    const lastActivityAt = allActivityDates.sort(
      (left, right) => right.getTime() - left.getTime(),
    )[0];
    const quizAveragePercentage = quizAttemptRows.length
      ? Math.round(
          quizAttemptRows.reduce(
            (total, row) =>
              total +
              (row.totalQuestions ? (row.score / row.totalQuestions) * 100 : 0),
            0,
          ) / quizAttemptRows.length,
        )
      : 0;
    const gradedSubmissions = submissionRows.filter(
      (row) => row.gradeScore !== null,
    );
    const maxScoreByAssignment = new Map(
      assignmentRows.map((row) => [row.id, row.maxScore]),
    );
    const assignmentAveragePercentage = gradedSubmissions.length
      ? Math.round(
          gradedSubmissions.reduce(
            (total, row) =>
              total +
              ((row.gradeScore ?? 0) /
                (maxScoreByAssignment.get(row.assignmentId) ?? 1)) *
                100,
            0,
          ) / gradedSubmissions.length,
        )
      : 0;
    const quizTitleById = new Map(quizRows.map((row) => [row.id, row.title]));

    return {
      activeCourses: enrollmentRows.length,
      assignmentAveragePercentage,
      assignmentsGraded: gradedSubmissions.length,
      assignmentsPending: Math.max(
        0,
        assignmentRows.length - submissionRows.length,
      ),
      assignmentsSubmitted: submissionRows.length,
      completedLectures: progressRows.filter((row) => row.isCompleted).length,
      completionPercentage: lectureRows.length
        ? Math.round(
            (progressRows.filter((row) => row.isCompleted).length /
              lectureRows.length) *
              100,
          )
        : 0,
      courses: courseProgress,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
      learningStreakDays: calculateStreak(allActivityDates),
      quizAttempts: quizAttemptRows.length,
      quizAveragePercentage,
      quizPerformance: quizAttemptRows.map((row) => ({
        percentage: row.totalQuestions
          ? Math.round((row.score / row.totalQuestions) * 100)
          : 0,
        quizTitle: quizTitleById.get(row.quizId) ?? 'Quiz',
        score: row.score,
        totalQuestions: row.totalQuestions,
      })),
      totalLectures: lectureRows.length,
      weeklyActivity: createWeeklyActivity(genuineProgressRows),
      watchTimeSeconds,
    } satisfies StudentAnalyticsResponse;
  }
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function calculateStreak(dates: Date[]) {
  const dateKeys = new Set(dates.map(dateKey));
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!dateKeys.has(dateKey(cursor)))
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (dateKeys.has(dateKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function createWeeklyActivity(
  rows: Array<{
    isCompleted: boolean;
    lastWatchedAt: Date;
    positionSeconds: number;
  }>,
) {
  const activityByDate = new Map<
    string,
    { lecturesCompleted: number; minutes: number }
  >();
  for (const row of rows) {
    const key = dateKey(row.lastWatchedAt);
    const current = activityByDate.get(key) ?? {
      lecturesCompleted: 0,
      minutes: 0,
    };
    current.minutes += Math.round(row.positionSeconds / 60);
    if (row.isCompleted) current.lecturesCompleted += 1;
    activityByDate.set(key, current);
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (6 - index));
    const activity = activityByDate.get(dateKey(date)) ?? {
      lecturesCompleted: 0,
      minutes: 0,
    };
    return {
      date: dateKey(date),
      label: date.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
      }),
      ...activity,
    };
  });
}
