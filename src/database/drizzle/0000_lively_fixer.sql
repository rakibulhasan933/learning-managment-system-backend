DO $$ BEGIN CREATE TYPE "public"."auth_provider" AS ENUM('password', 'google'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."course_level" AS ENUM('beginner', 'intermediate', 'advanced', 'all_levels'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."course_status" AS ENUM('draft', 'pending_review', 'published', 'archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."instalment_status" AS ENUM('pending', 'paid', 'overdue'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."order_status" AS ENUM('pending_verification', 'paid', 'rejected', 'expired', 'refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."payment_method" AS ENUM('bkash', 'nagad', 'rocket', 'bank_transfer', 'gateway'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."payout_status" AS ENUM('pending', 'approved', 'rejected', 'paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."question_difficulty" AS ENUM('easy', 'medium', 'hard'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."refund_status" AS ENUM('requested', 'approved', 'rejected', 'processed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'expired', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."user_role" AS ENUM('admin', 'instructor', 'student'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."video_provider" AS ENUM('r2', 'bunny', 'cloudflare_stream', 'mux'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE "abandoned_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovered" boolean DEFAULT false NOT NULL,
	"recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "affiliate_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"referrer_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "affiliate_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"attribution_id" uuid,
	"referrer_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "affiliate_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"commission_type" varchar(16) DEFAULT 'percent' NOT NULL,
	"commission_value" numeric(12, 2) NOT NULL,
	"scope_type" varchar(16) DEFAULT 'all' NOT NULL,
	"scope_id" uuid,
	"is_referral" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_links_commission_non_negative" CHECK ("affiliate_links"."commission_value" >= 0)
);--> statement-breakpoint
CREATE TABLE "affiliate_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_payouts_amount_positive" CHECK ("affiliate_payouts"."amount" > 0)
);--> statement-breakpoint
CREATE TABLE "affiliate_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"tracked_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "assignment_late_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_late" boolean DEFAULT true NOT NULL,
	"late_penalty_percent" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "batch_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"allow_late" boolean DEFAULT false NOT NULL,
	"late_penalty_percent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_deadlines_penalty_range" CHECK ("batch_deadlines"."late_penalty_percent" >= 0 and "batch_deadlines"."late_penalty_percent" <= 100)
);--> statement-breakpoint
CREATE TABLE "batch_drip_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"milestone_id" uuid,
	"module_id" uuid,
	"release_type" varchar(16) DEFAULT 'relative' NOT NULL,
	"release_days" integer,
	"release_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_drip_rules_target_present" CHECK ("batch_drip_rules"."milestone_id" is not null or "batch_drip_rules"."module_id" is not null),
	CONSTRAINT "batch_drip_rules_release_days_non_negative" CHECK ("batch_drip_rules"."release_days" is null or "batch_drip_rules"."release_days" >= 0)
);--> statement-breakpoint
CREATE TABLE "batch_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enrolment_start_at" timestamp with time zone,
	"enrolment_end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "bundle_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"original_price" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'BDT' NOT NULL,
	"duration_days" integer,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundles_price_non_negative" CHECK ("bundles"."price" >= 0)
);--> statement-breakpoint
CREATE TABLE "course_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_reviews_rating_range" CHECK ("course_reviews"."rating" >= 1 and "course_reviews"."rating" <= 5)
);--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"subject" varchar(180),
	"chapter" varchar(180),
	"topic" varchar(180),
	"question_bank_question_id" uuid,
	"ease" numeric(4, 2) DEFAULT '2.5' NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "live_class_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"live_class_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"present" boolean NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "live_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"batch_id" uuid,
	"instructor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"meeting_url" text NOT NULL,
	"provider" varchar(16) DEFAULT 'other' NOT NULL,
	"recording_url" text,
	"recording_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"subject" varchar(200) NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "model_test_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"option_order" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" numeric(10, 2),
	"total_questions" integer NOT NULL,
	"wrong_question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_late" boolean DEFAULT false NOT NULL,
	"finished_in_seconds" integer
);--> statement-breakpoint
CREATE TABLE "model_test_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE "model_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"negative_mark" numeric(6, 2) DEFAULT '0' NOT NULL,
	"shuffle_questions" boolean DEFAULT true NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_tests_duration_positive" CHECK ("model_tests"."duration_minutes" > 0),
	CONSTRAINT "model_tests_negative_mark_non_negative" CHECK ("model_tests"."negative_mark" >= 0),
	CONSTRAINT "model_tests_max_attempts_positive" CHECK ("model_tests"."max_attempts" > 0)
);--> statement-breakpoint
CREATE TABLE "order_instalments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" "instalment_status" DEFAULT 'pending' NOT NULL,
	"sender_number" varchar(64),
	"transaction_id" varchar(255),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_instalments_amount_positive" CHECK ("order_instalments"."amount" > 0)
);--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"is_order_bump" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "question_bank_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"option_text" text NOT NULL,
	"position" integer NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
CREATE TABLE "question_bank_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"course_id" uuid,
	"question_text" text NOT NULL,
	"explanation" text,
	"subject" varchar(180),
	"chapter" varchar(180),
	"topic" varchar(180),
	"difficulty" "question_difficulty" DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "student_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid,
	"question_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"duration_days" integer,
	"order_id" uuid,
	"status" "subscription_status" DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_months_positive" CHECK ("subscriptions"."months" > 0)
);--> statement-breakpoint
ALTER TABLE "abandoned_carts" ADD CONSTRAINT "abandoned_carts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_link_id_affiliate_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_referrer_id_profiles_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_buyer_id_profiles_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_attribution_id_affiliate_attributions_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."affiliate_attributions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_referrer_id_profiles_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_buyer_id_profiles_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_referrer_id_profiles_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_tracks" ADD CONSTRAINT "affiliate_tracks_link_id_affiliate_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_late_flags" ADD CONSTRAINT "assignment_late_flags_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_late_flags" ADD CONSTRAINT "assignment_late_flags_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_deadlines" ADD CONSTRAINT "batch_deadlines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_deadlines" ADD CONSTRAINT "batch_deadlines_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_drip_rules" ADD CONSTRAINT "batch_drip_rules_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_drip_rules" ADD CONSTRAINT "batch_drip_rules_milestone_id_sections_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_drip_rules" ADD CONSTRAINT "batch_drip_rules_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_members" ADD CONSTRAINT "batch_members_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_members" ADD CONSTRAINT "batch_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_instructor_id_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD CONSTRAINT "bundle_courses_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD CONSTRAINT "bundle_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_instructor_id_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_student_id_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_question_bank_question_id_question_bank_questions_id_fk" FOREIGN KEY ("question_bank_question_id") REFERENCES "public"."question_bank_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_class_attendance" ADD CONSTRAINT "live_class_attendance_live_class_id_live_classes_id_fk" FOREIGN KEY ("live_class_id") REFERENCES "public"."live_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_class_attendance" ADD CONSTRAINT "live_class_attendance_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_class_attendance" ADD CONSTRAINT "live_class_attendance_marked_by_profiles_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_instructor_id_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_student_id_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_instructor_id_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_test_attempts" ADD CONSTRAINT "model_test_attempts_test_id_model_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."model_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_test_attempts" ADD CONSTRAINT "model_test_attempts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_test_questions" ADD CONSTRAINT "model_test_questions_test_id_model_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."model_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_test_questions" ADD CONSTRAINT "model_test_questions_question_id_question_bank_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_tests" ADD CONSTRAINT "model_tests_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_tests" ADD CONSTRAINT "model_tests_instructor_id_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_instalments" ADD CONSTRAINT "order_instalments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_options" ADD CONSTRAINT "question_bank_options_question_id_question_bank_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_questions" ADD CONSTRAINT "question_bank_questions_instructor_id_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_questions" ADD CONSTRAINT "question_bank_questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_course_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."course_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_lesson_id_lectures_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_question_id_question_bank_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_bank_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abandoned_carts_user_id_idx" ON "abandoned_carts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_attributions_order_id_unique" ON "affiliate_attributions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "affiliate_attributions_referrer_id_idx" ON "affiliate_attributions" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_commissions_order_id_unique" ON "affiliate_commissions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "affiliate_commissions_referrer_id_idx" ON "affiliate_commissions" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_links_code_unique" ON "affiliate_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "affiliate_links_owner_id_idx" ON "affiliate_links" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "affiliate_payouts_referrer_id_idx" ON "affiliate_payouts" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "affiliate_tracks_link_id_idx" ON "affiliate_tracks" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_late_flags_assignment_user_unique" ON "assignment_late_flags" USING btree ("assignment_id","user_id");--> statement-breakpoint
CREATE INDEX "assignment_late_flags_assignment_id_idx" ON "assignment_late_flags" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_deadlines_batch_assignment_unique" ON "batch_deadlines" USING btree ("batch_id","assignment_id");--> statement-breakpoint
CREATE INDEX "batch_deadlines_batch_id_idx" ON "batch_deadlines" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_drip_rules_batch_id_idx" ON "batch_drip_rules" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_members_batch_user_unique" ON "batch_members" USING btree ("batch_id","user_id");--> statement-breakpoint
CREATE INDEX "batch_members_batch_id_idx" ON "batch_members" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_members_user_id_idx" ON "batch_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "batches_course_id_idx" ON "batches" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "batches_instructor_id_idx" ON "batches" USING btree ("instructor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_type_target_unique" ON "bookmarks" USING btree ("user_id","type","target_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_courses_bundle_course_unique" ON "bundle_courses" USING btree ("bundle_id","course_id");--> statement-breakpoint
CREATE INDEX "bundle_courses_bundle_id_idx" ON "bundle_courses" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "bundles_instructor_id_idx" ON "bundles" USING btree ("instructor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_reviews_course_student_unique" ON "course_reviews" USING btree ("course_id","student_id");--> statement-breakpoint
CREATE INDEX "course_reviews_course_visible_idx" ON "course_reviews" USING btree ("course_id","is_hidden","created_at");--> statement-breakpoint
CREATE INDEX "flashcards_user_id_idx" ON "flashcards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flashcards_user_due_idx" ON "flashcards" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_class_attendance_class_user_unique" ON "live_class_attendance" USING btree ("live_class_id","user_id");--> statement-breakpoint
CREATE INDEX "live_class_attendance_class_id_idx" ON "live_class_attendance" USING btree ("live_class_id");--> statement-breakpoint
CREATE INDEX "live_classes_course_id_idx" ON "live_classes" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "live_classes_batch_id_idx" ON "live_classes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "live_classes_instructor_id_idx" ON "live_classes" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "message_threads_student_idx" ON "message_threads" USING btree ("student_id","last_message_at");--> statement-breakpoint
CREATE INDEX "message_threads_instructor_idx" ON "message_threads" USING btree ("instructor_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "model_test_attempts_test_idx" ON "model_test_attempts" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "model_test_attempts_user_idx" ON "model_test_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_test_questions_test_question_unique" ON "model_test_questions" USING btree ("test_id","question_id");--> statement-breakpoint
CREATE INDEX "model_test_questions_test_idx" ON "model_test_questions" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "model_tests_course_idx" ON "model_tests" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "model_tests_instructor_idx" ON "model_tests" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "order_instalments_order_id_idx" ON "order_instalments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_course_unique" ON "order_items" USING btree ("order_id","course_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_bank_options_question_position_unique" ON "question_bank_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE INDEX "question_bank_options_question_idx" ON "question_bank_options" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "question_bank_instructor_idx" ON "question_bank_questions" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "question_bank_topic_idx" ON "question_bank_questions" USING btree ("topic");--> statement-breakpoint
DROP INDEX IF EXISTS "refunds_order_unique";
CREATE UNIQUE INDEX "refunds_order_unique" ON "refunds" USING btree ("order_id") WHERE "refunds"."status" in ('requested', 'approved', 'processed');--> statement-breakpoint
DROP INDEX IF EXISTS "refunds_status_created_idx";
CREATE INDEX "refunds_status_created_idx" ON "refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "review_replies_review_idx" ON "review_replies" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "student_notes_user_id_idx" ON "student_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_target_idx" ON "subscriptions" USING btree ("target_type","target_id");
