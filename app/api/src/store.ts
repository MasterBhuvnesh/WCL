/**
 * In-memory data store for the WCL development backend.
 *
 * This is intentionally non-durable: everything lives in process memory and is
 * lost on restart. It exists only to support the Electron client during local
 * development. The production system uses PostgreSQL and Redis (see the system
 * plan), which this module deliberately does not attempt to model.
 */

import { randomUUID } from "node:crypto";

export type SessionStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "auto_submitted";

export type AnswerStatus =
  | "not_visited"
  | "not_answered"
  | "answered"
  | "marked_for_review"
  | "answered_marked";

/**
 * A single stored answer for a question within a session. Keyed by question ID
 * inside the session, which gives the idempotent upsert semantics required by
 * the contract (one record per question).
 */
export interface StoredAnswer {
  questionId: string;
  selectedOptionIds: string[];
  status: AnswerStatus;
  clientSeq: number;
  answeredAt: string;
}

/**
 * The shape the client sends for an answer upsert, on both the per-change and
 * heartbeat paths.
 */
export interface AnswerUpsert {
  questionId: string;
  selectedOptionIds: string[];
  status: AnswerStatus;
  clientSeq: number;
  answeredAt: string;
}

/**
 * Server-side grading outcome. Never returned to any client.
 */
export interface SessionResult {
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  unanswered: number;
  gradedAt: string;
}

export interface ExamMeta {
  examId: string;
  title: string;
  durationSeconds: number;
  questionsToServe: number;
  instructions: string[];
}

export interface Session {
  sessionId: string;
  token: string;
  username: string;
  examId: string;
  status: SessionStatus;
  /** Set on first begin; null while still in the lobby. */
  startedAt: string | null;
  /** Set on first begin; null while still in the lobby. */
  deadlineAt: string | null;
  shuffleSeed: string | null;
  /** Frozen subset of question IDs served to this session, in served order. */
  servedQuestionIds: string[];
  /** Answers keyed by question ID. */
  answers: Map<string, StoredAnswer>;
  submittedAt: string | null;
  /** Server-only grading result; never serialized to the client. */
  result: SessionResult | null;
}

/**
 * Grace window applied to the deadline when judging whether a buffered answer is
 * still acceptable. Judged against `answeredAt`, not arrival time, per the plan.
 */
export const DEADLINE_GRACE_SECONDS = 10;

/** token -> session */
const sessionsByToken = new Map<string, Session>();
/** sessionId -> session */
const sessionsById = new Map<string, Session>();

/**
 * The single seeded demo exam. The store owns exam metadata so route handlers
 * stay thin.
 */
export const DEMO_EXAM: ExamMeta = {
  examId: "WCL-DEMO",
  title: "WCL Practice Examination",
  durationSeconds: 300,
  questionsToServe: 10,
  instructions: [
    "The total duration of this examination is 60 minutes. The countdown begins when you select Begin and cannot be paused.",
    "This paper contains 10 questions. Each question carries 1 mark and there is no negative marking.",
    "Questions are of two types: single correct answer and multiple correct answers. Read each question carefully before responding.",
    "For multiple correct answer questions, marks are awarded only when the selected set of options exactly matches the correct set.",
    "Your answers are saved automatically and synchronised with the server. Do not refresh or close the application during the examination.",
    "Use the question palette to navigate. You may mark questions for review and return to them while time remains.",
    "The server clock is authoritative. The examination will be submitted automatically when the time expires.",
    "Do not switch to other applications or leave full-screen mode. Such activity is recorded for review by the invigilator.",
    "Your individual score is not displayed on submission. Results are published separately by the administrator.",
    "Ensure a stable network connection. In the event of a disruption, relaunch the application to resume your session.",
  ],
};

/**
 * Look up the exam metadata for an exam ID. Only the single demo exam exists in
 * this development backend.
 */
export function getExam(examId: string | undefined): ExamMeta | null {
  const id = examId ?? DEMO_EXAM.examId;
  return id === DEMO_EXAM.examId ? DEMO_EXAM : null;
}

/**
 * Create a fresh session for a successful login. A fresh login always creates a
 * fresh session and token, per the contract.
 */
export function createSession(username: string, examId: string): Session {
  const session: Session = {
    sessionId: randomUUID(),
    token: randomUUID(),
    username,
    examId,
    status: "not_started",
    startedAt: null,
    deadlineAt: null,
    shuffleSeed: null,
    servedQuestionIds: [],
    answers: new Map(),
    submittedAt: null,
    result: null,
  };
  sessionsByToken.set(session.token, session);
  sessionsById.set(session.sessionId, session);
  return session;
}

export function getSessionByToken(token: string): Session | undefined {
  return sessionsByToken.get(token);
}

export function getSessionById(sessionId: string): Session | undefined {
  return sessionsById.get(sessionId);
}
