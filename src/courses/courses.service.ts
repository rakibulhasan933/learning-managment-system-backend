import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import type {
  CourseDetailDto,
  CourseEnrollmentStatusResponse,
  CourseListResponse,
  CourseSummaryDto,
} from '../types/index.js';
import { courseLevels } from '../types/index.js';
import {
  and,
  asc,
  count,
  courseReviews,
  courses,
  desc,
  enrollments,
  eq,
  ilike,
  modules,
  or,
  orders,
  profiles,
  sections,
  sql,
  videos,
} from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { isMissingTableError } from '../sales/sales-helpers.js';

const courseListQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
  level: z.enum(courseLevels).optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(12),
  q: z.string().trim().min(1).optional(),
});

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toCourseSummary(row: {
  category: string | null;
  currency: string;
  enrollmentEnabled: boolean;
  enrollmentEndsAt: Date | null;
  id: string;
  instructorName: string | null;
  level: CourseSummaryDto['level'];
  price: string;
  publishedAt: Date | null;
  shortDescription: string | null;
  slug: string;
  thumbnailUrl: string | null;
  title: string;
}): CourseSummaryDto {
  return {
    category: row.category,
    currency: row.currency,
    enrollmentEnabled: row.enrollmentEnabled,
    enrollmentEndsAt: serializeDate(row.enrollmentEndsAt),
    id: row.id,
    instructorName: row.instructorName,
    level: row.level,
    price: row.price,
    publishedAt: serializeDate(row.publishedAt),
    shortDescription: row.shortDescription,
    slug: row.slug,
    thumbnailUrl: row.thumbnailUrl,
    title: row.title,
  };
}

function parseQuery(query: unknown) {
  try {
    return courseListQuerySchema.parse(query);
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
export class CoursesService {
    private readonly logger = new Logger(CoursesService.name);

  constructor(private readonly authService: AuthService) {}

  async list(queryInput: unknown): Promise<CourseListResponse> {
    const query = parseQuery(queryInput);
    const filters = [eq(courses.status, 'published')];

    if (query.q) {
      filters.push(
        or(
          ilike(courses.title, `%${query.q}%`),
          ilike(courses.shortDescription, `%${query.q}%`),
          ilike(courses.category, `%${query.q}%`),
        )!,
      );
    }
    if (query.category) filters.push(eq(courses.category, query.category));
    if (query.level) filters.push(eq(courses.level, query.level));
    if (query.maxPrice !== undefined) {
      filters.push(sql`${courses.price} <= ${query.maxPrice}`);
    }

    const where = and(...filters);
    const offset = (query.page - 1) * query.pageSize;
    const [totalRow] = await db
      .select({ total: count() })
      .from(courses)
      .where(where);
    const rows = await db
      .select({
        category: courses.category,
        currency: courses.currency,
        enrollmentEnabled: courses.enrollmentEnabled,
        enrollmentEndsAt: courses.enrollmentEndsAt,
        id: courses.id,
        instructorName: profiles.fullName,
        level: courses.level,
        price: courses.price,
        publishedAt: courses.publishedAt,
        shortDescription: courses.shortDescription,
        slug: courses.slug,
        thumbnailUrl: courses.thumbnailUrl,
        title: courses.title,
      })
      .from(courses)
      .innerJoin(profiles, eq(courses.instructorId, profiles.id))
      .where(where)
      .orderBy(desc(courses.publishedAt), desc(courses.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    const total = totalRow?.total ?? 0;
    return {
      courses: rows.map(toCourseSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async enrollmentStatus(
    slug: string,
    request: Request,
  ): Promise<CourseEnrollmentStatusResponse> {
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.slug, slug), eq(courses.status, 'published')))
      .limit(1);
    if (!course) throw new HttpException({ message: 'Course not found.' }, 404);

    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) {
      return {
        courseId: course.id,
        enrollmentStatus: null,
        isAuthenticated: false,
        isEnrolled: false,
        latestOrder: null,
      };
    }

    const [enrollment] = await db
      .select({ status: enrollments.status })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, course.id),
          eq(enrollments.userId, profile.id),
        ),
      )
      .orderBy(desc(enrollments.enrolledAt))
      .limit(1);
    const orderRows = await db
      .select({
        id: orders.id,
        rejectionReason: orders.rejectionReason,
        status: orders.status,
      })
      .from(orders)
      .where(and(eq(orders.courseId, course.id), eq(orders.userId, profile.id)))
      .orderBy(desc(orders.createdAt));
    const latestOrder =
      orderRows.find((order) => order.status === 'pending_verification') ??
      orderRows.find((order) => order.status === 'rejected') ??
      orderRows[0] ??
      null;

    return {
      courseId: course.id,
      enrollmentStatus: enrollment?.status ?? null,
      isAuthenticated: true,
      isEnrolled: enrollment?.status === 'active',
      latestOrder,
    };
  }

  async detail(slug: string): Promise<CourseDetailDto> {
    const [course] = await db
      .select({
        category: courses.category,
        currency: courses.currency,
        description: courses.description,
        enrollmentEnabled: courses.enrollmentEnabled,
        enrollmentEndsAt: courses.enrollmentEndsAt,
        id: courses.id,
        instructorName: profiles.fullName,
        level: courses.level,
        price: courses.price,
        publishedAt: courses.publishedAt,
        shortDescription: courses.shortDescription,
        slug: courses.slug,
        thumbnailUrl: courses.thumbnailUrl,
        title: courses.title,
      })
      .from(courses)
      .innerJoin(profiles, eq(courses.instructorId, profiles.id))
      .where(and(eq(courses.slug, slug), eq(courses.status, 'published')))
      .limit(1);
    if (!course) throw new HttpException({ message: 'Course not found.' }, 404);

    const sectionRows = await db
      .select({
        id: sections.id,
        position: sections.position,
        title: sections.title,
      })
      .from(sections)
      .where(eq(sections.courseId, course.id))
      .orderBy(asc(sections.position));
    const lectureRows = await db
      .select({
        durationSeconds: videos.durationSeconds,
        id: videos.id,
        isPreview: videos.isPreview,
        position: videos.position,
        moduleId: videos.moduleId,
        milestoneId: modules.milestoneId,
        title: videos.title,
      })
      .from(videos)
      .innerJoin(modules, eq(videos.moduleId, modules.id))
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(
        and(eq(sections.courseId, course.id), eq(videos.isPublished, true)),
      )
      .orderBy(
        asc(sections.position),
        asc(modules.position),
        asc(videos.position),
      );
    const moduleRows = await db
      .select({
        contentTypes: modules.contentTypes,
        durationSeconds: sql<number>`coalesce(sum(${videos.durationSeconds}), 0)`,
        id: modules.id,
        milestoneId: modules.milestoneId,
        position: modules.position,
        title: modules.title,
        videoCount: count(videos.id),
      })
      .from(modules)
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .leftJoin(
        videos,
        and(eq(videos.moduleId, modules.id), eq(videos.isPublished, true)),
      )
      .where(eq(sections.courseId, course.id))
      .groupBy(modules.id)
      .orderBy(asc(modules.position));

    return {
      ...toCourseSummary(course),
      ...await this.courseReviewStats(course.id),
      description: course.description,
      sections: sectionRows.map((section) => ({
        id: section.id,
        lectures: lectureRows
          .filter((lecture) => section.id === lecture.milestoneId)
          .map((lecture) => ({
            durationSeconds: lecture.durationSeconds,
            id: lecture.id,
            isPreview: lecture.isPreview,
            position: lecture.position,
            title: lecture.title,
          })),
        modules: moduleRows
          .filter((module) => module.milestoneId === section.id)
          .map((module) => ({
            contentTypes: Array.from(new Set(module.contentTypes)) as Array<
              'video' | 'pdf' | 'quiz' | 'assignment'
            >,
            durationSeconds: Number(module.durationSeconds ?? 0),
            id: module.id,
            position: module.position,
            title: module.title,
            videoCount: Number(module.videoCount),
          })),
        position: section.position,
        title: section.title,
      })),
    };
  }

  /**
   * Visible-review aggregate for the public course detail. Graceful when
   * the reviews migration has not been applied yet: null/0 instead of
   * 503 so the course page never breaks.
   */
  private async courseReviewStats(
    courseId: string,
  ): Promise<{ averageRating: number | null; reviewCount: number }> {
    try {
      const rows = await db
        .select({ rating: courseReviews.rating })
        .from(courseReviews)
        .where(
          and(
            eq(courseReviews.courseId, courseId),
            eq(courseReviews.isHidden, false),
          ),
        );
      if (!rows.length) return { averageRating: null, reviewCount: 0 };
      const sum = rows.reduce((total, row) => total + row.rating, 0);
      return {
        averageRating: Math.round((sum / rows.length) * 10) / 10,
        reviewCount: rows.length,
      };
      } catch (error) {
        // Missing table is the expected pre-migration state; anything else
        // is unexpected but must still not break the course page.
        if (!isMissingTableError(error)) {
          this.logger.warn(
            `courseReviewStats failed for course ${courseId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return { averageRating: null, reviewCount: 0 };
    }
  }
}
