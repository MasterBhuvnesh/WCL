/**
 * exam-flow.js — k6 load test of the full WCL candidate lifecycle.
 *
 *   /auth/login -> /exam/begin -> /exam/manifest
 *     -> answer loop (POST /exam/answer, monotonic client_seq,
 *        interleaved POST /exam/heartbeat)
 *     -> POST /exam/submit
 *
 * Each VU acts as one distinct seeded candidate (user001..user700, wrapping for
 * VUS > 700) and runs the flow exactly once (per-vu-iterations, iterations=1) so
 * sessions are never reused. Re-runs need a clean slate: `bun run seed --fresh`
 * (or admin session reset), otherwise a second login hits 409 "already
 * submitted". Startup of all VUs models the t=0 manifest herd; per-candidate
 * think-time and the final submit model steady-state and the t=end submit burst.
 *
 * Env knobs (all optional):
 *   BASE_URL          API base URL                 (default http://localhost:4000)
 *   SCENARIO          "load" | "smoke"             (default load)
 *   VUS               virtual users for load       (default 700, tested to 1500)
 *   ANSWERS           questions answered per VU     (default 15)
 *   HEARTBEAT_EVERY   answers between heartbeats    (default 5)
 *   THINK_MS          sleep between answers (ms)    (default 300)
 *   P95_MS            p95 latency threshold (ms)    (default 800)
 *   ERROR_RATE        max unexpected-error rate     (default 0.01)
 *   PARTICIPANT_PW    shared candidate secret       (default "password")
 *   EXAM_ID           exam id                       (default WCL-DEMO)
 *
 * Run:  k6 run tests/load/exam-flow.js
 *       SCENARIO=smoke k6 run tests/load/exam-flow.js
 *       BASE_URL=https://api.example.com VUS=1500 k6 run tests/load/exam-flow.js
 *
 * NOTE: the API rate-limits per client IP (login 10/min, exam 300/min). From a
 * single load-gen host every VU shares one IP, so a localhost run WILL see 429s
 * — those are counted as `rate_limited`, not `errors`. For real numbers run
 * distributed (k6 Cloud / multiple agents) or raise the limits in a test build.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const EXAM_ID = __ENV.EXAM_ID || "WCL-DEMO";
const PASSWORD = __ENV.PARTICIPANT_PW || "password";
const VUS = parseInt(__ENV.VUS || "700", 10);
const ANSWERS = parseInt(__ENV.ANSWERS || "15", 10);
const HEARTBEAT_EVERY = parseInt(__ENV.HEARTBEAT_EVERY || "5", 10);
const THINK_MS = parseInt(__ENV.THINK_MS || "300", 10);
const P95_MS = parseInt(__ENV.P95_MS || "800", 10);
const ERROR_RATE = parseFloat(__ENV.ERROR_RATE || "0.01");
const SEED_PARTICIPANTS = 700;

const errors = new Rate("errors"); // unexpected non-2xx (excludes 429)
const rateLimited = new Counter("rate_limited"); // 429s (single-IP localhost artifact)
const flowTrend = new Trend("flow_duration_ms", true); // full lifecycle per VU

const allScenarios = {
  load: {
    executor: "per-vu-iterations",
    vus: VUS,
    iterations: 1,
    maxDuration: "10m",
    exec: "candidate",
  },
  smoke: {
    executor: "per-vu-iterations",
    vus: 10,
    iterations: 1,
    maxDuration: "2m",
    exec: "candidate",
  },
};
const SCENARIO = allScenarios[__ENV.SCENARIO || "load"] ? __ENV.SCENARIO || "load" : "load";

export const options = {
  scenarios: { [SCENARIO]: allScenarios[SCENARIO] },
  thresholds: {
    http_req_duration: [`p(95)<${P95_MS}`],
    errors: [`rate<${ERROR_RATE}`],
    // Login and submit must essentially always succeed (429s excluded via `errors`).
    checks: ["rate>0.95"],
  },
};

/** Record a response: 429 -> rate_limited, other non-expected -> error. */
function track(res, expected) {
  if (res.status === 429) {
    rateLimited.add(1);
    errors.add(false);
    return false;
  }
  const ok = res.status === expected;
  errors.add(!ok);
  return ok;
}

function post(path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return http.post(`${BASE_URL}${path}`, body === undefined ? "{}" : JSON.stringify(body), {
    headers,
    tags: { name: path },
  });
}

function username() {
  const n = ((__VU - 1) % SEED_PARTICIPANTS) + 1;
  return `user${String(n).padStart(3, "0")}`;
}

export function candidate() {
  const started = Date.now();
  const user = username();

  // 1. Login
  const loginRes = post("/auth/login", null, { username: user, password: PASSWORD, examId: EXAM_ID });
  check(loginRes, { "login 200": (r) => r.status === 200 });
  if (!track(loginRes, 200)) return;
  const token = loginRes.json("token");
  if (!token) return;

  // 2. Begin (idempotent)
  const beginRes = post("/exam/begin", token);
  check(beginRes, { "begin 200": (r) => r.status === 200 });
  if (!track(beginRes, 200)) return;

  // 3. Manifest
  const manRes = http.get(`${BASE_URL}/exam/manifest`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: "/exam/manifest" },
  });
  check(manRes, { "manifest 200": (r) => r.status === 200 });
  if (!track(manRes, 200)) return;
  const questions = manRes.json("questions") || [];
  if (questions.length === 0) return;

  // 4. Answer loop with monotonic client_seq and interleaved heartbeats.
  let seq = 0;
  const target = Math.min(ANSWERS, questions.length);
  for (let i = 0; i < target; i++) {
    const q = questions[i];
    const opt = q.options && q.options[0] ? q.options[0].optionId : null;
    if (opt) {
      seq += 1;
      const ansRes = post("/exam/answer", token, {
        questionId: q.questionId,
        selectedOptionIds: [opt],
        status: "answered",
        clientSeq: seq,
        answeredAt: new Date().toISOString(),
      });
      check(ansRes, { "answer 200": (r) => r.status === 200 });
      track(ansRes, 200);
    }
    if ((i + 1) % HEARTBEAT_EVERY === 0) {
      const hbRes = post("/exam/heartbeat", token, { answers: [] });
      check(hbRes, { "heartbeat 200": (r) => r.status === 200 });
      track(hbRes, 200);
    }
    if (THINK_MS > 0) sleep(THINK_MS / 1000);
  }

  // 5. Submit
  const subRes = post("/exam/submit", token);
  check(subRes, { "submit 200": (r) => r.status === 200 });
  track(subRes, 200);

  flowTrend.add(Date.now() - started);
}
