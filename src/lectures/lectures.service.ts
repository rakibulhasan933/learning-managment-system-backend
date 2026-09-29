import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import type { LectureVideoUrlResponse } from '../types/index.js';
import {
  and,
  courses,
  enrollments,
  eq,
  lectures,
  modules,
  sections,
  videos,
} from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createR2PlaybackUrl } from '../lib/r2.js';

const idSchema = z.string().uuid();

function parseId(value: string) {
  try {
    return idSchema.parse(value);
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
export class LecturesService {
  constructor(private readonly authService: AuthService) {}

  private async getOptionalProfileId(request: Request) {
    return (
      (await this.authService.getAuthenticatedProfile(request))?.id ?? null
    );
  }

  private async assertAccess(
    courseId: string,
    courseStatus: string,
    isPreview: boolean,
    profileId: string | null,
  ) {
    if (isPreview && courseStatus === 'published') return;
    if (!profileId) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }
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

  async lectureVideo(
    idInput: string,
    request: Request,
  ): Promise<LectureVideoUrlResponse> {
    const id = parseId(idInput);
    const [lecture] = await db
      .select({
        courseId: courses.id,
        courseStatus: courses.status,
        isPreview: lectures.isPreview,
        isPublished: lectures.isPublished,
        videoProvider: lectures.videoProvider,
        videoRef: lectures.videoRef,
      })
      .from(lectures)
      .innerJoin(sections, eq(lectures.sectionId, sections.id))
      .innerJoin(courses, eq(sections.courseId, courses.id))
      .where(eq(lectures.id, id))
      .limit(1);
    if (!lecture || !lecture.isPublished) {
      throw new HttpException({ message: 'Lecture not found.' }, 404);
    }
    await this.assertAccess(
      lecture.courseId,
      lecture.courseStatus,
      lecture.isPreview,
      await this.getOptionalProfileId(request),
    );
    if (!lecture.videoRef) {
      throw new HttpException(
        { message: 'Lecture video is not available.' },
        404,
      );
    }
    if (lecture.videoProvider !== 'r2') {
      throw new HttpException(
        { message: 'Video provider is not supported yet.' },
        501,
      );
    }
    return {
      expiresInSeconds: 20 * 60,
      provider: lecture.videoProvider,
      url: await createR2PlaybackUrl(lecture.videoRef),
    };
  }

  async video(
    idInput: string,
    request: Request,
  ): Promise<LectureVideoUrlResponse> {
    const id = parseId(idInput);
    const [video] = await db
      .select({
        courseId: courses.id,
        courseStatus: courses.status,
        isPreview: videos.isPreview,
        isPublished: videos.isPublished,
        videoProvider: videos.videoProvider,
        videoRef: videos.videoRef,
      })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .innerJoin(courses, eq(sections.courseId, courses.id))
      .where(eq(videos.id, id))
      .limit(1);
    if (!video || !video.isPublished) {
      throw new HttpException({ message: 'Video not found.' }, 404);
    }
    await this.assertAccess(
      video.courseId,
      video.courseStatus,
      video.isPreview,
      await this.getOptionalProfileId(request),
    );
    if (!video.videoRef) {
      throw new HttpException({ message: 'Video is not available.' }, 404);
    }
    if (video.videoProvider !== 'r2') {
      throw new HttpException(
        { message: 'Video provider is not supported yet.' },
        501,
      );
    }
    return {
      expiresInSeconds: 20 * 60,
      provider: video.videoProvider,
      url: await createR2PlaybackUrl(video.videoRef),
    };
  }
}
