import { z } from 'zod';
import {
  courseLevels,
  courseStatuses,
  videoProviders,
} from '../types/index.js';

export const courseMutationSchema = z.object({
  category: z.string().trim().min(1).max(120).nullable().optional(),
  currency: z.string().trim().length(3).default('BDT'),
  description: z.string().trim().nullable().optional(),
  level: z.enum(courseLevels).default('all_levels'),
  price: z.coerce.number().nonnegative().default(0),
  shortDescription: z.string().trim().nullable().optional(),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(courseStatuses).default('draft'),
  thumbnailUrl: z.string().trim().url().nullable().optional(),
  title: z.string().trim().min(3),
});
export const coursePatchSchema = courseMutationSchema.partial();
export const videoPatchSchema = z.object({
  description: z.string().trim().nullable().optional(),
  durationSeconds: z.coerce.number().int().nonnegative().nullable().optional(),
  isPreview: z.coerce.boolean().optional(),
  isPublished: z.coerce.boolean().optional(),
  position: z.coerce.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).optional(),
  videoProvider: z.enum(videoProviders).optional(),
  videoRef: z.string().trim().nullable().optional(),
});
export const sectionMutationSchema = z.object({
  description: z.string().trim().nullable().optional(),
  dripAfterDays: z.coerce.number().int().nonnegative().default(0),
  position: z.coerce.number().int().nonnegative().optional(),
  title: z.string().trim().min(1),
});
export const sectionPatchSchema = sectionMutationSchema.partial();
export const lectureMutationSchema = z.object({
  availableAt: z.coerce.date().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  durationSeconds: z.coerce.number().int().nonnegative().nullable().optional(),
  isPreview: z.coerce.boolean().default(false),
  isPublished: z.coerce.boolean().default(false),
  position: z.coerce.number().int().nonnegative(),
  title: z.string().trim().min(1),
  videoProvider: z.enum(videoProviders).default('r2'),
  videoRef: z.string().trim().nullable().optional(),
});
export const lecturePatchSchema = lectureMutationSchema.partial();
const quizOptionSchema = z.object({
  isCorrect: z.coerce.boolean().default(false),
  optionText: z.string().trim().min(1).max(1000),
  position: z.coerce.number().int().nonnegative(),
});
export const quizMutationSchema = z.object({
  isPublished: z.coerce.boolean().default(false),
  questions: z
    .array(
      z.object({
        options: z
          .array(quizOptionSchema)
          .min(2)
          .refine((options) => options.some((option) => option.isCorrect), {
            message: 'Each question needs at least one correct option.',
          }),
        position: z.coerce.number().int().nonnegative(),
        questionText: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1),
  title: z.string().trim().min(1).max(255),
});
export const assignmentMutationSchema = z.object({
  dueAt: z.coerce.date().nullable().optional(),
  instructions: z.string().trim().min(1).max(20_000),
  isPublished: z.coerce.boolean().default(false),
  maxScore: z.coerce.number().int().positive().default(100),
  title: z.string().trim().min(1).max(255),
});
export const assignmentGradeSchema = z.object({
  gradeFeedback: z.string().trim().nullable().optional(),
  gradeScore: z.coerce.number().int().nonnegative(),
});
