import {
  and,
  asc,
  desc,
  enrollments,
  eq,
  inArray,
  lectures,
  modules,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
  sections,
} from '../database/index.js';
import type {
  InstructorQuizDto,
  QuizSubmissionResultDto,
  StudentQuizAttemptDto,
  StudentQuizDto,
} from '../types/index.js';

import { HttpError } from '../http/errors.js';
import { db } from './database.js';

type QuizRow = typeof quizzes.$inferSelect;
type QuestionRow = typeof quizQuestions.$inferSelect;
type OptionRow = typeof quizOptions.$inferSelect;
type AttemptRow = typeof quizAttempts.$inferSelect;

function serializeDate(value: Date) {
  return value.toISOString();
}

function toAttemptDto(attempt: AttemptRow): StudentQuizAttemptDto {
  return {
    completedAt: serializeDate(attempt.completedAt),
    id: attempt.id,
    percentage:
      attempt.totalQuestions === 0
        ? 0
        : Math.round((attempt.score / attempt.totalQuestions) * 100),
    quizId: attempt.quizId,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
  };
}

export function toInstructorQuizDto({
  options,
  questions,
  quiz,
}: {
  options: OptionRow[];
  questions: QuestionRow[];
  quiz: QuizRow;
}): InstructorQuizDto {
  return {
    courseId: quiz.courseId,
    createdAt: serializeDate(quiz.createdAt),
    id: quiz.id,
    isPublished: quiz.isPublished,
    lectureId: quiz.lectureId,
    moduleId: quiz.moduleId,
    questions: questions
      .filter((question) => question.quizId === quiz.id)
      .map((question) => ({
        id: question.id,
        options: options
          .filter((option) => option.questionId === question.id)
          .map((option) => ({
            id: option.id,
            isCorrect: option.isCorrect,
            optionText: option.optionText,
            position: option.position,
          })),
        position: question.position,
        questionText: question.questionText,
      })),
    sectionId: quiz.sectionId,
    title: quiz.title,
    updatedAt: serializeDate(quiz.updatedAt),
  };
}

export function toStudentQuizDto({
  attempts,
  options,
  questions,
  quiz,
}: {
  attempts: AttemptRow[];
  options: OptionRow[];
  questions: QuestionRow[];
  quiz: QuizRow;
}): StudentQuizDto {
  const latestAttempt = attempts
    .filter((attempt) => attempt.quizId === quiz.id)
    .sort(
      (left, right) => right.completedAt.getTime() - left.completedAt.getTime(),
    )[0];

  return {
    courseId: quiz.courseId,
    id: quiz.id,
    latestAttempt: latestAttempt ? toAttemptDto(latestAttempt) : null,
    lectureId: quiz.lectureId,
    moduleId: quiz.moduleId,
    questions: questions
      .filter((question) => question.quizId === quiz.id)
      .map((question) => {
        const questionOptions = options.filter(
          (option) => option.questionId === question.id,
        );

        return {
          allowMultiple:
            questionOptions.filter((option) => option.isCorrect).length > 1,
          id: question.id,
          options: questionOptions.map((option) => ({
            id: option.id,
            optionText: option.optionText,
            position: option.position,
          })),
          position: question.position,
          questionText: question.questionText,
        };
      }),
    review: latestAttempt
      ? {
          answers: latestAttempt.answers,
          correctOptionIds: Object.fromEntries(
            questions.map((question) => [
              question.id,
              options
                .filter(
                  (option) =>
                    option.questionId === question.id && option.isCorrect,
                )
                .map((option) => option.id)
                .sort(),
            ]),
          ),
          correctQuestionIds: questions
            .filter((question) => {
              const correct = options
                .filter(
                  (option) =>
                    option.questionId === question.id && option.isCorrect,
                )
                .map((option) => option.id)
                .sort();
              const submitted = [
                ...(latestAttempt.answers[question.id] ?? []),
              ].sort();
              return (
                correct.length === submitted.length &&
                correct.every((id, index) => id === submitted[index])
              );
            })
            .map((question) => question.id),
        }
      : null,
    sectionId: quiz.sectionId,
    title: quiz.title,
  };
}

export async function getInstructorQuizDtosForCourse(courseId: string) {
  const quizRows = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.courseId, courseId))
    .orderBy(asc(quizzes.createdAt));
  const quizIds = quizRows.map((quiz) => quiz.id);

  if (quizIds.length === 0) {
    return [];
  }

  const questionRows = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizRows[0]!.id))
    .orderBy(asc(quizQuestions.position));

  const allQuestionRows =
    quizRows.length === 1
      ? questionRows
      : await db
          .select()
          .from(quizQuestions)
          .where(inArray(quizQuestions.quizId, quizIds))
          .orderBy(asc(quizQuestions.position));
  const questionIds = allQuestionRows.map((question) => question.id);
  const optionRows =
    questionIds.length === 0
      ? []
      : await db
          .select()
          .from(quizOptions)
          .where(inArray(quizOptions.questionId, questionIds))
          .orderBy(asc(quizOptions.position));

  return quizRows.map((quiz) =>
    toInstructorQuizDto({
      options: optionRows,
      questions: allQuestionRows,
      quiz,
    }),
  );
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
  // Feature set 5: an expired subscription covering this course blocks
  // access. No-op pre-migration (missing subscriptions table is skipped
  // inside), so existing enrolments keep working until migration.
  const { assertSubscriptionNotExpired } = await import(
    '../sales/sales-helpers.js'
  );
  try {
    await assertSubscriptionNotExpired(profileId, courseId);
  } catch (error) {
    // ForbiddenException from the helper already carries status 403.
    if ((error as { status?: unknown } | null)?.status === 403) throw error;
    throw new HttpError(403, 'Your subscription for this course has expired.');
  }
}

export async function getQuizCourseId(quizId: string) {
  const [quiz] = await db
    .select({ courseId: quizzes.courseId })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);

  if (!quiz) {
    throw new HttpError(404, 'Quiz not found.');
  }

  return quiz.courseId;
}

export async function getStudentQuizByTarget({
  lectureId,
  moduleId,
  profileId,
  sectionId,
}: {
  lectureId?: string;
  moduleId?: string;
  profileId: string;
  sectionId?: string;
}) {
  const [target] = lectureId
    ? await db
        .select({ courseId: sections.courseId })
        .from(lectures)
        .innerJoin(sections, eq(lectures.sectionId, sections.id))
        .where(eq(lectures.id, lectureId))
        .limit(1)
    : moduleId
      ? await db
          .select({ courseId: sections.courseId })
          .from(modules)
          .innerJoin(sections, eq(modules.milestoneId, sections.id))
          .where(eq(modules.id, moduleId))
          .limit(1)
      : await db
          .select({ courseId: sections.courseId })
          .from(sections)
          .where(eq(sections.id, sectionId!))
          .limit(1);

  if (!target) {
    throw new HttpError(404, 'Quiz target not found.');
  }

  await assertActiveEnrollment(target.courseId, profileId);

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(
      and(
        lectureId
          ? eq(quizzes.lectureId, lectureId)
          : moduleId
            ? eq(quizzes.moduleId, moduleId)
            : eq(quizzes.sectionId, sectionId!),
        eq(quizzes.isPublished, true),
      ),
    )
    .limit(1);

  if (!quiz) {
    throw new HttpError(404, 'Quiz not found.');
  }

  return getStudentQuizDto(quiz.id, profileId);
}

export async function getStudentQuizDto(quizId: string, profileId: string) {
  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);

  if (!quiz || !quiz.isPublished) {
    throw new HttpError(404, 'Quiz not found.');
  }

  await assertActiveEnrollment(quiz.courseId, profileId);

  const [existingAttempt] = await db
    .select({ id: quizAttempts.id })
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, profileId)),
    )
    .limit(1);
  if (existingAttempt) {
    throw new HttpError(409, 'You have already submitted this quiz.');
  }

  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position));
  const options =
    questions.length === 0
      ? []
      : await db
          .select()
          .from(quizOptions)
          .where(
            inArray(
              quizOptions.questionId,
              questions.map((question) => question.id),
            ),
          )
          .orderBy(asc(quizOptions.position));
  const attempts = await db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, profileId)),
    )
    .orderBy(desc(quizAttempts.completedAt));

  return toStudentQuizDto({ attempts, options, questions, quiz });
}

export async function getStudentQuizzesForCourse(
  courseId: string,
  profileId: string,
) {
  const quizRows = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.courseId, courseId), eq(quizzes.isPublished, true)));
  const questionRows =
    quizRows.length === 0
      ? []
      : await db
          .select()
          .from(quizQuestions)
          .where(
            inArray(
              quizQuestions.quizId,
              quizRows.map((quiz) => quiz.id),
            ),
          )
          .orderBy(asc(quizQuestions.position));
  const optionRows =
    questionRows.length === 0
      ? []
      : await db
          .select()
          .from(quizOptions)
          .where(
            inArray(
              quizOptions.questionId,
              questionRows.map((question) => question.id),
            ),
          )
          .orderBy(asc(quizOptions.position));
  const attempts =
    quizRows.length === 0
      ? []
      : await db
          .select()
          .from(quizAttempts)
          .where(
            and(
              eq(quizAttempts.userId, profileId),
              inArray(
                quizAttempts.quizId,
                quizRows.map((quiz) => quiz.id),
              ),
            ),
          )
          .orderBy(desc(quizAttempts.completedAt));

  return quizRows.map((quiz) =>
    toStudentQuizDto({
      attempts,
      options: optionRows,
      questions: questionRows,
      quiz,
    }),
  );
}

export async function submitQuizAttempt({
  answers,
  profileId,
  quizId,
}: {
  answers: Record<string, string[]>;
  profileId: string;
  quizId: string;
}): Promise<QuizSubmissionResultDto> {
  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);

  if (!quiz || !quiz.isPublished) {
    throw new HttpError(404, 'Quiz not found.');
  }

  await assertActiveEnrollment(quiz.courseId, profileId);

  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position));
  const options =
    questions.length === 0
      ? []
      : await db
          .select()
          .from(quizOptions)
          .where(
            inArray(
              quizOptions.questionId,
              questions.map((question) => question.id),
            ),
          );
  const correctQuestionIds: string[] = [];
  const correctOptionIds: Record<string, string[]> = {};

  for (const question of questions) {
    const questionCorrectOptionIds = options
      .filter((option) => option.questionId === question.id && option.isCorrect)
      .map((option) => option.id)
      .sort();
    const submittedOptionIds = [...(answers[question.id] ?? [])].sort();
    correctOptionIds[question.id] = questionCorrectOptionIds;

    if (
      questionCorrectOptionIds.length === submittedOptionIds.length &&
      questionCorrectOptionIds.every(
        (optionId, index) => optionId === submittedOptionIds[index],
      )
    ) {
      correctQuestionIds.push(question.id);
    }
  }

  const [attempt] = await db
    .insert(quizAttempts)
    .values({
      answers,
      quizId: quiz.id,
      score: correctQuestionIds.length,
      totalQuestions: questions.length,
      userId: profileId,
    })
    .returning();

  if (!attempt) {
    throw new HttpError(500, 'Quiz attempt could not be saved.');
  }

  return {
    ...toAttemptDto(attempt),
    correctOptionIds,
    correctQuestionIds,
    review: {
      answers,
      correctOptionIds,
    },
  };
}
