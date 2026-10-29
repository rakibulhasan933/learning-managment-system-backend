import {
  alias,
  and,
  asc,
  assignmentLateFlags,
  assignmentSubmissions,
  assignments,
  batchDeadlines,
  batchMembers,
  courses,
  desc,
  enrollments,
  eq,
  inArray,
  profiles,
  users,
} from '../database/index.js';
import type {
  InstructorAssignmentDto,
  InstructorAssignmentSubmissionDto,
  StudentAssignmentDto,
  StudentAssignmentSubmissionDto,
} from '../types/index.js';

import { HttpError } from '../http/errors.js';
import { db } from './database.js';

type AssignmentRow = typeof assignments.$inferSelect;
type SubmissionRow = typeof assignmentSubmissions.$inferSelect;
type InstructorSubmissionRow = SubmissionRow & {
  gradedByEmail: string | null;
  studentEmail: string;
  studentName: string | null;
};

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toStudentSubmissionDto(
  submission: SubmissionRow,
): StudentAssignmentSubmissionDto {
  return {
    assignmentId: submission.assignmentId,
    gradeFeedback: submission.gradeFeedback,
    gradeScore: submission.gradeScore,
    gradedAt: serializeDate(submission.gradedAt),
    id: submission.id,
    submittedAt: submission.submittedAt.toISOString(),
    submissionText: submission.submissionText,
    updatedAt: submission.updatedAt.toISOString(),
  };
}

function toInstructorSubmissionDto(
  submission: InstructorSubmissionRow,
): InstructorAssignmentSubmissionDto {
  return {
    ...toStudentSubmissionDto(submission),
    gradedByEmail: submission.gradedByEmail,
    studentEmail: submission.studentEmail,
    studentId: submission.userId,
    studentName: submission.studentName,
  };
}

export function toInstructorAssignmentDto({
  assignment,
  submissions,
}: {
  assignment: AssignmentRow;
  submissions: InstructorSubmissionRow[];
}): InstructorAssignmentDto {
  return {
    courseId: assignment.courseId,
    createdAt: assignment.createdAt.toISOString(),
    dueAt: serializeDate(assignment.dueAt),
    id: assignment.id,
    instructions: assignment.instructions,
    isPublished: assignment.isPublished,
    lectureId: assignment.lectureId,
    moduleId: assignment.moduleId,
    maxScore: assignment.maxScore,
    sectionId: assignment.sectionId,
    submissions: submissions
      .filter((submission) => submission.assignmentId === assignment.id)
      .map(toInstructorSubmissionDto),
    title: assignment.title,
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

function toStudentAssignmentDto({
  assignment,
  submissions,
}: {
  assignment: AssignmentRow;
  submissions: SubmissionRow[];
}): StudentAssignmentDto {
  const submission = submissions
    .filter((row) => row.assignmentId === assignment.id)
    .sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    )[0];

  return {
    courseId: assignment.courseId,
    dueAt: serializeDate(assignment.dueAt),
    id: assignment.id,
    instructions: assignment.instructions,
    lectureId: assignment.lectureId,
    moduleId: assignment.moduleId,
    maxScore: assignment.maxScore,
    sectionId: assignment.sectionId,
    submission: submission ? toStudentSubmissionDto(submission) : null,
    title: assignment.title,
  };
}

export async function assertActiveEnrollment(
  courseId: string,
  profileId: string,
) {
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, courseId),
        eq(enrollments.userId, profileId),
        eq(enrollments.status, 'active'),
      ),
    )
    .limit(1);

  if (!enrollment) {
    throw new HttpError(403, 'Active enrollment is required.');
  }
}

export async function getInstructorAssignmentDtosForCourse(courseId: string) {
  const assignmentRows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.courseId, courseId))
    .orderBy(asc(assignments.createdAt));
  const assignmentIds = assignmentRows.map((assignment) => assignment.id);

  if (assignmentIds.length === 0) {
    return [];
  }

  const graderProfiles = alias(profiles, 'assignment_grader_profiles');
  const graderUsers = alias(users, 'assignment_grader_users');
  const submissionRows = await db
    .select({
      assignmentId: assignmentSubmissions.assignmentId,
      gradeFeedback: assignmentSubmissions.gradeFeedback,
      gradeScore: assignmentSubmissions.gradeScore,
      gradedAt: assignmentSubmissions.gradedAt,
      gradedBy: assignmentSubmissions.gradedBy,
      gradedByEmail: graderUsers.email,
      id: assignmentSubmissions.id,
      studentEmail: users.email,
      studentName: profiles.fullName,
      submittedAt: assignmentSubmissions.submittedAt,
      submissionText: assignmentSubmissions.submissionText,
      updatedAt: assignmentSubmissions.updatedAt,
      userId: assignmentSubmissions.userId,
    })
    .from(assignmentSubmissions)
    .innerJoin(profiles, eq(assignmentSubmissions.userId, profiles.id))
    .innerJoin(users, eq(profiles.userId, users.id))
    .leftJoin(
      graderProfiles,
      eq(assignmentSubmissions.gradedBy, graderProfiles.id),
    )
    .leftJoin(graderUsers, eq(graderProfiles.userId, graderUsers.id))
    .where(inArray(assignmentSubmissions.assignmentId, assignmentIds))
    .orderBy(desc(assignmentSubmissions.submittedAt));

  return assignmentRows.map((assignment) =>
    toInstructorAssignmentDto({
      assignment,
      submissions: submissionRows,
    }),
  );
}

export async function saveAssignmentForTarget({
  courseId,
  input,
  lectureId,
  moduleId,
  sectionId,
}: {
  courseId: string;
  input: {
    dueAt?: Date | null;
    instructions: string;
    isPublished: boolean;
    maxScore: number;
    title: string;
  };
  lectureId?: string;
  moduleId?: string;
  sectionId?: string;
}) {
  const existing = await db
    .select()
    .from(assignments)
    .where(
      lectureId
        ? eq(assignments.lectureId, lectureId)
        : moduleId
          ? eq(assignments.moduleId, moduleId)
          : eq(assignments.sectionId, sectionId!),
    )
    .limit(1);
  const [assignment] =
    existing.length > 0
      ? await db
          .update(assignments)
          .set({
            dueAt: input.dueAt ?? null,
            instructions: input.instructions,
            isPublished: input.isPublished,
            maxScore: input.maxScore,
            title: input.title,
          })
          .where(eq(assignments.id, existing[0]!.id))
          .returning()
      : await db
          .insert(assignments)
          .values({
            courseId,
            dueAt: input.dueAt ?? null,
            instructions: input.instructions,
            isPublished: input.isPublished,
            lectureId: lectureId ?? null,
            moduleId: moduleId ?? null,
            maxScore: input.maxScore,
            sectionId: sectionId ?? null,
            title: input.title,
          })
          .returning();

  if (!assignment) {
    throw new HttpError(500, 'Assignment could not be saved.');
  }

  return toInstructorAssignmentDto({ assignment, submissions: [] });
}

export async function getStudentAssignmentsForCourse(
  courseId: string,
  profileId: string,
) {
  const assignmentRows = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.courseId, courseId),
        eq(assignments.isPublished, true),
      ),
    )
    .orderBy(asc(assignments.createdAt));
  const assignmentIds = assignmentRows.map((assignment) => assignment.id);
  const submissionRows =
    assignmentIds.length === 0
      ? []
      : await db
          .select()
          .from(assignmentSubmissions)
          .where(
            and(
              eq(assignmentSubmissions.userId, profileId),
              inArray(assignmentSubmissions.assignmentId, assignmentIds),
            ),
          )
          .orderBy(desc(assignmentSubmissions.updatedAt));

  return assignmentRows.map((assignment) =>
    toStudentAssignmentDto({ assignment, submissions: submissionRows }),
  );
}

export async function submitAssignment({
  assignmentId,
  profileId,
  submissionText,
}: {
  assignmentId: string;
  profileId: string;
  submissionText: string;
}) {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  if (!assignment || !assignment.isPublished) {
    throw new HttpError(404, 'Assignment not found.');
  }

  await assertActiveEnrollment(assignment.courseId, profileId);

  const [submission] = await db
    .insert(assignmentSubmissions)
    .values({
      assignmentId,
      submissionText,
      userId: profileId,
    })
    .onConflictDoUpdate({
      set: {
        gradeFeedback: null,
        gradeScore: null,
        gradedAt: null,
        gradedBy: null,
        submittedAt: new Date(),
        submissionText,
      },
      target: [
        assignmentSubmissions.assignmentId,
        assignmentSubmissions.userId,
      ],
    })
    .returning();

  if (!submission) {
    throw new HttpError(500, 'Assignment submission could not be saved.');
  }

  // Next batch: late flag. The submission itself is never rejected
  // for lateness; it is flagged instead. The applicable deadline is
  // the student's batch deadline for this assignment (strictest one
  // wins when the student is in several batches), falling back to the
  // assignment's own dueAt. A penalty is recorded only when a batch
  // policy sets one (default 0 = no deduction). Best-effort and
  // swallowed pre-migration (missing assignment_late_flags /
  // batch_deadlines tables) so submitting keeps working.
  let isLate = false;
  let latePenaltyPercent = 0;
  try {
    const memberships = await db
      .select({ batchId: batchMembers.batchId })
      .from(batchMembers)
      .where(eq(batchMembers.userId, profileId));
    let dueAt: Date | null = assignment.dueAt;
    if (memberships.length) {
      const deadlines = await db
        .select()
        .from(batchDeadlines)
        .where(
          and(
            eq(batchDeadlines.assignmentId, assignmentId),
            inArray(
              batchDeadlines.batchId,
              memberships.map((m) => m.batchId),
            ),
          ),
        )
        .orderBy(asc(batchDeadlines.dueAt));
      if (deadlines.length) {
        dueAt = deadlines[0]!.dueAt;
        latePenaltyPercent = deadlines[0]!.latePenaltyPercent;
      }
    }
    isLate = dueAt ? submission.submittedAt > dueAt : false;
    if (isLate) {
      await db
        .insert(assignmentLateFlags)
        .values({
          assignmentId,
          isLate: true,
          latePenaltyPercent,
          submittedAt: submission.submittedAt,
          userId: profileId,
        })
        .onConflictDoUpdate({
          set: {
            isLate: true,
            latePenaltyPercent,
            submittedAt: submission.submittedAt,
          },
          target: [assignmentLateFlags.assignmentId, assignmentLateFlags.userId],
        });
    }
  } catch {
    // Pre-migration: the flag row cannot be persisted, but lateness
    // against the assignment's own dueAt is still reported honestly
    // in the response; no penalty is applied without a batch policy.
    isLate = assignment.dueAt ? submission.submittedAt > assignment.dueAt : false;
    latePenaltyPercent = 0;
  }

  return {
    ...toStudentSubmissionDto(submission),
    isLate,
    latePenaltyPercent,
  };
}

export async function gradeAssignmentSubmission({
  courseId,
  gradeFeedback,
  gradeScore,
  graderProfileId,
  submissionId,
}: {
  courseId: string;
  gradeFeedback: string | null;
  gradeScore: number;
  graderProfileId: string;
  submissionId: string;
}) {
  const [target] = await db
    .select({
      assignmentId: assignments.id,
      maxScore: assignments.maxScore,
      userId: assignmentSubmissions.userId,
    })
    .from(assignmentSubmissions)
    .innerJoin(
      assignments,
      eq(assignmentSubmissions.assignmentId, assignments.id),
    )
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .where(
      and(
        eq(assignmentSubmissions.id, submissionId),
        eq(assignments.courseId, courseId),
      ),
    )
    .limit(1);

  if (!target) {
    throw new HttpError(404, 'Assignment submission not found.');
  }

  if (gradeScore > target.maxScore) {
    throw new HttpError(
      400,
      'Grade score cannot exceed the assignment max score.',
    );
  }

  // Next batch: apply a batch late penalty ONLY when a late flag with
  // a percentage above 0 exists for this student + assignment. The
  // teacher's raw score is the input every time, so re-grading does
  // not compound the deduction. Default 0 (or no flag row) = no change.
  let effectiveScore = gradeScore;
  try {
    const [flag] = await db
      .select()
      .from(assignmentLateFlags)
      .where(
        and(
          eq(assignmentLateFlags.assignmentId, target.assignmentId),
          eq(assignmentLateFlags.userId, target.userId),
          eq(assignmentLateFlags.isLate, true),
        ),
      )
      .limit(1);
    if (flag && flag.latePenaltyPercent > 0) {
      effectiveScore = Math.round(
        (gradeScore * (100 - flag.latePenaltyPercent)) / 100,
      );
    }
  } catch {
    // Pre-migration: no penalty table, no deduction.
  }

  const [submission] = await db
    .update(assignmentSubmissions)
    .set({
      gradeFeedback,
      gradeScore: effectiveScore,
      gradedAt: new Date(),
      gradedBy: graderProfileId,
    })
    .where(eq(assignmentSubmissions.id, submissionId))
    .returning();

  if (!submission) {
    throw new HttpError(500, 'Assignment grade could not be saved.');
  }

  return submission;
}
