import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { LearningCourseResponse } from '../types/index.js';
import {
  and,
  asc,
  courses,
  enrollments,
  eq,
  inArray,
  modules,
  sections,
  videoProgress,
  videos,
} from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { getStudentAssignmentsForCourse } from '../lib/assignments.js';
import { getStudentQuizzesForCourse } from '../lib/quizzes.js';

const courseParamsSchema = z.object({
  courseId: z.string().uuid(),
});

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

@Injectable()
export class LearningService {
  constructor(private readonly authService: AuthService) {}

  async course(
    courseId: string,
    request: Request,
  ): Promise<LearningCourseResponse> {
    const params = courseParamsSchema.parse({ courseId });
    const profile = await this.authService.getAuthenticatedProfile(request);

    if (!profile) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }

    const [enrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, params.courseId),
          eq(enrollments.userId, profile.id),
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

    const [course] = await db
      .select({ id: courses.id, slug: courses.slug, title: courses.title })
      .from(courses)
      .where(eq(courses.id, params.courseId))
      .limit(1);
    if (!course) {
      throw new HttpException({ message: 'Course not found.' }, 404);
    }

    const sectionRows = await db
      .select({
        id: sections.id,
        position: sections.position,
        title: sections.title,
      })
      .from(sections)
      .where(eq(sections.courseId, params.courseId))
      .orderBy(asc(sections.position));
    const moduleRows = await db
      .select({
        contentTypes: modules.contentTypes,
        id: modules.id,
        milestoneId: modules.milestoneId,
        pdfUrl: modules.pdfUrl,
        position: modules.position,
        slidesUrl: modules.slidesUrl,
        title: modules.title,
      })
      .from(modules)
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(eq(sections.courseId, params.courseId))
      .orderBy(asc(sections.position), asc(modules.position));
    const videoRows = await db
      .select({
        availableAt: videos.availableAt,
        description: videos.description,
        durationSeconds: videos.durationSeconds,
        id: videos.id,
        isPreview: videos.isPreview,
        pdfUrl: videos.pdfUrl,
        position: videos.position,
        moduleId: videos.moduleId,
        slidesUrl: videos.slidesUrl,
        title: videos.title,
      })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(
        and(
          eq(sections.courseId, params.courseId),
          eq(videos.isPublished, true),
        ),
      )
      .orderBy(
        asc(sections.position),
        asc(modules.position),
        asc(videos.position),
      );
    const videoIds = videoRows.map((video) => video.id);
    const progressRows =
      videoIds.length === 0
        ? []
        : await db
            .select()
            .from(videoProgress)
            .where(
              and(
                eq(videoProgress.userId, profile.id),
                inArray(videoProgress.videoId, videoIds),
              ),
            );
    const progressDtos = progressRows.map((row) => ({
      completedAt: serializeDate(row.completedAt),
      id: row.id,
      isCompleted: row.isCompleted,
      lastWatchedAt: row.lastWatchedAt.toISOString(),
      lectureId: row.videoId,
      positionSeconds: row.positionSeconds,
      updatedAt: row.updatedAt.toISOString(),
    }));
    const completedLectureCount = videoRows.filter((video) =>
      progressRows.some((row) => row.videoId === video.id && row.isCompleted),
    ).length;
    const totalLectureCount = videoRows.length;
    const quizDtos = await getStudentQuizzesForCourse(
      params.courseId,
      profile.id,
    );
    const assignmentDtos = await getStudentAssignmentsForCourse(
      params.courseId,
      profile.id,
    );

    return {
      course: {
        ...course,
        completedLectureCount,
        completionPercentage:
          totalLectureCount === 0
            ? 0
            : Math.round((completedLectureCount / totalLectureCount) * 100),
        totalLectureCount,
      },
      learner: { email: profile.email },
      sections: sectionRows.map((section) => {
        const sectionLectures = videoRows
          .filter((video) =>
            moduleRows.some(
              (module) =>
                module.id === video.moduleId &&
                module.milestoneId === section.id,
            ),
          )
          .map((video) => {
            const module = moduleRows.find(
              (item) => item.id === video.moduleId,
            );
            const moduleVideos = videoRows.filter(
              (item) => item.moduleId === video.moduleId,
            );
            return {
              availableAt: serializeDate(video.availableAt),
              assignment:
                moduleVideos[0]?.id === video.id
                  ? (assignmentDtos.find(
                      (assignment) => assignment.moduleId === video.moduleId,
                    ) ?? null)
                  : null,
              durationSeconds: video.durationSeconds,
              description: video.description,
              id: video.id,
              isPreview: video.isPreview,
              pdfUrl: video.pdfUrl,
              position: video.position,
              progress:
                progressDtos.find((item) => item.lectureId === video.id) ??
                null,
              quiz:
                moduleVideos[0]?.id === video.id
                  ? (quizDtos.find(
                      (quiz) => quiz.moduleId === video.moduleId,
                    ) ?? null)
                  : null,
              sectionId: module?.milestoneId ?? section.id,
              moduleId: video.moduleId,
              moduleTitle: module?.title ?? 'Module',
              modulePdfUrl: module?.pdfUrl ?? null,
              moduleSlidesUrl: module?.slidesUrl ?? null,
              slidesUrl: video.slidesUrl,
              title: video.title,
            };
          });
        return {
          id: section.id,
          lectures: sectionLectures,
          modules: moduleRows
            .filter((module) => module.milestoneId === section.id)
            .map((module) => ({
              assignment:
                assignmentDtos.find(
                  (assignment) => assignment.moduleId === module.id,
                ) ?? null,
              contentTypes: module.contentTypes as Array<
                'video' | 'pdf' | 'quiz' | 'assignment'
              >,
              id: module.id,
              pdfUrl: module.pdfUrl,
              position: module.position,
              quiz:
                quizDtos.find((quiz) => quiz.moduleId === module.id) ?? null,
              slidesUrl: module.slidesUrl,
              title: module.title,
              videos: sectionLectures.filter(
                (lecture) => lecture.moduleId === module.id,
              ),
            })),
          position: section.position,
          assignment:
            assignmentDtos.find(
              (assignment) => assignment.sectionId === section.id,
            ) ?? null,
          quiz: quizDtos.find((quiz) => quiz.sectionId === section.id) ?? null,
          title: section.title,
        };
      }),
    };
  }
}
