# Migration notes — Feature set 5 (bundles, subscriptions, instalments, seller dashboard, question bank, model tests)

> **Status: migration NOT applied.** The Drizzle schema definitions for the
> tables below live in `src/database/schema.ts`, but no migration has been
> generated or run in this environment (no install/build was run, per the
> coordinator's instructions). **Do not claim the migration-dependent
> endpoints work live until the steps below are completed.**
>
> Generate + apply (on the machine that owns the database):
>
> ```bash
> pnpm db:generate   # drizzle-kit generate --config src/database/drizzle.config.ts
> pnpm db:migrate    # drizzle-kit migrate --config src/database/drizzle.config.ts
> ```
>
> Until then, every endpoint that touches a missing table returns
> **HTTP 503** naming the missing table (see `src/sales/sales-helpers.ts`
> `missingTable503`), never fake success data. Endpoints that only use
> pre-existing tables work without the migration (seller dashboard,
> seller CSV export, announcement draft, refund-estimate fallback for
> single-course orders).

## New tables (all in `src/database/schema.ts`)

| Table | Why it is needed | Key columns |
|---|---|---|
| `bundles` | A purchasable group of courses with its own price. | `instructor_id`, `title`, `price`, `original_price`, `currency`, `duration_days` (null = no expiry), `is_published` |
| `bundle_courses` | Links bundles to their courses (one bundle → many courses). | `bundle_id`, `course_id`, `position`; unique (`bundle_id`, `course_id`) |
| `order_items` | Order lines beyond `orders.course_id`: bundle members and checkout order bumps. The existing `orders` table holds exactly one course, so bundle/bump enrolment on PayConfirm approval cannot be expressed without this. | `order_id`, `course_id`, `amount`, `is_order_bump`; unique (`order_id`, `course_id`) |
| `subscriptions` | Time-boxed access to a course or bundle, with expiry enforced on enrolment checks (`assertSubscriptionNotExpired`). | `user_id`, `target_type` (`course`/`bundle`), `target_id`, `months`, `duration_days`, `order_id`, `status` (`pending`/`active`/`expired`/`cancelled`), `starts_at`, `expires_at` |
| `order_instalments` | A schedule splitting one order into dated payments. | `order_id`, `amount`, `due_date`, `status` (`pending`/`paid`/`overdue` is derived at read time), `sender_number`, `transaction_id`, `paid_at` |
| `abandoned_carts` | Checkout-started events with no proof submitted. No mail/SMS is sent from this table. | `user_id`, `items` (jsonb `[{courseId?, bundleId?}]`), `started_at`, `recovered`, `recovered_at` |
| `question_bank_questions` | Questions stored once and reused across many model tests. The existing `quiz_questions` table requires a `quiz_id`, so it cannot hold reusable bank questions. | `instructor_id`, `course_id` (nullable), `question_text`, `explanation`, `subject`, `chapter`, `topic`, `difficulty` |
| `question_bank_options` | Options for bank questions, with the correct flag. | `question_id`, `option_text`, `position`, `is_correct` |
| `model_tests` | Exam-grade tests separate from legacy quizzes. | `course_id`, `instructor_id`, `title`, `duration_minutes`, `negative_mark` (default `0` — no universal negative-marking rule), `shuffle_questions`, `max_attempts` (default `1`), `is_published` |
| `model_test_questions` | Link table so one bank question attaches to many tests without duplicating its text. | `test_id`, `question_id`, `position`; unique (`test_id`, `question_id`) |
| `model_test_attempts` | Per-student attempts with seeded question/option order, answers, score, topic breakdown and wrong-question ids. | `test_id`, `user_id`, `question_order` (jsonb), `option_order` (jsonb), `answers` (jsonb), `score`, `total_questions`, `wrong_question_ids` (jsonb), `topic_breakdown` (jsonb), `started_at`, `submitted_at`, `submitted_late`, `finished_in_seconds` |

## New enums

`subscription_status`, `instalment_status`, `question_difficulty`
(`easy`/`medium`/`hard`). These are created by the same generated migration.

## No changes to existing tables

No existing table or column was altered. In particular:

- `orders`, `enrollments`, `payments` flow: unchanged. Payment stays
  automatic via PayConfirm (student submits sender number + Transaction
  ID; proof verification approves the order). No manual admin
  order approve/reject was reintroduced, and no payment gateway was added.
- Subscription expiry is enforced by a new helper that reads the new
  `subscriptions` table and is skipped when the table does not exist, so
  existing learning/quiz access keeps working before the migration.
- The 8 prior fixes were not touched (see `git status` — only
  `src/payments/payments.service.ts` gained a post-approval hook that
  enrols `order_items` courses and activates pending subscriptions; it
  is a no-op while the new tables are missing).

## Rules that live in code (not in the migration)

- Instalment access: granted on the **first** paid instalment; later
  overdue instalments do not revoke access.
  (`src/sales/sales-helpers.ts` header comment, `payInstalment`.)
- Refunds: bundle only before any course is started; subscription
  prorated by unused days only within 14 days of activation; instalment
  refund = paid minus consumed period. Implemented as pure estimators in
  `refundRules` plus `GET /orders/:orderId/refund-estimate`; actual
  refunds still go through the existing refunds/admin flow.
- Model-test timer: a submission after expiry is **scored as-is and
  flagged `submittedLate: true`**, never rejected and never extended.
- Negative marking: default `0`; the teacher sets `negativeMark` per
  test. Example values (BCS-style −0.50, admission-style −0.25) appear
  only in comments, never as defaults.
- Leaderboard tiebreak: score desc, then fastest finish, then earliest
  submission; one row per student (their best attempt).
- Mistake Bank reveals correct answers only for questions the student
  already attempted and got wrong, matching existing quiz-review
  behaviour; unattempted questions never appear.
