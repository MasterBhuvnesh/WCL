/**
 * Admin router: authentication (password + optional TOTP), MFA setup, live
 * monitoring, reporting and CSV export, session/exam controls, integrity event
 * review, question-bank management, and participant import.
 *
 * Mounted at /admin, so routes are declared without that prefix. Every route
 * except POST /login requires a valid admin token. Mutating actions are
 * recorded in the audit log on a best-effort basis (never blocking the reply).
 */

import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.ts";
import {
  admins,
  answers,
  examSessions,
  exams,
  integrityEvents,
  options,
  participants,
  questions,
  results,
} from "../db/schema.ts";
import {
  HttpError,
  rateLimit,
  requireAdmin,
  signAdminToken,
  validate,
  type AuthedRequest,
} from "../http/middleware.ts";
import { redis } from "../redis.ts";
import { audit, authenticator, csvField, iso, rebuildLeaderboard } from "../services/admin/helpers.ts";

/**
 * Bun runtime global (password hashing). Declared locally rather than pulling in
 * ambient bun types; module-scoped so it cannot collide with other modules.
 */
declare const Bun: {
  password: {
    hash(password: string): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
  };
};

const DEFAULT_EXAM_ID = "WCL-EXAM";

export const adminRouter = Router();

/** Wrap an async handler so rejections reach the Express error middleware. */
type AsyncHandler = (req: AuthedRequest, res: Response) => Promise<void>;
function h(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req as AuthedRequest, res).catch(next);
  };
}

/** Parse a query integer with a default and inclusive clamp. */
function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// --- 1. Authentication ---------------------------------------------------

adminRouter.post(
  "/login",
  rateLimit({ bucket: "admin-login", limit: 10, windowSeconds: 60 }),
  validate(
    z.object({
      email: z.string().min(1),
      password: z.string().min(1),
      totp: z.string().optional(),
    }),
  ),
  h(async (req, res) => {
    const { email, password, totp } = req.body as {
      email: string;
      password: string;
      totp?: string;
    };
    const [admin] = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
    if (!admin || !(await Bun.password.verify(password, admin.passwordHash))) {
      throw new HttpError(401, "Invalid credentials");
    }
    if (admin.totpSecret) {
      if (!totp) throw new HttpError(401, "TOTP code required");
      if (!(await authenticator.check(totp, admin.totpSecret))) {
        throw new HttpError(401, "Invalid TOTP code");
      }
    }
    res.json({ token: signAdminToken({ adminId: admin.id, email: admin.email }), email: admin.email });
  }),
);

// Everything below requires a valid admin token.
adminRouter.use(requireAdmin);

// --- 2. MFA setup --------------------------------------------------------

adminRouter.post(
  "/mfa/setup",
  h(async (req, res) => {
    const { adminId, email } = req.admin!;
    const secret = authenticator.generateSecret();
    await db.update(admins).set({ totpSecret: secret }).where(eq(admins.id, adminId));
    await audit(adminId, "mfa-setup", adminId, {});
    res.json({ secret, otpauthUrl: authenticator.keyuri(email, "WCL", secret) });
  }),
);

// --- 3. Leaderboard ------------------------------------------------------

adminRouter.get(
  "/leaderboard",
  h(async (req, res) => {
    const examId = (req.query.examId as string) || DEFAULT_EXAM_ID;
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const key = `leaderboard:${examId}`;

    let total = await redis.zcard(key);
    if (total === 0) {
      await rebuildLeaderboard(examId);
      total = await redis.zcard(key);
    }
    const flat = await redis.zrevrange(key, offset, offset + limit - 1, "WITHSCORES");

    const ids: string[] = [];
    for (let i = 0; i < flat.length; i += 2) ids.push(flat[i]);
    const names = ids.length
      ? await db
          .select({
            id: participants.id,
            username: participants.username,
            displayName: participants.displayName,
          })
          .from(participants)
          .where(inArray(participants.id, ids))
      : [];
    const nameById = new Map(names.map((n) => [n.id, n]));

    const entries = [];
    for (let i = 0; i < flat.length; i += 2) {
      const participantId = flat[i];
      const p = nameById.get(participantId);
      entries.push({
        rank: offset + i / 2 + 1,
        participantId,
        username: p?.username ?? participantId,
        displayName: p?.displayName ?? null,
        score: Number(flat[i + 1]),
      });
    }
    res.json({ examId, total, entries });
  }),
);

// --- 4. Session monitoring ----------------------------------------------

adminRouter.get(
  "/sessions",
  h(async (req, res) => {
    const examId = (req.query.examId as string) || DEFAULT_EXAM_ID;
    const grouped = await db
      .select({ status: examSessions.status, n: count() })
      .from(examSessions)
      .where(eq(examSessions.examId, examId))
      .groupBy(examSessions.status);
    const counts = { not_started: 0, in_progress: 0, submitted: 0, auto_submitted: 0 };
    for (const g of grouped) counts[g.status] = g.n;

    const rows = await db
      .select({
        sessionId: examSessions.id,
        username: participants.username,
        status: examSessions.status,
        startedAt: examSessions.startedAt,
        deadlineAt: examSessions.deadlineAt,
        submittedAt: examSessions.submittedAt,
      })
      .from(examSessions)
      .innerJoin(participants, eq(examSessions.participantId, participants.id))
      .where(eq(examSessions.examId, examId))
      .orderBy(desc(examSessions.createdAt))
      .limit(1000);

    res.json({
      counts,
      sessions: rows.map((r) => ({
        sessionId: r.sessionId,
        username: r.username,
        status: r.status,
        startedAt: iso(r.startedAt),
        deadlineAt: iso(r.deadlineAt),
        submittedAt: iso(r.submittedAt),
      })),
    });
  }),
);

// --- 5. Results list -----------------------------------------------------

/** Shared projection for the results list and CSV export. */
function resultsRows(examId: string) {
  return db
    .select({
      sessionId: results.sessionId,
      username: participants.username,
      examId: results.examId,
      status: examSessions.status,
      score: results.score,
      maxScore: results.maxScore,
      correct: results.correct,
      wrong: results.wrong,
      unanswered: results.unanswered,
      startedAt: examSessions.startedAt,
      submittedAt: examSessions.submittedAt,
      gradedAt: results.gradedAt,
    })
    .from(results)
    .innerJoin(examSessions, eq(results.sessionId, examSessions.id))
    .innerJoin(participants, eq(results.participantId, participants.id))
    .where(eq(results.examId, examId))
    .orderBy(desc(results.gradedAt));
}

adminRouter.get(
  "/results",
  h(async (req, res) => {
    const examId = (req.query.examId as string) || DEFAULT_EXAM_ID;
    const rows = await resultsRows(examId);
    res.json(
      rows.map((r) => ({
        ...r,
        startedAt: iso(r.startedAt),
        submittedAt: iso(r.submittedAt),
        gradedAt: iso(r.gradedAt),
      })),
    );
  }),
);

// --- 6. Per-session review ----------------------------------------------

adminRouter.get(
  "/results/:sessionId",
  h(async (req, res) => {
    const sessionId = req.params.sessionId;
    const [session] = await db
      .select({
        id: examSessions.id,
        examId: examSessions.examId,
        status: examSessions.status,
        startedAt: examSessions.startedAt,
        submittedAt: examSessions.submittedAt,
        servedQuestionIds: examSessions.servedQuestionIds,
        username: participants.username,
      })
      .from(examSessions)
      .innerJoin(participants, eq(examSessions.participantId, participants.id))
      .where(eq(examSessions.id, sessionId))
      .limit(1);
    if (!session) throw new HttpError(404, "Session not found");

    const [result] = await db
      .select({ score: results.score, maxScore: results.maxScore })
      .from(results)
      .where(eq(results.sessionId, sessionId))
      .limit(1);

    const served = session.servedQuestionIds;
    const qRows = served.length
      ? await db.select().from(questions).where(inArray(questions.id, served))
      : [];
    const oRows = served.length
      ? await db.select().from(options).where(inArray(options.questionId, served))
      : [];
    const aRows = await db
      .select({ questionId: answers.questionId, selectedOptionIds: answers.selectedOptionIds })
      .from(answers)
      .where(eq(answers.sessionId, sessionId));

    const qById = new Map(qRows.map((q) => [q.id, q]));
    const optsByQ = new Map<string, typeof oRows>();
    for (const o of oRows) {
      const list = optsByQ.get(o.questionId) ?? [];
      list.push(o);
      optsByQ.set(o.questionId, list);
    }
    const selByQ = new Map(aRows.map((a) => [a.questionId, a.selectedOptionIds]));

    const answersOut = served.map((qid) => {
      const q = qById.get(qid);
      const opts = optsByQ.get(qid) ?? [];
      const selected = selByQ.get(qid) ?? [];
      const correctIds = new Set(opts.filter((o) => o.isCorrect).map((o) => o.id));
      let outcome: "correct" | "wrong" | "unanswered";
      if (selected.length === 0) {
        outcome = "unanswered";
      } else {
        const sel = new Set(selected);
        outcome =
          sel.size === correctIds.size && [...sel].every((id) => correctIds.has(id))
            ? "correct"
            : "wrong";
      }
      return {
        questionId: qid,
        type: q?.type ?? null,
        text: q?.text ?? "",
        options: opts.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
        selectedOptionIds: selected,
        outcome,
      };
    });

    res.json({
      sessionId: session.id,
      username: session.username,
      examId: session.examId,
      status: session.status,
      score: result?.score ?? null,
      maxScore: result?.maxScore ?? null,
      startedAt: iso(session.startedAt),
      submittedAt: iso(session.submittedAt),
      answers: answersOut,
    });
  }),
);

// --- 6b. Edit result score (audited) ------------------------------------

adminRouter.patch(
  "/results/:sessionId",
  validate(z.object({ finalScore: z.number().int().min(0), reason: z.string().optional() })),
  h(async (req, res) => {
    const sessionId = req.params.sessionId;
    const { finalScore, reason } = req.body as { finalScore: number; reason?: string };

    const [existing] = await db
      .select()
      .from(results)
      .where(eq(results.sessionId, sessionId))
      .limit(1);
    if (!existing) throw new HttpError(404, "Result not found");

    const oldScore = existing.score;
    const gradedAt = new Date();
    const [updated] = await db
      .update(results)
      .set({ score: finalScore, gradedAt })
      .where(eq(results.sessionId, sessionId))
      .returning();

    // Keep the leaderboard ZSET and any live admin view in sync with the edit.
    await redis.zadd(`leaderboard:${existing.examId}`, finalScore, existing.participantId);
    const [participant] = await db
      .select({ username: participants.username })
      .from(participants)
      .where(eq(participants.id, existing.participantId))
      .limit(1);
    await redis.publish(
      `wcl:leaderboard:${existing.examId}`,
      JSON.stringify({
        participantId: existing.participantId,
        username: participant?.username ?? existing.participantId,
        score: finalScore,
        maxScore: existing.maxScore,
        submittedAt: iso(gradedAt),
      }),
    );

    await audit(req.admin!.adminId, "result.score_edit", sessionId, {
      oldScore,
      newScore: finalScore,
      reason: reason ?? null,
    });

    res.json({ ...updated, gradedAt: iso(updated!.gradedAt) });
  }),
);

// --- 7. CSV export -------------------------------------------------------

adminRouter.get(
  "/export/results.csv",
  h(async (req, res) => {
    const examId = (req.query.examId as string) || DEFAULT_EXAM_ID;
    const rows = await resultsRows(examId);
    const header = [
      "Username",
      "Exam",
      "Status",
      "Score",
      "Max score",
      "Correct",
      "Wrong",
      "Unanswered",
      "Started at",
      "Submitted at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.username,
          r.examId,
          r.status,
          r.score,
          r.maxScore,
          r.correct,
          r.wrong,
          r.unanswered,
          iso(r.startedAt),
          iso(r.submittedAt),
        ]
          .map(csvField)
          .join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="results-${examId}.csv"`);
    res.send(`${lines.join("\r\n")}\r\n`);
  }),
);

// --- 8. Session reset ----------------------------------------------------

adminRouter.post(
  "/sessions/:sessionId/reset",
  h(async (req, res) => {
    const sessionId = req.params.sessionId;
    const [session] = await db
      .select({ examId: examSessions.examId, participantId: examSessions.participantId })
      .from(examSessions)
      .where(eq(examSessions.id, sessionId))
      .limit(1);
    if (!session) throw new HttpError(404, "Session not found");

    await db.delete(answers).where(eq(answers.sessionId, sessionId));
    await db.delete(results).where(eq(results.sessionId, sessionId));
    await db
      .update(examSessions)
      .set({
        status: "not_started",
        startedAt: null,
        deadlineAt: null,
        shuffleSeed: null,
        submittedAt: null,
        servedQuestionIds: [],
      })
      .where(eq(examSessions.id, sessionId));

    await redis.del(`session:${sessionId}`, `deadline:${sessionId}`);
    await redis.zrem(`leaderboard:${session.examId}`, session.participantId);

    await audit(req.admin!.adminId, "session-reset", sessionId, { examId: session.examId });
    res.json({ ok: true });
  }),
);

// --- 8b. Release device binding (audited) --------------------------------

/**
 * Clear a session's device binding so the participant can log in and resume
 * from a different machine (hardware failure, seat move). Login rebinds to the
 * new device and records a `device_change` integrity event. Until released, a
 * login from any other device is blocked.
 */
adminRouter.post(
  "/sessions/:sessionId/release-device",
  h(async (req, res) => {
    const sessionId = req.params.sessionId;
    const [session] = await db
      .select({ deviceId: examSessions.deviceId })
      .from(examSessions)
      .where(eq(examSessions.id, sessionId))
      .limit(1);
    if (!session) throw new HttpError(404, "Session not found");

    await db.update(examSessions).set({ deviceId: null }).where(eq(examSessions.id, sessionId));
    await redis.del(`session:${sessionId}`);

    await audit(req.admin!.adminId, "session-release-device", sessionId, {
      previousDeviceId: session.deviceId,
    });
    res.json({ ok: true });
  }),
);

// --- 9. Add time to one session -----------------------------------------

const secondsBody = z.object({ seconds: z.number().int().min(1).max(7200) });

adminRouter.post(
  "/sessions/:sessionId/add-time",
  validate(secondsBody),
  h(async (req, res) => {
    const sessionId = req.params.sessionId;
    const { seconds } = req.body as { seconds: number };
    const [session] = await db
      .select({ status: examSessions.status, deadlineAt: examSessions.deadlineAt })
      .from(examSessions)
      .where(eq(examSessions.id, sessionId))
      .limit(1);
    if (!session) throw new HttpError(404, "Session not found");
    if (session.status !== "in_progress" || !session.deadlineAt) {
      throw new HttpError(409, "Session is not in progress");
    }

    const deadlineAt = new Date(session.deadlineAt.getTime() + seconds * 1000);
    await db.update(examSessions).set({ deadlineAt }).where(eq(examSessions.id, sessionId));
    await redis.del(`session:${sessionId}`);
    await redis.set(`deadline:${sessionId}`, deadlineAt.getTime());
    await redis.publish(
      `wcl:session:${sessionId}`,
      JSON.stringify({ type: "add_time", sessionId, deadlineAt: deadlineAt.toISOString() }),
    );

    await audit(req.admin!.adminId, "session-add-time", sessionId, { seconds });
    res.json({ ok: true, deadlineAt: deadlineAt.toISOString() });
  }),
);

// --- 10. Add time to every in-progress session of an exam ---------------

adminRouter.post(
  "/exams/:examId/add-time",
  validate(secondsBody),
  h(async (req, res) => {
    const examId = req.params.examId;
    const { seconds } = req.body as { seconds: number };

    const updated = await db
      .update(examSessions)
      .set({ deadlineAt: sql`${examSessions.deadlineAt} + make_interval(secs => ${seconds})` })
      .where(
        and(
          eq(examSessions.examId, examId),
          eq(examSessions.status, "in_progress"),
          isNotNull(examSessions.deadlineAt),
        ),
      )
      .returning({ id: examSessions.id, deadlineAt: examSessions.deadlineAt });

    // Extend the availability window too, but only when it is set.
    await db
      .update(exams)
      .set({ availableUntil: sql`${exams.availableUntil} + make_interval(secs => ${seconds})` })
      .where(and(eq(exams.id, examId), isNotNull(exams.availableUntil)));

    for (const s of updated) {
      if (!s.deadlineAt) continue;
      await redis.del(`session:${s.id}`);
      await redis.set(`deadline:${s.id}`, s.deadlineAt.getTime());
      await redis.publish(
        `wcl:session:${s.id}`,
        JSON.stringify({ type: "add_time", sessionId: s.id, deadlineAt: s.deadlineAt.toISOString() }),
      );
    }

    await audit(req.admin!.adminId, "exam-add-time", examId, { seconds, updated: updated.length });
    res.json({ ok: true, updated: updated.length });
  }),
);

// --- 11. Open / close an exam -------------------------------------------

async function setExamOpen(req: AuthedRequest, res: Response, isOpen: boolean): Promise<void> {
  const examId = req.params.examId;
  const [row] = await db
    .update(exams)
    .set({ isOpen })
    .where(eq(exams.id, examId))
    .returning({ isOpen: exams.isOpen });
  if (!row) throw new HttpError(404, "Exam not found");
  await audit(req.admin!.adminId, isOpen ? "exam-open" : "exam-close", examId, { isOpen });
  res.json({ ok: true, isOpen: row.isOpen });
}

adminRouter.post("/exams/:examId/open", h((req, res) => setExamOpen(req, res, true)));
adminRouter.post("/exams/:examId/close", h((req, res) => setExamOpen(req, res, false)));

// --- 12. Publish / unpublish results ------------------------------------

adminRouter.post(
  "/exams/:examId/publish",
  validate(z.object({ published: z.boolean() })),
  h(async (req, res) => {
    const examId = req.params.examId;
    const { published } = req.body as { published: boolean };
    const [row] = await db
      .update(exams)
      .set({ resultsPublished: published })
      .where(eq(exams.id, examId))
      .returning({ resultsPublished: exams.resultsPublished });
    if (!row) throw new HttpError(404, "Exam not found");
    await audit(req.admin!.adminId, "exam-publish", examId, { resultsPublished: published });
    res.json({ ok: true, resultsPublished: row.resultsPublished });
  }),
);

// --- 13. Integrity events ------------------------------------------------

adminRouter.get(
  "/integrity-events",
  h(async (req, res) => {
    const examId = req.query.examId as string | undefined;
    const sessionId = req.query.sessionId as string | undefined;
    const limit = clampInt(req.query.limit, 100, 1, 500);

    const conds = [];
    if (examId) conds.push(eq(examSessions.examId, examId));
    if (sessionId) conds.push(eq(integrityEvents.sessionId, sessionId));

    const rows = await db
      .select({
        id: integrityEvents.id,
        sessionId: integrityEvents.sessionId,
        username: participants.username,
        type: integrityEvents.type,
        meta: integrityEvents.meta,
        createdAt: integrityEvents.createdAt,
      })
      .from(integrityEvents)
      .innerJoin(examSessions, eq(integrityEvents.sessionId, examSessions.id))
      .innerJoin(participants, eq(examSessions.participantId, participants.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(integrityEvents.createdAt))
      .limit(limit);

    res.json(rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })));
  }),
);

// --- 14. Question bank ---------------------------------------------------

adminRouter.get(
  "/questions",
  h(async (req, res) => {
    const examId = (req.query.examId as string) || DEFAULT_EXAM_ID;
    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.examId, examId))
      .orderBy(asc(questions.id));
    const qIds = qRows.map((q) => q.id);
    const oRows = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds)).orderBy(asc(options.id))
      : [];
    const optsByQ = new Map<string, typeof oRows>();
    for (const o of oRows) {
      const list = optsByQ.get(o.questionId) ?? [];
      list.push(o);
      optsByQ.set(o.questionId, list);
    }
    res.json(
      qRows.map((q) => ({
        id: q.id,
        type: q.type,
        text: q.text,
        marks: q.marks,
        options: (optsByQ.get(q.id) ?? []).map((o) => ({
          id: o.id,
          text: o.text,
          isCorrect: o.isCorrect,
        })),
      })),
    );
  }),
);

const questionsUpsertBody = z.object({
  examId: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        type: z.enum(["SCQ", "MCQ"]),
        text: z.string().min(1),
        marks: z.number().int().min(1).optional(),
        options: z
          .array(
            z.object({
              id: z.string().min(1).optional(),
              text: z.string().min(1),
              isCorrect: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

adminRouter.post(
  "/questions",
  validate(questionsUpsertBody),
  h(async (req, res) => {
    const body = req.body as z.infer<typeof questionsUpsertBody>;
    for (const q of body.questions) {
      const correct = q.options.filter((o) => o.isCorrect).length;
      if (q.type === "SCQ" && correct !== 1) {
        throw new HttpError(400, "Each SCQ must have exactly one correct option");
      }
      if (q.type === "MCQ" && correct < 1) {
        throw new HttpError(400, "Each MCQ must have at least one correct option");
      }
    }

    const ids: string[] = [];
    await db.transaction(async (tx) => {
      for (const q of body.questions) {
        const qid = q.id ?? `Q-${randomUUID().slice(0, 8)}`;
        ids.push(qid);
        const marks = q.marks ?? 1;
        await tx
          .insert(questions)
          .values({ id: qid, examId: body.examId, type: q.type, text: q.text, marks })
          .onConflictDoUpdate({
            target: questions.id,
            set: { examId: body.examId, type: q.type, text: q.text, marks },
          });
        // Replace options wholesale.
        await tx.delete(options).where(eq(options.questionId, qid));
        await tx.insert(options).values(
          q.options.map((o) => ({
            id: o.id ?? `O-${randomUUID().slice(0, 8)}`,
            questionId: qid,
            text: o.text,
            isCorrect: o.isCorrect,
          })),
        );
      }
    });

    await redis.del(`bank:${body.examId}`);
    await audit(req.admin!.adminId, "questions-upsert", body.examId, { count: body.questions.length });
    res.json({ ok: true, ids });
  }),
);

adminRouter.delete(
  "/questions/:id",
  h(async (req, res) => {
    const id = req.params.id;
    const [q] = await db
      .select({ examId: questions.examId })
      .from(questions)
      .where(eq(questions.id, id))
      .limit(1);
    if (!q) throw new HttpError(404, "Question not found");

    const [inUse] = await db
      .select({ id: examSessions.id })
      .from(examSessions)
      .where(sql`${examSessions.servedQuestionIds} @> ${JSON.stringify([id])}::jsonb`)
      .limit(1);
    if (inUse) throw new HttpError(409, "Question has been served to a session and cannot be deleted");

    await db.delete(options).where(eq(options.questionId, id));
    await db.delete(questions).where(eq(questions.id, id));

    await redis.del(`bank:${q.examId}`);
    await audit(req.admin!.adminId, "question-delete", id, { examId: q.examId });
    res.json({ ok: true });
  }),
);

// --- 15. Participants ------------------------------------------------------

adminRouter.get(
  "/participants",
  h(async (_req, res) => {
    const rows = await db
      .select({
        id: participants.id,
        username: participants.username,
        displayName: participants.displayName,
        createdAt: participants.createdAt,
      })
      .from(participants)
      .orderBy(asc(participants.username));
    res.json(rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })));
  }),
);

const importBody = z.object({
  participants: z
    .array(
      z.object({
        username: z.string().min(1),
        secret: z.string().min(1),
        displayName: z.string().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

adminRouter.post(
  "/participants/import",
  validate(importBody),
  h(async (req, res) => {
    const { participants: list } = req.body as z.infer<typeof importBody>;

    // De-duplicate within the batch (first occurrence wins).
    const byUsername = new Map<string, { username: string; secret: string; displayName?: string }>();
    for (const p of list) if (!byUsername.has(p.username)) byUsername.set(p.username, p);

    const usernames = [...byUsername.keys()];
    const existing = await db
      .select({ username: participants.username })
      .from(participants)
      .where(inArray(participants.username, usernames));
    const existingSet = new Set(existing.map((e) => e.username));
    const toInsert = usernames.filter((u) => !existingSet.has(u));

    let created = 0;
    // ponytail: sequential argon2 hashing bounds memory at the 1000-row ceiling;
    // batch/parallelise only if import throughput becomes a problem.
    for (const username of toInsert) {
      const p = byUsername.get(username)!;
      const secretHash = await Bun.password.hash(p.secret);
      const inserted = await db
        .insert(participants)
        .values({ username, secretHash, displayName: p.displayName ?? null })
        .onConflictDoNothing()
        .returning({ id: participants.id });
      if (inserted.length) created += 1;
    }

    const skipped = list.length - created;
    await audit(req.admin!.adminId, "participants-import", null, { created, skipped });
    res.json({ created, skipped });
  }),
);
