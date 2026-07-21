# WCL Implementation Status

What has actually been built, as of 2026-07-06. Complements the design in
[EXAM_SYSTEM_PLAN.md](EXAM_SYSTEM_PLAN.md), the task list in
[BUILD_CHECKLIST.md](BUILD_CHECKLIST.md), and the operations guide in
[RUNBOOK.md](RUNBOOK.md).

**Scope:** the Electron exam client, the production backend (PostgreSQL +
Redis), the admin panel with a full operations UI, a load/correctness test
suite, CI, and the runbook. What remains is AWS infrastructure, code signing,
TIER-2 kiosk lockdown, and executing the load/chaos/rehearsal procedures —
see §9.

---

## 1. Repository layout

```
app/
  client/        Electron exam client (electron-vite, React 19, TS, Tailwind v4, shadcn)
  api/           Production backend (Bun + Express + Drizzle/PostgreSQL + Redis + WS)
  admin/         Admin panel (Next.js 16, port 5000): results dashboard + operations UI
tests/
  load/          k6 load test (full candidate flow, 700–1500 VUs)
  integration/   Runnable correctness suites (resume, stale-write, deadline, offline-sync)
docs/            Plan, checklist, runbook, this document
docker-compose.yml   Local PostgreSQL + Redis
.github/workflows/ci.yml   CI: three parallel Bun jobs (api / admin / client)
postman/         API collection
```

The planned `apps/*` + `packages/shared-types` monorepo restructure is
deliberately deferred: the three apps build green with independent lockfiles,
and a workspace root would be churn with no current payoff. Extract shared
types when the API contract starts changing in more than one app at a time.

---

## 2. How to run locally

```bash
# 1. Infrastructure
docker compose up -d                # Postgres :5432, Redis :6379
# Optional dashboards (Grafana http://localhost:3001, admin/admin):
# docker compose --profile obs up -d

# 2. Backend (http://localhost:4000)
cd app/api
bun install
bun run db:migrate
bun run seed                        # 1 exam, 100-question bank, 700 participants (--fresh to reset)
bun run dev

# 3. Admin panel (http://localhost:5000)
cd app/admin && bun install && bun run dev

# 4. Exam client (fullscreen Electron app)
cd app/client && npm install && npm run dev
```

**Seeded credentials:** participants `user001`..`user700` / `password`, exam
`WCL-EXAM`, admin `admin@wcl.local` / `adminpass`. Environment is
zod-validated (`app/api/src/env.ts`, see `.env.example`); `CLOCK_MULTIPLIER`
speeds the exam clock for testing (60 makes the hour last a minute) — verify
it is unset for real events, the boot log prints it.

**WSL note:** on this dev machine the stack runs Windows-side (Docker Desktop,
Windows bun). WSL-set env vars do not propagate to Windows bun and WSL
processes cannot reach the Windows-bound API on `localhost`; run test
instances via `powershell.exe bun` with env set Windows-side.

**Developer override (client):** `Ctrl+Shift+Alt+X` toggles Developer Mode
(disables kiosk lock, allows app switching, opens DevTools).

---

## 3. Electron client

Candidate flow: Login → Terms/lobby → Exam → Submitted, with route guards in
`App.tsx`; state and side effects live in `context/ExamProvider.tsx`.

Implemented (see git history for the phase-1 detail; all still current):

- **Security baseline:** `contextIsolation: true`, `nodeIntegration: false`,
  no remote module; kiosk/fullscreen with refocus-on-blur, best-effort
  shortcut blocking, copy protection, DevTools gated behind Developer Mode.
- **Question palette** with the five statuses; countdown driven by server
  `remainingSeconds` with clock-offset correction; auto-submit at deadline;
  submitted screen never shows a score.
- **Focus-loss detection:** blocking overlay + `integrity_event` report.
- **Watermark:** tiled diagonal candidate-name + exam-ID overlay after login.
- **Device fingerprint** (`src/main/fingerprint.ts`): sha256 of sorted
  non-internal MACs + hostname + platform, stdlib only, computed in the main
  process, exposed over IPC, sent as `deviceId` on `/auth/login`. The binding
  rides inside the JWT, so resume needs nothing extra.
- **Write-ahead buffer on SQLite** (`src/main/store.ts`): Electron's built-in
  `node:sqlite` (no native deps) as a key-value table in `userData`, exposed
  over synchronous IPC so `lib/buffer.ts` kept its localStorage-shaped API;
  automatic JSON-file fallback if `node:sqlite` fails to load, and a
  localStorage fallback in plain-web dev.
- **Persisted state machine:** the session status (login/terms/exam/submitted)
  is stored on every transition; relaunch shows the correct screen
  immediately, and a resume during a network outage keeps the session (marks
  offline) instead of wiping to login.
- **Reconnect with backoff:** the heartbeat self-reschedules — steady 12 s
  when healthy, exponential 1 s → 2 s → 4 s … capped at 30 s (plus jitter)
  when unreachable, reset on success. Unsynced answers replay on every
  heartbeat with the monotonic `client_seq` guard.
- **Packaging:** `electron-builder.yml` with `asar: true` and a Windows NSIS
  target (icon, install-dir prompt). Produce the installer on Windows with
  `npm run build:win`. Code signing is pending certificate procurement
  (TIER 2).

---

## 4. Backend API (`app/api`)

Bun + Express, thin handlers over plain service functions. PostgreSQL via
Drizzle (versioned migrations in `app/api/drizzle/`), Redis (ioredis), JWT
sessions (device-bound when the client sends `deviceId`), argon2id hashing via
`Bun.password`, zod validation and fixed-window Redis rate limiting on every
endpoint, pino structured logging, `/health` liveness endpoint.

### Candidate endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Verify hashed secret, mint short-lived device-bound JWT. Different-device login on a bound session → **409** + `device_change` integrity event. |
| POST | `/exam/begin` | Stamp `started_at`/`deadline_at`, allocate `shuffle_seed`, freeze the served 60-of-100 subset. Idempotent. |
| GET | `/exam/manifest` | Seed-ordered questions and options, `is_correct` stripped, only after Begin. |
| GET | `/time` | Server time for offset estimation. |
| POST | `/exam/answer` | Idempotent upsert, monotonic `client_seq` guard against stale overwrites. |
| POST | `/exam/heartbeat` | Accept buffered answers; return remaining, serverTime, acked, deadline, status. |
| POST | `/exam/submit` | Finalize + grade server-side; confirmation only, never the score. |
| POST | `/exam/resume` | Server-authoritative state: seed, manifest, answers, deadline, remaining. |
| POST | `/exam/integrity` | Client-reported integrity events (focus loss etc.). |

### Admin endpoints (all JWT-authed, MFA-capable, mutations audited)

Login + TOTP setup, question-bank CRUD (Redis question cache busted on
mutation), participant bulk import (hashed on ingest), paged leaderboard +
live WebSocket `/admin/ws` (Redis pub/sub across nodes), session monitoring,
session reset, add-time (one participant or exam-wide; exam-wide also extends
`available_until`), exam open/close and results-publish toggles,
integrity-events review, CSV export, **score edit**
(`PATCH /admin/results/:sessionId` — updates the results row, the Redis
leaderboard ZSET, and the live WS; audit `result.score_edit` with old/new
score and reason), and **device-binding release**
(`POST /admin/sessions/:sessionId/release-device`, audit
`session-release-device`).

### Integrity properties

- Grading is entirely server-side (all-or-nothing, no negative marking, MCQ
  exact-set match); `is_correct` and scores never reach any client.
- Deadline enforced by `answered_at` + grace, not arrival time, so
  before-deadline answers buffered through an outage still count — even when
  they arrive after the session was finalized (the result is re-graded).
- **Auto-submit jitter:** the background deadline sweep spreads finalizations
  randomly over ~3 s (scaled down by `CLOCK_MULTIPLIER`) so 700 clustered
  deadlines don't stampede the DB; per-session lazy finalize on
  heartbeat/resume needs no jitter.
- **Device binding is strict:** a second device gets 409 until a proctor
  releases the binding; both the blocked attempt and the post-release rebind
  are logged as `device_change` integrity events.

---

## 5. Admin panel (`app/admin`)

Two halves, one Next.js app on port 5000:

- **Results dashboard** (`/` + `/session/[sessionId]`): stat row, results
  table, per-candidate answer review, CSV export routes.
- **Operations UI** (`/admin/...`, token-gated, `NEXT_PUBLIC_API_BASE`):
  login + MFA (TOTP setup on the overview page), question-bank management and
  exam open/close/publish, participant JSON import, live leaderboard
  (paged + `/admin/ws`), sessions screen with reset / add-time / score-edit,
  and an integrity-events dashboard with type filter.

Known smallness: the leaderboard WS shows "Offline" instead of
auto-reconnecting (refresh reconnects), destructive actions use
`confirm()`/`prompt()` rather than dialogs, and since no exam-CRUD endpoint
exists, exam-scoped screens take an editable Exam ID (default `WCL-EXAM`).

---

## 6. Tests (`tests/`)

- **Load:** `tests/load/exam-flow.js` — k6, full candidate lifecycle with
  monotonic `client_seq` and interleaved heartbeats, `BASE_URL`/`VUS` env
  (default 700, up to 1500), p95 + error-rate thresholds, `SCENARIO=smoke`
  for 10 VUs. Syntax-checked; **not yet executed** (k6 not installed here).
  Note: per-IP rate limits make single-host runs report 429s (counted
  separately as `rate_limited`); see `tests/README.md`.
- **Integration** (plain `bun` scripts against a live API, all **passing**
  and re-runnable — they self-reset via admin endpoints):
  `resume.test.ts` (same-device + blocked-then-released different-device),
  `stale-write.test.ts` (monotonic guard), `deadline.test.ts` (fast-clock
  auto-submit), `offline-sync.test.ts` (buffered answers at the deadline
  boundary).
- **`tests/README.md`:** run instructions, localhost-first-then-cloud k6
  procedure, chaos-drill playbook (kill a node, drop a network, RDS
  failover), and the dress-rehearsal checklist.

The deadline suite surfaced a real grading bug — see §8.

---

## 7. CI and operations

- **CI** (`.github/workflows/ci.yml`): push-to-main + PR; parallel Bun jobs —
  api typecheck, admin lint + build, client lint + build (with
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; CI compiles but never launches Electron).
- **Operations:** [RUNBOOK.md](RUNBOOK.md) — start, monitor, intervene
  (add-time / reset / release-device / score-edit with exact curl commands),
  close, backup/restore. The restore drill is documented but **not yet
  executed** — do it before exam day.

---

## 8. Verification performed (2026-07-06)

- `app/api`: `bun run typecheck` clean; score-edit, jitter, and device-rebind
  paths exercised end-to-end against real Postgres + Redis (18/18 smoke
  checks; leaderboard ZSET verified after a score edit).
- `app/admin`: `bun run build` (Next production build) passes; lint clean.
- `app/client`: `npm run typecheck` and `npm run build` (all three
  electron-vite bundles) pass; SQLite KV roundtrip, backoff schedule, and
  fingerprint stability self-checked.
- All four integration suites pass against a live seeded API, twice in a row.
- **Bug found and fixed:** an answer stamped before the deadline (within
  grace) that *arrived after* the session was already finalized was ACKed and
  stored but never graded — the score had been computed without it. Fixed in
  `services/exam.ts`: all write paths (`/exam/answer` and heartbeat) now go
  through `applyBatch`, which re-grades the finalized result after a late
  in-grace write (skipped, with a warning log, if an admin already edited the
  score). Verified live: the deadline suite now asserts via the admin results
  endpoint that the late answer is counted into the regraded result, and all
  four suites re-pass after the fix (deadline 8, offline-sync 7, stale-write
  9, resume 25 checks).

---

## 9. Not built / pending

1. **AWS infrastructure** (EC2 nodes, ALB/TLS, RDS Multi-AZ, ElastiCache,
   Secrets Manager, CloudWatch, OS tuning, backups): nothing provisioned;
   alarm targets and procedures are documented in the runbook.
2. **Code signing** (TIER 2): certificate procurement not started.
3. **Full kiosk lockdown** (TIER 2): Alt+Tab / Windows key need a native
   keyboard hook or Assigned Access; best-effort blocking is in place.
4. **Monorepo restructure + shared-types package:** deferred (§1).
5. **Executing** the k6 load runs, chaos drills, restore drill, and the full
   dress rehearsal — scripts and playbooks exist; the runs need real infra.
6. **Small API gaps:** no exam-CRUD endpoint (exams come from seed), no
   endpoint to set `available_from`/`available_until` (only the open/close
   toggle and add-time extension), `/health` is liveness-only (no DB/Redis
   probe).
