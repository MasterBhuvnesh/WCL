CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"selected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"client_seq" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"exam_id" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"shuffle_seed" text,
	"served_question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"questions_to_serve" integer NOT NULL,
	"instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"available_from" timestamp with time zone,
	"available_until" timestamp with time zone,
	"is_open" boolean DEFAULT true NOT NULL,
	"results_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"secret_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"marks" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "results" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"exam_id" text NOT NULL,
	"score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"correct" integer NOT NULL,
	"wrong" integer NOT NULL,
	"unanswered" integer NOT NULL,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_uq" ON "admins" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_session_question_uq" ON "answers" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE INDEX "answers_session_idx" ON "answers" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_participant_exam_idx" ON "exam_sessions" USING btree ("participant_id","exam_id");--> statement-breakpoint
CREATE INDEX "sessions_exam_status_idx" ON "exam_sessions" USING btree ("exam_id","status");--> statement-breakpoint
CREATE INDEX "sessions_deadline_idx" ON "exam_sessions" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "integrity_session_idx" ON "integrity_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "options_question_idx" ON "options" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_username_uq" ON "participants" USING btree ("username");--> statement-breakpoint
CREATE INDEX "questions_exam_idx" ON "questions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "results_exam_score_idx" ON "results" USING btree ("exam_id","score");