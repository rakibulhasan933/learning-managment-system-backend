import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { alias } from '../../database/index.js';
import {
  and,
  auditLogs,
  categories,
  courses,
  desc,
  eq,
  profiles,
  users,
} from '../../database/index.js';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';

@Injectable()
export class AdminCourses {
  constructor(private readonly authService: AuthService) {}

  private async admin(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin')
      throw new ForbiddenException('Access denied.');
    return profile;
  }

  async listCategories(request: Request) {
    await this.admin(request);
    return {
      categories: await db.select().from(categories).orderBy(categories.name),
    };
  }

  async createCategory(request: Request) {
    const profile = await this.admin(request);
    const input = categorySchema.parse(request.body);
    const [created] = await db.insert(categories).values(input).returning();
    if (!created) throw new Error('Category could not be created.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'category_created',
      entityType: 'category',
      entityId: created.id,
      metadata: { name: created.name },
    });
    return created;
  }

  async updateCategory(id: string, request: Request) {
    const profile = await this.admin(request);
    const input = categorySchema.partial().parse(request.body);
    const [updated] = await db
      .update(categories)
      .set(input)
      .where(eq(categories.id, id))
      .returning();
    if (!updated) throw new NotFoundException('Category not found.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'category_updated',
      entityType: 'category',
      entityId: id,
      metadata: { name: updated.name },
    });
    return updated;
  }

  async deleteCategory(id: string, request: Request) {
    const profile = await this.admin(request);
    const [deleted] = await db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!deleted) throw new NotFoundException('Category not found.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'category_deleted',
      entityType: 'category',
      entityId: id,
      metadata: {},
    });
  }

  async listPending(request: Request) {
    await this.admin(request);
    const instructorProfiles = alias(
      profiles,
      'admin_pending_instructor_profiles',
    );
    const instructorUsers = alias(users, 'admin_pending_instructor_users');
    const rows = await db
      .select({
        category: courses.category,
        currency: courses.currency,
        id: courses.id,
        instructorEmail: instructorUsers.email,
        instructorName: instructorProfiles.fullName,
        price: courses.price,
        slug: courses.slug,
        status: courses.status,
        title: courses.title,
        updatedAt: courses.updatedAt,
      })
      .from(courses)
      .innerJoin(
        instructorProfiles,
        eq(courses.instructorId, instructorProfiles.id),
      )
      .innerJoin(
        instructorUsers,
        eq(instructorProfiles.userId, instructorUsers.id),
      )
      .where(eq(courses.status, 'pending_review'))
      .orderBy(desc(courses.updatedAt));
    return {
      courses: rows.map((row) => ({
        ...row,
        price: row.price,
        submittedAt: row.updatedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async setApproval(
    id: string,
    action: 'approve' | 'reject',
    request: Request,
  ) {
    const profile = await this.admin(request);
    const [updated] = await db
      .update(courses)
      .set({
        publishedAt: action === 'approve' ? new Date() : null,
        status: action === 'approve' ? 'published' : 'archived',
      })
      .where(and(eq(courses.id, id), eq(courses.status, 'pending_review')))
      .returning({ id: courses.id });
    if (!updated) throw new NotFoundException('Pending course not found.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: `course_${action}d`,
      entityType: 'course',
      entityId: id,
      metadata: {},
    });
  }
}

const categorySchema = z.object({
  description: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(140)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
