import { NotFoundException } from '@nestjs/common';
import {
  and,
  courses,
  eq,
  lectures,
  quizOptions,
  quizQuestions,
  quizzes,
  sections,
} from '../database/index.js';
import { db } from '../lib/database.js';
import { toInstructorQuizDto } from '../lib/quizzes.js';
import type { z } from 'zod';
import { quizMutationSchema } from './course-schemas.js';

export async function assertInstructorOwnsCourse(
  courseId: string,
  instructorId: string,
) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(eq(courses.id, courseId), eq(courses.instructorId, instructorId)),
    )
    .limit(1);
  if (!course) throw new NotFoundException('Course not found.');
}
export async function assertSectionBelongsToCourse(
  sectionId: string,
  courseId: string,
) {
  const [section] = await db
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.courseId, courseId)))
    .limit(1);
  if (!section) throw new NotFoundException('Section not found.');
}
export async function assertLectureBelongsToCourse(
  lectureId: string,
  courseId: string,
) {
  const [lecture] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .innerJoin(sections, eq(lectures.sectionId, sections.id))
    .where(and(eq(lectures.id, lectureId), eq(sections.courseId, courseId)))
    .limit(1);
  if (!lecture) throw new NotFoundException('Lecture not found.');
}
export async function saveQuizForTarget({
  courseId,
  input,
  lectureId,
  moduleId,
  sectionId,
}: {
  courseId: string;
  input: z.infer<typeof quizMutationSchema>;
  lectureId?: string;
  moduleId?: string;
  sectionId?: string;
}) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(quizzes)
      .where(
        lectureId
          ? eq(quizzes.lectureId, lectureId)
          : moduleId
            ? eq(quizzes.moduleId, moduleId)
            : eq(quizzes.sectionId, sectionId!),
      )
      .limit(1);
    const [quiz] = existing.length
      ? await tx
          .update(quizzes)
          .set({ isPublished: input.isPublished, title: input.title })
          .where(eq(quizzes.id, existing[0]!.id))
          .returning()
      : await tx
          .insert(quizzes)
          .values({
            courseId,
            isPublished: input.isPublished,
            lectureId: lectureId ?? null,
            moduleId: moduleId ?? null,
            sectionId: sectionId ?? null,
            title: input.title,
          })
          .returning();
    if (!quiz) throw new Error('Quiz could not be saved.');
    await tx.delete(quizQuestions).where(eq(quizQuestions.quizId, quiz.id));
    const savedQuestions: Array<typeof quizQuestions.$inferSelect> = [];
    const savedOptions: Array<typeof quizOptions.$inferSelect> = [];
    for (const questionInput of input.questions) {
      const [question] = await tx
        .insert(quizQuestions)
        .values({
          position: questionInput.position,
          questionText: questionInput.questionText,
          quizId: quiz.id,
        })
        .returning();
      if (!question) throw new Error('Quiz question could not be saved.');
      savedQuestions.push(question);
      savedOptions.push(
        ...(await tx
          .insert(quizOptions)
          .values(
            questionInput.options.map((option) => ({
              isCorrect: option.isCorrect,
              optionText: option.optionText,
              position: option.position,
              questionId: question.id,
            })),
          )
          .returning()),
      );
    }
    return toInstructorQuizDto({
      options: savedOptions,
      questions: savedQuestions,
      quiz,
    });
  });
}
