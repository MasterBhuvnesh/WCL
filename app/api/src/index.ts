/**
 * WCL examination system: in-memory development backend.
 *
 * Bun + Express + TypeScript. This server exists only to support the Electron
 * exam client during local development. It is deliberately not production-grade:
 * no database, no Redis, no Docker. State lives in process memory and is lost on
 * restart. The production design is described in docs/EXAM_SYSTEM_PLAN.md.
 *
 * Authentication uses opaque bearer tokens (crypto.randomUUID) mapped to
 * in-memory sessions. No JWT, no password hashing: the dev credential rule is
 * "any non-empty username with password 'password'".
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";

import { QUESTION_BANK, type Question } from "./data/questions.ts";
import {
  DEADLINE_GRACE_SECONDS,
  createSession,
  getExam,
  getSessionByToken,
  type AnswerStatus,
  type AnswerUpsert,
  type Session,
} from "./store.ts";
import { seededSubset } from "./lib/shuffle.ts";
import { buildManifest } from "./lib/manifest.ts";
import { gradeSession, isExactMatch } from "./lib/grading.ts";

const PORT = Number(process.env.PORT ?? 4000);
const DEV_PASSWORD = "password";

/** Fast lookup of the full bank by question ID, built once at startup. */
const questionsById = new Map<string, Question>(
  QUESTION_BANK.map((question) => [question.id, question]),
);

const VALID_ANSWER_STATUSES: ReadonlySet<AnswerStatus> = new Set<AnswerStatus>([
  "not_visited",
  "not_answered",
  "answered",
  "marked_for_review",
  "answered_marked",
]);

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Request augmented with the authenticated session by the auth middleware.
 */
interface AuthedRequest extends Request {
  session?: Session;
}

/**
 * Bearer-token auth middleware. Resolves the session from the Authorization
 * header and attaches it to the request. Responds 401 when missing or unknown.
 */
function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const session = getSessionByToken(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }
  req.session = session;
  next();
}

/**
 * Compute whole seconds remaining until the deadline from the server clock,
 * floored at zero.
 */
function remainingSeconds(deadlineAt: string): number {
  const remainingMs = new Date(deadlineAt).getTime() - Date.now();
  return Math.max(0, Math.floor(remainingMs / 1000));
}

/**
 * True if the session is past its deadline by the server clock.
 */
function isPastDeadline(session: Session): boolean {
  return !!session.deadlineAt && Date.now() > new Date(session.deadlineAt).getTime();
}

/**
 * Completed-exam results are appended to a JSON file so the admin panel can
 * read them across restarts. Interim persistence until the real database lands.
 */
const RESULTS_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "results.json",
);

// ponytail: read-modify-write of one JSON file; replace with PostgreSQL per the plan.
function persistResult(session: Session): void {
  try {
    let records: unknown[] = [];
    try {
      const parsed = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
      if (Array.isArray(parsed)) records = parsed;
    } catch {
      // First write, or an unreadable file: start a fresh array.
    }
    // Per-question review data, denormalized so the admin panel can render it
    // from the file alone. This file is server-side only; isCorrect is safe here.
    const answers = session.servedQuestionIds.map((questionId) => {
      const question = questionsById.get(questionId);
      const selected = session.answers.get(questionId)?.selectedOptionIds ?? [];
      const correctIds = (question?.options ?? [])
        .filter((option) => option.isCorrect)
        .map((option) => option.id);
      const outcome =
        selected.length === 0
          ? "unanswered"
          : isExactMatch(selected, correctIds)
            ? "correct"
            : "wrong";
      return {
        questionId,
        type: question?.type ?? "SCQ",
        text: question?.text ?? "",
        options: (question?.options ?? []).map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: option.isCorrect,
        })),
        selectedOptionIds: selected,
        outcome,
      };
    });

    records.push({
      sessionId: session.sessionId,
      username: session.username,
      examId: session.examId,
      status: session.status,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      ...session.result,
      answers,
    });
    mkdirSync(dirname(RESULTS_FILE), { recursive: true });
    writeFileSync(RESULTS_FILE, JSON.stringify(records, null, 2));
  } catch (error) {
    console.error("[results] failed to persist result", error);
  }
}

/**
 * Finalize and grade a session exactly once. Used by both manual submit and
 * deadline-triggered auto-submit. Grading is server-side only; the result is
 * stored on the session, appended to the results file for the admin panel, and
 * never returned to the client.
 */
function finalizeSession(session: Session, status: "submitted" | "auto_submitted"): void {
  if (session.status === "submitted" || session.status === "auto_submitted") {
    return;
  }
  session.status = status;
  session.submittedAt = new Date().toISOString();
  session.result = gradeSession(session, questionsById);
  persistResult(session);
}

/**
 * Apply a single answer upsert under the monotonic client_seq guard and the
 * deadline grace rule. Returns the question ID to acknowledge, or null when the
 * upsert is rejected outright (answered after the grace window).
 *
 * Acknowledgement semantics: an answer that is ignored because its client_seq is
 * not newer than the stored one is still acknowledged. An answer rejected for
 * being past the deadline grace is not stored and not acknowledged.
 */
function applyAnswerUpsert(session: Session, upsert: AnswerUpsert): string | null {
  const { questionId, selectedOptionIds, status, clientSeq, answeredAt } = upsert;

  // Basic shape and membership validation. Reject silently malformed entries.
  if (typeof questionId !== "string" || !session.servedQuestionIds.includes(questionId)) {
    return null;
  }
  if (!Array.isArray(selectedOptionIds) || !selectedOptionIds.every((id) => typeof id === "string")) {
    return null;
  }
  if (typeof clientSeq !== "number" || !Number.isFinite(clientSeq)) {
    return null;
  }
  if (!VALID_ANSWER_STATUSES.has(status)) {
    return null;
  }

  // Deadline enforcement is judged by answered_at, not arrival time, with a
  // grace window for clock skew and buffered before-deadline answers.
  if (session.deadlineAt) {
    const stampedMs = new Date(answeredAt).getTime();
    const graceCutoffMs =
      new Date(session.deadlineAt).getTime() + DEADLINE_GRACE_SECONDS * 1000;
    if (!Number.isNaN(stampedMs) && stampedMs > graceCutoffMs) {
      return null;
    }
  }

  const existing = session.answers.get(questionId);
  // Monotonic guard: apply only if strictly newer; otherwise ignore but ack.
  if (!existing || clientSeq > existing.clientSeq) {
    session.answers.set(questionId, {
      questionId,
      selectedOptionIds: [...selectedOptionIds],
      status,
      clientSeq,
      answeredAt,
    });
  }
  return questionId;
}

/**
 * Build the exam metadata block returned to the client (no answers, no flags).
 */
function examBlock(examId: string | undefined) {
  const exam = getExam(examId);
  if (!exam) {
    return null;
  }
  return {
    examId: exam.examId,
    title: exam.title,
    durationSeconds: exam.durationSeconds,
    questionsToServe: exam.questionsToServe,
    instructions: exam.instructions,
  };
}

/**
 * Serialize stored answers into the AnswerUpsert array shape for resume.
 */
function serializeAnswers(session: Session): AnswerUpsert[] {
  return [...session.answers.values()].map((answer) => ({
    questionId: answer.questionId,
    selectedOptionIds: [...answer.selectedOptionIds],
    status: answer.status,
    clientSeq: answer.clientSeq,
    answeredAt: answer.answeredAt,
  }));
}

// --- Routes ---------------------------------------------------------------

/** Health check for liveness probes and smoke tests. */
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "wcl-api",
    time: new Date().toISOString(),
  });
});

/** Server time for client offset (NTP-style) calculation. */
app.get("/time", (_req: Request, res: Response) => {
  res.status(200).json({ serverTime: new Date().toISOString() });
});

/**
 * Login. Dev credential rule: any non-empty username with password "password".
 * A fresh login always creates a fresh session and token.
 */
app.post("/auth/login", (req: Request, res: Response) => {
  const { username, password, examId } = req.body ?? {};

  if (typeof username !== "string" || username.trim().length === 0) {
    res.status(401).json({ error: "Username is required" });
    return;
  }
  if (password !== DEV_PASSWORD) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const exam = examBlock(typeof examId === "string" ? examId : undefined);
  if (!exam) {
    res.status(401).json({ error: "Unknown exam" });
    return;
  }

  const session = createSession(username.trim(), exam.examId);
  res.status(200).json({
    token: session.token,
    sessionId: session.sessionId,
    exam,
    sessionStatus: session.status,
  });
});

/**
 * Begin the exam. Idempotent: re-calling returns the existing started/deadline.
 * On first begin, stamp times, generate a seed, freeze the served subset, and
 * the manifest ordering follows from the seed.
 */
app.post("/exam/begin", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = req.session!;
  const exam = getExam(session.examId)!;

  if (!session.startedAt || !session.deadlineAt) {
    const now = Date.now();
    session.startedAt = new Date(now).toISOString();
    session.deadlineAt = new Date(now + exam.durationSeconds * 1000).toISOString();
    session.shuffleSeed = randomUUID();
    session.servedQuestionIds = seededSubset(
      QUESTION_BANK.map((question) => question.id),
      exam.questionsToServe,
      session.shuffleSeed,
    );
    session.status = "in_progress";
  }

  res.status(200).json({
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    serverTime: new Date().toISOString(),
    durationSeconds: exam.durationSeconds,
    status: "in_progress",
  });
});

/**
 * Manifest. Returns the seed-ordered served questions without isCorrect.
 * 409 if begin has not happened.
 */
app.get("/exam/manifest", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = req.session!;
  if (!session.shuffleSeed || session.servedQuestionIds.length === 0) {
    res.status(409).json({ error: "Exam has not begun" });
    return;
  }
  res.status(200).json({
    examId: session.examId,
    shuffleSeed: session.shuffleSeed,
    questions: buildManifest(session, questionsById),
  });
});

/**
 * Per-change answer upsert with the monotonic guard and deadline grace rule.
 */
app.post("/exam/answer", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = req.session!;
  const body = req.body ?? {};
  const upsert: AnswerUpsert = {
    questionId: body.questionId,
    selectedOptionIds: body.selectedOptionIds,
    status: body.status,
    clientSeq: body.clientSeq,
    answeredAt: body.answeredAt,
  };

  const acked = applyAnswerUpsert(session, upsert);
  res.status(200).json({ acked: acked ? [acked] : [] });
});

/**
 * Heartbeat. Applies a batch of answers, returns the authoritative clock state,
 * and finalizes (auto-submits) exactly once if past the deadline.
 */
app.post("/exam/heartbeat", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = req.session!;
  const body = req.body ?? {};
  const incoming: AnswerUpsert[] = Array.isArray(body.answers) ? body.answers : [];

  const acked: string[] = [];
  for (const upsert of incoming) {
    const ackedId = applyAnswerUpsert(session, upsert);
    if (ackedId) {
      acked.push(ackedId);
    }
  }

  let status = session.status;
  if (session.deadlineAt && isPastDeadline(session)) {
    finalizeSession(session, "auto_submitted");
    status = session.status;
  }

  res.status(200).json({
    serverTime: new Date().toISOString(),
    remainingSeconds: session.deadlineAt ? remainingSeconds(session.deadlineAt) : 0,
    deadlineAt: session.deadlineAt,
    status,
    acked,
  });
});

/**
 * Manual submit. Grades server-side and stores the result. The score is never
 * returned to the client.
 */
app.post("/exam/submit", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = req.session!;
  finalizeSession(session, "submitted");
  res.status(200).json({
    status: "submitted",
    submittedAt: session.submittedAt,
  });
});

/**
 * Resume. Returns the server-authoritative state needed to restore the client:
 * exam meta, seed-ordered manifest (no isCorrect), stored answers, deadline,
 * remaining seconds, server time, and status.
 */
app.post("/exam/resume", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = req.session!;
  const exam = examBlock(session.examId);

  if (session.deadlineAt && isPastDeadline(session)) {
    finalizeSession(session, "auto_submitted");
  }

  const manifest = session.shuffleSeed ? buildManifest(session, questionsById) : [];

  res.status(200).json({
    exam,
    manifest,
    answers: serializeAnswers(session),
    deadlineAt: session.deadlineAt,
    remainingSeconds: session.deadlineAt ? remainingSeconds(session.deadlineAt) : 0,
    serverTime: new Date().toISOString(),
    status: session.status,
  });
});

// --- Fallbacks ------------------------------------------------------------

/** Unknown route. */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

/** Final error handler: keep responses JSON and avoid leaking internals. */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

app.listen(PORT, () => {
  // Startup banner. No emoji per project conventions.
  console.log(`wcl-api listening on http://localhost:${PORT}`);
  console.log(`Question bank size: ${QUESTION_BANK.length}`);
});
