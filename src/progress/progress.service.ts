import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import type {
  LectureProgressDto,
  LectureProgressMutationResponse,
} from '../types/index.js';
import {
  and,
  courses,
  enrollments,
  eq,
  lectures,
  modules,
  progress,
  sections,
  videoProgress,
  videos,
} from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';

const progressMutationSchema = z.object({
  isCompleted: z.coerce.boolean().optional(),
  positionSeconds: z.coerce.number().int().nonnegative(),
});

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function parseMutation(input: unknown) {
  try {
    return progressMutationSchema.parse(input);
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

function toProgressDto(row: typeof progress.$inferSelect): LectureProgressDto {
  return {
    completedAt: serializeDate(row.completedAt),
    id: row.id,
    isCompleted: row.isCompleted,
    lastWatchedAt: row.lastWatchedAt.toISOString(),
    lectureId: row.lectureId,
    positionSeconds: row.positionSeconds,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProgressService {
  constructor(private readonly authService: AuthService) {}

  private async getProfile(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile || !['admin', 'student'].includes(profile.role)) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }
    return profile;
  }

  async lecture(
    lectureId: string,
    request: Request,
  ): Promise<LectureProgressMutationResponse> {
    const profile = await this.getProfile(request);
    const input = parseMutation(request.body);
    const [lecture] = await db
      .select({
        courseId: courses.id,
        id: lectures.id,
        isPublished: lectures.isPublished,
      })
      .from(lectures)
      .innerJoin(sections, eq(lectures.sectionId, sections.id))
      .innerJoin(courses, eq(sections.courseId, courses.id))
      .where(eq(lectures.id, lectureId))
      .limit(1);
    if (!lecture || !lecture.isPublished) {
      throw new HttpException({ message: 'Lecture not found.' }, 404);
    }
    await this.assertEnrollment(lecture.courseId, profile.id);

    const now = new Date();
    const shouldComplete = input.isCompleted === true;
    // A position of 0 with no completion is not watching (e.g. merely
    // opening a learning page). Do not refresh lastWatchedAt for it, or
    // the streak calculation would count a page view as a learning day.
    // (A brand-new row still gets the column default; analytics ignores
    // zero-position, non-completed rows, so it cannot start a streak.)
    const watched = shouldComplete || input.positionSeconds > 0;
    const [saved] = await db
      .insert(progress)
      .values({
        completedAt: shouldComplete ? now : null,
        isCompleted: shouldComplete,
        lastWatchedAt: now,
        lectureId,
        positionSeconds: input.positionSeconds,
        updatedAt: now,
        userId: profile.id,
      })
      .onConflictDoUpdate({
        set: {
          ...(shouldComplete ? { completedAt: now, isCompleted: true } : {}),
          ...(watched ? { lastWatchedAt: now } : {}),
          positionSeconds: input.positionSeconds,
          updatedAt: now,
        },
        target: [progress.userId, progress.lectureId],
      })
      .returning();
    if (!saved) {
      throw new HttpException({ message: 'Progress could not be saved.' }, 500);
    }
    return { progress: toProgressDto(saved) };
  }

  async video(videoId: string, request: Request) {
    const profile = await this.getProfile(request);
    const input = parseMutation(request.body);
    const [video] = await db
      .select({
        courseId: courses.id,
        id: videos.id,
        isPublished: videos.isPublished,
      })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .innerJoin(courses, eq(sections.courseId, courses.id))
      .where(eq(videos.id, videoId))
      .limit(1);
    if (!video || !video.isPublished) {
      throw new HttpException({ message: 'Video not found.' }, 404);
    }
    await this.assertEnrollment(video.courseId, profile.id);

    const now = new Date();
    const shouldComplete = input.isCompleted === true;
    // Same rule as lectures: a zero-position, non-completed update is not
    // watching, so it must not refresh lastWatchedAt (see above).
    const watched = shouldComplete || input.positionSeconds > 0;
    const [saved] = await db
      .insert(videoProgress)
      .values({
        completedAt: shouldComplete ? now : null,
        isCompleted: shouldComplete,
        lastWatchedAt: now,
        positionSeconds: input.positionSeconds,
        updatedAt: now,
        userId: profile.id,
        videoId,
      })
      .onConflictDoUpdate({
        set: {
          ...(shouldComplete ? { completedAt: now, isCompleted: true } : {}),
          ...(watched ? { lastWatchedAt: now } : {}),
          positionSeconds: input.positionSeconds,
          updatedAt: now,
        },
        target: [videoProgress.userId, videoProgress.videoId],
      })
      .returning();
    if (!saved) {
      throw new HttpException({ message: 'Progress could not be saved.' }, 500);
    }
    return {
      progress: {
        completedAt: serializeDate(saved.completedAt),
        id: saved.id,
        isCompleted: saved.isCompleted,
        lastWatchedAt: saved.lastWatchedAt.toISOString(),
        lectureId: saved.videoId,
        positionSeconds: saved.positionSeconds,
        updatedAt: saved.updatedAt.toISOString(),
      },
    };
  }

  private async assertEnrollment(courseId: string, profileId: string) {
    const [enrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.userId, profileId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    if (!enrollment) {
      throw new HttpException(
        { message: 'Active enrollment is required.' },
        403,
      );
    }
  }
}
