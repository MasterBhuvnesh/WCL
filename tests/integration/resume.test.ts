/**
 * resume.test.ts — server-authoritative resume, same-device and different-device.
 *
 * Proves POST /exam/resume returns the SAME shuffle_seed, ordered manifest,
 * saved answers, and deadline after a simulated relaunch (fresh token, no local
 * state). Then re-logs in with a DIFFERENT deviceId and asserts the server's
 * documented behavior: it re-binds the session to the new device, issues a
 * fresh JWT (no block), logs an integrity event, and resume still returns the
 * identical state — a PC change grants no extra time and loses nothing.
 *
 * Run:  BASE_URL=http://localhost:4000 bun tests/integration/resume.test.ts
 */

import { api, beginFresh, check, eq, login, manifest, answerBody, adminLogin, run, EXAM_ID } from "./_lib.ts";

const USER = process.env.RESUME_USER ?? "user695";

await run("resume", async () => {
  // Begin fresh on device A and save two answers.
  const { token: tokenA, sessionId } = await beginFresh(USER, "device-A");
  const m1 = await manifest(tokenA);
  check(m1.questions.length > 0, "manifest has questions after begin");
  const seed = m1.shuffleSeed;
  const order = m1.questions.map((q) => q.questionId);

  const q0 = m1.questions[0];
  const q1 = m1.questions[1];
  const a0 = await api("/exam/answer", { method: "POST", token: tokenA, body: answerBody(q0, [0], 1, new Date()) });
  eq(a0.json.acked, [q0.questionId], "first answer acked");
  const a1 = await api("/exam/answer", {
    method: "POST",
    token: tokenA,
    body: answerBody(q1, [1], 1, new Date(), "answered_marked"),
  });
  eq(a1.json.acked, [q1.questionId], "second answer acked");

  // --- Same-device relaunch: fresh login, brand-new token, no local state. ---
  const relogin = await login(USER, "device-A");
  check(relogin.status === 200, "same-device relogin ok");
  eq(relogin.json.sessionId, sessionId, "same session id on relaunch");
  const r1 = await api("/exam/resume", { method: "POST", token: relogin.json.token });
  check(r1.status === 200, "resume returns 200");
  eq(r1.json.manifest.shuffleSeed, seed, "resume seed identical");
  eq(r1.json.manifest.questions.map((q: any) => q.questionId), order, "resume manifest order identical");
  check(r1.json.status === "in_progress", "session still in_progress");
  check(typeof r1.json.deadlineAt === "string", "resume returns deadline");

  const byQ = new Map<string, any>(r1.json.answers.map((a: any) => [a.questionId, a]));
  eq(byQ.get(q0.questionId)?.selectedOptionIds, [q0.options[0].optionId], "answer 0 restored");
  eq(byQ.get(q1.questionId)?.status, "answered_marked", "answer 1 status restored");
  check(byQ.size === 2, "exactly the two saved answers returned");

  const deadlineA = r1.json.deadlineAt;
  const adminToken = await adminLogin();

  // --- Different-device resume: strict binding + proctor release. ------------
  // Documented server behavior (routes/exam.ts login handler): while the session
  // is bound to device-A, a login from device-B is BLOCKED (409) and a
  // device_change integrity event (allowed:false) is recorded. A proctor must
  // release the binding (admin endpoint) before the new device can resume.
  const blocked = await login(USER, "device-B");
  check(blocked.status === 409, "different-device login BLOCKED while bound (409)");
  check(
    /device/i.test(blocked.json?.error ?? ""),
    `409 explains device binding (got: ${blocked.json?.error})`,
  );

  // Proctor releases the device binding (nulls deviceId), audited.
  const release = await api(`/admin/sessions/${sessionId}/release-device`, { method: "POST", token: adminToken });
  check(release.status === 200, "admin release-device returns 200");

  // Now the new device may log in, re-bind, and resume with identical state.
  const loginB = await login(USER, "device-B");
  check(loginB.status === 200, "after release, new-device login succeeds (re-bind, fresh JWT)");
  eq(loginB.json.sessionId, sessionId, "different device keeps same session id");

  const r2 = await api("/exam/resume", { method: "POST", token: loginB.json.token });
  check(r2.status === 200, "resume on new device returns 200");
  eq(r2.json.manifest.shuffleSeed, seed, "new-device seed identical (no reshuffle)");
  eq(r2.json.manifest.questions.map((q: any) => q.questionId), order, "new-device manifest order identical");
  eq(r2.json.deadlineAt, deadlineA, "deadline unchanged on device change (no extra time)");
  eq(new Map<string, any>(r2.json.answers.map((a: any) => [a.questionId, a])).size, 2, "answers survive device change");

  // Both a blocked and an allowed device_change are on the proctor review trail.
  const ev = await api<any[]>(
    `/admin/integrity-events?examId=${encodeURIComponent(EXAM_ID)}&sessionId=${sessionId}`,
    { token: adminToken },
  );
  const changes = (ev.json as any[]).filter((e) => e.type === "device_change");
  check(changes.length >= 2, `device_change events logged for block + rebind (found ${changes.length})`);
  check(
    changes.some((e) => e.meta?.allowed === false) && changes.some((e) => e.meta?.allowed === true),
    "both blocked (allowed:false) and rebind (allowed:true) device_change recorded",
  );
});
