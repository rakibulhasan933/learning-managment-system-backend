import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import {
  and,
  asc,
  batchMembers,
  batches,
  courses,
  enrollments,
  eq,
  inArray,
  liveClassAttendance,
  liveClasses,
  profiles,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { notifyManySafely } from '../lib/notifications.js';
import { missingTable503 } from '../sales/sales-helpers.js';

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
const isoDate = z.string().datetime();

function liveClassDto(row: typeof liveClasses.$inferSelect) {
  return {
    batchId: row.batchId,
    courseId: row.courseId,
    createdAt: row.createdAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    id: row.id,
    instructorId: row.instructorId,
    meetingUrl: row.meetingUrl,
    provider: row.provider,
    recordingTitle: row.recordingTitle,
    recordingUrl: row.recordingUrl,
    startsAt: row.startsAt.toISOString(),
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class LiveClassesService {
  constructor(private readonly authService: AuthService) {}

  private async requireRole(
    request: Request,
    roles: string[],
  ): Promise<{ id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) throw new UnauthorizedException('Authentication is required.');
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }

  private async ownedCourse(
    profile: { id: string; role: string },
    courseId: string,
  ) {
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course) throw new NotFoundException('Course not found.');
    if (profile.role === 'instructor' && course.instructorId !== profile.id) {
      throw new ForbiddenException('Access denied.');
    }
    return course;
  }

  private async instructorLiveClass(
    profile: { id: string; role: string },
    liveClassId: string,
  ) {
    const [row] = await db
      .select()
      .from(liveClasses)
      .where(eq(liveClasses.id, liveClassId))
      .limit(1);
    if (!row) throw new NotFoundException('Live class not found.');
    if (profile.role === 'instructor' && row.instructorId !== profile.id) {
      throw new ForbiddenException('Access denied.');
    }
    return row;
  }

  async createLiveClass(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const input = parseOr400(
      z.object({
        batchId: uuid.optional(),
        courseId: uuid,
        endsAt: isoDate.optional(),
        meetingUrl: z.string().trim().url().max(2000),
        provider: z.enum(['meet', 'zoom', 'other']),
        startsAt: isoDate,
        title: z.string().trim().min(2).max(180),
      }),
      request.body,
    );
    try {
      const course = await this.ownedCourse(profile, input.courseId);
      if (input.batchId) {
        const [batch] = await db
          .select({ courseId: batches.courseId, id: batches.id })
          .from(batches)
          .where(eq(batches.id, input.batchId))
          .limit(1);
        if (!batch || batch.courseId !== input.courseId) {
          throw new NotFoundException('Batch not found in this course.');
        }
      }
      const [row] = await db
        .insert(liveClasses)
        .values({
          batchId: input.batchId ?? null,
          courseId: input.courseId,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          instructorId:
            profile.role === 'admin' ? course.instructorId : profile.id,
          meetingUrl: input.meetingUrl,
          provider: input.provider,
          startsAt: new Date(input.startsAt),
          title: input.title,
        })
        .returning();
      if (!row) throw new Error('Live class could not be created.');
      // Best-effort in-app notification to enrolled/batch students.
      // Never throws, so scheduling always succeeds.
      await this.notifyLiveClassScheduled({
        batchId: row.batchId,
        courseId: row.courseId,
        title: row.title,
      });
      return { liveClass: liveClassDto(row) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listInstructorLiveClasses(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const query = request.query as Record<string, string | undefined>;
    try {
      const conditions = [];
      if (profile.role === 'instructor') {
        conditions.push(eq(liveClasses.instructorId, profile.id));
      }
      if (query.courseId) {
        const courseId = parseOr400(uuid, query.courseId);
        await this.ownedCourse(profile, courseId);
        conditions.push(eq(liveClasses.courseId, courseId));
      }
      if (query.batchId) {
        conditions.push(eq(liveClasses.batchId, parseOr400(uuid, query.batchId)));
      }
      const rows = await db
        .select()
        .from(liveClasses)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(liveClasses.startsAt));
      return { liveClasses: rows.map(liveClassDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listStudentLiveClasses(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const query = request.query as Record<string, string | undefined>;
    try {
      const conditions = [];
      if (query.courseId) {
        const courseId = parseOr400(uuid, query.courseId);
        const [enrolment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.courseId, courseId),
              eq(enrollments.userId, profile.id),
              eq(enrollments.status, 'active'),
            ),
          )
          .limit(1);
        if (!enrolment) {
          throw new ForbiddenException('Active enrollment is required.');
        }
        conditions.push(eq(liveClasses.courseId, courseId));
      } else if (profile.role === 'student') {
        const enrolments = await db
          .select({ courseId: enrollments.courseId })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.userId, profile.id),
              eq(enrollments.status, 'active'),
            ),
          );
        const courseIds = enrolments.map((row) => row.courseId);
        if (!courseIds.length) return { liveClasses: [] };
        conditions.push(inArray(liveClasses.courseId, courseIds));
      }
      const rows = await db
        .select()
        .from(liveClasses)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(liveClasses.startsAt));
      if (profile.role === 'admin') {
        return { liveClasses: rows.map(liveClassDto) };
      }
      // A batch-scoped class is visible only to that batch's members;
      // a course-wide class is visible to every enrolled student.
      const batchIds = [...new Set(rows.map((r) => r.batchId).filter(Boolean))] as string[];
      const memberBatchIds = new Set<string>();
      if (batchIds.length) {
        const memberships = await db
          .select({ batchId: batchMembers.batchId })
          .from(batchMembers)
          .where(
            and(
              inArray(batchMembers.batchId, batchIds),
              eq(batchMembers.userId, profile.id),
            ),
          );
        for (const m of memberships) memberBatchIds.add(m.batchId);
      }
      const visible = rows.filter(
        (row) => !row.batchId || memberBatchIds.has(row.batchId),
      );
      return { liveClasses: visible.map(liveClassDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async setRecording(liveClassIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const liveClassId = parseOr400(uuid, liveClassIdInput);
    const input = parseOr400(
      z.object({
        recordingUrl: z.string().trim().url().max(2000),
        title: z.string().trim().min(1).max(180).optional(),
      }),
      request.body,
    );
    try {
      await this.instructorLiveClass(profile, liveClassId);
      // URL only: no file is uploaded and no recording server is
      // built. The teacher pastes a link (e.g. Drive/YouTube) and it
      // is stored against the class.
      const [row] = await db
        .update(liveClasses)
        .set({
          recordingTitle: input.title ?? null,
          recordingUrl: input.recordingUrl,
        })
        .where(eq(liveClasses.id, liveClassId))
        .returning();
      if (!row) throw new Error('Live class could not be updated.');
      return { liveClass: liveClassDto(row) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async markAttendance(liveClassIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const liveClassId = parseOr400(uuid, liveClassIdInput);
    const input = parseOr400(
      z.object({ present: z.boolean(), userId: uuid }),
      request.body,
    );
    try {
      const liveClass = await this.instructorLiveClass(profile, liveClassId);
      // Only the teacher marks attendance. A student opening the
      // meeting link never creates an attendance row.
      const [enrolment] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.courseId, liveClass.courseId),
            eq(enrollments.userId, input.userId),
            eq(enrollments.status, 'active'),
          ),
        )
        .limit(1);
      if (!enrolment) {
        throw new ForbiddenException('Active enrollment is required.');
      }
      if (liveClass.batchId) {
        const [member] = await db
          .select({ id: batchMembers.id })
          .from(batchMembers)
          .where(
            and(
              eq(batchMembers.batchId, liveClass.batchId),
              eq(batchMembers.userId, input.userId),
            ),
          )
          .limit(1);
        if (!member) {
          throw new ForbiddenException('Batch membership is required.');
        }
      }
      const [row] = await db
        .insert(liveClassAttendance)
        .values({
          liveClassId,
          markedBy: profile.id,
          present: input.present,
          userId: input.userId,
        })
        .onConflictDoUpdate({
          set: { markedBy: profile.id, present: input.present },
          target: [liveClassAttendance.liveClassId, liveClassAttendance.userId],
        })
        .returning();
      if (!row) throw new Error('Attendance could not be recorded.');
      return {
        attendance: {
          liveClassId: row.liveClassId,
          markedAt: row.markedAt.toISOString(),
          markedBy: row.markedBy,
          present: row.present,
          userId: row.userId,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listAttendance(liveClassIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const liveClassId = parseOr400(uuid, liveClassIdInput);
    try {
      await this.instructorLiveClass(profile, liveClassId);
      const rows = await db
        .select()
        .from(liveClassAttendance)
        .where(eq(liveClassAttendance.liveClassId, liveClassId))
        .orderBy(asc(liveClassAttendance.markedAt));
      const names = new Map<string, string | null>();
      if (rows.length) {
        const people = await db
          .select({ fullName: profiles.fullName, id: profiles.id })
          .from(profiles)
          .where(inArray(profiles.id, rows.map((r) => r.userId)));
        for (const person of people) names.set(person.id, person.fullName);
      }
      return {
        attendance: rows.map((row) => ({
          liveClassId: row.liveClassId,
          markedAt: row.markedAt.toISOString(),
          markedBy: row.markedBy,
          name: names.get(row.userId) ?? null,
          present: row.present,
          userId: row.userId,
        })),
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  /**
   * Best-effort in-app notification for a newly scheduled live class:
   * active enrolled students of the course, plus batch members when the
   * class is tied to a batch. Link clicks never count as attendance.
   * Never throws.
   */
  private async notifyLiveClassScheduled(input: {
    batchId: string | null;
    courseId: string;
    title: string;
  }) {
    try {
      const studentIds = new Set<string>();
      const enrolled = await db
        .select({ profileId: enrollments.userId })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.courseId, input.courseId),
            eq(enrollments.status, 'active'),
          ),
        );
      for (const row of enrolled) studentIds.add(row.profileId);
      if (input.batchId) {
        const members = await db
          .select({ profileId: batchMembers.userId })
          .from(batchMembers)
          .where(eq(batchMembers.batchId, input.batchId));
        for (const row of members) studentIds.add(row.profileId);
      }
      if (!studentIds.size) return;
      await notifyManySafely(
        [...studentIds].map((profileId) => ({
          body: `A new live class "${input.title}" was scheduled. Join from the live classes section.`,
          href: '/dashboard/student/live-classes',
          profileId,
          title: 'New live class scheduled',
          type: 'live_class_scheduled',
        })),
      );
    } catch (error) {
      console.error('Live-class notification failed.', error);
    }
  }
}
