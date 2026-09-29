import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  auditLogs,
  and,
  courses,
  desc,
  enrollments,
  eq,
  profiles,
  sql,
  users,
} from '../../database/index.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service.js';
import { db } from '../../lib/database.js';

@Injectable()
export class AdminUsers {
  constructor(private readonly authService: AuthService) {}
  private async admin(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new UnauthorizedException('Authentication is required.');
    if (profile.role !== 'admin')
      throw new ForbiddenException('Access denied.');
    return profile;
  }
  async list(request: Request) {
    await this.admin(request);
    const query = z
      .object({
        q: z.string().trim().min(1).optional(),
        role: z.enum(['admin', 'instructor', 'student']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
      })
      .parse(request.query);
    const filters = [] as ReturnType<typeof sql>[];
    if (query.q)
      filters.push(
        sql`(${users.email} ilike ${`%${query.q}%`} or ${profiles.fullName} ilike ${`%${query.q}%`})`,
      );
    if (query.role) filters.push(eq(profiles.role, query.role));
    if (query.status === 'active')
      filters.push(sql`${users.suspendedAt} is null`);
    if (query.status === 'suspended')
      filters.push(sql`${users.suspendedAt} is not null`);
    const rows = await db
      .select({
        authProvider: users.authProvider,
        createdAt: users.createdAt,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        fullName: profiles.fullName,
        id: users.id,
        profileId: profiles.id,
        role: profiles.role,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(users.createdAt));
    return {
      users: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
      })),
    };
  }
  async enrollments(request: Request) {
    await this.admin(request);
    const rows = await db
      .select({
        courseId: courses.id,
        courseTitle: courses.title,
        enrolledAt: enrollments.enrolledAt,
        id: enrollments.id,
        orderId: enrollments.orderId,
        revokedAt: enrollments.revokedAt,
        status: enrollments.status,
        studentEmail: users.email,
        studentName: profiles.fullName,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .innerJoin(profiles, eq(enrollments.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .orderBy(desc(enrollments.enrolledAt));
    return {
      enrollments: rows.map((row) => ({
        ...row,
        enrolledAt: row.enrolledAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async setEnrollmentStatus(
    id: string,
    action: 'activate' | 'revoke',
    request: Request,
  ) {
    const profile = await this.admin(request);
    const status = action === 'activate' ? 'active' : 'revoked';
    const [updated] = await db
      .update(enrollments)
      .set({ revokedAt: status === 'active' ? null : new Date(), status })
      .where(eq(enrollments.id, id))
      .returning({ id: enrollments.id });
    if (!updated) throw new NotFoundException('Enrollment not found.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: `enrollment_${action}d`,
      entityType: 'enrollment',
      entityId: updated.id,
      metadata: {},
    });
  }

  async createInstructor(request: Request) {
    const profile = await this.admin(request);
    const input = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .transform((value) => value.toLowerCase()),
        fullName: z.string().trim().min(1).max(160).nullable().optional(),
        password: z.string().min(8),
      })
      .parse(request.body);
    const existing = await db.query.users.findFirst({
      where: eq(users.email, input.email),
    });
    if (existing)
      throw new ConflictException('An account with this email already exists.');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          authProvider: 'password',
          email: input.email,
          emailVerifiedAt: new Date(),
          passwordHash,
        })
        .returning();
      if (!user) throw new Error('Instructor account could not be created.');
      const [createdProfile] = await tx
        .insert(profiles)
        .values({
          fullName: input.fullName ?? null,
          role: 'instructor',
          userId: user.id,
        })
        .returning();
      if (!createdProfile)
        throw new Error('Instructor profile could not be created.');
      return user;
    });
    const [row] = await db
      .select({
        authProvider: users.authProvider,
        createdAt: users.createdAt,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        fullName: profiles.fullName,
        id: users.id,
        profileId: profiles.id,
        role: profiles.role,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, created.id))
      .limit(1);
    if (!row) throw new Error('Instructor account could not be loaded.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: 'instructor_created',
      entityType: 'user',
      entityId: created.id,
      metadata: {},
    });
    return {
      user: {
        ...row,
        createdAt: row.createdAt.toISOString(),
        emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
      },
    };
  }

  async setSuspended(
    id: string,
    action: 'suspend' | 'activate',
    request: Request,
  ) {
    const profile = await this.admin(request);
    if (action === 'suspend' && id === profile.userId)
      throw new BadRequestException('You cannot suspend your own account.');
    const [updated] = await db
      .update(users)
      .set({ suspendedAt: action === 'suspend' ? new Date() : null })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!updated) throw new NotFoundException('User not found.');
    await db.insert(auditLogs).values({
      actorId: profile.id,
      action: action === 'suspend' ? 'user_suspended' : 'user_activated',
      entityType: 'user',
      entityId: id,
      metadata: {},
    });
  }
}
