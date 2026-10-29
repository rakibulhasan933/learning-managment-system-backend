import {
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
  asc,
  bookmarks,
  desc,
  eq,
  flashcards,
  inArray,
  lte,
  modelTestAttempts,
  questionBankOptions,
  questionBankQuestions,
  studentNotes,
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

function flashcardDto(row: typeof flashcards.$inferSelect) {
  return {
    back: row.back,
    chapter: row.chapter,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    ease: row.ease,
    front: row.front,
    id: row.id,
    intervalDays: row.intervalDays,
    questionBankQuestionId: row.questionBankQuestionId,
    repetitions: row.repetitions,
    subject: row.subject,
    topic: row.topic,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
  };
}

function bookmarkDto(row: typeof bookmarks.$inferSelect) {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    targetId: row.targetId,
    type: row.type,
    userId: row.userId,
  };
}

function noteDto(row: typeof studentNotes.$inferSelect) {
  return {
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    lessonId: row.lessonId,
    questionId: row.questionId,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
  };
}

/**
 * Simple SM-2-style update (NOT FSRS):
 * - quality >= 3: repetitions += 1; interval = 1 on the first success,
 *   6 on the second, then round(previous interval * ease).
 * - quality < 3: repetitions reset to 0, interval = 1 day.
 * - ease = max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))).
 * - dueAt = now + intervalDays.
 */
export function sm2Update(
  current: { ease: string; intervalDays: number; repetitions: number },
  quality: number,
): { dueAt: Date; ease: string; intervalDays: number; repetitions: number } {
  let ease = Number(current.ease);
  let repetitions = current.repetitions;
  let intervalDays: number;
  if (quality >= 3) {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(current.intervalDays * ease));
    ease = Math.max(
      1.3,
      ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    );
  } else {
    repetitions = 0;
    intervalDays = 1;
  }
  return {
    dueAt: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000),
    ease: ease.toFixed(2),
    intervalDays,
    repetitions,
  };
}

@Injectable()
export class RevisionService {
  constructor(private readonly authService: AuthService) {}

  private async requireStudent(
    request: Request,
  ): Promise<{ id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) throw new UnauthorizedException('Authentication is required.');
    if (!['admin', 'student'].includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }

  private async dueFlashcards(userId: string) {
    return db
      .select()
      .from(flashcards)
      .where(
        and(eq(flashcards.userId, userId), lte(flashcards.dueAt, new Date())),
      )
      .orderBy(asc(flashcards.dueAt));
  }

  /**
   * Mistake Bank, same rule as GET /student/mistake-bank in exams:
   * only questions this student answered wrongly in their own
   * SUBMITTED model-test attempts. Questions never attempted never
   * appear. The exams module itself is untouched.
   */
  private async mistakeBankQuestions(userId: string) {
    const attempts = await db
      .select()
      .from(modelTestAttempts)
      .where(eq(modelTestAttempts.userId, userId))
      .orderBy(desc(modelTestAttempts.submittedAt));
    const submitted = attempts.filter((row) => row.submittedAt);
    const wrongIds = [
      ...new Set(submitted.flatMap((row) => row.wrongQuestionIds)),
    ];
    if (!wrongIds.length) return { attempts: submitted, questions: [] };
    const questions = await db
      .select()
      .from(questionBankQuestions)
      .where(inArray(questionBankQuestions.id, wrongIds));
    const options = await db
      .select()
      .from(questionBankOptions)
      .where(inArray(questionBankOptions.questionId, wrongIds))
      .orderBy(asc(questionBankOptions.position));
    const sourceTests = new Map<string, string[]>();
    for (const attempt of submitted) {
      for (const questionId of attempt.wrongQuestionIds) {
        const list = sourceTests.get(questionId) ?? [];
        if (!list.includes(attempt.testId)) list.push(attempt.testId);
        sourceTests.set(questionId, list);
      }
    }
    return {
      attempts: submitted,
      questions: questions.map((row) => ({
        chapter: row.chapter,
        difficulty: row.difficulty,
        explanation: row.explanation,
        id: row.id,
        options: options
          .filter((option) => option.questionId === row.id)
          .map((option) => ({
            id: option.id,
            isCorrect: option.isCorrect,
            optionText: option.optionText,
            position: option.position,
          })),
        questionText: row.questionText,
        sourceTestIds: sourceTests.get(row.id) ?? [],
        subject: row.subject,
        topic: row.topic,
      })),
    };
  }

  async createFlashcard(request: Request) {
    const profile = await this.requireStudent(request);
    const input = parseOr400(
      z.object({
        back: z.string().trim().min(1).max(5000),
        chapter: z.string().trim().max(180).optional(),
        front: z.string().trim().min(1).max(5000),
        questionBankQuestionId: uuid.optional(),
        subject: z.string().trim().max(180).optional(),
        topic: z.string().trim().max(180).optional(),
      }),
      request.body,
    );
    try {
      if (input.questionBankQuestionId) {
        const [question] = await db
          .select({ id: questionBankQuestions.id })
          .from(questionBankQuestions)
          .where(eq(questionBankQuestions.id, input.questionBankQuestionId))
          .limit(1);
        if (!question) throw new NotFoundException('Question not found.');
      }
      const [row] = await db
        .insert(flashcards)
        .values({
          back: input.back,
          chapter: input.chapter ?? null,
          front: input.front,
          questionBankQuestionId: input.questionBankQuestionId ?? null,
          subject: input.subject ?? null,
          topic: input.topic ?? null,
          userId: profile.id,
        })
        .returning();
      if (!row) throw new Error('Flashcard could not be created.');
      return { flashcard: flashcardDto(row) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listFlashcards(request: Request) {
    const profile = await this.requireStudent(request);
    const query = request.query as Record<string, string | undefined>;
    try {
      const rows =
        query.dueOnly === 'true'
          ? await this.dueFlashcards(profile.id)
          : await db
              .select()
              .from(flashcards)
              .where(eq(flashcards.userId, profile.id))
              .orderBy(asc(flashcards.dueAt));
      return { flashcards: rows.map(flashcardDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async reviewFlashcard(flashcardIdInput: string, request: Request) {
    const profile = await this.requireStudent(request);
    const flashcardId = parseOr400(uuid, flashcardIdInput);
    const input = parseOr400(
      z.object({ quality: z.number().int().min(0).max(5) }),
      request.body,
    );
    try {
      const [row] = await db
        .select()
        .from(flashcards)
        .where(
          and(
            eq(flashcards.id, flashcardId),
            eq(flashcards.userId, profile.id),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException('Flashcard not found.');
      const next = sm2Update(row, input.quality);
      const [updated] = await db
        .update(flashcards)
        .set({
          dueAt: next.dueAt,
          ease: next.ease,
          intervalDays: next.intervalDays,
          repetitions: next.repetitions,
        })
        .where(eq(flashcards.id, flashcardId))
        .returning();
      if (!updated) throw new Error('Flashcard could not be updated.');
      return { flashcard: flashcardDto(updated) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async revisionToday(request: Request) {
    const profile = await this.requireStudent(request);
    try {
      const due = await this.dueFlashcards(profile.id);
      // Weak topics: submitted model-test topicBreakdown wrong counts,
      // plus Mistake Bank wrong questions for topics the breakdown
      // does not cover (no new tags are invented). suggestedTestIds
      // are the tests where the student got that topic wrong.
      const { attempts, questions } = await this.mistakeBankQuestions(
        profile.id,
      );
      const wrongByTopic = new Map<
        string,
        { suggestedTestIds: string[]; wrongCount: number }
      >();
      for (const attempt of attempts) {
        for (const [topic, values] of Object.entries(
          attempt.topicBreakdown,
        )) {
          if (!values.wrong) continue;
          const entry = wrongByTopic.get(topic) ?? {
            suggestedTestIds: [],
            wrongCount: 0,
          };
          entry.wrongCount += values.wrong;
          if (!entry.suggestedTestIds.includes(attempt.testId)) {
            entry.suggestedTestIds.push(attempt.testId);
          }
          wrongByTopic.set(topic, entry);
        }
      }
      for (const question of questions) {
        const topic = question.topic ?? 'untagged';
        if (wrongByTopic.has(topic)) continue;
        const entry = wrongByTopic.get(topic) ?? {
          suggestedTestIds: [],
          wrongCount: 0,
        };
        entry.wrongCount += 1;
        for (const testId of question.sourceTestIds) {
          if (!entry.suggestedTestIds.includes(testId)) {
            entry.suggestedTestIds.push(testId);
          }
        }
        wrongByTopic.set(topic, entry);
      }
      const weakTopicRecommendations = [...wrongByTopic.entries()]
        .map(([topic, entry]) => ({
          suggestedTestIds: entry.suggestedTestIds,
          topic,
          wrongCount: entry.wrongCount,
        }))
        .sort((a, b) => b.wrongCount - a.wrongCount)
        .slice(0, 10);
      return {
        dueCount: due.length,
        dueFlashcards: due.map(flashcardDto),
        weakTopicRecommendations,
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createBookmark(request: Request) {
    const profile = await this.requireStudent(request);
    const input = parseOr400(
      z.object({
        targetId: uuid,
        type: z.enum(['question', 'lesson']),
      }),
      request.body,
    );
    try {
      await db
        .insert(bookmarks)
        .values({
          targetId: input.targetId,
          type: input.type,
          userId: profile.id,
        })
        .onConflictDoNothing();
      const [row] = await db
        .select()
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, profile.id),
            eq(bookmarks.type, input.type),
            eq(bookmarks.targetId, input.targetId),
          ),
        )
        .limit(1);
      if (!row) throw new Error('Bookmark could not be created.');
      return { bookmark: bookmarkDto(row) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listBookmarks(request: Request) {
    const profile = await this.requireStudent(request);
    try {
      const rows = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.userId, profile.id))
        .orderBy(desc(bookmarks.createdAt));
      return { bookmarks: rows.map(bookmarkDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async deleteBookmark(bookmarkIdInput: string, request: Request) {
    const profile = await this.requireStudent(request);
    const bookmarkId = parseOr400(uuid, bookmarkIdInput);
    try {
      const [row] = await db
        .select()
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.id, bookmarkId),
            eq(bookmarks.userId, profile.id),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException('Bookmark not found.');
      await db.delete(bookmarks).where(eq(bookmarks.id, bookmarkId));
      return { deleted: true, id: bookmarkId };
    } catch (error) {
      missingTable503(error);
    }
  }

  async createNote(request: Request) {
    const profile = await this.requireStudent(request);
    const input = parseOr400(
      z.object({
        body: z.string().trim().min(1).max(10000),
        lessonId: uuid.optional(),
        questionId: uuid.optional(),
      }),
      request.body,
    );
    try {
      const [row] = await db
        .insert(studentNotes)
        .values({
          body: input.body,
          lessonId: input.lessonId ?? null,
          questionId: input.questionId ?? null,
          userId: profile.id,
        })
        .returning();
      if (!row) throw new Error('Note could not be created.');
      return { note: noteDto(row) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listNotes(request: Request) {
    const profile = await this.requireStudent(request);
    try {
      const rows = await db
        .select()
        .from(studentNotes)
        .where(eq(studentNotes.userId, profile.id))
        .orderBy(desc(studentNotes.updatedAt));
      return { notes: rows.map(noteDto) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async updateNote(noteIdInput: string, request: Request) {
    const profile = await this.requireStudent(request);
    const noteId = parseOr400(uuid, noteIdInput);
    const input = parseOr400(
      z.object({
        body: z.string().trim().min(1).max(10000).optional(),
        lessonId: uuid.nullable().optional(),
        questionId: uuid.nullable().optional(),
      }),
      request.body,
    );
    try {
      const [existing] = await db
        .select()
        .from(studentNotes)
        .where(
          and(
            eq(studentNotes.id, noteId),
            eq(studentNotes.userId, profile.id),
          ),
        )
        .limit(1);
      if (!existing) throw new NotFoundException('Note not found.');
      const [row] = await db
        .update(studentNotes)
        .set({
          body: input.body ?? existing.body,
          lessonId:
            input.lessonId !== undefined ? input.lessonId : existing.lessonId,
          questionId:
            input.questionId !== undefined
              ? input.questionId
              : existing.questionId,
        })
        .where(eq(studentNotes.id, noteId))
        .returning();
      if (!row) throw new Error('Note could not be updated.');
      return { note: noteDto(row) };
    } catch (error) {
      missingTable503(error);
    }
  }

  async deleteNote(noteIdInput: string, request: Request) {
    const profile = await this.requireStudent(request);
    const noteId = parseOr400(uuid, noteIdInput);
    try {
      const [row] = await db
        .select()
        .from(studentNotes)
        .where(
          and(eq(studentNotes.id, noteId), eq(studentNotes.userId, profile.id)),
        )
        .limit(1);
      if (!row) throw new NotFoundException('Note not found.');
      await db.delete(studentNotes).where(eq(studentNotes.id, noteId));
      return { deleted: true, id: noteId };
    } catch (error) {
      missingTable503(error);
    }
  }

  async revisionOverview(request: Request) {
    const profile = await this.requireStudent(request);
    try {
      const due = await this.dueFlashcards(profile.id);
      const bookmarkRows = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.userId, profile.id))
        .orderBy(desc(bookmarks.createdAt));
      const noteRows = await db
        .select()
        .from(studentNotes)
        .where(eq(studentNotes.userId, profile.id))
        .orderBy(desc(studentNotes.updatedAt));
      const { questions } = await this.mistakeBankQuestions(profile.id);
      return {
        bookmarks: bookmarkRows.map(bookmarkDto),
        dueFlashcards: due.map(flashcardDto),
        mistakeBank: { questions },
        notes: noteRows.map(noteDto),
      };
    } catch (error) {
      missingTable503(error);
    }
  }
}
