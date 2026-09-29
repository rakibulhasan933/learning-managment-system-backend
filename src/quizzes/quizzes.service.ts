import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import { courses, eq, quizzes } from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createNotification } from '../lib/notifications.js';
import {
  getStudentQuizByTarget,
  getStudentQuizDto,
  submitQuizAttempt,
} from '../lib/quizzes.js';

const targetQuerySchema = z
  .object({
    lectureId: z.string().uuid().optional(),
    moduleId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
  })
  .refine(
    (input) =>
      [input.lectureId, input.moduleId, input.sectionId].filter(Boolean)
        .length === 1,
    { message: 'Provide exactly one quiz target.' },
  );
const quizIdSchema = z.string().uuid();
const submitQuizSchema = z.object({
  answers: z.record(z.string().uuid(), z.array(z.string().uuid())),
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
export class QuizzesService {
  constructor(private readonly authService: AuthService) {}

  private async getProfile(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile || !['admin', 'student'].includes(profile.role)) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }
    return profile;
  }

  async target(queryInput: unknown, request: Request) {
    const profile = await this.getProfile(request);
    const query = parseOrBadRequest(targetQuerySchema, queryInput);
    return getStudentQuizByTarget({
      lectureId: query.lectureId,
      moduleId: query.moduleId,
      profileId: profile.id,
      sectionId: query.sectionId,
    });
  }

  async detail(quizIdInput: string, request: Request) {
    const profile = await this.getProfile(request);
    const quizId = parseOrBadRequest(quizIdSchema, quizIdInput);
    return getStudentQuizDto(quizId, profile.id);
  }

  async submit(quizIdInput: string, request: Request) {
    const profile = await this.getProfile(request);
    const quizId = parseOrBadRequest(quizIdSchema, quizIdInput);
    const input = parseOrBadRequest(submitQuizSchema, request.body);
    const result = await submitQuizAttempt({
      answers: input.answers,
      profileId: profile.id,
      quizId,
    });

    const [quiz] = await db
      .select({ courseId: quizzes.courseId, title: quizzes.title })
      .from(quizzes)
      .where(eq(quizzes.id, quizId))
      .limit(1);
    if (quiz) {
      const [course] = await db
        .select({ instructorId: courses.instructorId, title: courses.title })
        .from(courses)
        .where(eq(courses.id, quiz.courseId))
        .limit(1);
      if (course && course.instructorId !== profile.id) {
        await createNotification({
          body: `A student submitted ${quiz.title}.`,
          href: '/dashboard/instructor/quiz-results',
          profileId: course.instructorId,
          title: `New quiz result in ${course.title}`,
          type: 'quiz_submission',
        });
      }
    }

    return result;
  }
}
