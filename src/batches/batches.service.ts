import {
  BadRequestException,
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
  announcements,
  asc,
  batchDeadlines,
  batchDripRules,
  batchMembers,
  batches,
  courses,
  desc,
  enrollments,
  eq,
  inArray,
  lectures,
  modelTestAttempts,
  modelTests,
  modules,
  notifications,
  profiles,
  progress,
  sections,
  assignments,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { missingTable503 } from '../sales/sales-helpers.js';

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
const isoDate = z.string().datetime();

function batchDto(row: typeof batches.$inferSelect) {
  return {
    courseId: row.courseId,
    createdAt: row.createdAt.toISOString(),
    enrolmentEndAt: row.enrolmentEndAt?.toISOString() ?? null,
    enrolmentStartAt: row.enrolmentStartAt?.toISOString() ?? null,
    id: row.id,
    instructorId: row.instructorId,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function memberDto(
  row: typeof batchMembers.$inferSelect,
  name: string | null,
) {
  return {
    batchId: row.batchId,
    joinedAt: row.joinedAt.toISOString(),
    name,
    userId: row.userId,
  };
}

function dripRuleDto(row: typeof batchDripRules.$inferSelect) {
  return {
    batchId: row.batchId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    milestoneId: row.milestoneId,
    moduleId: row.moduleId,
    releaseAt: row.releaseAt?.toISOString() ?? null,
    releaseDays: row.releaseDays,
    releaseType: row.releaseType,
  };
}

function deadlineDto(row: typeof batchDeadlines.$inferSelect) {
  return {
    allowLate: row.allowLate,
    assignmentId: row.assignmentId,
    batchId: row.batchId,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    id: row.id,
    latePenaltyPercent: row.latePenaltyPercent,
  };
}

@Injectable()
export class BatchesService {
  constructor(private readonly authService: AuthService) {}

  private async requireRole(
    request: Request,
    roles: string[],
  ): Promise<{ id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) throw new UnauthorizedException('Authentication is required.');
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }

  private async ownedCourse(
    profile: { id: string; role: string },
    courseId: string,
  ) {
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course) throw new NotFoundException('Course not found.');
    if (profile.role === 'instructor' && course.instructorId !== profile.id) {
      throw new ForbiddenException('Access denied.');
    }
    return course;
  }

  private async instructorBatch(
    profile: { id: string; role: string },
    batchId: string,
  ) {
    const [batch] = await db
      .select()
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');
    if (profile.role === 'instructor' && batch.instructorId !== profile.id) {
      throw new ForbiddenException('Access denied.');
    }
    return batch;
  }

  private async requireEnrolment(userId: string, courseId: string) {
    const [row] = await db
      .select({ enrolledAt: enrollments.enrolledAt, id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.userId, userId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) throw new ForbiddenException('Active enrollment is required.');
    return row;
  }

  private async memberOf(batchId: string, userId: string) {
    const [row] = await db
      .select()
      .from(batchMembers)
      .where(
        and(
          eq(batchMembers.batchId, batchId),
          eq(batchMembers.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async namesById(userIds: string[]) {
    if (!userIds.length) return new Map<string, string | null>();
    const rows = await db
      .select({ fullName: profiles.fullName, id: profiles.id })
      .from(profiles)
      .where(inArray(profiles.id, userIds));
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  async createBatch(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const input = parseOr400(
      z.object({
        courseId: uuid,
        enrolmentEndAt: isoDate.optional(),
        enrolmentStartAt: isoDate.optional(),
        name: z.string().trim().min(2).max(180),
      }),
      request.body,
    );
    try {
      await this.ownedCourse(profile, input.courseId);
      const [batch] = await db
        .insert(batches)
        .values({
          courseId: input.courseId,
          enrolmentEndAt: input.enrolmentEndAt
            ? new Date(input.enrolmentEndAt)
            : null,
          enrolmentStartAt: input.enrolmentStartAt
            ? new Date(input.enrolmentStartAt)
            : null,
          instructorId:
            profile.role === 'admin'
              ? (await this.ownedCourse(profile, input.courseId))
                  .instructorId
              : profile.id,
          name: input.name,
        })
        .returning();
      if (!batch) throw new Error('Batch could not be created.');
      return { batch: batchDto(batch) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listBatches(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const query = request.query as Record<string, string | undefined>;
    try {
      const conditions = [];
      if (query.courseId) {
        const courseId = parseOr400(uuid, query.courseId);
        await this.ownedCourse(profile, courseId);
        conditions.push(eq(batches.courseId, courseId));
      } else if (profile.role === 'instructor') {
        conditions.push(eq(batches.instructorId, profile.id));
      }
      const rows = await db
        .select()
        .from(batches)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(batches.createdAt));
      return { batches: rows.map(batchDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async getBatch(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const batchId = parseOr400(uuid, batchIdInput);
    try {
      const batch = await this.instructorBatch(profile, batchId);
      const members = await db
        .select()
        .from(batchMembers)
        .where(eq(batchMembers.batchId, batchId))
        .orderBy(asc(batchMembers.joinedAt));
      const names = await this.namesById(members.map((m) => m.userId));
      const dripRules = await db
        .select()
        .from(batchDripRules)
        .where(eq(batchDripRules.batchId, batchId))
        .orderBy(asc(batchDripRules.createdAt));
      const deadlines = await db
        .select()
        .from(batchDeadlines)
        .where(eq(batchDeadlines.batchId, batchId))
        .orderBy(asc(batchDeadlines.dueAt));
      return {
        batch: batchDto(batch),
        deadlines: deadlines.map(deadlineDto),
        dripRules: dripRules.map(dripRuleDto),
        members: members.map((m) =>
          memberDto(m, names.get(m.userId) ?? null),
        ),
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async joinBatch(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const batchId = parseOr400(uuid, batchIdInput);
    try {
      const [batch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException('Batch not found.');
      await this.requireEnrolment(profile.id, batch.courseId);
      const now = new Date();
      if (batch.enrolmentStartAt && now < batch.enrolmentStartAt) {
        throw new ForbiddenException('Batch enrolment has not opened yet.');
      }
      if (batch.enrolmentEndAt && now > batch.enrolmentEndAt) {
        throw new ForbiddenException('Batch enrolment window has closed.');
      }
      await db
        .insert(batchMembers)
        .values({ batchId, userId: profile.id })
        .onConflictDoNothing();
      const member = await this.memberOf(batchId, profile.id);
      if (!member) throw new Error('Batch membership could not be created.');
      const names = await this.namesById([profile.id]);
      return { member: memberDto(member, names.get(profile.id) ?? null) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async addMember(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const batchId = parseOr400(uuid, batchIdInput);
    const input = parseOr400(z.object({ userId: uuid }), request.body);
    try {
      const batch = await this.instructorBatch(profile, batchId);
      const [user] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, input.userId))
        .limit(1);
      if (!user) throw new NotFoundException('User not found.');
      // Teacher-added members must also be enrolled in the course,
      // mirroring the self-join rule.
      await this.requireEnrolment(input.userId, batch.courseId);
      await db
        .insert(batchMembers)
        .values({ batchId, userId: input.userId })
        .onConflictDoNothing();
      const member = await this.memberOf(batchId, input.userId);
      if (!member) throw new Error('Batch membership could not be created.');
      const names = await this.namesById([input.userId]);
      return { member: memberDto(member, names.get(input.userId) ?? null) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createDrip(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const batchId = parseOr400(uuid, batchIdInput);
    const input = parseOr400(
      z
        .object({
          milestoneId: uuid.optional(),
          moduleId: uuid.optional(),
          releaseAt: isoDate.optional(),
          releaseDays: z.number().int().min(0).optional(),
          releaseType: z.enum(['relative', 'fixed']),
        })
        .refine((v) => v.milestoneId || v.moduleId, {
          message: 'milestoneId or moduleId is required.',
        })
        .refine(
          (v) =>
            v.releaseType === 'relative'
              ? v.releaseDays !== undefined
              : v.releaseAt !== undefined,
          {
            message:
              'relative drip requires releaseDays; fixed drip requires releaseAt.',
          },
        ),
      request.body,
    );
    try {
      const batch = await this.instructorBatch(profile, batchId);
      if (input.milestoneId) {
        const [section] = await db
          .select({ id: sections.id })
          .from(sections)
          .where(
            and(
              eq(sections.id, input.milestoneId),
              eq(sections.courseId, batch.courseId),
            ),
          )
          .limit(1);
        if (!section) throw new BadRequestException('Milestone not found in this course.');
      }
      if (input.moduleId) {
        const [mod] = await db
          .select({ id: modules.id })
          .from(modules)
          .innerJoin(sections, eq(modules.milestoneId, sections.id))
          .where(
            and(
              eq(modules.id, input.moduleId),
              eq(sections.courseId, batch.courseId),
            ),
          )
          .limit(1);
        if (!mod) throw new BadRequestException('Module not found in this course.');
      }
      const [rule] = await db
        .insert(batchDripRules)
        .values({
          batchId,
          milestoneId: input.milestoneId ?? null,
          moduleId: input.moduleId ?? null,
          releaseAt: input.releaseAt ? new Date(input.releaseAt) : null,
          releaseDays: input.releaseDays ?? null,
          releaseType: input.releaseType,
        })
        .returning();
      if (!rule) throw new Error('Drip rule could not be created.');
      return { rule: dripRuleDto(rule) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async dripStatus(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const batchId = parseOr400(uuid, batchIdInput);
    try {
      const [batch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException('Batch not found.');
      const enrolment = await this.requireEnrolment(profile.id, batch.courseId);
      const member = await this.memberOf(batchId, profile.id);
      if (!member) {
        throw new ForbiddenException('Batch membership is required.');
      }
      const rules = await db
        .select()
        .from(batchDripRules)
        .where(eq(batchDripRules.batchId, batchId))
        .orderBy(asc(batchDripRules.createdAt));
      const now = new Date();
      // Relative unlocks count from the batch-join day (the student's
      // batch enrolment day); course enrolment is only the fallback
      // when no membership row exists, which cannot happen here.
      const base = member.joinedAt ?? enrolment.enrolledAt;
      const items = rules.map((rule) => {
        const unlocksAt =
          rule.releaseType === 'relative' && rule.releaseDays !== null
            ? new Date(base.getTime() + rule.releaseDays * 24 * 60 * 60 * 1000)
            : rule.releaseAt;
        return {
          locked: unlocksAt ? unlocksAt > now : false,
          milestoneId: rule.milestoneId,
          moduleId: rule.moduleId,
          unlocksAt: unlocksAt?.toISOString() ?? null,
        };
      });
      return { items };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createDeadline(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const batchId = parseOr400(uuid, batchIdInput);
    const input = parseOr400(
      z.object({
        allowLate: z.boolean().optional(),
        assignmentId: uuid,
        dueAt: isoDate,
        latePenaltyPercent: z.number().int().min(0).max(100).optional(),
      }),
      request.body,
    );
    try {
      const batch = await this.instructorBatch(profile, batchId);
      const [assignment] = await db
        .select({ courseId: assignments.courseId, id: assignments.id })
        .from(assignments)
        .where(eq(assignments.id, input.assignmentId))
        .limit(1);
      if (!assignment || assignment.courseId !== batch.courseId) {
        throw new BadRequestException('Assignment not found in this course.');
      }
      const [deadline] = await db
        .insert(batchDeadlines)
        .values({
          allowLate: input.allowLate ?? false,
          assignmentId: input.assignmentId,
          batchId,
          dueAt: new Date(input.dueAt),
          latePenaltyPercent: input.latePenaltyPercent ?? 0,
        })
        .onConflictDoUpdate({
          set: {
            allowLate: input.allowLate ?? false,
            dueAt: new Date(input.dueAt),
            latePenaltyPercent: input.latePenaltyPercent ?? 0,
          },
          target: [batchDeadlines.batchId, batchDeadlines.assignmentId],
        })
        .returning();
      if (!deadline) throw new Error('Deadline could not be created.');
      return { deadline: deadlineDto(deadline) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async leaderboard(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    const batchId = parseOr400(uuid, batchIdInput);
    try {
      const [batch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException('Batch not found.');
      if (profile.role === 'instructor' && batch.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
      const members = await db
        .select()
        .from(batchMembers)
        .where(eq(batchMembers.batchId, batchId));
      if (profile.role === 'student') {
        if (!members.some((m) => m.userId === profile.id)) {
          throw new ForbiddenException('Batch membership is required.');
        }
      }
      const memberIds = members.map((m) => m.userId);
      const names = await this.namesById(memberIds);
      // Best submitted model-test score per member, for tests of this course.
      const bestScore = new Map<string, number>();
      if (memberIds.length) {
        const attempts = await db
          .select({
            score: modelTestAttempts.score,
            userId: modelTestAttempts.userId,
          })
          .from(modelTestAttempts)
          .innerJoin(modelTests, eq(modelTestAttempts.testId, modelTests.id))
          .where(
            and(
              eq(modelTests.courseId, batch.courseId),
              inArray(modelTestAttempts.userId, memberIds),
            ),
          );
        for (const row of attempts) {
          if (row.score === null) continue;
          const score = Number(row.score);
          const current = bestScore.get(row.userId);
          if (current === undefined || score > current) {
            bestScore.set(row.userId, score);
          }
        }
      }
      // Progress: completed lectures / all lectures of the course.
      let lectureIds: string[] = [];
      const sectionRows = await db
        .select({ id: sections.id })
        .from(sections)
        .where(eq(sections.courseId, batch.courseId));
      if (sectionRows.length) {
        const lectureRows = await db
          .select({ id: lectures.id })
          .from(lectures)
          .where(inArray(lectures.sectionId, sectionRows.map((s) => s.id)));
        lectureIds = lectureRows.map((row) => row.id);
      }
      const completedCount = new Map<string, number>();
      if (memberIds.length && lectureIds.length) {
        const done = await db
          .select({ userId: progress.userId })
          .from(progress)
          .where(
            and(
              inArray(progress.userId, memberIds),
              inArray(progress.lectureId, lectureIds),
              eq(progress.isCompleted, true),
            ),
          );
        for (const row of done) {
          completedCount.set(row.userId, (completedCount.get(row.userId) ?? 0) + 1);
        }
      }
      const entries = memberIds
        .map((userId) => ({
          name: names.get(userId) ?? null,
          progressPercent: lectureIds.length
            ? Math.round(
                ((completedCount.get(userId) ?? 0) / lectureIds.length) * 100,
              )
            : 0,
          score: bestScore.get(userId) ?? 0,
          userId,
        }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.progressPercent - a.progressPercent ||
            (a.name ?? '').localeCompare(b.name ?? ''),
        )
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      // Contract shape only: no email is ever included in this view.
      return { entries };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createAnnouncement(batchIdInput: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const batchId = parseOr400(uuid, batchIdInput);
    const input = parseOr400(
      z.object({
        body: z.string().trim().min(2).max(5000),
        title: z.string().trim().min(2).max(180),
      }),
      request.body,
    );
    try {
      const batch = await this.instructorBatch(profile, batchId);
      // Real record in the EXISTING announcements system (not the
      // seller-dashboard draft endpoint, which creates nothing).
      const [announcement] = await db
        .insert(announcements)
        .values({
          body: input.body,
          courseId: batch.courseId,
          instructorId:
            profile.role === 'admin' ? batch.instructorId : profile.id,
          title: input.title,
        })
        .returning();
      if (!announcement) throw new Error('Announcement could not be created.');
      const members = await db
        .select({ userId: batchMembers.userId })
        .from(batchMembers)
        .where(eq(batchMembers.batchId, batchId));
      if (members.length) {
        // In-app notifications only. No email or SMS is sent by this
        // system, and none is claimed here.
        await db.insert(notifications).values(
          members.map((m) => ({
            body: input.body,
            href: `/learn/${batch.courseId}`,
            profileId: m.userId,
            title: `${input.title}`,
            type: 'batch_announcement' as const,
          })),
        );
      }
      return {
        announcement: {
          body: announcement.body,
          courseId: announcement.courseId,
          createdAt: announcement.createdAt.toISOString(),
          id: announcement.id,
          title: announcement.title,
        },
        recipientCount: members.length,
        sent: true,
      };
    } catch (error) {
      missingTable503(error);
    }
  }
}
