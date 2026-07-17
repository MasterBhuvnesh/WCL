/**
 * Drizzle schema for the WCL examination system. Mirrors the data model in
 * docs/EXAM_SYSTEM_PLAN.md section 6.
 *
 * Integrity-critical constraints live in the database, not application code:
 * one answer row per (session, question), unique participant usernames, and
 * foreign keys throughout.
 */

import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type SessionStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "auto_submitted";

export type QuestionType = "SCQ" | "MCQ";

export type AnswerStatus =
  | "not_visited"
  | "not_answered"
  | "answered"
  | "marked_for_review"
  | "answered_marked";

export const exams = pgTable("exams", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  questionsToServe: integer("questions_to_serve").notNull(),
  instructions: jsonb("instructions").$type<string[]>().notNull().default([]),
  /** Availability window. Null bounds mean unrestricted on that side. */
  availableFrom: timestamp("available_from", { withTimezone: true }),
  availableUntil: timestamp("available_until", { withTimezone: true }),
  /** Admin toggle: when false, logins for this exam are refused. */
  isOpen: boolean("is_open").notNull().default(true),
  resultsPublished: boolean("results_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    type: text("type").$type<QuestionType>().notNull(),
    text: text("text").notNull(),
    marks: integer("marks").notNull().default(1),
    /** Optional image shown with the question (S3 object URL). Null when text-only. */
    imageUrl: text("image_url"),
  },
  (table) => [index("questions_exam_idx").on(table.examId)],
);

export const options = pgTable(
  "options",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    text: text("text").notNull(),
    /** Server-side only. Never serialized to any candidate response. */
    isCorrect: boolean("is_correct").notNull(),
  },
  (table) => [index("options_question_idx").on(table.questionId)],
);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Roll number / login name. */
    username: text("username").notNull(),
    /** Argon2id hash (Bun.password). Plaintext secrets are never stored. */
    secretHash: text("secret_hash").notNull(),
    displayName: text("display_name"),
    /** Date of birth (YYYY-MM-DD). Used by the external hall-ticket site; not part of login. */
    dob: date("dob", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("participants_username_uq").on(table.username)],
);

/**
 * Seat allocation for the external hall-ticket portal. One row per candidate;
 * exam-wide details (date, venue, timings) live in the portal's exam.json.
 */
export const hallticketSeats = pgTable("hallticket_seats", {
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => participants.id, { onDelete: "cascade" }),
  blockNo: text("block_no").notNull(),
  floorNo: text("floor_no").notNull(),
  labNo: text("lab_no").notNull(),
  seatNo: text("seat_no").notNull(),
});

export const examSessions = pgTable(
  "exam_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    status: text("status").$type<SessionStatus>().notNull().default("not_started"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    shuffleSeed: text("shuffle_seed"),
    /** Frozen served subset in served order. */
    servedQuestionIds: jsonb("served_question_ids").$type<string[]>().notNull().default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Optional device binding captured at login. */
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_participant_exam_idx").on(table.participantId, table.examId),
    index("sessions_exam_status_idx").on(table.examId, table.status),
    index("sessions_deadline_idx").on(table.status, table.deadlineAt),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => examSessions.id),
    questionId: text("question_id").notNull(),
    selectedOptionIds: jsonb("selected_option_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<AnswerStatus>().notNull(),
    clientSeq: integer("client_seq").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("answers_session_question_uq").on(table.sessionId, table.questionId),
    index("answers_session_idx").on(table.sessionId),
  ],
);

export const results = pgTable(
  "results",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => examSessions.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    score: real("score").notNull(),
    maxScore: integer("max_score").notNull(),
    correct: integer("correct").notNull(),
    wrong: integer("wrong").notNull(),
    unanswered: integer("unanswered").notNull(),
    gradedAt: timestamp("graded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("results_exam_score_idx").on(table.examId, table.score)],
);

export const feedback = pgTable(
  "feedback",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => examSessions.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    /** 1-5 rating of the examination platform. */
    platformRating: integer("platform_rating").notNull(),
    /** 1-5 rating of the college infrastructure. */
    infrastructureRating: integer("infrastructure_rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("feedback_exam_idx").on(table.examId)],
);

export const admins = pgTable(
  "admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** When set, TOTP verification is required at login (MFA). */
    totpSecret: text("totp_secret"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("admins_email_uq").on(table.email)],
);

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  adminId: uuid("admin_id").references(() => admins.id),
  action: text("action").notNull(),
  target: text("target"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrityEvents = pgTable(
  "integrity_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => examSessions.id),
    type: text("type").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("integrity_session_idx").on(table.sessionId)],
);
