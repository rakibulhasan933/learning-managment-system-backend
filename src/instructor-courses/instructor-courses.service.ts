import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  and,
  asc,
  assignmentSubmissions,
  assignments,
  courses,
  eq,
  lectures,
  modules,
  sections,
  sql,
  quizzes,
} from '../database/index.js';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { createNotification } from '../lib/notifications.js';
import {
  getInstructorAssignmentDtosForCourse,
  gradeAssignmentSubmission,
  saveAssignmentForTarget,
} from '../lib/assignments.js';
import { getInstructorQuizDtosForCourse } from '../lib/quizzes.js';
import {
  assignmentGradeSchema,
  assignmentMutationSchema,
  lectureMutationSchema,
  lecturePatchSchema,
  quizMutationSchema,
  sectionMutationSchema,
  sectionPatchSchema,
} from './course-schemas.js';
import {
  toInstructorLectureDto,
  toInstructorSectionDto,
} from './course-dtos.js';
import {
  assertInstructorOwnsCourse,
  assertSectionBelongsToCourse,
  assertLectureBelongsToCourse,
  saveQuizForTarget,
} from './course-operations.js';

@Injectable()
export class InstructorCoursesService {
  constructor(private readonly authService: AuthService) {}

  async outline(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const sectionRows = await db
      .select()
      .from(sections)
      .where(eq(sections.courseId, courseId))
      .orderBy(asc(sections.position));
    const lectureRows = await db
      .select()
      .from(lectures)
      .innerJoin(sections, eq(lectures.sectionId, sections.id))
      .where(eq(sections.courseId, courseId))
      .orderBy(asc(sections.position), asc(lectures.position));
    const quizDtos = await getInstructorQuizDtosForCourse(courseId);
    const assignmentDtos = await getInstructorAssignmentDtosForCourse(courseId);
    return {
      sections: sectionRows.map((section) =>
        toInstructorSectionDto(
          section,
          lectureRows
            .filter((row) => row.lectures.sectionId === section.id)
            .map((row) => row.lectures),
          quizDtos.find((quiz) => quiz.sectionId === section.id) ?? null,
          quizDtos.filter((quiz) => Boolean(quiz.lectureId)),
          assignmentDtos.find(
            (assignment) => assignment.sectionId === section.id,
          ) ?? null,
          assignmentDtos.filter((assignment) => Boolean(assignment.lectureId)),
        ),
      ),
    };
  }
  async createSection(courseId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const input = sectionMutationSchema.parse(request.body);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const [last] = await db
      .select({
        position: sql<number>`coalesce(max(${sections.position}), -1)`,
      })
      .from(sections)
      .where(eq(sections.courseId, courseId));
    const [created] = await db
      .insert(sections)
      .values({
        ...input,
        courseId,
        position: input.position ?? Number(last?.position ?? -1) + 1,
      })
      .returning();
    if (!created) throw new Error('Section could not be created.');
    return toInstructorSectionDto(created, []);
  }
  async updateSection(courseId: string, sectionId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const [updated] = await db
      .update(sections)
      .set(sectionPatchSchema.parse(request.body))
      .where(and(eq(sections.id, sectionId), eq(sections.courseId, courseId)))
      .returning();
    if (!updated) throw new NotFoundException('Section not found.');
    return toInstructorSectionDto(updated, []);
  }
  async deleteSection(courseId: string, sectionId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const [deleted] = await db
      .delete(sections)
      .where(and(eq(sections.id, sectionId), eq(sections.courseId, courseId)))
      .returning({ id: sections.id });
    if (!deleted) throw new NotFoundException('Section not found.');
  }
  async createLecture(courseId: string, sectionId: string, request: Request) {
    const profile = await this.requireStaff(request);
    const input = lectureMutationSchema.parse(request.body);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await assertSectionBelongsToCourse(sectionId, courseId);
    const [created] = await db
      .insert(lectures)
      .values({ ...input, availableAt: input.availableAt ?? null, sectionId })
      .returning();
    if (!created) throw new Error('Lecture could not be created.');
    return toInstructorLectureDto(created);
  }
  async updateLecture(courseId: string, lectureId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const [updated] = await db
      .update(lectures)
      .set(lecturePatchSchema.parse(request.body))
      .from(sections)
      .where(
        and(
          eq(lectures.id, lectureId),
          eq(lectures.sectionId, sections.id),
          eq(sections.courseId, courseId),
        ),
      )
      .returning();
    if (!updated) throw new NotFoundException('Lecture not found.');
    return toInstructorLectureDto(updated);
  }
  async deleteLecture(courseId: string, lectureId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await assertLectureBelongsToCourse(lectureId, courseId);
    const [deleted] = await db
      .delete(lectures)
      .where(eq(lectures.id, lectureId))
      .returning({ id: lectures.id });
    if (!deleted) throw new NotFoundException('Lecture not found.');
  }
  async saveSectionQuiz(courseId: string, sectionId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await assertSectionBelongsToCourse(sectionId, courseId);
    return saveQuizForTarget({
      courseId,
      input: quizMutationSchema.parse(request.body),
      sectionId,
    });
  }
  async saveLectureQuiz(courseId: string, lectureId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await assertLectureBelongsToCourse(lectureId, courseId);
    return saveQuizForTarget({
      courseId,
      input: quizMutationSchema.parse(request.body),
      lectureId,
    });
  }
  async saveModuleQuiz(courseId: string, moduleId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await this.assertModule(courseId, moduleId);
    return saveQuizForTarget({
      courseId,
      input: quizMutationSchema.parse(request.body),
      moduleId,
    });
  }
  async deleteQuiz(courseId: string, quizId: string, request: Request) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const [deleted] = await db
      .delete(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.courseId, courseId)))
      .returning({ id: quizzes.id });
    if (!deleted) throw new NotFoundException('Quiz not found.');
  }
  async saveSectionAssignment(
    courseId: string,
    sectionId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await assertSectionBelongsToCourse(sectionId, courseId);
    return saveAssignmentForTarget({
      courseId,
      input: assignmentMutationSchema.parse(request.body),
      sectionId,
    });
  }
  async saveLectureAssignment(
    courseId: string,
    lectureId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await assertLectureBelongsToCourse(lectureId, courseId);
    return saveAssignmentForTarget({
      courseId,
      input: assignmentMutationSchema.parse(request.body),
      lectureId,
    });
  }
  async saveModuleAssignment(
    courseId: string,
    moduleId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await this.assertModule(courseId, moduleId);
    return saveAssignmentForTarget({
      courseId,
      input: assignmentMutationSchema.parse(request.body),
      moduleId,
    });
  }
  async deleteAssignment(
    courseId: string,
    assignmentId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    await assertInstructorOwnsCourse(courseId, profile.id);
    const [deleted] = await db
      .delete(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.courseId, courseId),
        ),
      )
      .returning({ id: assignments.id });
    if (!deleted) throw new NotFoundException('Assignment not found.');
  }
  async gradeAssignment(
    courseId: string,
    submissionId: string,
    request: Request,
  ) {
    const profile = await this.requireStaff(request);
    const input = assignmentGradeSchema.parse(request.body);
    await assertInstructorOwnsCourse(courseId, profile.id);
    await gradeAssignmentSubmission({
      courseId,
      gradeFeedback: input.gradeFeedback ?? null,
      gradeScore: input.gradeScore,
      graderProfileId: profile.id,
      submissionId,
    });
    const [submission] = await db
      .select({ studentId: assignmentSubmissions.userId })
      .from(assignmentSubmissions)
      .where(eq(assignmentSubmissions.id, submissionId))
      .limit(1);
    if (submission)
      await createNotification({
        body:
          input.gradeFeedback ??
          `Your assignment received ${input.gradeScore} points.`,
        href: `/learn/${courseId}`,
        profileId: submission.studentId,
        title: 'Your assignment was graded',
        type: 'assignment_graded',
      });
  }
  private async assertModule(courseId: string, moduleId: string) {
    const [row] = await db
      .select({ id: modules.id })
      .from(modules)
      .innerJoin(sections, eq(modules.milestoneId, sections.id))
      .where(and(eq(modules.id, moduleId), eq(sections.courseId, courseId)))
      .limit(1);
    if (!row) throw new NotFoundException('Module not found.');
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
