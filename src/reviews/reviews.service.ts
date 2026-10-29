import {
  BadRequestException,
  ConflictException,
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
  courseReviews,
  courses,
  desc,
  enrollments,
  eq,
  profiles,
  reviewReplies,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { isMissingTableError, missingTable503 } from '../sales/sales-helpers.js';

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
const reviewBodySchema = z.object({
  body: z.string().trim().max(2000).optional(),
  rating: z.number().int().min(1).max(5),
});
const reviewPatchSchema = z.object({
  body: z.string().trim().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});
const replySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
const visibilitySchema = z.object({ hidden: z.boolean() });

const serializeDate = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

@Injectable()
export class ReviewsService {
  constructor(private readonly authService: AuthService) {}

  // ---------------- public ----------------

  /**
   * Public review list for a course page / sales page. Graceful when the
   * migration has not been applied yet: returns an empty aggregate
   * instead of 503 so the sales page never breaks.
   */
  async listPublic(courseId: string) {
    const id = parseOr400(uuid, courseId);
    try {
      const reviewRows = await db
        .select({
          body: courseReviews.body,
          createdAt: courseReviews.createdAt,
          id: courseReviews.id,
          rating: courseReviews.rating,
          reviewerName: profiles.fullName,
        })
        .from(courseReviews)
        .leftJoin(profiles, eq(courseReviews.studentId, profiles.id))
        .where(
          and(eq(courseReviews.courseId, id), eq(courseReviews.isHidden, false)),
        )
        .orderBy(desc(courseReviews.createdAt));
      const reviews = await Promise.all(
        reviewRows.map(async (row) => ({
          body: row.body,
          createdAt: serializeDate(row.createdAt),
          id: row.id,
          rating: row.rating,
          replies: await this.repliesForReview(row.id),
          reviewerName: row.reviewerName ?? 'একজন শিক্ষার্থী',
        })),
      );
      const averageRating = reviews.length
        ? Math.round(
            (reviews.reduce((sum, row) => sum + row.rating, 0) / reviews.length) *
              10,
          ) / 10
        : null;
      return { averageRating, reviewCount: reviews.length, reviews };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { averageRating: null, reviewCount: 0, reviews: [] };
      }
      throw error;
    }
  }

  // ---------------- student ----------------

  async getMine(courseId: string, request: Request) {
    const profile = await this.requireRole(request, ['student']);
    const id = parseOr400(uuid, courseId);
    const canReview = await this.hasActiveEnrolment(profile.id, id);
    try {
      const [row] = await db
        .select({
          body: courseReviews.body,
          createdAt: courseReviews.createdAt,
          id: courseReviews.id,
          rating: courseReviews.rating,
          reviewerName: profiles.fullName,
        })
        .from(courseReviews)
        .leftJoin(profiles, eq(courseReviews.studentId, profiles.id))
        .where(
          and(
            eq(courseReviews.courseId, id),
            eq(courseReviews.studentId, profile.id),
          ),
        )
        .limit(1);
      if (!row) return { canReview, review: null };
      return {
        canReview,
        review: {
          body: row.body,
          createdAt: serializeDate(row.createdAt),
          id: row.id,
          rating: row.rating,
          replies: await this.repliesForReview(row.id),
          reviewerName: row.reviewerName ?? 'একজন শিক্ষার্থী',
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createReview(courseId: string, request: Request) {
    const profile = await this.requireRole(request, ['student']);
    const id = parseOr400(uuid, courseId);
    const input = parseOr400(reviewBodySchema, request.body ?? {});
    if (!(await this.hasActiveEnrolment(profile.id, id))) {
      throw new BadRequestException(
        'A paid enrolment is required to review this course.',
      );
    }
    try {
      const [existing] = await db
        .select({ id: courseReviews.id })
        .from(courseReviews)
        .where(
          and(
            eq(courseReviews.courseId, id),
            eq(courseReviews.studentId, profile.id),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ConflictException(
          'You have already reviewed this course.',
        );
      }
      const [created] = await db
        .insert(courseReviews)
        .values({
          body: input.body?.trim() ? input.body.trim() : null,
          courseId: id,
          rating: input.rating,
          studentId: profile.id,
        })
        .returning();
      if (!created) throw new Error('Review could not be created.');
      return {
        review: {
          body: created.body,
          createdAt: serializeDate(created.createdAt),
          id: created.id,
          rating: created.rating,
          replies: [],
          reviewerName: 'একজন শিক্ষার্থী',
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async updateReview(courseId: string, request: Request) {
    const profile = await this.requireRole(request, ['student']);
    const id = parseOr400(uuid, courseId);
    const input = parseOr400(reviewPatchSchema, request.body ?? {});
    if (input.rating === undefined && input.body === undefined) {
      throw new BadRequestException('Nothing to update.');
    }
    try {
      const [existing] = await db
        .select()
        .from(courseReviews)
        .where(
          and(
            eq(courseReviews.courseId, id),
            eq(courseReviews.studentId, profile.id),
          ),
        )
        .limit(1);
      if (!existing) throw new NotFoundException('Review not found.');
      const values: { body?: string | null; rating?: number } = {};
      if (input.rating !== undefined) values.rating = input.rating;
      if (input.body !== undefined) {
        values.body = input.body.trim() ? input.body.trim() : null;
      }
      const [updated] = await db
        .update(courseReviews)
        .set(values)
        .where(eq(courseReviews.id, existing.id))
        .returning();
      if (!updated) throw new NotFoundException('Review not found.');
      return {
        review: {
          body: updated.body,
          createdAt: serializeDate(updated.createdAt),
          id: updated.id,
          rating: updated.rating,
          replies: await this.repliesForReview(updated.id),
          reviewerName: 'একজন শিক্ষার্থী',
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- staff ----------------

  async replyToReview(reviewId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const id = parseOr400(uuid, reviewId);
    const input = parseOr400(replySchema, request.body ?? {});
    try {
      const [review] = await db
        .select({ courseId: courseReviews.courseId })
        .from(courseReviews)
        .where(eq(courseReviews.id, id))
        .limit(1);
      if (!review) throw new NotFoundException('Review not found.');
      if (profile.role === 'instructor') {
        const [course] = await db
          .select({ instructorId: courses.instructorId })
          .from(courses)
          .where(eq(courses.id, review.courseId))
          .limit(1);
        if (!course || course.instructorId !== profile.id) {
          throw new ForbiddenException('Access denied.');
        }
      }
      const [created] = await db
        .insert(reviewReplies)
        .values({ authorId: profile.id, body: input.body, reviewId: id })
        .returning();
      if (!created) throw new Error('Reply could not be created.');
      return {
        reply: {
          authorName:
            profile.fullName ??
            (profile.role === 'admin' ? 'অ্যাডমিন' : 'শিক্ষক'),
          authorRole: profile.role,
          body: created.body,
          createdAt: serializeDate(created.createdAt),
          id: created.id,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async setVisibility(reviewId: string, request: Request) {
    await this.requireRole(request, ['admin']);
    const id = parseOr400(uuid, reviewId);
    const input = parseOr400(visibilitySchema, request.body ?? {});
    try {
      const [updated] = await db
        .update(courseReviews)
        .set({ isHidden: input.hidden })
        .where(eq(courseReviews.id, id))
        .returning();
      if (!updated) throw new NotFoundException('Review not found.');
      return {
        review: {
          body: updated.body,
          createdAt: serializeDate(updated.createdAt),
          id: updated.id,
          isHidden: updated.isHidden,
          rating: updated.rating,
          replies: await this.repliesForReview(updated.id),
          reviewerName: 'একজন শিক্ষার্থী',
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- helpers ----------------

  private async repliesForReview(reviewId: string) {
    const rows = await db
      .select({
        authorName: profiles.fullName,
        authorRole: profiles.role,
        body: reviewReplies.body,
        createdAt: reviewReplies.createdAt,
        id: reviewReplies.id,
      })
      .from(reviewReplies)
      .leftJoin(profiles, eq(reviewReplies.authorId, profiles.id))
      .where(eq(reviewReplies.reviewId, reviewId))
      .orderBy(reviewReplies.createdAt);
    return rows.map((row) => ({
      authorName:
        row.authorName ??
        (row.authorRole === 'admin' ? 'অ্যাডমিন' : 'শিক্ষক'),
      authorRole: row.authorRole,
      body: row.body,
      createdAt: serializeDate(row.createdAt),
      id: row.id,
    }));
  }

  private async hasActiveEnrolment(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, courseId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  private async requireRole(
    request: Request,
    roles: string[],
  ): Promise<{ fullName: string | null; id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) {
      throw new UnauthorizedException('Authentication is required.');
    }
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }
}
