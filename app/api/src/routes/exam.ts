/**
 * Candidate exam lifecycle: authentication, begin, manifest, answer capture,
 * heartbeat, submit, resume, and integrity reporting.
 *
 * Every response field name here is part of the client contract and must not
 * change. Shared caching and grading live in src/services/exam.ts.
 */

import { and, eq, lt } from "drizzle-orm";
import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { db } from "../db/index.ts";
import {
  answers,
  examSessions,
  exams,
  feedback,
  integrityEvents,
  questions,
  type SessionStatus,
} from "../db/schema.ts";
import { env } from "../env.ts";
import {
  HttpError,
  rateLimit,
  requireParticipant,
  signParticipantToken,
  validate,
  type AuthedRequest,
} from "../http/middleware.ts";
import { seededSubset } from "../lib/shuffle.ts";
import { logger } from "../logger.ts";
import { redis } from "../redis.ts";
import {
  applyBatch,
  buildExamBlock,
  buildManifest,
  buildResultReview,
  cacheSession,
  finalize,
  getBank,
  getParticipantByUsername,
  getSession,
  serializeSession,
  type AnswerEntry,
} from "../services/exam.ts";

/**
 * Bun runtime global (argon2id password hashing). Declared locally because the
 * project's tsconfig only pulls in @types/node.
 */
declare const Bun: {
  password: {
    verify(password: string, hash: string): Promise<boolean>;
    hash(password: string): Promise<string>;
  };
};

const DEFAULT_EXAM_ID = "WCL-EXAM";

/** Wrap an async handler so rejections reach the Express error middleware. */
function asyncHandler(
  fn: (req: AuthedRequest, res: Response) => Promise<void>,
): (req: AuthedRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

// --- Validation schemas ----------------------------------------------------

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  examId: z.string().optional(),
  deviceId: z.string().optional(),
});
type LoginBody = z.infer<typeof loginSchema>;

const answerEntrySchema = z.object({
  questionId: z.string(),
  selectedOptionIds: z.array(z.string()),
  status: z.string(),
  clientSeq: z.number(),
  answeredAt: z.string(),
});

const integritySchema = z.object({
  type: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const heartbeatSchema = z.object({
  answers: z.array(answerEntrySchema).optional(),
  // Integrity events piggyback on the heartbeat so cheat-attempt reporting
  // never costs an extra request. The client coalesces repeats client-side;
  // the cap bounds a hostile client.
  integrityEvents: z.array(integritySchema).max(50).optional(),
});

// --- Router ----------------------------------------------------------------

export const examRouter = Router();
examRouter.use(rateLimit({ bucket: "exam", limit: 300, windowSeconds: 60 }));

/** POST /auth/login: authenticate a participant and start/reuse a session. */
examRouter.post(
  "/auth/login",
  rateLimit({ bucket: "login", limit: 10, windowSeconds: 60 }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password, examId, deviceId } = req.body as LoginBody;

    const participant = await getParticipantByUsername(username);
    if (!participant) throw new HttpError(401, "Invalid username or password");

    const passwordOk = await Bun.password.verify(password, participant.secretHash);
    if (!passwordOk) throw new HttpError(401, "Invalid username or password");

    const [exam] = await db
      .select()
      .from(exams)
      .where(eq(exams.id, examId ?? DEFAULT_EXAM_ID))
      .limit(1);
    if (!exam) throw new HttpError(401, "Invalid username or password");

    const now = new Date();
    if (
      !exam.isOpen ||
      (exam.availableFrom && now < exam.availableFrom) ||
      (exam.availableUntil && now > exam.availableUntil)
    ) {
      throw new HttpError(403, "Exam is not open");
    }

    const [existing] = await db
      .select()
      .from(examSessions)
      .where(and(eq(examSessions.participantId, participant.id), eq(examSessions.examId, exam.id)))
      .limit(1);

    let session = existing;
    if (existing) {
      if (existing.status === "submitted" || existing.status === "auto_submitted") {
        throw new HttpError(409, "Exam already submitted");
      }

      const bound = existing.deviceId;
      // A different device is blocked while the binding stands. An admin must
      // "release device binding" (which nulls deviceId) before a legit resume
      // on new hardware; that path re-binds below and logs device_change.
      if (deviceId && bound && deviceId !== bound) {
        await db.insert(integrityEvents).values({
          sessionId: existing.id,
          type: "device_change",
          meta: { boundDeviceId: bound, attemptedDeviceId: deviceId, allowed: false },
        });
        throw new HttpError(
          409,
          "Session is bound to another device. Ask a proctor to release the device binding.",
        );
      }

      if (deviceId && deviceId !== bound) {
        // bound is null here: first bind, or an admin-released rebind onto new
        // hardware. Only the latter (an active session) is a device_change.
        const [updated] = await db
          .update(examSessions)
          .set({ deviceId })
          .where(eq(examSessions.id, existing.id))
          .returning();
        session = updated;
        if (existing.status === "in_progress") {
          await db.insert(integrityEvents).values({
            sessionId: existing.id,
            type: "device_change",
            meta: { attemptedDeviceId: deviceId, allowed: true },
          });
        }
      } else if (existing.status === "in_progress") {
        // Same device (or no device sent) re-login on an active session.
        await db.insert(integrityEvents).values({
          sessionId: existing.id,
          type: "double_login",
          meta: deviceId ? { deviceId } : null,
        });
      }
    } else {
      const [created] = await db
        .insert(examSessions)
        .values({
          participantId: participant.id,
          examId: exam.id,
          status: "not_started",
          deviceId: deviceId ?? null,
        })
        .returning();
      session = created;
    }
    if (!session) throw new HttpError(500, "Failed to establish session");

    const token = signParticipantToken({
      sessionId: session.id,
      participantId: participant.id,
      deviceId: deviceId ?? session.deviceId ?? undefined,
    });
    await cacheSession(serializeSession(session));

    res.status(200).json({
      token,
      sessionId: session.id,
      exam: buildExamBlock(exam),
      sessionStatus: session.status,
    });
  }),
);

/** POST /exam/begin: idempotently start the timed exam and freeze the subset. */
examRouter.post(
  "/exam/begin",
  requireParticipant,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const session = await getSession(sessionId);
    if (!session) throw new HttpError(401, "Session not found");

    const [exam] = await db.select().from(exams).where(eq(exams.id, session.examId)).limit(1);
    if (!exam) throw new HttpError(401, "Exam not found");

    const durationSeconds = Math.max(1, Math.round(exam.durationSeconds / env.CLOCK_MULTIPLIER));

    if (session.status !== "not_started") {
      res.status(200).json({
        startedAt: session.startedAt,
        deadlineAt: session.deadlineAt,
        serverTime: new Date().toISOString(),
        durationSeconds,
        status: session.status,
      });
      return;
    }

    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + durationSeconds * 1000);
    const shuffleSeed = randomUUID();
    const allIds = (
      await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.examId, exam.id))
        .orderBy(questions.id)
    ).map((row) => row.id);
    const servedQuestionIds = seededSubset(allIds, exam.questionsToServe, shuffleSeed);

    const [updated] = await db
      .update(examSessions)
      .set({ startedAt, deadlineAt, shuffleSeed, servedQuestionIds, status: "in_progress" })
      .where(eq(examSessions.id, session.id))
      .returning();
    if (!updated) throw new HttpError(500, "Failed to begin exam");
    await cacheSession(serializeSession(updated));
    await redis.set(
      `deadline:${session.id}`,
      String(deadlineAt.getTime()),
      "EX",
      durationSeconds + 300,
    );

    res.status(200).json({
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      serverTime: new Date().toISOString(),
      durationSeconds,
      status: "in_progress",
    });
  }),
);

/** GET /exam/manifest: served questions with per-question shuffled options. */
examRouter.get(
  "/exam/manifest",
  requireParticipant,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const session = await getSession(sessionId);
    if (!session || session.status === "not_started" || !session.shuffleSeed) {
      throw new HttpError(409, "Exam has not begun");
    }
    const bank = await getBank(session.examId);
    res.status(200).json(buildManifest(session, bank));
  }),
);

/** POST /exam/answer: single monotonic answer upsert. */
examRouter.post(
  "/exam/answer",
  requireParticipant,
  validate(answerEntrySchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const session = await getSession(sessionId);
    if (!session) throw new HttpError(401, "Session not found");
    const entry = req.body as AnswerEntry;
    // Batch of one: applyBatch owns the late-sync regrade for every write path.
    const acked = await applyBatch(session, [entry]);
    res.status(200).json({ acked });
  }),
);

/** POST /exam/heartbeat: batch answers, report clock, auto-submit past deadline. */
examRouter.post(
  "/exam/heartbeat",
  requireParticipant,
  validate(heartbeatSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const session = await getSession(sessionId);
    if (!session) throw new HttpError(401, "Session not found");

    const body = req.body as {
      answers?: AnswerEntry[];
      integrityEvents?: { type: string; meta?: Record<string, unknown> }[];
    };
    const acked = body.answers?.length ? await applyBatch(session, body.answers) : [];

    if (body.integrityEvents?.length) {
      await db.insert(integrityEvents).values(
        body.integrityEvents.map((e) => ({
          sessionId: session.id,
          type: e.type,
          meta: e.meta ?? null,
        })),
      );
    }

    const now = Date.now();
    const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : null;
    let status: SessionStatus = session.status;
    if (session.status === "in_progress" && deadlineMs !== null && now > deadlineMs) {
      status = (await finalize(session.id, "auto_submitted")).status;
    }
    const remainingSeconds =
      deadlineMs !== null ? Math.max(0, Math.floor((deadlineMs - now) / 1000)) : 0;

    res.status(200).json({
      serverTime: new Date().toISOString(),
      remainingSeconds,
      deadlineAt: session.deadlineAt,
      status,
      acked,
    });
  }),
);

/** POST /exam/submit: finalize as submitted (idempotent). */
examRouter.post(
  "/exam/submit",
  requireParticipant,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const result = await finalize(sessionId, "submitted");
    res.status(200).json({ status: result.status, submittedAt: result.submittedAt });
  }),
);

/** POST /exam/resume: full state rehydration for a returning candidate. */
examRouter.post(
  "/exam/resume",
  requireParticipant,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const current = await getSession(sessionId);
    if (!current) throw new HttpError(401, "Session not found");

    const deadlineMs = current.deadlineAt ? Date.parse(current.deadlineAt) : null;
    if (current.status === "in_progress" && deadlineMs !== null && Date.now() > deadlineMs) {
      await finalize(current.id, "auto_submitted");
    }

    const session = (await getSession(sessionId)) ?? current;
    const [exam] = await db.select().from(exams).where(eq(exams.id, session.examId)).limit(1);
    if (!exam) throw new HttpError(401, "Exam not found");

    const bank = await getBank(session.examId);
    const manifest = buildManifest(session, bank);

    const answerRows = await db.select().from(answers).where(eq(answers.sessionId, session.id));
    const answersOut = answerRows.map((a) => ({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      status: a.status,
      clientSeq: a.clientSeq,
      answeredAt: a.answeredAt.toISOString(),
    }));

    const nowMs = Date.now();
    const currentDeadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : null;
    const remainingSeconds =
      currentDeadlineMs !== null ? Math.max(0, Math.floor((currentDeadlineMs - nowMs) / 1000)) : 0;

    res.status(200).json({
      exam: buildExamBlock(exam),
      manifest,
      answers: answersOut,
      deadlineAt: session.deadlineAt,
      remainingSeconds,
      serverTime: new Date().toISOString(),
      status: session.status,
    });
  }),
);

/** GET /exam/result: candidate result review (outcome + marks only; never correct answers). */
examRouter.get(
  "/exam/result",
  requireParticipant,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const session = await getSession(sessionId);
    if (!session) throw new HttpError(401, "Session not found");
    if (session.status !== "submitted" && session.status !== "auto_submitted") {
      throw new HttpError(409, "Exam not submitted");
    }
    // Grading can lag the status flip; a null review means "retry shortly".
    const review = await buildResultReview(session);
    if (!review) throw new HttpError(409, "Result not ready");
    res.status(200).json(review);
  }),
);

const feedbackSchema = z.object({
  platformRating: z.number().int().min(1).max(5),
  infrastructureRating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/** POST /exam/feedback: post-submission candidate feedback (once per session). */
examRouter.post(
  "/exam/feedback",
  requireParticipant,
  validate(feedbackSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const session = await getSession(sessionId);
    if (!session) throw new HttpError(401, "Session not found");
    if (session.status !== "submitted" && session.status !== "auto_submitted") {
      throw new HttpError(409, "Exam not submitted");
    }
    const body = req.body as z.infer<typeof feedbackSchema>;
    // First submission wins; a repeat (relaunch, retry) is acknowledged, not an error.
    await db
      .insert(feedback)
      .values({
        sessionId,
        participantId: session.participantId,
        examId: session.examId,
        platformRating: body.platformRating,
        infrastructureRating: body.infrastructureRating,
        comment: body.comment || null,
      })
      .onConflictDoNothing();
    res.status(200).json({ ok: true });
  }),
);

/** POST /exam/integrity: record a proctoring integrity event. */
examRouter.post(
  "/exam/integrity",
  requireParticipant,
  validate(integritySchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.participant!;
    const { type, meta } = req.body as z.infer<typeof integritySchema>;
    await db.insert(integrityEvents).values({ sessionId, type, meta: meta ?? null });
    res.status(200).json({ ok: true });
  }),
);

// --- Auto-submit sweep -----------------------------------------------------

/**
 * Jitter window (ms) over which one sweep spreads its finalizations. Kept well
 * under the 5s sweep interval so every due session is finalized before the next
 * tick re-selects it. Scaled by CLOCK_MULTIPLIER so fast-clock test mode still
 * auto-submits promptly. finalize() is idempotent, so an overlap is harmless.
 */
const SWEEP_JITTER_MS = 3000;

/**
 * Periodically finalize sessions whose deadline (plus grace) has passed but
 * that never submitted. The per-participant deadline and per-client heartbeat
 * already stagger the common case; this sweep is the backstop for clients that
 * went offline at the deadline. If many deadlines cluster (e.g. a synchronized
 * begin), 700 finalizations would otherwise fire in one synchronous burst, so
 * each is scheduled at a small random offset to spread the DB/Redis writes.
 * One failure never kills the loop.
 */
export function startAutoSubmitSweep(): void {
  const jitterWindow = SWEEP_JITTER_MS / env.CLOCK_MULTIPLIER;
  setInterval(() => {
    void (async () => {
      try {
        const cutoff = new Date(Date.now() - 10_000);
        const due = await db
          .select({ id: examSessions.id })
          .from(examSessions)
          .where(and(eq(examSessions.status, "in_progress"), lt(examSessions.deadlineAt, cutoff)));
        for (const session of due) {
          setTimeout(
            () => {
              void finalize(session.id, "auto_submitted").catch((err: unknown) => {
                logger.error({ err, sessionId: session.id }, "auto-submit: finalize failed");
              });
            },
            Math.random() * jitterWindow,
          );
        }
        logger.debug({ count: due.length }, "auto-submit sweep");
      } catch (err) {
        logger.error({ err }, "auto-submit sweep failed");
      }
    })();
  }, 5000);
}
