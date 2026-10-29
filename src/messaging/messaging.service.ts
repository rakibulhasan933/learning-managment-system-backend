import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  batchMembers,
  batches,
  count,
  courses,
  desc,
  enrollments,
  eq,
  gte,
  isNull,
  messageThreads,
  messages,
  or,
  profiles,
  sql,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { notifySafely } from '../lib/notifications.js';
import {
  isMissingTableError,
  missingTable503,
} from '../sales/sales-helpers.js';
import { z, ZodError } from 'zod';

const MESSAGE_MAX = 2000;
const SUBJECT_MAX = 200;
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 5;

interface Viewer {
  id: string;
  role: string;
}

function preview(body: string): string {
  return body.length > 120 ? `${body.slice(0, 120)}…` : body;
}

@Injectable()
export class MessagingService {
  constructor(private readonly authService: AuthService) {}

  private async requireViewer(request: Request): Promise<Viewer> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['student', 'instructor', 'admin'].includes(profile.role))
      throw new ForbiddenException('Access denied.');
    return profile;
  }

  private async requireInstructor(request: Request): Promise<Viewer> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'instructor')
      throw new ForbiddenException('Access denied.');
    return profile;
  }

  /** Throws 404/403 unless the viewer is a party of the thread. */
  private async threadForViewer(threadId: string, viewer: Viewer) {
    const id = this.parseOr400(z.string().uuid(), threadId);
    try {
      const [thread] = await db
        .select()
        .from(messageThreads)
        .where(eq(messageThreads.id, id))
        .limit(1);
      if (!thread) throw new NotFoundException('Thread not found.');
      if (
        thread.studentId !== viewer.id &&
        thread.instructorId !== viewer.id
      ) {
        throw new ForbiddenException('Access denied.');
      }
      return thread;
    } catch (error) {
      missingTable503(error);
    }
  }

  private parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
    try {
      return schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError)
        throw new BadRequestException('Invalid request payload.');
      throw error;
    }
  }

  private async activeEnrollment(courseId: string, studentId: string) {
    const [row] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.userId, studentId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async ownedCourse(courseId: string, instructorId: string) {
    const [course] = await db
      .select({ id: courses.id, instructorId: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course) throw new NotFoundException('Course not found.');
    if (course.instructorId !== instructorId)
      throw new ForbiddenException('Access denied.');
    return course;
  }

  /** Find or create the 1:1 thread for (courseId, studentId, instructorId). */
  private async getOrCreateThread(input: {
    courseId: string;
    instructorId: string;
    studentId: string;
    subject: string;
  }) {
    const [existing] = await db
      .select()
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.courseId, input.courseId),
          eq(messageThreads.studentId, input.studentId),
          eq(messageThreads.instructorId, input.instructorId),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [created] = await db
      .insert(messageThreads)
      .values({
        courseId: input.courseId,
        instructorId: input.instructorId,
        studentId: input.studentId,
        subject: input.subject,
      })
      .returning();
    if (!created) throw new Error('Thread could not be created.');
    return created;
  }

  private async assertNotRateLimited(senderId: string) {
    const windowStart = new Date(Date.now() - RATE_WINDOW_SECONDS * 1000);
    const [{ value }] = await db
      .select({ value: count() })
      .from(messages)
      .where(
        and(eq(messages.senderId, senderId), gte(messages.createdAt, windowStart)),
      );
    if (value >= RATE_MAX_PER_WINDOW) {
      throw new HttpException(
        'Too many messages. Please wait a moment and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async sendMessage(input: {
    body: string;
    senderId: string;
    threadId: string;
  }) {
    await this.assertNotRateLimited(input.senderId);
    const [message] = await db
      .insert(messages)
      .values({
        body: input.body,
        senderId: input.senderId,
        threadId: input.threadId,
      })
      .returning();
    if (!message) throw new Error('Message could not be sent.');
    await db
      .update(messageThreads)
      .set({ lastMessageAt: message.createdAt })
      .where(eq(messageThreads.id, input.threadId));
    return message;
  }

  /** Notify the OTHER party of a new message (best-effort, in-app only). */
  private async notifyOtherParty(input: {
    body: string;
    recipientId: string;
    recipientRole: string;
    senderName: string | null;
    subject: string;
    threadId: string;
  }) {
    const href =
      input.recipientRole === 'instructor'
        ? `/dashboard/instructor/messages/${input.threadId}`
        : `/dashboard/student/messages/${input.threadId}`;
    await notifySafely({
      body: preview(input.body),
      href,
      profileId: input.recipientId,
      title: `New message: ${input.subject}`,
      type: 'new_message',
    });
  }

  // ------------------------- public API -------------------------

  async listThreads(request: Request) {
    const viewer = await this.requireViewer(request);
    try {
      const rows = await db
        .select({
          courseId: messageThreads.courseId,
          courseTitle: courses.title,
          createdAt: messageThreads.createdAt,
          id: messageThreads.id,
          instructorId: messageThreads.instructorId,
          lastMessageAt: messageThreads.lastMessageAt,
          studentId: messageThreads.studentId,
          subject: messageThreads.subject,
        })
        .from(messageThreads)
        .innerJoin(courses, eq(messageThreads.courseId, courses.id))
        .where(
          or(
            eq(messageThreads.studentId, viewer.id),
            eq(messageThreads.instructorId, viewer.id),
          ),
        )
        .orderBy(
          sql`${messageThreads.lastMessageAt} DESC NULLS LAST`,
          desc(messageThreads.createdAt),
        );
      const threads = [];
      for (const row of rows) {
        const isStudent = viewer.id === row.studentId;
        const otherPartyId = isStudent ? row.instructorId : row.studentId;
        const [other] = await db
          .select({ fullName: profiles.fullName, role: profiles.role })
          .from(profiles)
          .where(eq(profiles.id, otherPartyId))
          .limit(1);
        const [last] = await db
          .select({ body: messages.body })
          .from(messages)
          .where(eq(messages.threadId, row.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);
        const [{ value: unread }] = await db
          .select({ value: count() })
          .from(messages)
          .where(
            and(
              eq(messages.threadId, row.id),
              isNull(messages.readAt),
              sql`${messages.senderId} <> ${viewer.id}`,
            ),
          );
        threads.push({
          courseId: row.courseId,
          courseTitle: row.courseTitle,
          id: row.id,
          lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
          lastMessagePreview: last ? preview(last.body) : null,
          otherPartyName: other?.fullName ?? null,
          otherPartyRole: other?.role ?? (isStudent ? 'instructor' : 'student'),
          subject: row.subject,
          unreadCount: unread,
        });
      }
      return { threads };
    } catch (error) {
      missingTable503(error);
    }
  }

  async getThread(threadId: string, request: Request) {
    const viewer = await this.requireViewer(request);
    const thread = await this.threadForViewer(threadId, viewer);
    try {
      const [course] = await db
        .select({ title: courses.title })
        .from(courses)
        .where(eq(courses.id, thread.courseId))
        .limit(1);
      const [other] = await db
        .select({ fullName: profiles.fullName, role: profiles.role })
        .from(profiles)
        .where(
          eq(
            profiles.id,
            viewer.id === thread.studentId
              ? thread.instructorId
              : thread.studentId,
          ),
        )
        .limit(1);
      // Mark the other party's messages as read for this viewer.
      await db
        .update(messages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(messages.threadId, thread.id),
            isNull(messages.readAt),
            sql`${messages.senderId} <> ${viewer.id}`,
          ),
        );
      const rows = await db
        .select({
          body: messages.body,
          createdAt: messages.createdAt,
          id: messages.id,
          readAt: messages.readAt,
          senderFullName: profiles.fullName,
          senderId: messages.senderId,
          senderRole: profiles.role,
        })
        .from(messages)
        .innerJoin(profiles, eq(messages.senderId, profiles.id))
        .where(eq(messages.threadId, thread.id))
        .orderBy(messages.createdAt);
      return {
        messages: rows.map((row) => ({
          body: row.body,
          createdAt: row.createdAt.toISOString(),
          id: row.id,
          readAt: row.readAt?.toISOString() ?? null,
          senderId: row.senderId,
          senderName: row.senderFullName,
          senderRole: row.senderRole,
        })),
        thread: {
          courseId: thread.courseId,
          courseTitle: course?.title ?? null,
          id: thread.id,
          lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
          otherPartyName: other?.fullName ?? null,
          otherPartyRole: other?.role ?? null,
          subject: thread.subject,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createThread(request: Request) {
    const viewer = await this.requireViewer(request);
    const input = this.parseOr400(
      z.object({
        body: z.string().trim().min(1).max(MESSAGE_MAX),
        courseId: z.string().uuid(),
        studentId: z.string().uuid().optional(),
        subject: z.string().trim().min(1).max(SUBJECT_MAX),
      }),
      request.body ?? {},
    );
    try {
      if (viewer.role === 'student') {
        // A student always talks to the course's own instructor.
        const [course] = await db
          .select({ id: courses.id, instructorId: courses.instructorId })
          .from(courses)
          .where(eq(courses.id, input.courseId))
          .limit(1);
        if (!course) throw new NotFoundException('Course not found.');
        const enrollment = await this.activeEnrollment(
          input.courseId,
          viewer.id,
        );
        if (!enrollment)
          throw new ForbiddenException(
            'You must be enrolled in this course to message the instructor.',
          );
        const thread = await this.getOrCreateThread({
          courseId: input.courseId,
          instructorId: course.instructorId,
          studentId: viewer.id,
          subject: input.subject,
        });
        const message = await this.sendMessage({
          body: input.body,
          senderId: viewer.id,
          threadId: thread.id,
        });
        await this.notifyOtherParty({
          body: input.body,
          recipientId: course.instructorId,
          recipientRole: 'instructor',
          senderName: null,
          subject: thread.subject,
          threadId: thread.id,
        });
        return { message: messageDto(message), thread: threadDto(thread) };
      }
      if (viewer.role === 'instructor') {
        if (!input.studentId)
          throw new BadRequestException('studentId is required.');
        await this.ownedCourse(input.courseId, viewer.id);
        const enrollment = await this.activeEnrollment(
          input.courseId,
          input.studentId,
        );
        if (!enrollment)
          throw new ForbiddenException(
            'The student must be enrolled in this course.',
          );
        const thread = await this.getOrCreateThread({
          courseId: input.courseId,
          instructorId: viewer.id,
          studentId: input.studentId,
          subject: input.subject,
        });
        const message = await this.sendMessage({
          body: input.body,
          senderId: viewer.id,
          threadId: thread.id,
        });
        await this.notifyOtherParty({
          body: input.body,
          recipientId: input.studentId,
          recipientRole: 'student',
          senderName: null,
          subject: thread.subject,
          threadId: thread.id,
        });
        return { message: messageDto(message), thread: threadDto(thread) };
      }
      // Admins can read threads but never open new ones from this API.
      throw new ForbiddenException('Access denied.');
    } catch (error) {
      if (isMissingTableError(error)) missingTable503(error);
      throw error;
    }
  }

  async postMessage(threadId: string, request: Request) {
    const viewer = await this.requireViewer(request);
    const thread = await this.threadForViewer(threadId, viewer);
    const input = this.parseOr400(
      z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX) }),
      request.body ?? {},
    );
    try {
      const message = await this.sendMessage({
        body: input.body,
        senderId: viewer.id,
        threadId: thread.id,
      });
      const recipientId =
        viewer.id === thread.studentId ? thread.instructorId : thread.studentId;
      const [recipient] = await db
        .select({ role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, recipientId))
        .limit(1);
      await this.notifyOtherParty({
        body: input.body,
        recipientId,
        recipientRole: recipient?.role ?? 'student',
        senderName: null,
        subject: thread.subject,
        threadId: thread.id,
      });
      return { message: messageDto(message) };
    } catch (error) {
      if (isMissingTableError(error)) missingTable503(error);
      throw error;
    }
  }

  /**
   * Instructor broadcast to course students or batch members. Creates one
   * thread row per recipient (reuses an existing thread when the same
   * instructor already has one for that student+course), posts the message
   * in it, and sends each recipient a best-effort in-app notification.
   */
  async broadcast(request: Request) {
    const instructor = await this.requireInstructor(request);
    const input = this.parseOr400(
      z.object({
        batchId: z.string().uuid().optional(),
        body: z.string().trim().min(1).max(MESSAGE_MAX),
        courseId: z.string().uuid().optional(),
        subject: z.string().trim().min(1).max(SUBJECT_MAX),
      }),
      request.body ?? {},
    );
    const hasCourse = Boolean(input.courseId);
    const hasBatch = Boolean(input.batchId);
    if (hasCourse === hasBatch)
      throw new BadRequestException(
        'Exactly one of courseId or batchId is required.',
      );
    try {
      let courseId: string;
      let recipientIds: string[];
      if (input.courseId) {
        const course = await this.ownedCourse(input.courseId, instructor.id);
        courseId = course.id;
        const rows = await db
          .select({ profileId: enrollments.userId })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.courseId, courseId),
              eq(enrollments.status, 'active'),
            ),
          );
        recipientIds = [...new Set(rows.map((row) => row.profileId))];
      } else {
        const [batch] = await db
          .select({
            courseId: batches.courseId,
            id: batches.id,
            instructorId: batches.instructorId,
          })
          .from(batches)
          .where(eq(batches.id, input.batchId!))
          .limit(1);
        if (!batch) throw new NotFoundException('Batch not found.');
        if (batch.instructorId !== instructor.id)
          throw new ForbiddenException('Access denied.');
        courseId = batch.courseId;
        const rows = await db
          .select({ profileId: batchMembers.userId })
          .from(batchMembers)
          .where(eq(batchMembers.batchId, batch.id));
        recipientIds = [...new Set(rows.map((row) => row.profileId))];
      }
      let threadsCreated = 0;
      let notified = 0;
      for (const studentId of recipientIds) {
        if (studentId === instructor.id) continue;
        const thread = await this.getOrCreateThread({
          courseId,
          instructorId: instructor.id,
          studentId,
          subject: input.subject,
        });
        threadsCreated += 1;
        try {
          await this.sendMessage({
            body: input.body,
            senderId: instructor.id,
            threadId: thread.id,
          });
        } catch (error) {
          // Rate limiting only guards spam; a broadcast should never fail
          // for it — but never let one recipient break the loop.
          console.error('Broadcast message failed.', error);
          continue;
        }
        try {
          await this.notifyOtherParty({
            body: input.body,
            recipientId: studentId,
            recipientRole: 'student',
            senderName: null,
            subject: thread.subject,
            threadId: thread.id,
          });
          notified += 1;
        } catch {
          // notifySafely never throws; defensive only.
        }
      }
      return { notified, threadsCreated };
    } catch (error) {
      if (isMissingTableError(error)) missingTable503(error);
      throw error;
    }
  }
}

function threadDto(thread: typeof messageThreads.$inferSelect) {
  return {
    courseId: thread.courseId,
    createdAt: thread.createdAt.toISOString(),
    id: thread.id,
    instructorId: thread.instructorId,
    lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
    studentId: thread.studentId,
    subject: thread.subject,
  };
}

function messageDto(message: typeof messages.$inferSelect) {
  return {
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    readAt: message.readAt?.toISOString() ?? null,
    senderId: message.senderId,
    threadId: message.threadId,
  };
}
