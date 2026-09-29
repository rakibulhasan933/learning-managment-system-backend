import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { asc, eq, modules, sections, sql } from '../../database/index.js';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';

@Injectable()
export class CourseOutline {
  constructor(private readonly authService: AuthService) {}

  async milestones(courseId: string, request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'instructor'].includes(profile.role))
      throw new ForbiddenException('Access denied.');
    const rows = await db
      .select({
        id: sections.id,
        title: sections.title,
        description: sections.description,
        position: sections.position,
      })
      .from(sections)
      .where(eq(sections.courseId, courseId))
      .orderBy(asc(sections.position));
    return {
      milestones: await Promise.all(
        rows.map(async (milestone) => ({
          ...milestone,
          modules: await db
            .select()
            .from(modules)
            .where(eq(modules.milestoneId, milestone.id))
            .orderBy(asc(modules.position)),
        })),
      ),
    };
  }

  async createModule(milestoneId: string, request: Request) {
    await this.requireStaff(request);
    const input = z
      .object({
        title: z.string().trim().min(1),
        description: z.string().nullable().optional(),
        position: z.number().int().nonnegative().optional(),
      })
      .parse(request.body);
    const [last] = await db
      .select({ position: sql<number>`coalesce(max(${modules.position}), -1)` })
      .from(modules)
      .where(eq(modules.milestoneId, milestoneId));
    const [created] = await db
      .insert(modules)
      .values({
        milestoneId,
        ...input,
        position: input.position ?? Number(last?.position ?? -1) + 1,
      })
      .returning();
    return created;
  }

  async updateModule(moduleId: string, request: Request) {
    await this.requireStaff(request);
    const input = z
      .object({
        title: z.string().trim().min(1).optional(),
        description: z.string().nullable().optional(),
        position: z.number().int().nonnegative().optional(),
      })
      .parse(request.body);
    const [updated] = await db
      .update(modules)
      .set(input)
      .where(eq(modules.id, moduleId))
      .returning();
    return updated;
  }

  async deleteModule(moduleId: string, request: Request) {
    await this.requireStaff(request);
    await db.delete(modules).where(eq(modules.id, moduleId));
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
