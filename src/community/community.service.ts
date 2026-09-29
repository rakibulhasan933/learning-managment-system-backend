import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import type { DiscussionListResponse } from '../types/index.js';
import {
  and,
  courses,
  desc,
  discussionPosts,
  enrollments,
  eq,
  profiles,
} from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createNotification } from '../lib/notifications.js';

const courseIdSchema = z.string().uuid();
const postSchema = z.object({
  body: z.string().trim().min(2).max(5000),
  lectureId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown): T {
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

@Injectable()
export class CommunityService {
  constructor(private readonly authService: AuthService) {}

  private async access(courseId: string, request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    if (profile.role === 'admin') return profile;
    const [course] = await db
      .select({ instructorId: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    const [enrollment] = await db
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
    if (course?.instructorId !== profile.id && !enrollment) {
      throw new HttpException(
        { message: 'Active enrollment is required.' },
        403,
      );
    }
    return profile;
  }

  async list(
    courseIdInput: string,
    request: Request,
  ): Promise<DiscussionListResponse> {
    const courseId = parseOrBadRequest(courseIdSchema, courseIdInput);
    await this.access(courseId, request);
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
      .where(eq(discussionPosts.courseId, courseId))
      .orderBy(desc(discussionPosts.createdAt));
    return {
      posts: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(courseIdInput: string, request: Request) {
    const courseId = parseOrBadRequest(courseIdSchema, courseIdInput);
    const profile = await this.access(courseId, request);
    const input = parseOrBadRequest(postSchema, request.body);
    const [post] = await db
      .insert(discussionPosts)
      .values({
        authorId: profile.id,
        body: input.body,
        courseId,
        lectureId: input.lectureId ?? null,
        parentId: input.parentId ?? null,
      })
      .returning({ id: discussionPosts.id });
    const [course] = await db
      .select({ instructorId: courses.instructorId, title: courses.title })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (course && course.instructorId !== profile.id) {
      await createNotification({
        body: input.body,
        href: '/dashboard/instructor/discussions',
        profileId: course.instructorId,
        title: `New question in ${course.title}`,
        type: 'discussion_question',
      });
    }
    if (input.parentId) {
      const [parent] = await db
        .select({ authorId: discussionPosts.authorId })
        .from(discussionPosts)
        .where(eq(discussionPosts.id, input.parentId))
        .limit(1);
      if (parent && parent.authorId !== profile.id) {
        await createNotification({
          body: input.body,
          href: `/learn/${courseId}`,
          profileId: parent.authorId,
          title: `New reply in ${course?.title ?? 'your course discussion'}`,
          type: 'discussion_reply',
        });
      }
    }
    return { id: post!.id };
  }
}
