/**
 * Shared helpers for the WCL integration correctness scripts.
 *
 * Plain bun scripts, no test framework: assert-style checks against a live API.
 * Every script imports from here so the API contract lives in exactly one place.
 *
 * Config via env (all optional):
 *   BASE_URL        API base URL              (default http://localhost:4000)
 *   EXAM_ID         exam to log in against    (default WCL-DEMO)
 *   PARTICIPANT_PW  shared candidate secret   (default "password", per seed.ts)
 *   ADMIN_EMAIL     admin login email         (default admin@wcl.local, per seed)
 *   ADMIN_PASSWORD  admin login password      (default adminpass, per seed)
 */

export const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const EXAM_ID = process.env.EXAM_ID ?? "WCL-DEMO";
export const PARTICIPANT_PW = process.env.PARTICIPANT_PW ?? "password";
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@wcl.local";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "adminpass";

export interface ApiResult<T = any> {
  status: number;
  json: T;
}

/** One HTTP call. Never throws on non-2xx; returns {status, json}. */
export async function api<T = any>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

// --- assertions ------------------------------------------------------------

let checks = 0;
export function check(cond: boolean, msg: string): void {
  checks += 1;
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    console.log(`  FAIL ${msg}`);
    throw new Error(`assertion failed: ${msg}`);
  }
}

export function eq(actual: unknown, expected: unknown, msg: string): void {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

/** Run a named test body, print a banner, and set the process exit code. */
export async function run(name: string, body: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${name} :: ${BASE_URL} ===`);
  try {
    await body();
    console.log(`PASS ${name} (${checks} checks)`);
  } catch (err) {
    console.log(`FAIL ${name}: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- domain helpers --------------------------------------------------------

export interface LoginOut {
  token: string;
  sessionId: string;
  exam: { examId: string; durationSeconds: number; questionsToServe: number };
  sessionStatus: string;
}

/** Participant login. deviceId is optional (device binding). */
export async function login(username: string, deviceId?: string): Promise<ApiResult<LoginOut>> {
  return api<LoginOut>("/auth/login", {
    body: { username, password: PARTICIPANT_PW, examId: EXAM_ID, deviceId },
  });
}

/** Admin login -> bearer token (seed admin has no TOTP). */
export async function adminLogin(): Promise<string> {
  const r = await api<{ token: string }>("/admin/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (r.status !== 200 || !r.json?.token) {
    throw new Error(`admin login failed (${r.status}): ${JSON.stringify(r.json)}`);
  }
  return r.json.token;
}

/**
 * Make a candidate's session re-runnable: find any existing session for the
 * username via the admin API and reset it to not_started. No-op on first run.
 * Requires admin credentials; used by tests that must begin a fresh timer.
 */
export async function resetSession(username: string): Promise<void> {
  const token = await adminLogin();
  const r = await api<{ sessions: { sessionId: string; username: string }[] }>(
    `/admin/sessions?examId=${encodeURIComponent(EXAM_ID)}`,
    { token },
  );
  const row = r.json?.sessions?.find((s) => s.username === username);
  if (!row) return;
  const reset = await api(`/admin/sessions/${row.sessionId}/reset`, { method: "POST", token });
  if (reset.status !== 200) {
    throw new Error(`reset failed for ${username} (${reset.status}): ${JSON.stringify(reset.json)}`);
  }
  // Also clear any device binding so a fresh login with a new deviceId is not
  // blocked by the strict device-binding guard (endpoint is a no-op if absent).
  await api(`/admin/sessions/${row.sessionId}/release-device`, { method: "POST", token });
}

/** Login + begin a fresh timed session; returns token, sessionId, begin payload. */
export async function beginFresh(
  username: string,
  deviceId?: string,
): Promise<{ token: string; sessionId: string; begin: any }> {
  await resetSession(username);
  const l = await login(username, deviceId);
  if (l.status !== 200) throw new Error(`login failed (${l.status}): ${JSON.stringify(l.json)}`);
  const begin = await api("/exam/begin", { method: "POST", token: l.json.token });
  if (begin.status !== 200) throw new Error(`begin failed (${begin.status}): ${JSON.stringify(begin.json)}`);
  return { token: l.json.token, sessionId: l.json.sessionId, begin: begin.json };
}

export interface ManifestQuestion {
  questionId: string;
  type: string;
  options: { optionId: string; text: string }[];
}

export async function manifest(token: string): Promise<{ shuffleSeed: string; questions: ManifestQuestion[] }> {
  const r = await api<{ shuffleSeed: string; questions: ManifestQuestion[] }>("/exam/manifest", { token });
  if (r.status !== 200) throw new Error(`manifest failed (${r.status}): ${JSON.stringify(r.json)}`);
  return r.json;
}

/** Build an /exam/answer body. */
export function answerBody(
  q: ManifestQuestion,
  optionIndexes: number[],
  clientSeq: number,
  answeredAt: Date,
  status = "answered",
) {
  return {
    questionId: q.questionId,
    selectedOptionIds: optionIndexes.map((i) => q.options[i].optionId),
    status,
    clientSeq,
    answeredAt: answeredAt.toISOString(),
  };
}
