import {
  BadRequestException,
  ConflictException,
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
  courses,
  desc,
  enrollments,
  eq,
  inArray,
  modelTestAttempts,
  modelTestQuestions,
  modelTests,
  questionBankOptions,
  questionBankQuestions,
  profiles,
  users,
} from '../database/index.js';
import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { notifyManySafely } from '../lib/notifications.js';
import {
  assertSubscriptionNotExpired,
  missingTable503,
  seededShuffle,
} from '../sales/sales-helpers.js';

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

/** Minimal CSV parser: handles quoted fields, embedded commas and "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Minimal multipart/form-data parser (no extra dependency): returns text fields + files. */
export function parseMultipart(
  body: Buffer,
  contentType: string | undefined,
): { fields: Record<string, string>; files: Record<string, string> } {
  const fields: Record<string, string> = {};
  const files: Record<string, string> = {};
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '')?.[1]
    ?? /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '')?.[2];
  if (!boundary) return { fields, files };
  const text = body.toString('utf8');
  const parts = text.split(`--${boundary}`);
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    if (!name) continue;
    let value = part.slice(headerEnd + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    if (/filename="/.test(headers)) files[name] = value;
    else fields[name] = value.trim();
  }
  return { fields, files };
}

const norm = (value: string) =>
  value.trim().toLowerCase().replace(/[\s_-]+/g, '');

@Injectable()
export class ExamsService {
  constructor(private readonly authService: AuthService) {}

  // ---------------- Question bank ----------------

  async importQuestions(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    // Body may be: raw multipart (file field), raw CSV text, or JSON {csv}.
    let csvText: string | null = null;
    let courseId: string | undefined;
    let quizId: string | undefined;
    const raw = request.body;
    if (Buffer.isBuffer(raw)) {
      const contentType = request.headers['content-type'];
      if (contentType?.includes('multipart/form-data')) {
        const parsed = parseMultipart(raw, contentType);
        csvText = parsed.files['file'] ?? parsed.files['csv'] ?? null;
        courseId = parsed.fields['courseId'];
        quizId = parsed.fields['quizId'];
      } else {
        csvText = raw.toString('utf8');
      }
    } else if (typeof raw === 'string') {
      csvText = raw;
    } else if (raw && typeof raw === 'object') {
      csvText = typeof raw.csv === 'string' ? raw.csv : null;
      courseId = raw.courseId;
      quizId = raw.quizId;
    }
    if (!csvText) {
      throw new BadRequestException(
        'No CSV supplied. Send multipart field "file", a text/csv body, or JSON {csv}.',
      );
    }
    if (courseId) parseOr400(uuid, courseId);
    if (quizId) parseOr400(uuid, quizId);
    try {
      let attachTestId: string | null = null;
      if (quizId) {
        const [test] = await db
          .select({ id: modelTests.id, instructorId: modelTests.instructorId })
          .from(modelTests)
          .where(eq(modelTests.id, quizId))
          .limit(1);
        if (!test) throw new NotFoundException('Model test not found.');
        if (profile.role === 'instructor' && test.instructorId !== profile.id) {
          throw new ForbiddenException('Access denied.');
        }
        attachTestId = test.id;
      }
      if (courseId) {
        const [course] = await db
          .select({ id: courses.id, instructorId: courses.instructorId })
          .from(courses)
          .where(eq(courses.id, courseId))
          .limit(1);
        if (!course) throw new BadRequestException('Course not found.');
        if (profile.role === 'instructor' && course.instructorId !== profile.id) {
          throw new ForbiddenException('Access denied.');
        }
      }
      const rows = parseCsv(csvText);
      if (rows.length < 2) {
        throw new BadRequestException(
          'CSV must have a header row and at least one data row.',
        );
      }
      const header = rows[0]!.map(norm);
      const col = (...names: string[]) => {
        for (const name of names) {
          const idx = header.indexOf(norm(name));
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const questionCol = col('question', 'questiontext', 'text');
      const optionsCol = col('options', 'choices');
      const correctCol = col('correct', 'correctanswer', 'answer', 'correctoption');
      const subjectCol = col('subject');
      const chapterCol = col('chapter');
      const topicCol = col('topic', 'tag', 'tags');
      const difficultyCol = col('difficulty', 'level');
      const explanationCol = col('explanation', 'solution');
      const optionCols = [1, 2, 3, 4, 5].map((n) => ({
        col: col(`option${n}`, `option${String.fromCharCode(64 + n)}`),
        n,
      })).filter((entry) => entry.col >= 0);
      if (questionCol < 0 || correctCol < 0 || (optionsCol < 0 && optionCols.length < 2)) {
        throw new BadRequestException(
          'CSV header must include a question column, a correct-answer column, and either an options column (pipe-separated) or option1..option4 columns.',
        );
      }
      let imported = 0;
      let skipped = 0;
      const errors: Array<{ line: number; reason: string }> = [];
      const importedIds: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const line = i + 1; // 1-based file line (header is line 1)
        const cells = rows[i]!;
        const get = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');
        const questionText = get(questionCol);
        const options = optionsCol >= 0
          ? get(optionsCol).split('|').map((value) => value.trim()).filter(Boolean)
          : optionCols.map((entry) => get(entry.col)).filter(Boolean);
        const correctRaw = get(correctCol);
        const difficultyRaw = get(difficultyCol) || 'medium';
        const difficulty = difficultyRaw.toLowerCase();
        const fail = (reason: string) => {
          skipped += 1;
          errors.push({ line, reason });
        };
        if (!questionText) { fail('Question text is empty.'); continue; }
        if (options.length < 2) { fail('At least two options are required.'); continue; }
        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
          fail(`Difficulty must be easy, medium or hard (got "${difficultyRaw}").`);
          continue;
        }
        let correctIndex = -1;
        if (/^[a-eA-E]$/.test(correctRaw)) {
          correctIndex = correctRaw.toUpperCase().charCodeAt(0) - 65;
        } else if (/^\d+$/.test(correctRaw)) {
          correctIndex = Number(correctRaw) - 1;
        } else {
          correctIndex = options.findIndex(
            (option) => option.toLowerCase() === correctRaw.toLowerCase(),
          );
        }
        if (correctIndex < 0 || correctIndex >= options.length) {
          fail('Correct answer does not match any option (use a letter, a 1-based index, or the exact option text).');
          continue;
        }
        const [question] = await db
          .insert(questionBankQuestions)
          .values({
            chapter: get(chapterCol) || null,
            courseId: courseId ?? null,
            difficulty: difficulty as 'easy' | 'medium' | 'hard',
            explanation: get(explanationCol) || null,
            instructorId: profile.id,
            questionText,
            subject: get(subjectCol) || null,
            topic: get(topicCol) || null,
          })
          .returning({ id: questionBankQuestions.id });
        if (!question) { fail('Question could not be saved.'); continue; }
        await db.insert(questionBankOptions).values(
          options.map((optionText, index) => ({
            isCorrect: index === correctIndex,
            optionText,
            position: index,
            questionId: question.id,
          })),
        );
        imported += 1;
        importedIds.push(question.id);
      }
      if (attachTestId && importedIds.length) {
        const existing = await db
          .select({ position: modelTestQuestions.position })
          .from(modelTestQuestions)
          .where(eq(modelTestQuestions.testId, attachTestId))
          .orderBy(desc(modelTestQuestions.position))
          .limit(1);
        const start = (existing[0]?.position ?? -1) + 1;
        await db.insert(modelTestQuestions).values(
          importedIds.map((questionId, index) => ({
            position: start + index,
            questionId,
            testId: attachTestId!,
          })),
        ).onConflictDoNothing();
      }
      return {
        attachedToTestId: attachTestId,
        errors,
        imported,
        skipped,
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async listQuestions(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const query = request.query as Record<string, string | undefined>;
    try {
      const conditions = [eq(questionBankQuestions.instructorId, profile.id)];
      if (profile.role === 'admin') conditions.pop();
      if (query.subject) conditions.push(eq(questionBankQuestions.subject, query.subject));
      if (query.chapter) conditions.push(eq(questionBankQuestions.chapter, query.chapter));
      if (query.topic) conditions.push(eq(questionBankQuestions.topic, query.topic));
      if (query.difficulty) conditions.push(eq(questionBankQuestions.difficulty, query.difficulty as 'easy' | 'medium' | 'hard'));
      if (query.courseId) conditions.push(eq(questionBankQuestions.courseId, query.courseId));
      const rows = await db
        .select()
        .from(questionBankQuestions)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(questionBankQuestions.createdAt))
        .limit(200);
      const ids = rows.map((row) => row.id);
      const options = ids.length
        ? await db
            .select()
            .from(questionBankOptions)
            .where(inArray(questionBankOptions.questionId, ids))
            .orderBy(asc(questionBankOptions.position))
        : [];
      return {
        questions: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          options: options
            .filter((option) => option.questionId === row.id)
            .map((option) => ({
              id: option.id,
              isCorrect: option.isCorrect,
              optionText: option.optionText,
              position: option.position,
            })),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async attachQuestion(questionId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const qid = parseOr400(uuid, questionId);
    const input = parseOr400(z.object({ testId: uuid }), request.body);
    try {
      const [question] = await db
        .select({ instructorId: questionBankQuestions.instructorId })
        .from(questionBankQuestions)
        .where(eq(questionBankQuestions.id, qid))
        .limit(1);
      if (!question) throw new NotFoundException('Question not found.');
      const [test] = await db
        .select({ instructorId: modelTests.instructorId })
        .from(modelTests)
        .where(eq(modelTests.id, input.testId))
        .limit(1);
      if (!test) throw new NotFoundException('Model test not found.');
      if (
        profile.role === 'instructor' &&
        (question.instructorId !== profile.id || test.instructorId !== profile.id)
      ) {
        throw new ForbiddenException('Access denied.');
      }
      const existing = await db
        .select({ position: modelTestQuestions.position })
        .from(modelTestQuestions)
        .where(eq(modelTestQuestions.testId, input.testId))
        .orderBy(desc(modelTestQuestions.position))
        .limit(1);
      await db
        .insert(modelTestQuestions)
        .values({
          position: (existing[0]?.position ?? -1) + 1,
          questionId: qid,
          testId: input.testId,
        })
        .onConflictDoNothing();
      return { questionId: qid, testId: input.testId };
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- Model tests ----------------

  async createModelTest(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const input = parseOr400(
      z.object({
        courseId: uuid,
        durationMinutes: z.number().int().min(1).max(600),
        isPublished: z.boolean().optional(),
        maxAttempts: z.number().int().min(1).max(20).default(1),
        negativeMark: z.coerce.number().min(0).max(5).default(0),
        questions: z.array(z.object({ questionId: uuid })).max(200).default([]),
        shuffleQuestions: z.boolean().default(true),
        title: z.string().trim().min(2).max(180),
      }),
      request.body,
    );
    try {
      const [course] = await db
        .select({ id: courses.id, instructorId: courses.instructorId })
        .from(courses)
        .where(eq(courses.id, input.courseId))
        .limit(1);
      if (!course) throw new BadRequestException('Course not found.');
      if (profile.role === 'instructor' && course.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
      const questionIds = [...new Set(input.questions.map((q) => q.questionId))];
      if (questionIds.length) {
        const found = await db
          .select({ id: questionBankQuestions.id, instructorId: questionBankQuestions.instructorId })
          .from(questionBankQuestions)
          .where(inArray(questionBankQuestions.id, questionIds));
        if (found.length !== questionIds.length) {
          throw new BadRequestException('One or more questions were not found.');
        }
        if (
          profile.role === 'instructor' &&
          found.some((row) => row.instructorId !== profile.id)
        ) {
          throw new ForbiddenException('Questions must be your own bank questions.');
        }
      }
      const [test] = await db
        .insert(modelTests)
        .values({
          courseId: input.courseId,
          durationMinutes: input.durationMinutes,
          instructorId: profile.id,
          isPublished: input.isPublished ?? true,
          maxAttempts: input.maxAttempts,
          negativeMark: input.negativeMark.toFixed(2),
          shuffleQuestions: input.shuffleQuestions,
          title: input.title,
        })
        .returning({ id: modelTests.id });
      if (!test) throw new Error('Model test could not be created.');
      if (questionIds.length) {
        await db.insert(modelTestQuestions).values(
          questionIds.map((questionId, index) => ({
            position: index,
            questionId,
            testId: test.id,
          })),
        );
      }
      // Best-effort in-app notification to enrolled students when the test
      // is published. Never throws, so creation always succeeds.
      if (input.isPublished ?? true) {
        await this.notifyModelTestPublished({
          courseId: input.courseId,
          title: input.title,
        });
      }
      return {
        test: {
          courseId: input.courseId,
          durationMinutes: input.durationMinutes,
          id: test.id,
          maxAttempts: input.maxAttempts,
          negativeMark: input.negativeMark.toFixed(2),
          questionCount: questionIds.length,
          shuffleQuestions: input.shuffleQuestions,
          title: input.title,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async getModelTest(testId: string, request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    const id = parseOr400(uuid, testId);
    try {
      const [test] = await db
        .select()
        .from(modelTests)
        .where(eq(modelTests.id, id))
        .limit(1);
      if (!test) throw new NotFoundException('Model test not found.');
      if (profile.role === 'instructor' && test.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
      if (profile.role === 'student') {
        await this.requireEnrolment(profile.id, test.courseId);
      }
      const links = await db
        .select({ questionId: modelTestQuestions.questionId })
        .from(modelTestQuestions)
        .where(eq(modelTestQuestions.testId, id));
      return {
        test: {
          courseId: test.courseId,
          durationMinutes: test.durationMinutes,
          id: test.id,
          isPublished: test.isPublished,
          maxAttempts: test.maxAttempts,
          negativeMark: test.negativeMark,
          questionCount: links.length,
          shuffleQuestions: test.shuffleQuestions,
          title: test.title,
        },
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async startAttempt(testId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const id = parseOr400(uuid, testId);
    try {
      const [test] = await db
        .select()
        .from(modelTests)
        .where(eq(modelTests.id, id))
        .limit(1);
      if (!test || !test.isPublished) {
        throw new NotFoundException('Model test not found.');
      }
      await this.requireEnrolment(profile.id, test.courseId);
      const expiresCheck = (startedAt: Date) =>
        new Date(startedAt.getTime() + test.durationMinutes * 60 * 1000);
      // Resume an unsubmitted, unexpired attempt (same shuffled order).
      const [open] = await db
        .select()
        .from(modelTestAttempts)
        .where(
          and(
            eq(modelTestAttempts.testId, id),
            eq(modelTestAttempts.userId, profile.id),
          ),
        )
        .orderBy(desc(modelTestAttempts.startedAt))
        .limit(1);
      if (open && !open.submittedAt && expiresCheck(open.startedAt) > new Date()) {
        return this.attemptDto(open, test);
      }
      const prior = await db
        .select({ id: modelTestAttempts.id })
        .from(modelTestAttempts)
        .where(
          and(
            eq(modelTestAttempts.testId, id),
            eq(modelTestAttempts.userId, profile.id),
          ),
        );
      if (prior.length >= test.maxAttempts) {
        throw new ConflictException(
          'You have used all attempts for this model test.',
        );
      }
      const links = await db
        .select({ questionId: modelTestQuestions.questionId })
        .from(modelTestQuestions)
        .where(eq(modelTestQuestions.testId, id))
        .orderBy(asc(modelTestQuestions.position));
      if (!links.length) {
        throw new BadRequestException('This model test has no questions yet.');
      }
      const questionIds = links.map((link) => link.questionId);
      const options = await db
        .select()
        .from(questionBankOptions)
        .where(inArray(questionBankOptions.questionId, questionIds))
        .orderBy(asc(questionBankOptions.position));
      // Seed after insert so the attempt id itself is the seed.
      const [attempt] = await db
        .insert(modelTestAttempts)
        .values({
          optionOrder: {},
          questionOrder: questionIds,
          testId: id,
          totalQuestions: questionIds.length,
          userId: profile.id,
        })
        .returning();
      if (!attempt) throw new Error('Attempt could not be started.');
      const orderedIds = test.shuffleQuestions
        ? seededShuffle(questionIds, attempt.id)
        : questionIds;
      const optionOrder: Record<string, string[]> = {};
      for (const questionId of questionIds) {
        const opts = options
          .filter((option) => option.questionId === questionId)
          .map((option) => option.id);
        optionOrder[questionId] = test.shuffleQuestions
          ? seededShuffle(opts, `${attempt.id}:${questionId}`)
          : opts;
      }
      await db
        .update(modelTestAttempts)
        .set({ optionOrder, questionOrder: orderedIds })
        .where(eq(modelTestAttempts.id, attempt.id));
      const saved = { ...attempt, optionOrder, questionOrder: orderedIds };
      return this.attemptDto(saved, test);
    } catch (error) {
      missingTable503(error);
    }
  }

  private async attemptDto(
    attempt: typeof modelTestAttempts.$inferSelect,
    test: typeof modelTests.$inferSelect,
  ) {
    const questions = await db
      .select()
      .from(questionBankQuestions)
      .where(inArray(questionBankQuestions.id, attempt.questionOrder));
    const options = attempt.questionOrder.length
      ? await db
          .select()
          .from(questionBankOptions)
          .where(inArray(questionBankOptions.questionId, attempt.questionOrder))
          .orderBy(asc(questionBankOptions.position))
      : [];
    const byId = new Map(questions.map((row) => [row.id, row]));
    const expiresAt = new Date(
      attempt.startedAt.getTime() + test.durationMinutes * 60 * 1000,
    );
    return {
      attemptId: attempt.id,
      durationMinutes: test.durationMinutes,
      expiresAt: expiresAt.toISOString(),
      questions: attempt.questionOrder.map((questionId) => {
        const question = byId.get(questionId);
        const orderedOptionIds =
          attempt.optionOrder[questionId] ??
          options
            .filter((option) => option.questionId === questionId)
            .map((option) => option.id);
        const optionById = new Map(options.map((row) => [row.id, row]));
        return {
          chapter: question?.chapter ?? null,
          difficulty: question?.difficulty ?? null,
          id: questionId,
          options: orderedOptionIds
            .map((optionId) => optionById.get(optionId))
            .filter(Boolean)
            .map((option) => ({
              id: option!.id,
              optionText: option!.optionText,
            })),
          questionText: question?.questionText ?? '',
          subject: question?.subject ?? null,
          topic: question?.topic ?? null,
        };
      }),
      startedAt: attempt.startedAt.toISOString(),
      testId: test.id,
      title: test.title,
    };
  }

  async submitAttempt(
    testId: string,
    attemptId: string,
    request: Request,
  ) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const id = parseOr400(uuid, testId);
    const aid = parseOr400(uuid, attemptId);
    const input = parseOr400(
      z.object({ answers: z.record(z.string(), z.array(z.string())) }),
      request.body,
    );
    try {
      const [test] = await db
        .select()
        .from(modelTests)
        .where(eq(modelTests.id, id))
        .limit(1);
      if (!test) throw new NotFoundException('Model test not found.');
      const [attempt] = await db
        .select()
        .from(modelTestAttempts)
        .where(
          and(
            eq(modelTestAttempts.id, aid),
            eq(modelTestAttempts.testId, id),
            eq(modelTestAttempts.userId, profile.id),
          ),
        )
        .limit(1);
      if (!attempt) throw new NotFoundException('Attempt not found.');
      if (attempt.submittedAt) {
        throw new ConflictException('This attempt was already submitted.');
      }
      const questions = await db
        .select()
        .from(questionBankQuestions)
        .where(inArray(questionBankQuestions.id, attempt.questionOrder));
      const options = await db
        .select()
        .from(questionBankOptions)
        .where(inArray(questionBankOptions.questionId, attempt.questionOrder));
      const negativeMark = Number(test.negativeMark);
      let correctCount = 0;
      let wrongCount = 0;
      let blankCount = 0;
      const wrongQuestionIds: string[] = [];
      const topicBreakdown: Record<
        string,
        { blank: number; correct: number; total: number; wrong: number }
      > = {};
      for (const questionId of attempt.questionOrder) {
        const question = questions.find((row) => row.id === questionId);
        const topic = question?.topic ?? 'untagged';
        const entry = topicBreakdown[topic] ?? {
          blank: 0,
          correct: 0,
          total: 0,
          wrong: 0,
        };
        entry.total += 1;
        const correctIds = options
          .filter((option) => option.questionId === questionId && option.isCorrect)
          .map((option) => option.id)
          .sort();
        const submitted = [...(input.answers[questionId] ?? [])].sort();
        if (!submitted.length) {
          blankCount += 1;
          entry.blank += 1;
        } else if (
          submitted.length === correctIds.length &&
          submitted.every((value, index) => value === correctIds[index])
        ) {
          correctCount += 1;
          entry.correct += 1;
        } else {
          wrongCount += 1;
          entry.wrong += 1;
          wrongQuestionIds.push(questionId);
        }
        topicBreakdown[topic] = entry;
      }
      const negativeMarkApplied =
        Math.round(wrongCount * negativeMark * 100) / 100;
      const rawScore = correctCount - negativeMarkApplied;
      const score = Math.max(0, Math.round(rawScore * 100) / 100);
      const submittedAt = new Date();
      const expiresAt = new Date(
        attempt.startedAt.getTime() + test.durationMinutes * 60 * 1000,
      );
      // TIMER RULE: a submission after expiry is scored as-is
      // (auto-submitted as-is) and flagged submittedLate, never rejected
      // and never silently extended.
      const submittedLate = submittedAt > expiresAt;
      const finishedInSeconds = Math.max(
        0,
        Math.round(
          (submittedAt.getTime() - attempt.startedAt.getTime()) / 1000,
        ),
      );
      await db
        .update(modelTestAttempts)
        .set({
          answers: input.answers,
          finishedInSeconds,
          score: score.toFixed(2),
          submittedAt,
          submittedLate,
          topicBreakdown,
          wrongQuestionIds,
        })
        .where(eq(modelTestAttempts.id, aid));
      return {
        attemptId: aid,
        blankCount,
        correctCount,
        finishedInSeconds,
        negativeMark,
        negativeMarkApplied,
        percentage: attempt.totalQuestions
          ? Math.round((score / attempt.totalQuestions) * 100)
          : 0,
        score,
        submittedLate,
        testId: id,
        topicBreakdown,
        totalQuestions: attempt.totalQuestions,
        wrongCount,
        wrongQuestionIds,
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async leaderboard(testId: string, request: Request) {
    const profile = await this.requireRole(request, [
      'admin',
      'instructor',
      'student',
    ]);
    const id = parseOr400(uuid, testId);
    try {
      const [test] = await db
        .select()
        .from(modelTests)
        .where(eq(modelTests.id, id))
        .limit(1);
      if (!test) throw new NotFoundException('Model test not found.');
      if (profile.role === 'instructor' && test.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
      if (profile.role === 'student') {
        await this.requireEnrolment(profile.id, test.courseId);
      }
      const attempts = await db
        .select()
        .from(modelTestAttempts)
        .where(eq(modelTestAttempts.testId, id));
      const submitted = attempts.filter(
        (row) => row.submittedAt && row.score !== null,
      );
      // One row per student: their best attempt (score desc, fastest, earliest).
      const bestByUser = new Map<string, typeof submitted[number]>();
      for (const row of submitted) {
        const current = bestByUser.get(row.userId);
        if (!current || compareAttempts(row, current) < 0) {
          bestByUser.set(row.userId, row);
        }
      }
      const ranked = [...bestByUser.values()].sort(compareAttempts);
      const studentRows = ranked.length
        ? await db
            .select({
              email: users.email,
              fullName: profiles.fullName,
              id: profiles.id,
            })
            .from(profiles)
            .innerJoin(users, eq(profiles.userId, users.id))
            .where(inArray(profiles.id, ranked.map((row) => row.userId)))
        : [];
      const studentById = new Map(studentRows.map((row) => [row.id, row]));
      const entry = (row: typeof submitted[number], rank: number) => {
        const student = studentById.get(row.userId);
        return {
          finishedInSeconds: row.finishedInSeconds,
          rank,
          score: Number(row.score),
          studentName: student?.fullName ?? null,
          submittedAt: row.submittedAt!.toISOString(),
          userId: row.userId,
        };
      };
      const full = ranked.map((row, index) => ({
        ...entry(row, index + 1),
        studentEmail: studentById.get(row.userId)?.email ?? null,
      }));
      if (profile.role !== 'student') {
        return { leaderboard: full, testId: id, tiebreak: 'score desc, then fastest finish, then earliest submission' };
      }
      const ownIndex = ranked.findIndex((row) => row.userId === profile.id);
      return {
        leaderboard: ranked.slice(0, 10).map((row, index) => entry(row, index + 1)),
        ownEntry:
          ownIndex >= 0 ? entry(ranked[ownIndex]!, ownIndex + 1) : null,
        ownRank: ownIndex >= 0 ? ownIndex + 1 : null,
        testId: id,
        tiebreak: 'score desc, then fastest finish, then earliest submission',
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  async topicReport(testId: string, request: Request) {
    const profile = await this.requireRole(request, ['admin', 'instructor']);
    const id = parseOr400(uuid, testId);
    try {
      const [test] = await db
        .select({ instructorId: modelTests.instructorId })
        .from(modelTests)
        .where(eq(modelTests.id, id))
        .limit(1);
      if (!test) throw new NotFoundException('Model test not found.');
      if (profile.role === 'instructor' && test.instructorId !== profile.id) {
        throw new ForbiddenException('Access denied.');
      }
      const attempts = await db
        .select({ topicBreakdown: modelTestAttempts.topicBreakdown })
        .from(modelTestAttempts)
        .where(
          and(
            eq(modelTestAttempts.testId, id),
          ),
        );
      const submitted = attempts.filter(
        (row) => row.topicBreakdown && Object.keys(row.topicBreakdown).length,
      );
      const topics: Record<
        string,
        { blank: number; correct: number; total: number; wrong: number }
      > = {};
      for (const attempt of submitted) {
        for (const [topic, values] of Object.entries(attempt.topicBreakdown)) {
          const entry = topics[topic] ?? { blank: 0, correct: 0, total: 0, wrong: 0 };
          entry.correct += values.correct;
          entry.wrong += values.wrong;
          entry.blank += values.blank;
          entry.total += values.total;
          topics[topic] = entry;
        }
      }
      return {
        attemptsCount: submitted.length,
        testId: id,
        topics: Object.entries(topics).map(([topic, values]) => ({
          ...values,
          accuracy: values.total
            ? Math.round((values.correct / values.total) * 100)
            : 0,
          topic,
        })),
      };
    } catch (error) {
      missingTable503(error);
    }
  }

  /**
   * Mistake Bank: only questions this student answered wrongly in their
   * own submitted model-test attempts. Correct answers ARE included:
   * these questions were already attempted by this student, and the
   * existing quiz-review behaviour already reveals correct answers after
   * submission. Questions the student has never attempted never appear.
   */
  async mistakeBank(request: Request) {
    const profile = await this.requireRole(request, ['admin', 'student']);
    const query = request.query as Record<string, string | undefined>;
    try {
      const conditions = [eq(modelTestAttempts.userId, profile.id)];
      if (query.testId) conditions.push(eq(modelTestAttempts.testId, query.testId));
      const attempts = await db
        .select()
        .from(modelTestAttempts)
        .where(and(...conditions))
        .orderBy(desc(modelTestAttempts.submittedAt));
      const wrongIds = [...new Set(attempts.flatMap((row) => row.wrongQuestionIds))];
      if (!wrongIds.length) return { questions: [] };
      const questions = await db
        .select()
        .from(questionBankQuestions)
        .where(inArray(questionBankQuestions.id, wrongIds));
      const filtered = query.topic
        ? questions.filter((row) => row.topic === query.topic)
        : questions;
      const ids = filtered.map((row) => row.id);
      const options = ids.length
        ? await db
            .select()
            .from(questionBankOptions)
            .where(inArray(questionBankOptions.questionId, ids))
            .orderBy(asc(questionBankOptions.position))
        : [];
      const sourceTests = new Map<string, string[]>();
      for (const attempt of attempts) {
        for (const questionId of attempt.wrongQuestionIds) {
          const list = sourceTests.get(questionId) ?? [];
          if (!list.includes(attempt.testId)) list.push(attempt.testId);
          sourceTests.set(questionId, list);
        }
      }
      return {
        questions: filtered.map((row) => ({
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
    } catch (error) {
      missingTable503(error);
    }
  }

  // ---------------- helpers ----------------

  private async requireEnrolment(userId: string, courseId: string) {
    const [enrolment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.userId, userId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1);
    if (!enrolment) {
      throw new ForbiddenException('Active enrollment is required.');
    }
    await assertSubscriptionNotExpired(userId, courseId);
  }

  private async requireRole(
    request: Request,
    roles: string[],
  ): Promise<{ id: string; role: string }> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile) {
      throw new UnauthorizedException('Authentication is required.');
    }
    if (!roles.includes(profile.role)) {
      throw new ForbiddenException('Access denied.');
    }
    return profile;
  }

  /**
   * Best-effort in-app notification to active enrolled students when a
   * model test is published. Never throws.
   */
  private async notifyModelTestPublished(input: {
    courseId: string;
    title: string;
  }) {
    try {
      const rows = await db
        .select({ profileId: enrollments.userId })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.courseId, input.courseId),
            eq(enrollments.status, 'active'),
          ),
        );
      if (!rows.length) return;
      await notifyManySafely(
        rows.map((row) => ({
          body: `A new model test "${input.title}" is available for you to attempt.`,
          href: '/dashboard/student/model-tests',
          profileId: row.profileId,
          title: 'New model test published',
          type: 'model_test_published',
        })),
      );
    } catch (error) {
      console.error('Model-test notification failed.', error);
    }
  }
}

function compareAttempts(
  a: typeof modelTestAttempts.$inferSelect,
  b: typeof modelTestAttempts.$inferSelect,
): number {
  const scoreDiff = Number(b.score) - Number(a.score);
  if (scoreDiff !== 0) return scoreDiff;
  const aTime = a.finishedInSeconds ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.finishedInSeconds ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return (
    (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0)
  );
}
