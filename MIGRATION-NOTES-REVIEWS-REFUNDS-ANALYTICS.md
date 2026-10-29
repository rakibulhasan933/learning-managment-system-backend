# Migration notes — Reviews, student refund requests, admin analytics

Batch: course reviews + student-filed refund requests + admin analytics
(reports + CSV export). These features sit on top of the existing
`refunds` table and the sales refund rules; no existing table was
modified.

## New tables (additive only — `src/database/schema.ts`)

1. `course_reviews`
   - id uuid PK, course_id uuid → courses (cascade), student_id uuid →
     profiles (cascade)
   - rating smallint NOT NULL, CHECK (rating BETWEEN 1 AND 5)
   - body text NULL, is_hidden boolean NOT NULL DEFAULT false
   - created_at / updated_at timestamptz
   - unique(course_id, student_id) — one review per student per course
   - index(course_id, is_hidden, created_at)
2. `review_replies`
   - id uuid PK, review_id uuid → course_reviews (cascade),
     author_id uuid → profiles (set null)
   - body text NOT NULL, created_at timestamptz
   - index(review_id)

No other schema changes. No seed data, no fake reviews.

## Apply the migration

From `~/workspace/lms-latest/backend` (same flow as the earlier notes):

```powershell
pnpm db:generate   # creates the SQL migration for the two new tables
pnpm db:migrate    # applies it to Postgres
```

Do NOT hand-edit the generated SQL unless drizzle asks for it.

## What works WITHOUT the migration

- `POST /refund-requests`, `GET /refund-requests`,
  `GET /instructor/refund-requests` — the `refunds` table already
  exists; kind detection falls back to `standard` when the sales
  feature tables (subscriptions / order_instalments / order_items)
  are missing.
- All `GET /admin/analytics/*` endpoints — they only read existing
  tables. In `teachers`, `avgRating` is `null` when the reviews
  tables are missing (graceful, documented in the response).
- `GET /courses/:courseId/reviews` — public list returns
  `{ averageRating: null, reviewCount: 0, reviews: [] }` when the
  reviews tables are missing (deliberately NOT 503, so the sales
  page never breaks).
- `GET /courses/:slug` — returns `averageRating: null`,
  `reviewCount: 0` when the reviews tables are missing.

## What returns 503 WITHOUT the migration

- `GET /courses/:courseId/reviews/mine`
- `POST /courses/:courseId/reviews`
- `PATCH /courses/:courseId/reviews`
- `POST /reviews/:id/replies`
- `POST /reviews/:id/visibility`

## Behaviour notes

- Student review write/update requires an **active** enrolment
  (granted when the order is paid). Duplicate review → 409.
- Admin review visibility is hide-only; there is no delete endpoint.
- Reply authors: the course's instructor or an admin. No email is
  ever exposed in public review payloads; reviewer names fall back
  to "একজন শিক্ষার্থী".
- Admin refund approve (`POST /admin/refunds/:id/approve`) now also
  sets every enrolment with that order's id to
  `status='revoked', revoked_at=now`. Money movement stays manual —
  no payment code was touched.
- Analytics funnel has NO visits step (visit tracking does not
  exist); the `note` field says this. Completion = seller-dashboard
  definition (every published lecture completed; 0-lecture courses
  never count as completed).
- CSV export (`GET /admin/analytics/:report/export`, report =
  funnel | cohorts | refund-reasons | teachers) downloads
  `text/csv` with a Content-Disposition attachment filename.
- Seller dashboard already summed approved/processed `refunds`
  rows into its refund totals — no change needed there.

## Verification (Windows)

1. `pnpm db:generate` then `pnpm db:migrate`; confirm
   `course_reviews` and `review_replies` exist in Postgres.
2. `pnpm start:dev` (or the project's dev script) and hit the
   endpoints in order: public reviews list (200, empty), student
   POST review without enrolment (400), with enrolment (201),
   duplicate (409), instructor reply (201), admin visibility (200),
   public list again (shows the review).
3. `POST /refund-requests` for a paid order (201, kind=standard),
   then `POST /admin/refunds/:id/approve` and confirm the
   enrolment row flips to revoked.
4. `GET /admin/analytics/funnel`, `/cohorts`, `/refund-reasons`,
   `/teachers` and one CSV export download.

## Follow-up fix (2026-10-29): refund re-request after rejection

- `refunds_order_unique` changed from a plain unique index on
  `order_id` to a **partial** unique index covering only
  `status IN ('requested','approved','processed')`. Run
  `pnpm db:generate` + `pnpm db:migrate` again so the old
  constraint is replaced — otherwise a second request after a
  rejection still hits the old DB-level unique violation.
- Service rule now matches: `POST /refund-requests` returns 409
  only when an OPEN (requested/approved/processed) request
  exists for the order. After a rejection the student can file
  a fresh request; the old rejected row stays as history.
- No frontend change was needed: the orders page already shows
  the refund button for every paid order and the refund page
  always renders the form; backend 400/409 messages surface
  in the form.
