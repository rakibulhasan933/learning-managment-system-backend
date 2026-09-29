import {
  alias,
  and,
  asc,
  assignmentSubmissions,
  assignments,
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

  return toStudentSubmissionDto(submission);
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

  const [submission] = await db
    .update(assignmentSubmissions)
    .set({
      gradeFeedback,
      gradeScore,
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
