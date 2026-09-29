import type {
  InstructorCourseDto,
  InstructorLectureDto,
  InstructorSectionDto,
  InstructorQuizDto,
  InstructorAssignmentDto,
} from '../types/index.js';
import { courses, lectures, sections } from '../database/index.js';

const date = (value: Date | null) => value?.toISOString() ?? null;
export function toInstructorCourseDto(
  course: typeof courses.$inferSelect,
): InstructorCourseDto {
  return {
    category: course.category,
    createdAt: course.createdAt.toISOString(),
    currency: course.currency,
    description: course.description,
    id: course.id,
    level: course.level,
    price: course.price,
    publishedAt: date(course.publishedAt),
    shortDescription: course.shortDescription,
    slug: course.slug,
    status: course.status,
    thumbnailUrl: course.thumbnailUrl,
    title: course.title,
    updatedAt: course.updatedAt.toISOString(),
  };
}
export function toInstructorLectureDto(
  lecture: typeof lectures.$inferSelect,
  quiz: InstructorQuizDto | null = null,
  assignment: InstructorAssignmentDto | null = null,
): InstructorLectureDto {
  return {
    assignment,
    availableAt: date(lecture.availableAt),
    createdAt: lecture.createdAt.toISOString(),
    description: lecture.description,
    durationSeconds: lecture.durationSeconds,
    id: lecture.id,
    isPreview: lecture.isPreview,
    isPublished: lecture.isPublished,
    pdfUrl: lecture.pdfUrl,
    position: lecture.position,
    sectionId: lecture.sectionId,
    slidesUrl: lecture.slidesUrl,
    title: lecture.title,
    updatedAt: lecture.updatedAt.toISOString(),
    videoProvider: lecture.videoProvider,
    videoRef: lecture.videoRef,
    quiz,
  };
}
export function toInstructorSectionDto(
  section: typeof sections.$inferSelect,
  sectionLectures: Array<typeof lectures.$inferSelect>,
  quiz: InstructorQuizDto | null = null,
  lectureQuizzes: InstructorQuizDto[] = [],
  assignment: InstructorAssignmentDto | null = null,
  lectureAssignments: InstructorAssignmentDto[] = [],
): InstructorSectionDto {
  return {
    assignment,
    courseId: section.courseId,
    createdAt: section.createdAt.toISOString(),
    description: section.description,
    dripAfterDays: section.dripAfterDays,
    id: section.id,
    lectures: sectionLectures.map((lecture) =>
      toInstructorLectureDto(
        lecture,
        lectureQuizzes.find((item) => item.lectureId === lecture.id) ?? null,
        lectureAssignments.find((item) => item.lectureId === lecture.id) ??
          null,
      ),
    ),
    position: section.position,
    quiz,
    title: section.title,
    updatedAt: section.updatedAt.toISOString(),
  };
}
