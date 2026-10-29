import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  inArray,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  authProviders,
  courseLevels,
  courseStatuses,
  enrollmentStatuses,
  orderStatuses,
  paymentMethods,
  payoutStatuses,
  userRoles,
  videoProviders,
} from '../types/index.js';

export const authProviderEnum = pgEnum('auth_provider', authProviders);
export const userRoleEnum = pgEnum('user_role', userRoles);
export const courseLevelEnum = pgEnum('course_level', courseLevels);
export const courseStatusEnum = pgEnum('course_status', courseStatuses);
export const videoProviderEnum = pgEnum('video_provider', videoProviders);
export const enrollmentStatusEnum = pgEnum(
  'enrollment_status',
  enrollmentStatuses,
);
export const orderStatusEnum = pgEnum('order_status', orderStatuses);
export const paymentMethodEnum = pgEnum('payment_method', paymentMethods);
export const payoutStatusEnum = pgEnum('payout_status', payoutStatuses);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    googleId: text('google_id'),
    authProvider: authProviderEnum('auth_provider')
      .notNull()
      .default('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_google_id_unique').on(table.googleId),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fullName: text('full_name'),
    avatarUrl: text('avatar_url'),
    role: userRoleEnum('role').notNull().default('student'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('profiles_user_id_unique').on(table.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(table.tokenHash),
    index('refresh_tokens_user_id_idx').on(table.userId),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_token_hash_unique').on(table.tokenHash),
    index('password_reset_tokens_user_id_idx').on(table.userId),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('email_verification_tokens_token_hash_unique').on(
      table.tokenHash,
    ),
    index('email_verification_tokens_user_id_idx').on(table.userId),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    shortDescription: text('short_description'),
    description: text('description'),
    category: varchar('category', { length: 120 }),
    level: courseLevelEnum('level').notNull().default('all_levels'),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    offerTitle: text('offer_title'),
    offerPrice: numeric('offer_price', { precision: 12, scale: 2 }),
    offerStartsAt: timestamp('offer_starts_at', { withTimezone: true }),
    offerEndsAt: timestamp('offer_ends_at', { withTimezone: true }),
    currency: varchar('currency', { length: 3 }).notNull().default('BDT'),
    thumbnailUrl: text('thumbnail_url'),
    status: courseStatusEnum('status').notNull().default('draft'),
    enrollmentEnabled: boolean('enrollment_enabled').notNull().default(true),
    enrollmentEndsAt: timestamp('enrollment_ends_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('courses_slug_unique').on(table.slug),
    index('courses_instructor_id_idx').on(table.instructorId),
    index('courses_status_idx').on(table.status),
    check('courses_price_non_negative', sql`${table.price} >= 0`),
    check(
      'courses_offer_price_non_negative',
      sql`${table.offerPrice} is null or ${table.offerPrice} >= 0`,
    ),
  ],
);

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    dripAfterDays: integer('drip_after_days').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('sections_course_position_unique').on(
      table.courseId,
      table.position,
    ),
    check('sections_position_non_negative', sql`${table.position} >= 0`),
    check(
      'sections_drip_after_days_non_negative',
      sql`${table.dripAfterDays} >= 0`,
    ),
  ],
);

export const lectures = pgTable(
  'lectures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    videoProvider: videoProviderEnum('video_provider').notNull().default('r2'),
    // This is an R2 object key today, not a public URL. The backend resolves it later.
    videoRef: text('video_ref'),
    pdfUrl: text('pdf_url'),
    slidesUrl: text('slides_url'),
    durationSeconds: integer('duration_seconds'),
    isPreview: boolean('is_preview').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(false),
    availableAt: timestamp('available_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('lectures_section_position_unique').on(
      table.sectionId,
      table.position,
    ),
    check('lectures_position_non_negative', sql`${table.position} >= 0`),
    check(
      'lectures_duration_seconds_non_negative',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
  ],
);

/** New course hierarchy: a milestone contains modules. */
export const modules = pgTable(
  'modules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    contentTypes: text('content_types')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    title: text('title').notNull(),
    description: text('description'),
    pdfUrl: text('pdf_url'),
    slidesUrl: text('slides_url'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('modules_milestone_position_unique').on(
      table.milestoneId,
      table.position,
    ),
    index('modules_milestone_id_idx').on(table.milestoneId),
    check('modules_position_non_negative', sql`${table.position} >= 0`),
  ],
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    videoProvider: videoProviderEnum('video_provider').notNull().default('r2'),
    videoRef: text('video_ref'),
    pdfUrl: text('pdf_url'),
    slidesUrl: text('slides_url'),
    durationSeconds: integer('duration_seconds'),
    isPreview: boolean('is_preview').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(false),
    availableAt: timestamp('available_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('videos_module_position_unique').on(
      table.moduleId,
      table.position,
    ),
    index('videos_module_id_idx').on(table.moduleId),
    check('videos_position_non_negative', sql`${table.position} >= 0`),
    check(
      'videos_duration_seconds_non_negative',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
  ],
);

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id').references(() => sections.id, {
      onDelete: 'cascade',
    }),
    lectureId: uuid('lecture_id').references(() => lectures.id, {
      onDelete: 'cascade',
    }),
    moduleId: uuid('module_id').references(() => modules.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('quizzes_section_id_unique').on(table.sectionId),
    uniqueIndex('quizzes_lecture_id_unique').on(table.lectureId),
    uniqueIndex('quizzes_module_id_unique').on(table.moduleId),
    index('quizzes_course_id_idx').on(table.courseId),
    check(
      'quizzes_exactly_one_target',
      sql`(
      (${table.sectionId} is not null and ${table.lectureId} is null and ${table.moduleId} is null) or
      (${table.sectionId} is null and ${table.lectureId} is not null and ${table.moduleId} is null) or
      (${table.sectionId} is null and ${table.lectureId} is null and ${table.moduleId} is not null)
    )`,
    ),
  ],
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    questionText: text('question_text').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('quiz_questions_quiz_position_unique').on(
      table.quizId,
      table.position,
    ),
    index('quiz_questions_quiz_id_idx').on(table.quizId),
    check('quiz_questions_position_non_negative', sql`${table.position} >= 0`),
  ],
);

export const quizOptions = pgTable(
  'quiz_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => quizQuestions.id, { onDelete: 'cascade' }),
    optionText: text('option_text').notNull(),
    position: integer('position').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('quiz_options_question_position_unique').on(
      table.questionId,
      table.position,
    ),
    index('quiz_options_question_id_idx').on(table.questionId),
    check('quiz_options_position_non_negative', sql`${table.position} >= 0`),
  ],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    answers: jsonb('answers')
      .$type<Record<string, string[]>>()
      .notNull()
      .default({}),
    score: integer('score').notNull(),
    totalQuestions: integer('total_questions').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('quiz_attempts_quiz_id_idx').on(table.quizId),
    index('quiz_attempts_user_id_idx').on(table.userId),
    uniqueIndex('quiz_attempts_quiz_user_unique').on(
      table.quizId,
      table.userId,
    ),
    check('quiz_attempts_score_non_negative', sql`${table.score} >= 0`),
    check(
      'quiz_attempts_total_questions_non_negative',
      sql`${table.totalQuestions} >= 0`,
    ),
    check(
      'quiz_attempts_score_lte_total',
      sql`${table.score} <= ${table.totalQuestions}`,
    ),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id').references(() => sections.id, {
      onDelete: 'cascade',
    }),
    lectureId: uuid('lecture_id').references(() => lectures.id, {
      onDelete: 'cascade',
    }),
    moduleId: uuid('module_id').references(() => modules.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    maxScore: integer('max_score').notNull().default(100),
    isPublished: boolean('is_published').notNull().default(false),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('assignments_section_id_unique').on(table.sectionId),
    uniqueIndex('assignments_lecture_id_unique').on(table.lectureId),
    uniqueIndex('assignments_module_id_unique').on(table.moduleId),
    index('assignments_course_id_idx').on(table.courseId),
    check('assignments_max_score_positive', sql`${table.maxScore} > 0`),
    check(
      'assignments_exactly_one_target',
      sql`(
      (${table.sectionId} is not null and ${table.lectureId} is null and ${table.moduleId} is null) or
      (${table.sectionId} is null and ${table.lectureId} is not null and ${table.moduleId} is null) or
      (${table.sectionId} is null and ${table.lectureId} is null and ${table.moduleId} is not null)
    )`,
    ),
  ],
);

export const assignmentSubmissions = pgTable(
  'assignment_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    submissionText: text('submission_text').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    gradeScore: integer('grade_score'),
    gradeFeedback: text('grade_feedback'),
    gradedBy: uuid('graded_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('assignment_submissions_assignment_user_unique').on(
      table.assignmentId,
      table.userId,
    ),
    index('assignment_submissions_assignment_id_idx').on(table.assignmentId),
    index('assignment_submissions_user_id_idx').on(table.userId),
    check(
      'assignment_submissions_grade_score_non_negative',
      sql`${table.gradeScore} is null or ${table.gradeScore} >= 0`,
    ),
  ],
);

export const discussionPosts = pgTable(
  'discussion_posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    lectureId: uuid('lecture_id').references(() => lectures.id, {
      onDelete: 'cascade',
    }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('discussion_posts_course_id_idx').on(table.courseId, table.createdAt),
    index('discussion_posts_lecture_id_idx').on(table.lectureId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    href: text('href'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('notifications_profile_created_idx').on(
      table.profileId,
      table.createdAt,
    ),
  ],
);

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('announcements_course_created_idx').on(
      table.courseId,
      table.createdAt,
    ),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('categories_slug_unique').on(table.slug),
    index('categories_active_idx').on(table.isActive),
  ],
);

export const siteSettings = pgTable('site_settings', {
  key: varchar('key', { length: 120 }).primaryKey(),
  value: text('value').notNull().default(''),
  updatedBy: uuid('updated_by').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 80 }).notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_logs_created_idx').on(table.createdAt),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  ],
);

export const refundStatuses = [
  'requested',
  'approved',
  'rejected',
  'processed',
] as const;
export const refundStatusEnum = pgEnum('refund_status', refundStatuses);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('BDT'),
    reason: text('reason').notNull(),
    status: refundStatusEnum('status').notNull().default('requested'),
    requestedBy: uuid('requested_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One OPEN refund request per order. A rejected request does not block
    // a fresh request: the partial index only covers requested/approved/
    // processed rows, so a student can re-apply after a rejection.
    uniqueIndex('refunds_order_unique')
      .on(table.orderId)
      .where(inArray(table.status, ['requested', 'approved', 'processed'])),
    index('refunds_status_created_idx').on(table.status, table.createdAt),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('BDT'),
    couponCode: varchar('coupon_code', { length: 64 }),
    referenceCode: varchar('reference_code', { length: 64 }).notNull(),
    status: orderStatusEnum('status').notNull().default('pending_verification'),
    paymentMethod: paymentMethodEnum('payment_method'),
    transactionId: varchar('transaction_id', { length: 255 }),
    senderNumber: varchar('sender_number', { length: 64 }),
    proofScreenshotUrl: text('proof_screenshot_url'),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('orders_reference_code_unique').on(table.referenceCode),
    index('orders_user_id_idx').on(table.userId),
    index('orders_course_id_idx').on(table.courseId),
    index('orders_status_created_at_idx').on(table.status, table.createdAt),
    check('orders_amount_non_negative', sql`${table.amount} >= 0`),
    check(
      'orders_discount_amount_non_negative',
      sql`${table.discountAmount} >= 0`,
    ),
  ],
);

export const payoutRequests = pgTable(
  'payout_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('BDT'),
    referenceCode: varchar('reference_code', { length: 64 }).notNull(),
    status: payoutStatusEnum('status').notNull().default('pending'),
    note: text('note'),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('payout_requests_reference_code_unique').on(
      table.referenceCode,
    ),
    index('payout_requests_instructor_id_idx').on(table.instructorId),
    index('payout_requests_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
    check('payout_requests_amount_non_negative', sql`${table.amount} >= 0`),
  ],
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    status: enrollmentStatusEnum('status').notNull().default('active'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('enrollments_user_course_unique').on(
      table.userId,
      table.courseId,
    ),
    uniqueIndex('enrollments_order_id_unique').on(table.orderId),
    index('enrollments_course_id_idx').on(table.courseId),
  ],
);

export const progress = pgTable(
  'progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    positionSeconds: integer('position_seconds').notNull().default(0),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastWatchedAt: timestamp('last_watched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('progress_user_lecture_unique').on(
      table.userId,
      table.lectureId,
    ),
    index('progress_lecture_id_idx').on(table.lectureId),
    check(
      'progress_position_seconds_non_negative',
      sql`${table.positionSeconds} >= 0`,
    ),
  ],
);

export const videoProgress = pgTable(
  'video_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    positionSeconds: integer('position_seconds').notNull().default(0),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastWatchedAt: timestamp('last_watched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('video_progress_user_video_unique').on(
      table.userId,
      table.videoId,
    ),
    index('video_progress_video_id_idx').on(table.videoId),
  ],
);

/**
 * Feature set 5 (bundles / subscriptions / instalments / question bank /
 * model tests). These tables are defined here so a migration can be
 * generated with `pnpm db:generate`, but they do NOT exist in the live
 * database until that migration is applied. Every service that touches
 * them converts a Postgres "undefined table" error (42P01) into a 503
 * naming the missing table — see src/sales/sales-helpers.ts — so a
 * migration-dependent endpoint never returns fake success data.
 */
export const subscriptionStatuses = [
  'pending',
  'active',
  'expired',
  'cancelled',
] as const;
export const subscriptionStatusEnum = pgEnum(
  'subscription_status',
  subscriptionStatuses,
);
export const instalmentStatuses = ['pending', 'paid', 'overdue'] as const;
export const instalmentStatusEnum = pgEnum(
  'instalment_status',
  instalmentStatuses,
);
export const questionDifficulties = ['easy', 'medium', 'hard'] as const;
export const questionDifficultyEnum = pgEnum(
  'question_difficulty',
  questionDifficulties,
);

export const bundles = pgTable(
  'bundles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    originalPrice: numeric('original_price', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 3 }).notNull().default('BDT'),
    /** Optional time-box: access lasts this many days once paid. Null = no expiry. */
    durationDays: integer('duration_days'),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('bundles_instructor_id_idx').on(table.instructorId),
    check('bundles_price_non_negative', sql`${table.price} >= 0`),
  ],
);

export const bundleCourses = pgTable(
  'bundle_courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bundleId: uuid('bundle_id')
      .notNull()
      .references(() => bundles.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    uniqueIndex('bundle_courses_bundle_course_unique').on(
      table.bundleId,
      table.courseId,
    ),
    index('bundle_courses_bundle_id_idx').on(table.bundleId),
  ],
);

/** One row per order line beyond the order's own courseId (bundle members, order bumps). */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /** True when added by the checkout order-bump endpoint, false for bundle members. */
    isOrderBump: boolean('is_order_bump').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('order_items_order_course_unique').on(
      table.orderId,
      table.courseId,
    ),
    index('order_items_order_id_idx').on(table.orderId),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    targetType: varchar('target_type', { length: 16 }).notNull(),
    targetId: uuid('target_id').notNull(),
    months: integer('months').notNull(),
    /** Days form of the period, used for bundle subscriptions. */
    durationDays: integer('duration_days'),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    status: subscriptionStatusEnum('status').notNull().default('pending'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('subscriptions_user_id_idx').on(table.userId),
    index('subscriptions_target_idx').on(table.targetType, table.targetId),
    check('subscriptions_months_positive', sql`${table.months} > 0`),
  ],
);

export const orderInstalments = pgTable(
  'order_instalments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    status: instalmentStatusEnum('status').notNull().default('pending'),
    senderNumber: varchar('sender_number', { length: 64 }),
    transactionId: varchar('transaction_id', { length: 255 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('order_instalments_order_id_idx').on(table.orderId),
    check('order_instalments_amount_positive', sql`${table.amount} > 0`),
  ],
);

/** Checkout-started but never proof-submitted. No mail/SMS is sent from this. */
export const abandonedCarts = pgTable(
  'abandoned_carts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    items: jsonb('items')
      .$type<Array<{ courseId?: string; bundleId?: string }>>()
      .notNull()
      .default([]),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recovered: boolean('recovered').notNull().default(false),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('abandoned_carts_user_id_idx').on(table.userId)],
);

/** A question stored once, reusable across many model tests. */
export const questionBankQuestions = pgTable(
  'question_bank_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    courseId: uuid('course_id').references(() => courses.id, {
      onDelete: 'set null',
    }),
    questionText: text('question_text').notNull(),
    explanation: text('explanation'),
    subject: varchar('subject', { length: 180 }),
    chapter: varchar('chapter', { length: 180 }),
    topic: varchar('topic', { length: 180 }),
    difficulty: questionDifficultyEnum('difficulty')
      .notNull()
      .default('medium'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('question_bank_instructor_idx').on(table.instructorId),
    index('question_bank_topic_idx').on(table.topic),
  ],
);

export const questionBankOptions = pgTable(
  'question_bank_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questionBankQuestions.id, { onDelete: 'cascade' }),
    optionText: text('option_text').notNull(),
    position: integer('position').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
  },
  (table) => [
    uniqueIndex('question_bank_options_question_position_unique').on(
      table.questionId,
      table.position,
    ),
    index('question_bank_options_question_idx').on(table.questionId),
  ],
);

export const modelTests = pgTable(
  'model_tests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    /**
     * Points deducted per wrong (non-blank) answer. Default 0: no teacher
     * setting means no negative marking. Example values only — BCS-style
     * -0.50 and admission-style -0.25 are NOT defaults and are never
     * applied unless the teacher sets them on this test.
     */
    negativeMark: numeric('negative_mark', { precision: 6, scale: 2 })
      .notNull()
      .default('0'),
    shuffleQuestions: boolean('shuffle_questions').notNull().default(true),
    maxAttempts: integer('max_attempts').notNull().default(1),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('model_tests_course_idx').on(table.courseId),
    index('model_tests_instructor_idx').on(table.instructorId),
    check('model_tests_duration_positive', sql`${table.durationMinutes} > 0`),
    check('model_tests_negative_mark_non_negative', sql`${table.negativeMark} >= 0`),
    check('model_tests_max_attempts_positive', sql`${table.maxAttempts} > 0`),
  ],
);

export const modelTestQuestions = pgTable(
  'model_test_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    testId: uuid('test_id')
      .notNull()
      .references(() => modelTests.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questionBankQuestions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    uniqueIndex('model_test_questions_test_question_unique').on(
      table.testId,
      table.questionId,
    ),
    index('model_test_questions_test_idx').on(table.testId),
  ],
);

export const modelTestAttempts = pgTable(
  'model_test_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    testId: uuid('test_id')
      .notNull()
      .references(() => modelTests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Seeded per-attempt question/option order, so one attempt is stable. */
    questionOrder: jsonb('question_order')
      .$type<string[]>()
      .notNull()
      .default([]),
    optionOrder: jsonb('option_order')
      .$type<Record<string, string[]>>()
      .notNull()
      .default({}),
    answers: jsonb('answers')
      .$type<Record<string, string[]>>()
      .notNull()
      .default({}),
    score: numeric('score', { precision: 10, scale: 2 }),
    totalQuestions: integer('total_questions').notNull(),
    wrongQuestionIds: jsonb('wrong_question_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    topicBreakdown: jsonb('topic_breakdown')
      .$type<Record<string, { correct: number; wrong: number; blank: number; total: number }>>()
      .notNull()
      .default({}),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedLate: boolean('submitted_late').notNull().default(false),
    finishedInSeconds: integer('finished_in_seconds'),
  },
  (table) => [
    index('model_test_attempts_test_idx').on(table.testId),
    index('model_test_attempts_user_idx').on(table.userId),
  ],
);

export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    certificateUrl: text('certificate_url').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    verificationCode: varchar('verification_code', { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex('certificates_user_course_unique').on(
      table.userId,
      table.courseId,
    ),
    uniqueIndex('certificates_verification_code_unique').on(
      table.verificationCode,
    ),
    index('certificates_user_id_idx').on(table.userId),
    index('certificates_course_id_idx').on(table.courseId),
  ],
);

/**
 * Next batch (batches / affiliates / live classes / spaced revision).
 * Same pattern as feature set 5: these tables are defined here so a
 * migration can be generated with `pnpm db:generate`, but they do NOT
 * exist in the live database until that migration is applied. Every
 * service that touches them converts a Postgres "undefined table"
 * error (42P01) into a 503 naming the missing table (see
 * src/sales/sales-helpers.ts `missingTable503`), never fake success
 * data. No existing table or column was altered.
 */

// ---- Batches / cohorts + drip + per-batch deadlines ----

export const batches = pgTable(
  'batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    enrolmentStartAt: timestamp('enrolment_start_at', { withTimezone: true }),
    enrolmentEndAt: timestamp('enrolment_end_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('batches_course_id_idx').on(table.courseId),
    index('batches_instructor_id_idx').on(table.instructorId),
  ],
);

export const batchMembers = pgTable(
  'batch_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('batch_members_batch_user_unique').on(
      table.batchId,
      table.userId,
    ),
    index('batch_members_batch_id_idx').on(table.batchId),
    index('batch_members_user_id_idx').on(table.userId),
  ],
);

/** Drip rule: milestoneId is a sections.id; moduleId is a modules.id. */
export const batchDripRules = pgTable(
  'batch_drip_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => sections.id, {
      onDelete: 'cascade',
    }),
    moduleId: uuid('module_id').references(() => modules.id, {
      onDelete: 'cascade',
    }),
    releaseType: varchar('release_type', { length: 16 })
      .notNull()
      .default('relative'),
    releaseDays: integer('release_days'),
    releaseAt: timestamp('release_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('batch_drip_rules_batch_id_idx').on(table.batchId),
    check(
      'batch_drip_rules_target_present',
      sql`${table.milestoneId} is not null or ${table.moduleId} is not null`,
    ),
    check(
      'batch_drip_rules_release_days_non_negative',
      sql`${table.releaseDays} is null or ${table.releaseDays} >= 0`,
    ),
  ],
);

/**
 * Per-batch assignment deadline. latePenaltyPercent defaults to 0:
 * no teacher setting means no marks are ever deducted on its own.
 */
export const batchDeadlines = pgTable(
  'batch_deadlines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    allowLate: boolean('allow_late').notNull().default(false),
    latePenaltyPercent: integer('late_penalty_percent')
      .notNull()
      .default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('batch_deadlines_batch_assignment_unique').on(
      table.batchId,
      table.assignmentId,
    ),
    index('batch_deadlines_batch_id_idx').on(table.batchId),
    check(
      'batch_deadlines_penalty_range',
      sql`${table.latePenaltyPercent} >= 0 and ${table.latePenaltyPercent} <= 100`,
    ),
  ],
);

/**
 * Late-submission flags. A NEW table on purpose: the existing
 * assignment_submissions table is not altered. submitAssignment writes
 * one row here (best-effort, swallowed pre-migration) when a submission
 * lands after an applicable batch deadline (or the assignment's own
 * dueAt); gradeAssignmentSubmission applies latePenaltyPercent only
 * when a flag row carries a percentage above 0.
 */
export const assignmentLateFlags = pgTable(
  'assignment_late_flags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    isLate: boolean('is_late').notNull().default(true),
    latePenaltyPercent: integer('late_penalty_percent')
      .notNull()
      .default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('assignment_late_flags_assignment_user_unique').on(
      table.assignmentId,
      table.userId,
    ),
    index('assignment_late_flags_assignment_id_idx').on(table.assignmentId),
  ],
);

// ---- Affiliates / referrals (manual payout approval only) ----

export const affiliateLinks = pgTable(
  'affiliate_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 64 }).notNull(),
    commissionType: varchar('commission_type', { length: 16 })
      .notNull()
      .default('percent'),
    commissionValue: numeric('commission_value', {
      precision: 12,
      scale: 2,
    }).notNull(),
    scopeType: varchar('scope_type', { length: 16 })
      .notNull()
      .default('all'),
    scopeId: uuid('scope_id'),
    isReferral: boolean('is_referral').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('affiliate_links_code_unique').on(table.code),
    index('affiliate_links_owner_id_idx').on(table.ownerId),
    check(
      'affiliate_links_commission_non_negative',
      sql`${table.commissionValue} >= 0`,
    ),
  ],
);

export const affiliateTracks = pgTable(
  'affiliate_tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => affiliateLinks.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 64 }).notNull(),
    trackedAt: timestamp('tracked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('affiliate_tracks_link_id_idx').on(table.linkId)],
);

export const affiliateAttributions = pgTable(
  'affiliate_attributions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id')
      .notNull()
      .references(() => affiliateLinks.id, { onDelete: 'cascade' }),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('affiliate_attributions_order_id_unique').on(table.orderId),
    index('affiliate_attributions_referrer_id_idx').on(table.referrerId),
  ],
);

export const affiliateCommissions = pgTable(
  'affiliate_commissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    attributionId: uuid('attribution_id').references(
      () => affiliateAttributions.id,
      { onDelete: 'set null' },
    ),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('affiliate_commissions_order_id_unique').on(table.orderId),
    index('affiliate_commissions_referrer_id_idx').on(table.referrerId),
  ],
);

export const affiliatePayouts = pgTable(
  'affiliate_payouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    note: text('note'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('affiliate_payouts_referrer_id_idx').on(table.referrerId),
    check(
      'affiliate_payouts_amount_positive',
      sql`${table.amount} > 0`,
    ),
  ],
);

// ---- Link-based live classes (no WebRTC / recording server) ----

export const liveClasses = pgTable(
  'live_classes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').references(() => batches.id, {
      onDelete: 'set null',
    }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    meetingUrl: text('meeting_url').notNull(),
    provider: varchar('provider', { length: 16 }).notNull().default('other'),
    recordingUrl: text('recording_url'),
    recordingTitle: text('recording_title'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('live_classes_course_id_idx').on(table.courseId),
    index('live_classes_batch_id_idx').on(table.batchId),
    index('live_classes_instructor_id_idx').on(table.instructorId),
  ],
);

/** Attendance is ONLY teacher-marked; a link click never creates a row. */
export const liveClassAttendance = pgTable(
  'live_class_attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    liveClassId: uuid('live_class_id')
      .notNull()
      .references(() => liveClasses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    present: boolean('present').notNull(),
    markedBy: uuid('marked_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    markedAt: timestamp('marked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('live_class_attendance_class_user_unique').on(
      table.liveClassId,
      table.userId,
    ),
    index('live_class_attendance_class_id_idx').on(table.liveClassId),
  ],
);

// ---- Spaced revision: flashcards (simple SM-2, not FSRS) ----

export const flashcards = pgTable(
  'flashcards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
    subject: varchar('subject', { length: 180 }),
    chapter: varchar('chapter', { length: 180 }),
    topic: varchar('topic', { length: 180 }),
    questionBankQuestionId: uuid('question_bank_question_id').references(
      () => questionBankQuestions.id,
      { onDelete: 'set null' },
    ),
    ease: numeric('ease', { precision: 4, scale: 2 }).notNull().default('2.5'),
    intervalDays: integer('interval_days').notNull().default(0),
    repetitions: integer('repetitions').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('flashcards_user_id_idx').on(table.userId),
    index('flashcards_user_due_idx').on(table.userId, table.dueAt),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('bookmarks_user_type_target_unique').on(
      table.userId,
      table.type,
      table.targetId,
    ),
    index('bookmarks_user_id_idx').on(table.userId),
  ],
);

export const studentNotes = pgTable(
  'student_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id').references(() => lectures.id, {
      onDelete: 'cascade',
    }),
    questionId: uuid('question_id').references(
      () => questionBankQuestions.id,
      { onDelete: 'cascade' },
    ),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('student_notes_user_id_idx').on(table.userId)],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles),
  refreshTokens: many(refreshTokens),
  passwordResetTokens: many(passwordResetTokens),
  emailVerificationTokens: many(emailVerificationTokens),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
  courses: many(courses, { relationName: 'course_instructor' }),
  enrollments: many(enrollments),
  quizAttempts: many(quizAttempts),
  assignmentSubmissions: many(assignmentSubmissions, {
    relationName: 'assignment_submission_student',
  }),
  gradedAssignmentSubmissions: many(assignmentSubmissions, {
    relationName: 'assignment_submission_grader',
  }),
  studentOrders: many(orders, { relationName: 'order_student' }),
  reviewedOrders: many(orders, { relationName: 'order_reviewer' }),
  progress: many(progress),
  videoProgress: many(videoProgress),
  certificates: many(certificates),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  instructor: one(profiles, {
    fields: [courses.instructorId],
    references: [profiles.id],
    relationName: 'course_instructor',
  }),
  sections: many(sections),
  enrollments: many(enrollments),
  orders: many(orders),
  quizzes: many(quizzes),
  assignments: many(assignments),
  certificates: many(certificates),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  course: one(courses, {
    fields: [sections.courseId],
    references: [courses.id],
  }),
  lectures: many(lectures),
  modules: many(modules),
  quizzes: many(quizzes),
  assignments: many(assignments),
}));

export const modulesRelations = relations(modules, ({ one, many }) => ({
  milestone: one(sections, {
    fields: [modules.milestoneId],
    references: [sections.id],
  }),
  videos: many(videos),
  quizzes: many(quizzes),
  assignments: many(assignments),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  module: one(modules, {
    fields: [videos.moduleId],
    references: [modules.id],
  }),
  progress: many(videoProgress),
}));

export const lecturesRelations = relations(lectures, ({ one, many }) => ({
  section: one(sections, {
    fields: [lectures.sectionId],
    references: [sections.id],
  }),
  progress: many(progress),
  quizzes: many(quizzes),
  assignments: many(assignments),
}));

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  course: one(courses, {
    fields: [quizzes.courseId],
    references: [courses.id],
  }),
  section: one(sections, {
    fields: [quizzes.sectionId],
    references: [sections.id],
  }),
  lecture: one(lectures, {
    fields: [quizzes.lectureId],
    references: [lectures.id],
  }),
  module: one(modules, {
    fields: [quizzes.moduleId],
    references: [modules.id],
  }),
  questions: many(quizQuestions),
  attempts: many(quizAttempts),
}));

export const quizQuestionsRelations = relations(
  quizQuestions,
  ({ one, many }) => ({
    quiz: one(quizzes, {
      fields: [quizQuestions.quizId],
      references: [quizzes.id],
    }),
    options: many(quizOptions),
  }),
);

export const quizOptionsRelations = relations(quizOptions, ({ one }) => ({
  question: one(quizQuestions, {
    fields: [quizOptions.questionId],
    references: [quizQuestions.id],
  }),
}));

export const quizAttemptsRelations = relations(quizAttempts, ({ one }) => ({
  quiz: one(quizzes, {
    fields: [quizAttempts.quizId],
    references: [quizzes.id],
  }),
  student: one(profiles, {
    fields: [quizAttempts.userId],
    references: [profiles.id],
  }),
}));

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  course: one(courses, {
    fields: [assignments.courseId],
    references: [courses.id],
  }),
  section: one(sections, {
    fields: [assignments.sectionId],
    references: [sections.id],
  }),
  lecture: one(lectures, {
    fields: [assignments.lectureId],
    references: [lectures.id],
  }),
  module: one(modules, {
    fields: [assignments.moduleId],
    references: [modules.id],
  }),
  submissions: many(assignmentSubmissions),
}));

export const assignmentSubmissionsRelations = relations(
  assignmentSubmissions,
  ({ one }) => ({
    assignment: one(assignments, {
      fields: [assignmentSubmissions.assignmentId],
      references: [assignments.id],
    }),
    student: one(profiles, {
      fields: [assignmentSubmissions.userId],
      references: [profiles.id],
      relationName: 'assignment_submission_student',
    }),
    grader: one(profiles, {
      fields: [assignmentSubmissions.gradedBy],
      references: [profiles.id],
      relationName: 'assignment_submission_grader',
    }),
  }),
);

export const ordersRelations = relations(orders, ({ one }) => ({
  student: one(profiles, {
    fields: [orders.userId],
    references: [profiles.id],
    relationName: 'order_student',
  }),
  course: one(courses, {
    fields: [orders.courseId],
    references: [courses.id],
  }),
  reviewer: one(profiles, {
    fields: [orders.reviewedBy],
    references: [profiles.id],
    relationName: 'order_reviewer',
  }),
  enrollment: one(enrollments),
}));

export const payoutRequestsRelations = relations(payoutRequests, ({ one }) => ({
  instructor: one(profiles, {
    fields: [payoutRequests.instructorId],
    references: [profiles.id],
    relationName: 'payout_request_instructor',
  }),
  reviewer: one(profiles, {
    fields: [payoutRequests.reviewedBy],
    references: [profiles.id],
    relationName: 'payout_request_reviewer',
  }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(profiles, {
    fields: [enrollments.userId],
    references: [profiles.id],
  }),
  course: one(courses, {
    fields: [enrollments.courseId],
    references: [courses.id],
  }),
  order: one(orders, {
    fields: [enrollments.orderId],
    references: [orders.id],
  }),
}));

export const progressRelations = relations(progress, ({ one }) => ({
  student: one(profiles, {
    fields: [progress.userId],
    references: [profiles.id],
  }),
  lecture: one(lectures, {
    fields: [progress.lectureId],
    references: [lectures.id],
  }),
}));

export const videoProgressRelations = relations(videoProgress, ({ one }) => ({
  student: one(profiles, {
    fields: [videoProgress.userId],
    references: [profiles.id],
  }),
  video: one(videos, {
    fields: [videoProgress.videoId],
    references: [videos.id],
  }),
}));

export const certificatesRelations = relations(certificates, ({ one }) => ({
  student: one(profiles, {
    fields: [certificates.userId],
    references: [profiles.id],
  }),
  course: one(courses, {
    fields: [certificates.courseId],
    references: [courses.id],
  }),
}));

/**
 * Course reviews: one visible review per (course, student). Students need
 * a paid/active enrolment to write one. Admins hide instead of delete,
 * so history stays auditable.
 */
export const courseReviews = pgTable(
  'course_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    body: text('body'),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('course_reviews_course_student_unique').on(
      table.courseId,
      table.studentId,
    ),
    index('course_reviews_course_visible_idx').on(
      table.courseId,
      table.isHidden,
      table.createdAt,
    ),
    check(
      'course_reviews_rating_range',
      sql`${table.rating} >= 1 and ${table.rating} <= 5`,
    ),
  ],
);

export const reviewReplies = pgTable(
  'review_replies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => courseReviews.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('review_replies_review_idx').on(table.reviewId)],
);

// Instructor <-> student messaging (text-only, max 2000 chars). No file
// uploads. Threads are scoped to a course and the two parties.
export const messageThreads = pgTable(
  'message_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 200 }).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('message_threads_student_idx').on(
      table.studentId,
      table.lastMessageAt,
    ),
    index('message_threads_instructor_idx').on(
      table.instructorId,
      table.lastMessageAt,
    ),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => messageThreads.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('messages_thread_created_idx').on(table.threadId, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type EmailVerificationToken =
  typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken =
  typeof emailVerificationTokens.$inferInsert;
export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
export type Section = typeof sections.$inferSelect;
export type NewSection = typeof sections.$inferInsert;
export type Lecture = typeof lectures.$inferSelect;
export type NewLecture = typeof lectures.$inferInsert;
export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type NewQuizQuestion = typeof quizQuestions.$inferInsert;
export type QuizOption = typeof quizOptions.$inferSelect;
export type NewQuizOption = typeof quizOptions.$inferInsert;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type NewQuizAttempt = typeof quizAttempts.$inferInsert;
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type AssignmentSubmission = typeof assignmentSubmissions.$inferSelect;
export type NewAssignmentSubmission = typeof assignmentSubmissions.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type PayoutRequest = typeof payoutRequests.$inferSelect;
export type NewPayoutRequest = typeof payoutRequests.$inferInsert;
export type Enrollment = typeof enrollments.$inferSelect;
export type NewEnrollment = typeof enrollments.$inferInsert;
export type Progress = typeof progress.$inferSelect;
export type NewProgress = typeof progress.$inferInsert;
export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;
export type DiscussionPost = typeof discussionPosts.$inferSelect;
export type NewDiscussionPost = typeof discussionPosts.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type SiteSetting = typeof siteSettings.$inferSelect;
export type NewSiteSetting = typeof siteSettings.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type Bundle = typeof bundles.$inferSelect;
export type NewBundle = typeof bundles.$inferInsert;
export type BundleCourse = typeof bundleCourses.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type OrderInstalment = typeof orderInstalments.$inferSelect;
export type AbandonedCart = typeof abandonedCarts.$inferSelect;
export type QuestionBankQuestion = typeof questionBankQuestions.$inferSelect;
export type QuestionBankOption = typeof questionBankOptions.$inferSelect;
export type ModelTest = typeof modelTests.$inferSelect;
export type ModelTestQuestion = typeof modelTestQuestions.$inferSelect;
export type ModelTestAttempt = typeof modelTestAttempts.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type BatchMember = typeof batchMembers.$inferSelect;
export type BatchDripRule = typeof batchDripRules.$inferSelect;
export type BatchDeadline = typeof batchDeadlines.$inferSelect;
export type AssignmentLateFlag = typeof assignmentLateFlags.$inferSelect;
export type AffiliateLink = typeof affiliateLinks.$inferSelect;
export type AffiliateAttribution = typeof affiliateAttributions.$inferSelect;
export type AffiliateCommission = typeof affiliateCommissions.$inferSelect;
export type AffiliatePayout = typeof affiliatePayouts.$inferSelect;
export type LiveClass = typeof liveClasses.$inferSelect;
export type LiveClassAttendance = typeof liveClassAttendance.$inferSelect;
export type Flashcard = typeof flashcards.$inferSelect;
export type Bookmark = typeof bookmarks.$inferSelect;
export type StudentNote = typeof studentNotes.$inferSelect;
export type CourseReview = typeof courseReviews.$inferSelect;
export type NewCourseReview = typeof courseReviews.$inferInsert;
export type ReviewReply = typeof reviewReplies.$inferSelect;
export type NewReviewReply = typeof reviewReplies.$inferInsert;
export type MessageThread = typeof messageThreads.$inferSelect;
export type NewMessageThread = typeof messageThreads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
