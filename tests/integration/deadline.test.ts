/**
 * deadline.test.ts — server-authoritative deadline enforcement (fast-clock).
 *
 * Requires the API to run with CLOCK_MULTIPLIER > 1 so the exam window is a few
 * seconds (e.g. CLOCK_MULTIPLIER=360 -> 3600/360 = 10s). The test reads the
 * effective durationSeconds from /exam/begin and skips (exit 2) if it is too
 * long to wait out, telling you how to shorten it.
 *
 * Proves, per spec (§4a, §12):
 *   - answers stamped AFTER deadline+grace are rejected (not acked),
 *   - the session auto-finalizes (auto_submitted) once the deadline passes,
 *   - /exam/submit after the deadline returns the already-finalized status and
 *     does not re-open or re-grade the session.
 *
 * Run:  BASE_URL=http://localhost:4600 bun tests/integration/deadline.test.ts
 */

import { EXAM_ID, adminLogin, api, beginFresh, check, eq, manifest, answerBody, run, sleep } from "./_lib.ts";

const USER = process.env.DEADLINE_USER ?? "user697";
const GRACE_MS = 10_000; // ANSWER_GRACE_MS in services/exam.ts
const MAX_WAIT_S = 45; // refuse to sit for a real-time hour

await run("deadline", async () => {
  const { token, sessionId, begin } = await beginFresh(USER);
  const durationSeconds: number = begin.durationSeconds;
  const deadlineMs = Date.parse(begin.deadlineAt);
  console.log(`  info durationSeconds=${durationSeconds} deadlineAt=${begin.deadlineAt}`);

  if (durationSeconds > MAX_WAIT_S) {
    console.log(
      `  SKIP durationSeconds=${durationSeconds}s is too long. Restart the API with a fast clock, e.g.\n` +
        `       CLOCK_MULTIPLIER=360 bun src/index.ts   (=> ~10s), then re-run this test.`,
    );
    process.exit(2);
  }

  const m = await manifest(token);
  const q = m.questions[0];

  // Control: an in-window answer is accepted.
  const pre = await api("/exam/answer", { method: "POST", token, body: answerBody(q, [0], 1, new Date()) });
  eq(pre.json.acked, [q.questionId], "in-window answer acked");

  // Wait past deadline + grace + margin.
  const waitMs = deadlineMs + GRACE_MS + 2000 - Date.now();
  console.log(`  info waiting ${Math.max(0, Math.round(waitMs / 1000))}s past deadline+grace...`);
  await sleep(Math.max(0, waitMs));

  // Heartbeat triggers auto-finalize; clock reports zero remaining.
  const hb = await api("/exam/heartbeat", { method: "POST", token, body: {} });
  eq(hb.json.remainingSeconds, 0, "remainingSeconds clamped to 0 past deadline");
  eq(hb.json.status, "auto_submitted", "session auto-finalized on heartbeat past deadline");

  // An answer stamped now (after deadline+grace) must be rejected.
  const late = await api("/exam/answer", { method: "POST", token, body: answerBody(q, [1], 2, new Date()) });
  eq(late.json.acked, [], "post-grace answer rejected (answered_at judged, not arrival)");

  // A late-arriving but before-deadline answer is still accepted (clamped in).
  const buffered = new Date(deadlineMs - 1000);
  const bufd = await api("/exam/answer", {
    method: "POST",
    token,
    body: answerBody(m.questions[1], [0], 3, buffered),
  });
  eq(bufd.json.acked, [m.questions[1].questionId], "before-deadline buffered answer still accepted after arrival");

  // The late in-grace answer must be RE-GRADED into the result, not merely
  // stored: the session finalized with 1 answered, so after the regrade the
  // result must count 2 answered regardless of correctness.
  const admin = await adminLogin();
  const rows = (await api(`/admin/results?examId=${encodeURIComponent(EXAM_ID)}`, { token: admin })).json;
  const row = rows.find((r: { sessionId: string }) => r.sessionId === sessionId);
  check(row != null, "result row exists for the auto-submitted session");
  eq(row.unanswered, m.questions.length - 2, "regrade counted the late in-grace answer");

  // Submit after the deadline: idempotent, returns the finalized status; the
  // already-graded session is not re-opened (still auto_submitted, not submitted).
  const sub = await api("/exam/submit", { method: "POST", token, body: {} });
  eq(sub.json.status, "auto_submitted", "submit after deadline keeps auto_submitted (no re-open/re-grade)");
});
