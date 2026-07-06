/**
 * stale-write.test.ts — monotonic client_seq guard (correctness requirement).
 *
 * The server upserts an answer only when the incoming client_seq is strictly
 * greater than the stored one; a retried older request must NEVER overwrite a
 * newer answer. Note the documented quirk (services/exam.ts applyAnswer): a
 * stale write is still ACKed to the client (so it stops retrying) but is
 * ignored at the database level. We therefore verify the STORED state via
 * /exam/resume, not the ack, then confirm a genuinely newer seq does apply.
 *
 * Run:  BASE_URL=http://localhost:4000 bun tests/integration/stale-write.test.ts
 */

import { api, beginFresh, check, eq, manifest, answerBody, run } from "./_lib.ts";

const USER = process.env.STALE_USER ?? "user696";

async function storedSelection(token: string, questionId: string): Promise<string[]> {
  const r = await api("/exam/resume", { method: "POST", token });
  const a = (r.json.answers as any[]).find((x) => x.questionId === questionId);
  return a?.selectedOptionIds ?? [];
}

await run("stale-write", async () => {
  const { token } = await beginFresh(USER);
  const m = await manifest(token);
  const q = m.questions[0];
  const optA = q.options[0].optionId;
  const optB = q.options[1].optionId;
  check(optA !== optB, "question has two distinct options to disambiguate");

  const now = new Date();

  // 1. Newer seq (100) selecting option A -> applied.
  const w1 = await api("/exam/answer", { method: "POST", token, body: answerBody(q, [0], 100, now) });
  eq(w1.json.acked, [q.questionId], "seq=100 acked");
  eq(await storedSelection(token, q.questionId), [optA], "after seq=100 stored selection is A");

  // 2. OLDER seq (50) selecting option B -> acked but MUST NOT overwrite.
  const w2 = await api("/exam/answer", { method: "POST", token, body: answerBody(q, [1], 50, now) });
  eq(w2.json.acked, [q.questionId], "stale seq=50 still acked (client stops retrying)");
  eq(await storedSelection(token, q.questionId), [optA], "stale seq=50 did NOT overwrite (still A) — monotonic guard holds");

  // 3. Newer seq (150) selecting option B -> applied.
  const w3 = await api("/exam/answer", { method: "POST", token, body: answerBody(q, [1], 150, now) });
  eq(w3.json.acked, [q.questionId], "seq=150 acked");
  eq(await storedSelection(token, q.questionId), [optB], "newer seq=150 applied (now B) — guard only blocks older");

  // 4. Same batch via heartbeat: a stale entry among newer must be ignored too.
  const w4 = await api("/exam/heartbeat", {
    method: "POST",
    token,
    body: { answers: [answerBody(q, [0], 120, now)] }, // 120 < stored 150 -> stale
  });
  check(w4.json.acked.includes(q.questionId), "heartbeat acks stale entry");
  eq(await storedSelection(token, q.questionId), [optB], "heartbeat stale entry did NOT overwrite (still B)");
});
