/**
 * offline-sync.test.ts — before-deadline buffered answers sync at the boundary.
 *
 * Simulates a candidate that goes offline near the deadline: answers are stamped
 * (answered_at) BEFORE the deadline but not sent, then pushed in one batch via
 * /exam/heartbeat right AFTER the deadline (within the grace window). The server
 * judges by answered_at, so the pre-deadline answer must be accepted and counted
 * even though it arrived late, while an answer genuinely stamped after
 * deadline+grace in the same push must be rejected. Nothing legitimate is lost;
 * a hacked client that keeps answering past the deadline gains nothing.
 *
 * Requires a fast clock (CLOCK_MULTIPLIER > 1); reads durationSeconds from begin
 * and skips (exit 2) if too long, like deadline.test.ts.
 *
 * Run:  BASE_URL=http://localhost:4600 bun tests/integration/offline-sync.test.ts
 */

import { api, beginFresh, check, eq, manifest, answerBody, run, sleep } from "./_lib.ts";

const USER = process.env.OFFLINE_USER ?? "user698";
const GRACE_MS = 10_000;
const MAX_WAIT_S = 45;

await run("offline-sync", async () => {
  const { token, begin } = await beginFresh(USER);
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
  const qGood = m.questions[0]; // stamped before deadline -> must count
  const qBad = m.questions[1]; // stamped after deadline+grace -> must be dropped

  // Accumulate offline (do NOT send yet). Stamp answered_at now, before deadline.
  const goodStamp = new Date(); // < deadline
  const batch = [
    answerBody(qGood, [0], 1, goodStamp),
    // qBad is stamped AFTER deadline+grace to represent post-deadline activity.
    answerBody(qBad, [0], 2, new Date(deadlineMs + GRACE_MS + 3000)),
  ];

  // Wait until just past the deadline but well within the grace window, so the
  // session is still in_progress when the batch lands (applyBatch runs before
  // the heartbeat's own auto-finalize).
  const waitMs = deadlineMs + 1500 - Date.now();
  console.log(`  info holding batch offline for ${Math.max(0, Math.round(waitMs / 1000))}s, then pushing ~1.5s past deadline...`);
  await sleep(Math.max(0, waitMs));
  check(Date.now() > deadlineMs, "pushing strictly after the deadline");
  check(Date.now() < deadlineMs + GRACE_MS, "pushing within the grace window");

  const hb = await api("/exam/heartbeat", { method: "POST", token, body: { answers: batch } });
  check(hb.json.acked.includes(qGood.questionId), "before-deadline buffered answer ACKed at boundary");
  check(!hb.json.acked.includes(qBad.questionId), "after-deadline answer NOT ACKed (dropped)");
  eq(hb.json.status, "auto_submitted", "session auto-finalized by the same boundary heartbeat");

  // The counted answer is durably persisted; the dropped one is absent.
  const resume = await api("/exam/resume", { method: "POST", token });
  const stored = new Map<string, any>((resume.json.answers as any[]).map((a) => [a.questionId, a]));
  eq(stored.get(qGood.questionId)?.selectedOptionIds, [qGood.options[0].optionId], "pre-deadline answer persisted");
  check(!stored.has(qBad.questionId), "post-deadline answer never stored");
});
