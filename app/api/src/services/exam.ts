/**
 * Candidate exam services: session cache, question-bank cache, answer
 * application, and the shared finalize (grading) path.
 *
 * These functions are consumed by src/routes/exam.ts. They own the Redis
 * caching conventions (session:{id}, bank:{examId}) and the exactly-once
 * finalize semantics that keep concurrent submit / heartbeat / auto-submit
 * from double-grading a session.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../db/index.ts";
import {
  answers,
  auditLogs,
  examSessions,
  exams,
  options,
  participants,
  questions,
  results,
  type AnswerStatus,
  type QuestionType,
  type SessionStatus,
} from "../db/schema.ts";
import { env } from "../env.ts";
import { isExactMatch } from "../lib/grading.ts";
import { seededShuffle } from "../lib/shuffle.ts";
import { logger } from "../logger.ts";
import { redis } from "../redis.ts";

type SessionRow = typeof examSessions.$inferSelect;
type ExamRow = typeof exams.$inferSelect;

/** JSON-safe session shape shared by the Redis cache and DB fallback. */
export interface CachedSession {
  id: string;
  participantId: string;
  examId: string;
  status: SessionStatus;
  startedAt: string | null;
  deadlineAt: string | null;
  shuffleSeed: string | null;
  servedQuestionIds: string[];
  submittedAt: string | null;
  deviceId: string | null;
}

/** Server-side question-bank entry. `isCorrect` is NEVER sent to candidates. */
export interface BankOption {
  optionId: string;
  text: string;
  isCorrect: boolean;
}

export interface BankQuestion {
  questionId: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  marks: number;
  options: BankOption[];
}

/** A single client answer payload, shared by /exam/answer and /exam/heartbeat. */
export interface AnswerEntry {
  questionId: string;
  selectedOptionIds: string[];
  status: string;
  clientSeq: number;
  answeredAt: string;
}

const ANSWER_STATUSES = new Set<AnswerStatus>([
  "not_visited",
  "not_answered",
  "answered",
  "marked_for_review",
  "answered_marked",
]);

/** Grace window (ms) applied to answer acceptance past the deadline. */
const ANSWER_GRACE_MS = 10_000;

// --- Session cache ---------------------------------------------------------

/** Convert a DB session row into its JSON-safe cached form. */
export function serializeSession(row: SessionRow): CachedSession {
  return {
    id: row.id,
    participantId: row.participantId,
    examId: row.examId,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    deadlineAt: row.deadlineAt ? row.deadlineAt.toISOString() : null,
    shuffleSeed: row.shuffleSeed,
    servedQuestionIds: row.servedQuestionIds,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    deviceId: row.deviceId,
  };
}

/** Write the session cache with the token lifetime as TTL. */
export async function cacheSession(session: CachedSession): Promise<void> {
  await redis.set(
    `session:${session.id}`,
    JSON.stringify(session),
    "EX",
    env.SESSION_TOKEN_TTL_SECONDS,
  );
}

/** Read a session from Redis, falling back to the DB and re-caching. */
export async function getSession(sessionId: string): Promise<CachedSession | null> {
  const cached = await redis.get(`session:${sessionId}`);
  if (cached) {
    return JSON.parse(cached) as CachedSession;
  }
  const [row] = await db
    .select()
    .from(examSessions)
    .where(eq(examSessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  const session = serializeSession(row);
  await cacheSession(session);
  return session;
}

// --- Question-bank cache ---------------------------------------------------

/**
 * Load the exam's full question bank (questions + options, including the
 * server-only `isCorrect` flags) from a Redis cache, falling back to the DB.
 * Admin CRUD invalidates this by deleting bank:{examId}.
 */
export async function getBank(examId: string): Promise<BankQuestion[]> {
  const cached = await redis.get(`bank:${examId}`);
  if (cached) {
    return JSON.parse(cached) as BankQuestion[];
  }

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.examId, examId))
    .orderBy(questions.id);

  let bank: BankQuestion[] = [];
  if (questionRows.length > 0) {
    const optionRows = await db
      .select()
      .from(options)
      .where(
        inArray(
          options.questionId,
          questionRows.map((q) => q.id),
        ),
      );
    const optionsByQuestion = new Map<string, BankOption[]>();
    for (const option of optionRows) {
      const list = optionsByQuestion.get(option.questionId) ?? [];
      list.push({ optionId: option.id, text: option.text, isCorrect: option.isCorrect });
      optionsByQuestion.set(option.questionId, list);
    }
    bank = questionRows.map((q) => ({
      questionId: q.id,
      type: q.type,
      text: q.text,
      imageUrl: q.imageUrl,
      marks: q.marks,
      options: optionsByQuestion.get(q.id) ?? [],
    }));
  }

  await redis.set(`bank:${examId}`, JSON.stringify(bank), "EX", 600);
  return bank;
}

// --- Response builders -----------------------------------------------------

/** The exam block shared by /auth/login and /exam/resume. */
export function buildExamBlock(exam: ExamRow): {
  examId: string;
  title: string;
  durationSeconds: number;
  questionsToServe: number;
  instructions: string[];
} {
  return {
    examId: exam.id,
    title: exam.title,
    durationSeconds: exam.durationSeconds,
    questionsToServe: exam.questionsToServe,
    instructions: exam.instructions,
  };
}

/**
 * Build the candidate manifest: questions in served order with options
 * deterministically shuffled per question. Never emits `isCorrect`. Returns an
 * empty question list when the session has not begun (used by /exam/resume).
 */
export function buildManifest(
  session: CachedSession,
  bank: BankQuestion[],
): {
  examId: string;
  shuffleSeed: string | null;
  questions: {
    questionId: string;
    type: QuestionType;
    text: string;
    imageUrl: string | null;
    marks: number;
    options: { optionId: string; text: string }[];
  }[];
} {
  if (!session.shuffleSeed || session.servedQuestionIds.length === 0) {
    return { examId: session.examId, shuffleSeed: session.shuffleSeed, questions: [] };
  }
  const seed = session.shuffleSeed;
  const bankById = new Map(bank.map((q) => [q.questionId, q]));
  const questionsOut = [];
  for (const questionId of session.servedQuestionIds) {
    const question = bankById.get(questionId);
    if (!question) continue;
    const shuffled = seededShuffle(question.options, `${seed}:${questionId}`);
    questionsOut.push({
      questionId: question.questionId,
      type: question.type,
      text: question.text,
      imageUrl: question.imageUrl,
      marks: question.marks,
      options: shuffled.map((o) => ({ optionId: o.optionId, text: o.text })),
    });
  }
  return { examId: session.examId, shuffleSeed: seed, questions: questionsOut };
}

// --- Answer application ----------------------------------------------------

/**
 * Apply a single answer with the monotonic-sequence guard. Returns whether the
 * answer was ACKed. A structurally valid but stale (lower clientSeq) write is
 * ignored at the database level yet still ACKed; out-of-bank, unknown-status,
 * or past-grace entries are not ACKed.
 */
export async function applyAnswer(session: CachedSession, entry: AnswerEntry): Promise<boolean> {
  if (!session.servedQuestionIds.includes(entry.questionId)) return false;
  if (!ANSWER_STATUSES.has(entry.status as AnswerStatus)) return false;

  const answeredMs = Date.parse(entry.answeredAt);
  if (Number.isNaN(answeredMs)) return false;
  if (session.deadlineAt) {
    const graceLimit = Date.parse(session.deadlineAt) + ANSWER_GRACE_MS;
    if (answeredMs > graceLimit) return false;
  }

  const answeredAt = new Date(answeredMs);
  const status = entry.status as AnswerStatus;
  await db
    .insert(answers)
    .values({
      sessionId: session.id,
      questionId: entry.questionId,
      selectedOptionIds: entry.selectedOptionIds,
      status,
      clientSeq: entry.clientSeq,
      answeredAt,
    })
    .onConflictDoUpdate({
      target: [answers.sessionId, answers.questionId],
      set: {
        selectedOptionIds: entry.selectedOptionIds,
        status,
        clientSeq: entry.clientSeq,
        answeredAt,
      },
      // Apply only when the incoming sequence is strictly newer.
      setWhere: sql`${answers.clientSeq} < excluded.client_seq`,
    });
  return true;
}

/**
 * Apply a batch of answers, returning the ACKed question ids.
 *
 * If the session is already finalized (auto-submit sweep, heartbeat finalize,
 * or manual submit beat the sync), grading has already run WITHOUT these
 * answers — an ACKed in-grace answer (applyAnswer only ACKs within
 * deadline+grace) would otherwise be stored but never counted. Re-grade once
 * per batch so the spec guarantee holds: buffered before-deadline answers
 * synced after finalize are never lost.
 */
export async function applyBatch(
  session: CachedSession,
  entries: AnswerEntry[],
): Promise<string[]> {
  const acked: string[] = [];
  for (const entry of entries) {
    if (await applyAnswer(session, entry)) acked.push(entry.questionId);
  }
  if (
    acked.length > 0 &&
    (session.status === "submitted" || session.status === "auto_submitted")
  ) {
    await regrade(session.id);
  }
  return acked;
}

/**
 * Recompute and re-persist the result for a finalized session after a late
 * (but in-grace) answer sync. Skipped when an admin has manually edited the
 * score (result.score_edit audit entry), so a human decision is never
 * silently clobbered by an automatic recount.
 */
async function regrade(sessionId: string): Promise<void> {
  const [edited] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "result.score_edit"), eq(auditLogs.target, sessionId)))
    .limit(1);
  if (edited) {
    logger.warn({ sessionId }, "late answer synced but score was admin-edited; skipping regrade");
    return;
  }
  const [row] = await db.select().from(examSessions).where(eq(examSessions.id, sessionId)).limit(1);
  if (!row || (row.status !== "submitted" && row.status !== "auto_submitted")) return;
  await gradeAndPersist(row);
  logger.info({ sessionId }, "regraded after late in-grace answer sync");
}

// --- Finalize (grading) ----------------------------------------------------

/**
 * Finalize a session exactly once. The status transition is claimed with an
 * atomic UPDATE ... WHERE status = 'in_progress' RETURNING, so concurrent
 * submit / heartbeat / sweep callers cannot double-grade. If the session was
 * already finalized (or never begun), the stored state is returned unchanged.
 */
export async function finalize(
  sessionId: string,
  status: "submitted" | "auto_submitted",
): Promise<{ status: SessionStatus; submittedAt: string | null }> {
  const submittedAt = new Date();
  const [claimed] = await db
    .update(examSessions)
    .set({ status, submittedAt })
    .where(and(eq(examSessions.id, sessionId), eq(examSessions.status, "in_progress")))
    .returning();

  if (!claimed) {
    const existing = await getSession(sessionId);
    return {
      status: existing?.status ?? "not_started",
      submittedAt: existing?.submittedAt ?? null,
    };
  }

  await gradeAndPersist(claimed);
  await cacheSession(serializeSession(claimed));
  return { status: claimed.status, submittedAt: submittedAt.toISOString() };
}

interface ResultAnswer {
  questionId: string;
  type: QuestionType;
  text: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  selectedOptionIds: string[];
  outcome: "correct" | "wrong" | "unanswered";
}

interface ResultRecord {
  sessionId: string;
  username: string;
  examId: string;
  status: SessionStatus;
  startedAt: string | null;
  submittedAt: string | null;
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  unanswered: number;
  gradedAt: string;
  answers: ResultAnswer[];
}

/** Grade the claimed session and fan the result out to DB, Redis, and the file feed. */
async function gradeAndPersist(session: SessionRow): Promise<void> {
  const bank = await getBank(session.examId);
  const bankById = new Map(bank.map((q) => [q.questionId, q]));

  const answerRows = await db
    .select()
    .from(answers)
    .where(eq(answers.sessionId, session.id));
  const selectionByQuestion = new Map(answerRows.map((a) => [a.questionId, a.selectedOptionIds]));

  let score = 0;
  let maxScore = 0;
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  const gradedAnswers: ResultAnswer[] = [];

  for (const questionId of session.servedQuestionIds) {
    const question = bankById.get(questionId);
    if (!question) continue;
    maxScore += question.marks;
    const selected = selectionByQuestion.get(questionId) ?? [];
    const correctIds = question.options.filter((o) => o.isCorrect).map((o) => o.optionId);

    let outcome: ResultAnswer["outcome"];
    if (selected.length === 0) {
      unanswered += 1;
      outcome = "unanswered";
    } else if (isExactMatch(selected, correctIds)) {
      score += question.marks;
      correct += 1;
      outcome = "correct";
    } else {
      score -= 0.5;
      wrong += 1;
      outcome = "wrong";
    }

    gradedAnswers.push({
      questionId,
      type: question.type,
      text: question.text,
      options: question.options.map((o) => ({ id: o.optionId, text: o.text, isCorrect: o.isCorrect })),
      selectedOptionIds: selected,
      outcome,
    });
  }

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, session.participantId))
    .limit(1);
  const username = participant?.username ?? "";
  const submittedAtIso = session.submittedAt
    ? session.submittedAt.toISOString()
    : new Date().toISOString();

  await db
    .insert(results)
    .values({
      sessionId: session.id,
      participantId: session.participantId,
      examId: session.examId,
      score,
      maxScore,
      correct,
      wrong,
      unanswered,
    })
    // Upsert so a regrade (late in-grace answer sync) refreshes the result.
    .onConflictDoUpdate({
      target: results.sessionId,
      set: { score, maxScore, correct, wrong, unanswered, gradedAt: new Date() },
    });

  await redis.zadd(`leaderboard:${session.examId}`, score, session.participantId);
  await redis.publish(
    `wcl:leaderboard:${session.examId}`,
    JSON.stringify({ participantId: session.participantId, username, score, maxScore, submittedAt: submittedAtIso }),
  );

  await appendResult({
    sessionId: session.id,
    username,
    examId: session.examId,
    status: session.status,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    submittedAt: submittedAtIso,
    score,
    maxScore,
    correct,
    wrong,
    unanswered,
    gradedAt: new Date().toISOString(),
    answers: gradedAnswers,
  });
}

/** Per-question entry in the candidate result review. NEVER carries `isCorrect`. */
interface ReviewQuestion {
  questionId: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  marks: number;
  options: { optionId: string; text: string }[];
  selectedOptionIds: string[];
  outcome: "correct" | "wrong" | "unanswered";
  marksAwarded: number;
}

/**
 * Build the candidate-facing result review for a finalized session: the stored
 * totals plus a per-question breakdown (outcome and marks only, options in the
 * seed order the candidate saw). Recomputes each outcome exactly like grading.
 * Returns null when no results row exists yet (status flips before grading
 * finishes), so the route can tell the client to retry. NEVER emits `isCorrect`.
 */
export async function buildResultReview(session: CachedSession): Promise<{
  sessionId: string;
  examId: string;
  status: SessionStatus;
  submittedAt: string | null;
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  unanswered: number;
  questions: ReviewQuestion[];
} | null> {
  const [result] = await db
    .select()
    .from(results)
    .where(eq(results.sessionId, session.id))
    .limit(1);
  if (!result) return null;

  const bank = await getBank(session.examId);
  const bankById = new Map(bank.map((q) => [q.questionId, q]));
  const answerRows = await db.select().from(answers).where(eq(answers.sessionId, session.id));
  const selectionByQuestion = new Map(answerRows.map((a) => [a.questionId, a.selectedOptionIds]));

  const seed = session.shuffleSeed ?? "";
  const questionsOut: ReviewQuestion[] = [];
  for (const questionId of session.servedQuestionIds) {
    const question = bankById.get(questionId);
    if (!question) continue;
    const selected = selectionByQuestion.get(questionId) ?? [];
    const correctIds = question.options.filter((o) => o.isCorrect).map((o) => o.optionId);

    let outcome: ReviewQuestion["outcome"];
    let marksAwarded: number;
    if (selected.length === 0) {
      outcome = "unanswered";
      marksAwarded = 0;
    } else if (isExactMatch(selected, correctIds)) {
      outcome = "correct";
      marksAwarded = question.marks;
    } else {
      outcome = "wrong";
      marksAwarded = -0.5;
    }

    // Same option order the candidate saw in the exam (manifest uses this seed).
    const shuffled = seededShuffle(question.options, `${seed}:${questionId}`);
    questionsOut.push({
      questionId: question.questionId,
      type: question.type,
      text: question.text,
      imageUrl: question.imageUrl,
      marks: question.marks,
      options: shuffled.map((o) => ({ optionId: o.optionId, text: o.text })),
      selectedOptionIds: selected,
      outcome,
      marksAwarded,
    });
  }

  return {
    sessionId: session.id,
    examId: session.examId,
    status: session.status,
    submittedAt: session.submittedAt,
    score: result.score,
    maxScore: result.maxScore,
    correct: result.correct,
    wrong: result.wrong,
    unanswered: result.unanswered,
    questions: questionsOut,
  };
}

// --- File result feed (read by the Next.js admin panel) --------------------

const RESULTS_FILE = fileURLToPath(new URL("../../data/results.json", import.meta.url));

// ponytail: single-process append lock (promise chain). If the API ever runs
// multi-process, move this feed to the DB (results table already exists) or a
// file lock; the in-memory chain only serializes writers within one process.
let writeChain: Promise<void> = Promise.resolve();

/** Append one graded result to data/results.json (read-modify-write). */
function appendResult(record: ResultRecord): Promise<void> {
  const next = writeChain
    .then(async () => {
      await mkdir(dirname(RESULTS_FILE), { recursive: true });
      let existing: unknown[] = [];
      try {
        const parsed = JSON.parse(await readFile(RESULTS_FILE, "utf8")) as unknown;
        if (Array.isArray(parsed)) existing = parsed;
      } catch {
        existing = [];
      }
      // A regrade replaces the session's record instead of duplicating it.
      existing = existing.filter(
        (r) => (r as { sessionId?: string } | null)?.sessionId !== record.sessionId,
      );
      existing.push(record);
      await writeFile(RESULTS_FILE, JSON.stringify(existing, null, 2), "utf8");
    })
    .catch((err: unknown) => {
      logger.error({ err }, "results.json append failed");
    });
  writeChain = next;
  return next;
}
