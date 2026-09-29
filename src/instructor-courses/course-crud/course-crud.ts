import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { courses, desc, eq } from '../../database/index.js';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';
import { courseMutationSchema, coursePatchSchema } from '../course-schemas.js';
import { toInstructorCourseDto } from '../course-dtos.js';

@Injectable()
export class CourseCrud {
  constructor(private readonly authService: AuthService) {}

  private async profile(request: Request) {
    const value = await this.authService.getAuthenticatedProfile(request);
    if (!value) throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'instructor'].includes(value.role))
      throw new ForbiddenException('Access denied.');
    return value;
  }

  async list(request: Request) {
    const user = await this.profile(request);
    const rows = await db
      .select()
      .from(courses)
      .where(eq(courses.instructorId, user.id))
      .orderBy(desc(courses.updatedAt));
    return { courses: rows.map(toInstructorCourseDto) };
  }

  async create(request: Request) {
    const user = await this.profile(request);
    const input = courseMutationSchema.parse(request.body);
    const [created] = await db
      .insert(courses)
      .values({
        ...input,
        instructorId: user.id,
        price: String(input.price),
        publishedAt: input.status === 'published' ? new Date() : null,
      })
      .returning();
    if (!created) throw new Error('Course could not be created.');
    return toInstructorCourseDto(created);
  }

  async detail(id: string, request: Request) {
    const user = await this.profile(request);
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    if (!course || course.instructorId !== user.id)
      throw new NotFoundException('Course not found.');
    return toInstructorCourseDto(course);
  }

  async update(id: string, request: Request) {
    const user = await this.profile(request);
    const input = coursePatchSchema.parse(request.body);
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    if (!course || course.instructorId !== user.id)
      throw new NotFoundException('Course not found.');
    const [updated] = await db
      .update(courses)
      .set({
        ...input,
        price: input.price === undefined ? undefined : String(input.price),
      })
      .where(eq(courses.id, id))
      .returning();
    return toInstructorCourseDto(updated!);
  }

  async remove(id: string, request: Request) {
    const user = await this.profile(request);
    const [course] = await db
      .select({ instructorId: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    if (!course || course.instructorId !== user.id)
      throw new NotFoundException('Course not found.');
    await db.delete(courses).where(eq(courses.id, id));
  }
}
