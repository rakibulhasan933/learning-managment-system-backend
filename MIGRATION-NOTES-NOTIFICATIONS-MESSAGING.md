# MIGRATION-NOTES-NOTIFICATIONS-MESSAGING

নোটিফিকেশন সেন্টার + ইন-অ্যাপ মেসেজিং ব্যাচের মাইগ্রেশন নোট। আগের তিনটি
মাইগ্রেশন নোট (5-FEATURES, NEXT-BATCH, REVIEWS-REFUNDS-ANALYTICS) ছোঁয়া হয়নি।

## কোন টেবিল নতুন

schema.ts-এ শুধু যোগ হয়েছে (কোনো পুরনো টেবিল বদলানো হয়নি):

- `message_threads` — id, course_id (FK courses, cascade), student_id (FK
  profiles, cascade), instructor_id (FK profiles, cascade), subject
  varchar(200), last_message_at nullable, created_at
  - index: (student_id, last_message_at), (instructor_id, last_message_at)
- `messages` — id, thread_id (FK message_threads, cascade delete),
  sender_id (FK profiles, cascade), body text, read_at nullable, created_at
  - index: (thread_id, created_at)

`notifications` টেবিল আগে থেকেই আছে — এর জন্য কোনো মাইগ্রেশন লাগে না।

## মাইগ্রেশন কমান্ড

```bash
cd backend
pnpm db:generate   # migration ফাইল তৈরি হবে
pnpm db:migrate    # ডাটাবেজে প্রয়োগ হবে
```

## মাইগ্রেশন-নির্ভর আচরণ

- `/notifications*` এন্ডপয়েন্ট: মাইগ্রেশন লাগে না — `notifications`
  টেবিল আগেই বিদ্যমান।
- `/messages/*` ও `/instructor/messages/broadcast` এন্ডপয়েন্ট:
  `message_threads`/`messages` টেবিল না থাকলে টেবিলের নামসহ **503** দেবে
  (আগের ব্যাচের `isMissingTableError`/`missingTable503` প্যাটার্নে,
  `sales-helpers.js` থেকে পুনর্ব্যবহৃত)।
- ইভেন্ট ট্রিগার (নিচে) সব best-effort: নোটিফিকেশন টেবিল/মাইগ্রেশন না
  থাকলেও মূল ফ্লো (পেমেন্ট, রিফান্ড, গ্রেডিং, লাইভ ক্লাস, মডেল টেস্ট,
  পেআউট) কখনো ভাঙে না, কখনো 503 দেয় না।

## নতুন এন্ডপয়েন্ট

### নোটিফিকেশন সেন্টার (`src/notifications/`)

- `GET /notifications` → `{ notifications: [...], unreadCount }` —
  unread আগে, তারপর নতুনতম; limit 50
- `GET /notifications/unread-count` → `{ unreadCount }`
- `POST /notifications/:id/read` → `{ id, readAt }` (শুধু নিজেরটা, অন্যেরটা 404)
- `POST /notifications/read-all` → `{ marked }`
- রোল: student / instructor / admin (যেকোনো authenticated)
- বিদ্যমান `GET /instructor/notifications` ছোঁয়া হয়নি — আগের মতোই চলবে।

### মেসেজিং (`src/messaging/`, টেক্সট-শুধু, max 2000, ফাইল আপলোড নেই)

- `GET /messages/threads` → `{ threads: [{ id, courseId, courseTitle,
  otherPartyName, otherPartyRole, subject, lastMessageAt,
  lastMessagePreview, unreadCount }] }` (কোনো email ফাঁস নয়)
- `GET /messages/threads/:id` → `{ thread, messages: [...] }`; ভিউয়ারের
  জন্য অন্য পক্ষের মেসেজ read হিসেবে চিহ্নিত হয়
- `POST /messages/threads` `{ courseId, studentId?, subject (max 200),
  body (max 2000) }` → 201 `{ thread, message }`
  - student: studentId নিজের হবে + ওই কোর্সে active enrolment লাগবে
  - instructor: কোর্স নিজের হতে হবে, studentId বাধ্যতামূলক + ছাত্র
    enrolled হতে হবে; admin নতুন থ্রেড খুলতে পারে না
  - একই (courseId, studentId, instructorId)-তে থ্রেড থাকলে reuse
- `POST /messages/threads/:id/messages` `{ body max 2000 }` → 201
  `{ message }`; শুধু থ্রেডের পক্ষ; ৬০ সেকেন্ডে একই sender ৫টির বেশি
  পাঠালে **429**
- `POST /instructor/messages/broadcast`
  `{ courseId?, batchId?, subject, body }` → `{ threadsCreated, notified }`;
  courseId/batchId-এর exactly একটি; instructor-এর নিজের কোর্স/ব্যাচ;
  প্রতি প্রাপকের জন্য আলাদা থ্রেড রো (reuse যেখানে আছে); প্রাপক =
  কোর্সের active enrolled ছাত্র বা ব্যাচ মেম্বার; প্রত্যেকে best-effort
  নোটিফিকেশন পায়

## ইভেন্ট ট্রিগার (সব best-effort, try/catch — মূল ফ্লো কখনো ভাঙে না)

| ফ্লো | নোটিফিকেশন type | প্রাপক |
|---|---|---|
| PayConfirm approval (`payments.service.ts submitProof`) | `order_paid` | ছাত্র; href `/dashboard/student/orders` |
| রিফান্ড রিকোয়েস্ট (`refund-requests createRequest`) | `refund_requested` | কোর্সের instructor(রা) (`/dashboard/instructor/refund-requests`) + সব admin (`/dashboard/admin/refunds`) |
| রিফান্ড সিদ্ধান্ত (`admin-finance decideRefund`) | `refund_decided` | ছাত্র (approved/rejected/processed অনুযায়ী বার্তা); `/dashboard/student/orders` |
| কোর্স অ্যানাউন্সমেন্ট (`instructor-dashboard createAnnouncement`) | আগে থেকেই আছে (`course_announcement`) — ডুপ্লিকেট করা হয়নি |
| ব্যাচ অ্যানাউন্সমেন্ট (`batches.service.ts`) | আগে থেকেই আছে (`batch_announcement`) — ডুপ্লিকেট করা হয়নি |
| অ্যাসাইনমেন্ট গ্রেডিং (`instructor-courses gradeAssignment`) | আগে থেকেই আছে (`assignment_graded`) — ডুপ্লিকেট করা হয়নি |
| লাইভ ক্লাস সিডিউল (`live-classes createLiveClass`) | `live_class_scheduled` | কোর্সের active enrolled ছাত্র + ব্যাচ মেম্বার; `/dashboard/student/live-classes` |
| মডেল টেস্ট পাবলিশ (`exams createModelTest`, isPublished) | `model_test_published` | কোর্সের active enrolled ছাত্র; `/dashboard/student/model-tests` |
| অ্যাফিলিয়েট পেআউট সিদ্ধান্ত (`affiliates adminPayoutAction`) | `affiliate_payout_decided` | referrer; `/dashboard/instructor/affiliates` |
| instructor পেআউট সিদ্ধান্ত (`admin-finance decidePayout`) | `payout_decided` | শিক্ষক; `/dashboard/instructor/payouts` |
| নতুন মেসেজ | `new_message` | অন্য পক্ষ; ছাত্র → `/dashboard/student/messages/[threadId]`, শিক্ষক → `/dashboard/instructor/messages/[threadId]` |

কোনো ইমেইল/SMS কোড লেখা হয়নি — শুধু ইন-অ্যাপ নোটিফিকেশন।

## নতুন হেলপার

`src/lib/notifications.ts`-এ `notifySafely` ও `notifyManySafely`:
ভেতরে try/catch, কখনো throw করে না — নোটিফিকেশন ব্যর্থ হলেও মূল ফ্লো
ভাঙে না।

## Windows-এ যাচাই

1. `cd backend` → `pnpm db:generate` → `pnpm db:migrate`
2. `pnpm dev` চালিয়ে লগইন করুন
3. `GET /notifications` — খালি লিস্ট `{ notifications: [], unreadCount: 0 }`
4. কোর্সে enrolled ছাত্র হিসেবে `POST /messages/threads` দিয়ে থ্রেড খুলুন → 201
5. একই (courseId, studentId, instructorId)-তে আবার পোস্ট করলে নতুন থ্রেড
   না হয়ে পুরনোটাই reuse হয় কিনা দেখুন
6. ৬০ সেকেন্ডে ৬টি মেসেজ পাঠিয়ে 429 পান কিনা দেখুন
7. `POST /instructor/messages/broadcast` দিয়ে ব্রডকাস্ট — প্রাপকের
   নোটিফিকেশন সেন্টারে `new_message` আসে কিনা দেখুন
8. PayConfirm দিয়ে পেমেন্ট → ছাত্রের নোটিফিকেশনে `order_paid` আসে কিনা দেখুন
9. পুরনো `GET /instructor/notifications` আগের মতোই কাজ করছে কিনা দেখুন
