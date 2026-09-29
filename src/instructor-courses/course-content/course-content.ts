import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  eq,
  lectures,
  modules,
  sections,
  videos,
} from '../../database/index.js';
import { videoProviders } from '../../types/index.js';
import { AuthService } from '../../auth/auth.service.js';
import { db as database } from '../../lib/database.js';
import { z } from 'zod';
import { uploadLectureMaterial } from '../../lib/supabase-storage.js';
import {
  createLectureVideoKey,
  createR2UploadUrl,
  uploadLectureVideoToR2,
} from '../../lib/r2.js';
import { videoPatchSchema } from '../course-schemas.js';

@Injectable()
export class CourseContent {
  constructor(private readonly authService: AuthService) {}
  async createVideo(moduleId: string, request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'instructor'].includes(profile.role))
      throw new ForbiddenException('Access denied.');
    const input = z
      .object({
        title: z.string().trim().min(1),
        description: z.string().nullable().optional(),
        position: z.coerce.number().int().nonnegative(),
        durationSeconds: z.coerce
          .number()
          .int()
          .nonnegative()
          .nullable()
          .optional(),
        videoProvider: z.enum(videoProviders).default('r2'),
        videoRef: z.string().nullable().optional(),
        isPreview: z.coerce.boolean().default(false),
        isPublished: z.coerce.boolean().default(false),
      })
      .parse(request.body);
    const [created] = await database
      .insert(videos)
      .values({ moduleId, ...input })
      .returning();
    return created;
  }

  async updateVideo(videoId: string, request: Request) {
    await this.requireStaff(request);
    const [updated] = await database
      .update(videos)
      .set(videoPatchSchema.parse(request.body))
      .where(eq(videos.id, videoId))
      .returning();
    if (!updated) throw new UnauthorizedException('Video not found.');
    return updated;
  }

  async deleteVideo(videoId: string, request: Request) {
    await this.requireStaff(request);
    const [deleted] = await database
      .delete(videos)
      .where(eq(videos.id, videoId))
      .returning({ id: videos.id });
    if (!deleted) throw new UnauthorizedException('Video not found.');
  }

  async uploadMaterial(courseId: string, videoId: string, request: Request) {
    await this.requireStaff(request);
    const input = z
      .object({
        base64: z.string().min(1),
        contentType: z.string().min(1),
        fileName: z.string().trim().min(1),
        kind: z.enum(['pdf', 'slides']),
      })
      .parse(request.body);
    const url = await uploadLectureMaterial({
      base64: input.base64,
      contentType: input.contentType,
      courseId,
      fileName: input.fileName,
      kind: input.kind,
      lectureId: videoId,
    });
    await database
      .update(videos)
      .set(input.kind === 'pdf' ? { pdfUrl: url } : { slidesUrl: url })
      .where(eq(videos.id, videoId));
    return { url };
  }

  async uploadMaterialBuffer(
    courseId: string,
    videoId: string,
    fileName: string,
    kind: 'pdf' | 'slides',
    request: Request,
  ) {
    await this.requireStaff(request);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      throw new UnauthorizedException('Material file is required.');
    }
    const contentType =
      request.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    const url = await uploadLectureMaterial({
      body: request.body,
      contentType,
      courseId,
      fileName,
      kind,
      lectureId: videoId,
    });
    await database
      .update(videos)
      .set(kind === 'pdf' ? { pdfUrl: url } : { slidesUrl: url })
      .where(eq(videos.id, videoId));
    return { url };
  }

  async uploadModuleMaterial(
    courseId: string,
    moduleId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await this.assertModule(courseId, moduleId, profile.id);
    const input = z
      .object({
        base64: z.string().min(1),
        contentType: z.string().min(1),
        fileName: z.string().trim().min(1),
        kind: z.literal('pdf'),
      })
      .parse(request.body);
    const url = await uploadLectureMaterial({
      base64: input.base64,
      contentType: input.contentType,
      courseId,
      fileName: input.fileName,
      kind: input.kind,
      lectureId: moduleId,
    });
    await database
      .update(modules)
      .set({ pdfUrl: url, slidesUrl: null })
      .where(eq(modules.id, moduleId));
    return { url };
  }

  async uploadModuleMaterialBuffer(
    courseId: string,
    moduleId: string,
    fileName: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await this.assertModule(courseId, moduleId, profile.id);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0)
      throw new UnauthorizedException('Material file is required.');
    const contentType =
      request.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    const url = await uploadLectureMaterial({
      body: request.body,
      contentType,
      courseId,
      fileName,
      kind: 'pdf',
      lectureId: moduleId,
    });
    await database
      .update(modules)
      .set({ pdfUrl: url, slidesUrl: null })
      .where(eq(modules.id, moduleId));
    return { url };
  }

  async deleteModuleMaterial(
    courseId: string,
    moduleId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await this.assertModule(courseId, moduleId, profile.id);
    await database
      .update(modules)
      .set({ pdfUrl: null, slidesUrl: null })
      .where(eq(modules.id, moduleId));
  }

  async createVideoUploadUrl(
    courseId: string,
    videoId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await this.assertVideo(courseId, videoId, profile.id);
    const input = z
      .object({
        contentType: z.literal('video/mp4'),
        fileName: z.string().trim().min(1).max(255),
      })
      .parse(request.body);
    const videoRef = createLectureVideoKey({
      courseId,
      fileName: input.fileName,
      lectureId: videoId,
    });
    return {
      expiresInSeconds: 15 * 60,
      headers: { 'Content-Type': input.contentType },
      uploadUrl: await createR2UploadUrl({
        contentType: input.contentType,
        key: videoRef,
      }),
      videoProvider: 'r2',
      videoRef,
    };
  }

  async uploadVideo(
    courseId: string,
    videoId: string,
    fileName: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await this.assertVideo(courseId, videoId, profile.id);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0)
      throw new UnauthorizedException('Video file is required.');
    const videoRef = createLectureVideoKey({
      courseId,
      fileName,
      lectureId: videoId,
    });
    await uploadLectureVideoToR2({
      body: request.body,
      contentType: 'video/mp4',
      key: videoRef,
    });
    await database
      .update(videos)
      .set({
        isPublished: true,
        title: fileName,
        videoProvider: 'r2',
        videoRef,
      })
      .where(eq(videos.id, videoId));
    return { message: 'Video uploaded and saved.', videoRef };
  }

  async uploadLectureVideo(
    courseId: string,
    lectureId: string,
    fileName: string,
    request: Request,
  ) {
    await this.requireStaff(request);
    await this.assertLecture(courseId, lectureId);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0)
      throw new UnauthorizedException('Video file is required.');
    const videoRef = createLectureVideoKey({ courseId, fileName, lectureId });
    await uploadLectureVideoToR2({
      body: request.body,
      contentType: 'video/mp4',
      key: videoRef,
    });
    const [updated] = await database
      .update(lectures)
      .set({ title: fileName, videoProvider: 'r2', videoRef })
      .where(eq(lectures.id, lectureId))
      .returning();
    if (!updated) throw new UnauthorizedException('Lecture not found.');
    return { message: 'Video uploaded and saved.' };
  }

  async createLectureVideoUploadUrl(
    courseId: string,
    lectureId: string,
    request: Request,
  ) {
    await this.requireStaff(request);
    await this.assertLecture(courseId, lectureId);
    const input = z
      .object({
        contentType: z.literal('video/mp4'),
        fileName: z.string().trim().min(1).max(255),
      })
      .parse(request.body);
    const videoRef = createLectureVideoKey({
      courseId,
      fileName: input.fileName,
      lectureId,
    });
    return {
      expiresInSeconds: 15 * 60,
      headers: { 'Content-Type': input.contentType },
      uploadUrl: await createR2UploadUrl({
        contentType: input.contentType,
        key: videoRef,
      }),
      videoProvider: 'r2',
      videoRef,
    };
  }

  async uploadLectureMaterialBase64(
    courseId: string,
    lectureId: string,
    request: Request,
  ) {
    await this.requireStaff(request);
    await this.assertLecture(courseId, lectureId);
    const input = z
      .object({
        base64: z.string().min(1),
        contentType: z.string().min(1),
        fileName: z.string().trim().min(1),
        kind: z.enum(['pdf', 'slides']),
      })
      .parse(request.body);
    const url = await uploadLectureMaterial({
      base64: input.base64,
      contentType: input.contentType,
      courseId,
      fileName: input.fileName,
      kind: input.kind,
      lectureId,
    });
    const [updated] = await database
      .update(lectures)
      .set(input.kind === 'pdf' ? { pdfUrl: url } : { slidesUrl: url })
      .where(eq(lectures.id, lectureId))
      .returning();
    return { lecture: updated, url };
  }

  async uploadLectureMaterialBuffer(
    courseId: string,
    lectureId: string,
    fileName: string,
    kind: 'pdf' | 'slides',
    request: Request,
  ) {
    await this.requireStaff(request);
    await this.assertLecture(courseId, lectureId);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0)
      throw new UnauthorizedException('Material file is required.');
    const contentType =
      request.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    const url = await uploadLectureMaterial({
      body: request.body,
      contentType,
      courseId,
      fileName,
      kind,
      lectureId,
    });
    await database
      .update(lectures)
      .set(kind === 'pdf' ? { pdfUrl: url } : { slidesUrl: url })
      .where(eq(lectures.id, lectureId));
    return { url };
  }

  private async assertLecture(courseId: string, lectureId: string) {
    const [row] = await database
      .select({ id: lectures.id })
      .from(lectures)
      .innerJoin(sections, eq(lectures.sectionId, sections.id))
      .where(and(eq(lectures.id, lectureId), eq(sections.courseId, courseId)))
      .limit(1);
    if (!row) throw new UnauthorizedException('Lecture not found.');
  }

  private async assertModule(
    courseId: string,
    moduleId: string,
    instructorId: string,
  ) {
    const [row] = await database
      .select({ id: modules.id })
      .from(modules)
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(and(eq(modules.id, moduleId), eq(sections.courseId, courseId)))
      .limit(1);
    if (!row) throw new UnauthorizedException('Module not found.');
    return row;
  }

  private async assertVideo(
    courseId: string,
    videoId: string,
    instructorId: string,
  ) {
    const [row] = await database
      .select({ id: videos.id })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(and(eq(videos.id, videoId), eq(sections.courseId, courseId)))
      .limit(1);
    if (!row) throw new UnauthorizedException('Video not found.');
    return row;
  }

  private async requireStaff(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'instructor'].includes(profile.role))
      throw new ForbiddenException('Access denied.');
    return profile;
  }
}
