# BUILD CHECKLIST

Derived from [EXAM_SYSTEM_PLAN.md](EXAM_SYSTEM_PLAN.md). Items map to the locked decisions,
data model, API contracts, and subsystem designs in that document. Tier 1 is the non-negotiable
integrity path; Tier 2 items are marked.

---

## SHARED AND MONOREPO

- [ ] Monorepo layout: `apps/api`, `apps/admin`, `apps/client`, `packages/shared-types` (actual layout is `app/*` with independent lockfiles; restructure deliberately deferred — pure churn while the three apps build green independently)
- [ ] Shared TypeScript types package (API contract, enums, status values) (deferred with the restructure; extract when the contract starts churning across apps)
- [x] `docker-compose.yml` for local Postgres and Redis
- [x] Database migrations tooling (Drizzle; first migration generated and applied)
- [x] Seed script: 1 exam, 100-question bank, 700 fake participants (`bun run seed`, `--fresh` to reset)
- [x] Fast-clock test mode (`CLOCK_MULTIPLIER` env; 60 makes the hour last a minute)
- [x] CI pipeline (lint, type-check, build; `.github/workflows/ci.yml`, three parallel Bun jobs)
- [x] Environment configuration and secrets handling (zod-validated env, `.env.example`; dev defaults only, override in production)

---

## ELECTRON CLIENT

- [x] Scaffold Electron, React, Vite, TypeScript (electron-vite, at `app/client`; shadcn ui, tailwind v4, lucide already present)
- [x] Security baseline: `contextIsolation: true`, `nodeIntegration: false`, no remote module
- [x] Kiosk and fullscreen mode; DevTools off unless developer mode (Ctrl+Shift+Alt+X)
- [x] Local SQLite write-ahead buffer (Electron's built-in `node:sqlite` in the main process over sync IPC, JSON-file fallback; `lib/buffer.ts` API unchanged, localStorage fallback in web dev)
- [x] Device fingerprint capture for session binding (sha256 of MACs+hostname+platform in main process, sent as `deviceId` at login)
- [x] Login screen (username, password, optional Exam ID / Engine)
- [x] Lobby / Terms screen (instructions + accept before begin)
- [x] Begin action calls `/exam/begin`
- [x] Fetch and render manifest (served subset, shuffled, without `is_correct`)
- [x] Question palette with five statuses: not_visited, not_answered, answered, marked_for_review, answered_marked
- [x] Countdown timer driven by server `remainingSeconds` with clock-offset correction
- [x] Optimistic local write on every answer or flag change, stamped with monotonic `client_seq`
- [x] Two-tier sync: debounced per-change push plus heartbeat
- [x] Reconnect with backoff; replay unsynced buffer (exponential 1s→30s with jitter, resets on success)
- [x] Resume on relaunch (same-device resume; different-device blocked with 409 + `device_change` event until proctor releases the binding)
- [x] Auto-submit at deadline; manual submit (server-side jitter spreads sweep finalizations over ~3s, scaled by `CLOCK_MULTIPLIER`)
- [x] Submitted and locked screen (confirmation only, no score)
- [x] Focus-loss detection: on-screen warning overlay plus `integrity_event`
- [x] Offline state indicator and handling
- [x] State-machine transitions persisted to local SQLite (status persisted on login/begin/submit; relaunch restores the right screen)
- [x] Installer and ASAR packaging (asar + NSIS target configured in `electron-builder.yml`; run `npm run build:win` on Windows to produce the installer)
- [0] Code signing (TIER 2; start certificate procurement on day 0)
- [ ] Full kiosk lockdown beyond fullscreen (best-effort shortcut blocking done; Alt+Tab and Windows key need a native hook or Assigned Access, TIER 2)
- [x] Watermark based on candidate name and exam ID (tiled diagonal overlay after login)

---

## BACKEND API (BUN AND EXPRESS)

> `app/api` is the production backend: PostgreSQL (Drizzle), Redis, JWT, argon2id,
> WebSocket, rate limiting. The old in-memory store survives only as `src/store.ts` history.

- [x] Bun and Express project with exact pinned versions
- [x] Smoke-test middleware stack on Bun (JWT, rate limiting, WebSocket all live)
- [x] Thin, framework-agnostic handlers (business logic in plain functions)
- [x] Schema and migrations for all tables in the data model (Drizzle on PostgreSQL)
- [x] Auth: `/auth/login` with hashed secret verification (argon2id via `Bun.password`)
- [x] Short-lived session JWT, device-bound when the client sends `deviceId`
- [x] `/exam/begin`: stamp `started_at`, set `deadline_at`, allocate `shuffle_seed`, freeze `served_question_ids`
- [x] Seeded subset selection (60 of an 80-question bank) plus server-side shuffle of questions and options
- [x] `/exam/manifest`: strip `is_correct`, ordered by seed, only after Begin
- [x] `/time` endpoint for offset calculation
- [x] `/exam/heartbeat`: accept answers, return remaining, serverTime, acked, deadline, status
- [x] `/exam/answer`: idempotent upsert with monotonic `client_seq` guard
- [x] `/exam/submit`: finalize, return confirmation only (never the score)
- [x] `/exam/resume`: server-authoritative state (seed, manifest, answers, deadline, remaining)
- [x] Grading engine: no negative marking, all-or-nothing, MCQ scores only on exact set match
- [x] Persist completed-exam results to a JSON file (`app/api/data/results.json`; interim until PostgreSQL)
- [x] Deadline enforcement by `answered_at` plus grace; availability window enforced at login
- [x] Redis integration: sessions, deadline cache, leaderboard sorted set, pub/sub, rate limiting (idempotency via the monotonic `client_seq` upsert)
- [x] Question bank cached in Redis (invalidated on admin question mutations)
- [x] WebSocket for admin live leaderboard and add-time push (pub/sub across nodes)
- [x] Rate limiting and input validation on every endpoint
- [x] Structured logging (pino)
- [x] Health-check endpoint (`/health`)

---

## ADMIN ENDPOINTS AND PANEL

- [x] Admin auth with MFA (password + optional per-admin TOTP; `/admin/mfa/setup`)
- [x] Exam and question CRUD (question bank CRUD with cache bust; exam open/close/publish; exam creation via seed)
- [x] Participant bulk import (`/admin/participants/import`, JSON array, hashed on ingest)
- [x] Leaderboard, paged and live via WebSocket (`/admin/ws`, Redis pub/sub)
- [x] Edit result score (audited) (`PATCH /admin/results/:sessionId`, updates leaderboard + live WS, audit `result.score_edit`)
- [x] Reset a participant session
- [x] Add time to one participant or all; option to extend `available_until`
- [x] Open and close the availability window
- [x] Publish results toggle (`results_published`)
- [x] Integrity-events review (focus-loss, double-login; client reports via `/exam/integrity`)
- [x] Results export (CSV endpoint)
- [x] Session monitoring (status counts and recent sessions)
- [x] Audit log written on every mutating action

---

## ADMIN FRONTEND (NEXT.JS)

- [x] Scaffold Next.js and React (`app/admin`, shadcn and Inter, port 5000)
- [x] Completed-exam results dashboard (stat row and results table; reads the JSON results file)
- [x] Per-candidate answer review page (marked options against correct options, per-question outcome)
- [x] Admin auth and MFA UI (`/admin/login`, token-gated layout; MFA setup on the overview page)
- [x] Exam and question bank management screens (question CRUD via the upsert route; exams are seed-created — no exam-CRUD endpoint exists, screens take an Exam ID)
- [x] Participant import screen (JSON array paste → import, shows created/skipped)
- [x] Live leaderboard view (paged + `/admin/ws` refresh; WS does not auto-reconnect yet)
- [x] Score edit, session reset, add-time controls (on the Sessions screen)
- [x] Exam open and close, publish results controls
- [x] Integrity-events dashboard (type filter, exam-scoped)
- [x] Results export action (CSV: all results, and per-candidate answers)

---

## DATABASE (POSTGRESQL)

- [x] Schema: exams, questions, options, participants, exam_sessions, answers, results, admins, audit_logs, integrity_events
- [x] Unique constraint on `(session_id, question_id)`
- [x] Indexes for leaderboard, participant lookup, and exam scoping
- [x] Connection pool (postgres.js, size via `DB_POOL_MAX`)
- [ ] Encryption at rest (RDS) and least-privilege access control
- [x] Versioned migrations (drizzle-kit, committed under `app/api/drizzle`)

---

## CACHE AND REALTIME (REDIS)

- [x] Session and deadline cache
- [x] Leaderboard sorted set
- [x] Pub/sub for WebSocket fan-out across API nodes
- [x] Idempotency key store (resolved by design: answer upserts are idempotent via the monotonic `client_seq` guard; a dedicated store was not needed)
- [x] Rate-limit store (fixed-window INCR and EXPIRE)

---

## INFRASTRUCTURE AND DEPLOYMENT (AWS)

- [ ] Two EC2 API nodes (stateless)
- [ ] ALB with TLS termination, health checks, idle timeout greater than heartbeat interval
- [ ] RDS PostgreSQL Multi-AZ
- [ ] ElastiCache Redis
- [ ] Secrets Manager or SSM Parameter Store for all secrets
- [ ] Domain and ACM certificate
- [ ] CloudWatch metrics and alarms (error rate, latency, DB connections)
- [ ] OS tuning (file descriptors), pool sizing, RDS `max_connections`
- [ ] Backup and restore drill
- [ ] App distribution to centers handled by staff; client version pinning

---

## SECURITY AND ANTI-CHEAT

- [x] `is_correct` never serialized to any client response
- [x] All grading server-side; client submits answers only
- [x] `deadline_at` server-side only; client time advisory
- [x] Deadline enforced by `answered_at`, not arrival time
- [x] Short-lived JWT, device-bound when provided; one session per participant per exam, double login logged
- [ ] TLS 1.2 or higher everywhere via system trust store (local HTTP for now, pinning deferred, TIER 2)
- [x] Idempotency (per-question upsert) plus monotonic `client_seq` guard against stale overwrites
- [x] Rate limiting and input validation on every endpoint
- [x] Admin MFA; all admin mutations audited
- [ ] Encryption at rest and DB access control (manifest served only after Begin; at-rest encryption pending DB)
- [x] Score never returned to any client
- [x] Electron hardened: context isolation on, node integration off, DevTools gated (code signing tracked separately in the client section, TIER 2)
- [x] Secrets never committed to the repository

---

## TESTING (LOAD, CHAOS, END TO END)

- [x] k6 load test, 700 to 1500 virtual users (script at `tests/load/exam-flow.js`, VUS/BASE_URL env, smoke scenario; syntax-checked — not yet executed, k6 not installed locally)
- [ ] Run k6 against localhost first, then against cloud (procedure in `tests/README.md`)
- [ ] Chaos drills: kill an API node mid-exam, drop a client network, RDS failover (playbook written in `tests/README.md`; drills need real infra)
- [x] Resume correctness tests (same-device and different-device; `tests/integration/resume.test.ts`, passing against live API)
- [x] Deadline and auto-submit tests using fast-clock mode (`tests/integration/deadline.test.ts`, passing)
- [x] Stale-write and monotonic-guard test (`tests/integration/stale-write.test.ts`, passing)
- [x] Offline-at-deadline answer-sync test (`tests/integration/offline-sync.test.ts`, passing)
- [ ] Full mock exam dress rehearsal at scale (checklist in `tests/README.md`)

---

## OPERATIONS AND RUNBOOK

- [x] Operations runbook (start, monitor, intervene, close) (`docs/RUNBOOK.md`)
- [ ] Monitoring dashboards and alerting (alarm targets documented in RUNBOOK §2; needs AWS/CloudWatch)
- [ ] Backup and restore procedure documented and tested (documented in RUNBOOK §5; restore drill not yet executed)
- [x] Incident procedures: add time, reset session, release device binding (RUNBOOK §3; all three endpoints exist)
- [x] Post-exam results publication and export procedure (RUNBOOK §4)
