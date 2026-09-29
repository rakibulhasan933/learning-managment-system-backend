import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import { assignments, courses, eq } from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createNotification } from '../lib/notifications.js';
import { submitAssignment } from '../lib/assignments.js';

const assignmentIdSchema = z.string().uuid();
const assignmentSubmissionSchema = z.object({
  submissionText: z.string().trim().min(1).max(20_000),
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
export class AssignmentsService {
  constructor(private readonly authService: AuthService) {}

  async submit(assignmentIdInput: string, request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile || !['admin', 'student'].includes(profile.role)) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }
    const assignmentId = parseOrBadRequest(
      assignmentIdSchema,
      assignmentIdInput,
    );
    const input = parseOrBadRequest(assignmentSubmissionSchema, request.body);
    const submission = await submitAssignment({
      assignmentId,
      profileId: profile.id,
      submissionText: input.submissionText,
    });
    const [assignment] = await db
      .select({ courseId: assignments.courseId, title: assignments.title })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    if (assignment) {
      const [course] = await db
        .select({ instructorId: courses.instructorId, title: courses.title })
        .from(courses)
        .where(eq(courses.id, assignment.courseId))
        .limit(1);
      if (course && course.instructorId !== profile.id) {
        await createNotification({
          body: `A student submitted ${assignment.title}.`,
          href: `/dashboard/instructor/courses/${assignment.courseId}/edit`,
          profileId: course.instructorId,
          title: `New assignment submission in ${course.title}`,
          type: 'assignment_submission',
        });
      }
    }

    return submission;
  }
}
