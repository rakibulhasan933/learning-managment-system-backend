# Migration notes — Next batch (batches, affiliates, live classes, spaced revision)

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
> `missingTable503`), never fake success data. The one exception is
> `POST /affiliate/track`, which is best-effort by contract and always
> returns `{tracked: true}` even when tracking cannot be stored.
>
> This note does NOT replace `MIGRATION-NOTES-5-FEATURES.md`, which is
> untouched. The feature-set-5 tables are still required first: the
> revision weak-topic / Mistake Bank logic reads `model_test_attempts`,
> `question_bank_questions` and `question_bank_options`, and affiliate
> scope checks read `bundles`.

## New tables (all in `src/database/schema.ts`)

| Table | Why it is needed | Key columns |
|---|---|---|
| `batches` | A cohort of students inside one course. | `course_id`, `instructor_id`, `name`, `enrolment_start_at`, `enrolment_end_at` |
| `batch_members` | Who is in a batch (self-join or teacher-added). | `batch_id`, `user_id`, `joined_at`; unique (`batch_id`, `user_id`) |
| `batch_drip_rules` | Per-batch content release rules. `milestone_id` is a `sections.id`; `module_id` is a `modules.id`. | `batch_id`, `milestone_id`, `module_id`, `release_type` (`relative`/`fixed`), `release_days`, `release_at` |
| `batch_deadlines` | Per-batch assignment deadlines with an explicit late policy. | `batch_id`, `assignment_id`, `due_at`, `allow_late`, `late_penalty_percent` (default `0`) |
| `assignment_late_flags` | Per-student late-submission flags. A NEW table on purpose — the existing `assignment_submissions` table was not altered. | `assignment_id`, `user_id`, `is_late`, `late_penalty_percent`, `submitted_at`; unique (`assignment_id`, `user_id`) |
| `affiliate_links` | Referral/affiliate links owned by a teacher, admin, or student. | `owner_id`, `code` (unique), `commission_type` (`percent`/`flat`), `commission_value`, `scope_type` (`course`/`bundle`/`all`), `scope_id`, `is_referral` |
| `affiliate_tracks` | Best-effort click records for `/affiliate/track`. | `link_id`, `code`, `tracked_at` |
| `affiliate_attributions` | Which link gets credit for an order, recorded before payment. | `order_id` (unique — one attribution per order), `link_id`, `referrer_id`, `buyer_id` |
| `affiliate_commissions` | Commission earned only after the order is PayConfirm-paid. | `order_id` (unique — one commission per order), `attribution_id`, `referrer_id`, `buyer_id`, `amount`, `status` (`pending`/`approved`/`paid`) |
| `affiliate_payouts` | Manual payout requests; admin approval only, no auto payout. | `referrer_id`, `amount`, `note`, `status` (`pending`/`approved`/`rejected`/`paid`) |
| `live_classes` | Link-based scheduled classes. The meeting itself happens on Meet/Zoom/another provider — no video server is built. | `course_id`, `batch_id` (nullable), `instructor_id`, `title`, `starts_at`, `ends_at`, `meeting_url`, `provider`, `recording_url`, `recording_title` |
| `live_class_attendance` | Teacher-marked attendance only; a link click never creates a row. | `live_class_id`, `user_id`, `present`, `marked_by`, `marked_at`; unique (`live_class_id`, `user_id`) |
| `flashcards` | Student flashcards with simple SM-2 state (not FSRS). | `user_id`, `front`, `back`, `subject`, `chapter`, `topic`, `question_bank_question_id`, `ease` (default `2.5`), `interval_days`, `repetitions`, `due_at` |
| `bookmarks` | Student bookmarks of a question or a lesson. | `user_id`, `type` (`question`/`lesson`), `target_id`; unique (`user_id`, `type`, `target_id`) |
| `student_notes` | Student notes attached to a lesson and/or a question. | `user_id`, `lesson_id`, `question_id`, `body` |

## No changes to existing tables

No existing table or column was altered. In particular:

- `orders`, `enrollments`, and the PayConfirm flow are unchanged: the
  student still submits sender number + Transaction ID, and approval
  still makes the order paid + enrols. No manual admin order
  approve/reject was reintroduced. The only addition in
  `src/payments/payments.service.ts` is a post-approval hook that calls
  `recordAffiliateCommission` (no-op pre-migration, no-op without an
  attribution, self-referral excluded, one commission per order).
- `src/exams/` (question bank / model tests / Mistake Bank) was not
  touched. Revision re-implements the Mistake Bank read with the same
  rule (only the student's own wrong answers from submitted attempts)
  instead of modifying the exams code.
- `src/sales/` was not touched; `missingTable503` / `isMissingTableError`
  were reused as-is.
- The seller-dashboard announcement-draft endpoint was not touched.
  Batch announcements use the EXISTING `announcements` table plus
  in-app `notifications` rows for batch members only — that is a real
  record, not a draft, but no email or SMS is sent (this notification
  system is in-app only).

## Rules that live in code (not in the migration)

- **Drip unlock:** `relative` unlocks `releaseDays` after the student's
  batch-join day (`batch_members.joined_at`); `fixed` unlocks at
  `releaseAt`. Items with no rule are not listed by
  `GET /batches/:id/drip-status` — that endpoint returns the batch's
  drip rules with their locked/unlocksAt state, not the whole catalog.
- **Late penalty:** default `0`. No teacher setting means no deduction,
  ever. A late submission is flagged (`isLate`) in the submit response
  and, when a batch policy sets a percentage above 0, the teacher's raw
  grade is reduced by that percentage at grading time
  (`gradeAssignmentSubmission` in `src/lib/assignments.ts`). Re-grading
  uses the raw score again, so the deduction never compounds. A late
  submission is never rejected for lateness, and `allowLate: false`
  does not change that — it is recorded on the deadline but does not
  block submission (the contract only asked for flagging + penalty).
- **Affiliate commission:** percent = `round(order amount × percent) /
  100`; flat = the flat value. Commission status starts `pending`;
  there is no endpoint that auto-approves it, and payout
  `approve` → `mark-paid` is a manual admin record, not a money
  movement. Payout requests are NOT capped against the approved
  balance in code (the contract sets no cap) — admins approve manually.
- **Self-referral:** rejected at attribution time (`400`) and
  re-checked in the commission hook, so it can never earn.
- **Attendance:** only the teacher's `POST .../attendance` creates or
  updates a row. Opening a meeting link does nothing to attendance.
- **Recording:** URL only. The teacher pastes a link; no file is
  uploaded and no recording server exists.
- **Flashcards (SM-2, simplified):** quality ≥ 3 increments
  repetitions (interval 1, then 6, then `round(prev × ease)`); quality
  < 3 resets repetitions to 0 with a 1-day interval; ease is floored
  at 1.3. This is not FSRS.
- **Weak topics:** submitted model-test `topicBreakdown` wrong counts
  first; Mistake Bank wrong questions only add topics the breakdown
  does not already cover (no double counting, no new tags invented).

## Endpoints that work WITHOUT this migration

None of the four features' storage endpoints work without it (they all
touch a new table and return 503 naming it). Two behaviours degrade
gracefully instead of failing:

- `POST /affiliate/track` always returns `{tracked: true}`.
- Assignment submission keeps working exactly as before; lateness
  against the assignment's own `dueAt` is still reported in the
  response, but no batch-deadline flag row is persisted and no penalty
  is applied until the migration lands.

## Windows verification steps (not run here)

```powershell
cd backend
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm dev
```

Then, with a teacher account, a student account, and an admin account:

1. Batch: create batch → join as an enrolled student inside the window
   (expect 403 outside it) → add a drip rule (`relative`, 3 days) →
   `drip-status` shows `locked: true` with `unlocksAt` 3 days after
   join, and `locked: false` after that date.
2. Deadline: set a batch deadline with `latePenaltyPercent: 10` →
   submit the assignment late → response has `isLate: true` →
   grade it → stored score is the raw score reduced by 10%.
3. Affiliate: create link → `track` → `attribute` before payment →
   PayConfirm-pay the order → `GET /affiliate/dashboard` shows the
   commission `pending` → request payout → admin `approve` →
   `mark-paid`. Also verify self-attribution returns 400 and a second
   commission for the same order is never created.
4. Live class: create with a Meet URL → enrolled student lists it →
   set a recording URL → it appears on the class → teacher marks
   attendance → student list shows the row; opening the meeting link
   alone creates no attendance row.
5. Revision: create flashcard → review with quality 5 → `ease`,
   `intervalDays`, `repetitions`, `dueAt` advance per SM-2 →
   `GET /student/revision/today` shows due cards and weak topics from
   real wrong model-test answers only (never unattempted questions).
