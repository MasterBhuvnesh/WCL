# BUILD CHECKLIST

Derived from [EXAM_SYSTEM_PLAN.md](EXAM_SYSTEM_PLAN.md). Items map to the locked decisions,
data model, API contract, and subsystem designs in that document. Tier 1 is the non-negotiable
integrity path; Tier 2 items are marked.

---

## SHARED AND MONOREPO

- [ ] Monorepo layout: `apps/api`, `apps/admin`, `apps/client`, `packages/shared-types`
- [ ] Shared TypeScript types package (API contract, enums, status values)
- [ ] `docker-compose.yml` for local Postgres and Redis
- [ ] Database migrations tooling (Drizzle or Prisma)
- [ ] Seed script: 1 exam, 100-question bank, 700 fake participants
- [ ] Fast-clock test mode (env-flag time multiplier) for timer and auto-submit testing
- [ ] CI pipeline (lint, type-check, tests, build)
- [ ] Environment configuration and secrets handling (no secrets in repo)

---

## ELECTRON CLIENT

- [x] Scaffold Electron, React, Vite, TypeScript (electron-vite, at `app/client`; shadcn ui, tailwind v4, lucide already present)
- [x] Security baseline: `contextIsolation: true`, `nodeIntegration: false`, no remote module
- [x] Kiosk and fullscreen mode; DevTools off unless developer mode (Ctrl+Shift+Alt+X)
- [ ] Local SQLite (better-sqlite3) write-ahead buffer (currently localStorage-backed via `lib/buffer.ts`; SQLite swap is a follow-up)
- [ ] Device fingerprint capture for session binding
- [x] Login screen (username, password, optional Exam ID / Engine)
- [x] Lobby / Terms screen (instructions + accept before begin)
- [x] Begin action calls `/exam/begin`
- [x] Fetch and render manifest (served subset, shuffled, without `is_correct`)
- [x] Question palette with five statuses: not_visited, not_answered, answered, marked_for_review, answered_marked
- [x] Countdown timer driven by server `remainingSeconds` with clock-offset correction
- [x] Optimistic local write on every answer or flag change, stamped with monotonic `client_seq`
- [x] Two-tier sync: debounced per-change push plus heartbeat
- [ ] Reconnect with backoff; replay unsynced buffer (unsynced replay done on heartbeat; explicit backoff pending)
- [ ] Resume on relaunch (same-device resume done; different-device rebind pending device fingerprint)
- [x] Auto-submit at deadline; manual submit (server-side jitter pending)
- [x] Submitted and locked screen (confirmation only, no score)
- [x] Focus-loss detection: on-screen warning overlay plus `integrity_event`
- [x] Offline state indicator and handling
- [ ] State-machine transitions persisted to local SQLite (localStorage for now)
- [ ] Installer and ASAR packaging
- [ ] Code signing (TIER 2; start certificate procurement on day 0)
- [ ] Full kiosk lockdown beyond fullscreen (best-effort shortcut blocking done; Alt+Tab and Windows key need a native hook or Assigned Access, TIER 2)

---

## BACKEND API (BUN AND EXPRESS)

> A simple in-memory development backend exists at `app/api` (no DB/Redis/Docker).
> Production hardening (persistence, hashing, JWT, Redis, WS, rate limiting) is pending.

- [x] Bun and Express project with exact pinned versions
- [ ] Smoke-test middleware stack on Bun (body parsing + CORS done; JWT, rate-limit, WebSocket pending)
- [x] Thin, framework-agnostic handlers (business logic in plain functions)
- [ ] Schema and migrations for all tables in the data model (in-memory store for now)
- [ ] Auth: `/auth/login` with hashed secret verification (dev: plain password check)
- [ ] Short-lived session JWT, device-bound (dev: opaque bearer token, one session per token)
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
- [x] Deadline enforcement by `answered_at` plus grace (availability-window cap pending)
- [ ] Redis integration: sessions, deadline cache, leaderboard sorted set, pub/sub, idempotency keys, rate limiting
- [ ] Question bank cached in Redis
- [ ] WebSocket for admin live leaderboard and add-time push (pub/sub across nodes)
- [ ] Rate limiting and input validation on every endpoint
- [ ] Structured logging (pino)
- [x] Health-check endpoint (`/health`)

---

## ADMIN ENDPOINTS AND PANEL

- [ ] Admin auth with MFA
- [ ] Exam and question CRUD (bank management)
- [ ] Participant bulk CSV import
- [ ] Leaderboard, paged and live via WebSocket
- [ ] Edit result score (audited)
- [ ] Reset a participant session
- [ ] Add time to one participant or all; option to extend `available_until`
- [ ] Open and close the availability window
- [ ] Publish results toggle (`results_published`)
- [ ] Integrity-events review (focus-loss, double-login, device-change)
- [ ] Results export
- [ ] Session monitoring (connected and submitted counts)
- [ ] Audit log written on every mutating action

---

## ADMIN FRONTEND (NEXT.JS)

- [x] Scaffold Next.js and React (`app/admin`, shadcn and Inter, port 5000)
- [x] Completed-exam results dashboard (stat row and results table; reads the JSON results file)
- [x] Per-candidate answer review page (marked options against correct options, per-question outcome)
- [ ] Admin auth and MFA UI
- [ ] Exam and question bank management screens
- [ ] Participant import screen
- [ ] Live leaderboard view
- [ ] Score edit, session reset, add-time controls
- [ ] Exam open and close, publish results controls
- [ ] Integrity-events dashboard
- [x] Results export action (CSV: all results, and per-candidate answers)

---

## DATABASE (POSTGRESQL)

- [ ] Schema: exams, questions, options, participants, exam_sessions, answers, results, admins, audit_logs, integrity_events
- [ ] Unique constraint on `(session_id, question_id)`
- [ ] Indexes for leaderboard, participant lookup, and exam scoping
- [ ] Connection pooler (PgBouncer or built-in pool) with tuned size
- [ ] Encryption at rest (RDS) and least-privilege access control
- [ ] Versioned migrations

---

## CACHE AND REALTIME (REDIS)

- [ ] Session and deadline cache
- [ ] Leaderboard sorted set
- [ ] Pub/sub for WebSocket fan-out across API nodes
- [ ] Idempotency key store
- [ ] Rate-limit store

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
- [ ] Short-lived JWT, device-bound, single active session per participant (dev: opaque token, one session per token)
- [ ] TLS 1.2 or higher everywhere via system trust store (local HTTP for now, pinning deferred, TIER 2)
- [x] Idempotency (per-question upsert) plus monotonic `client_seq` guard against stale overwrites
- [ ] Rate limiting and input validation on every endpoint
- [ ] Admin MFA; all admin mutations audited
- [ ] Encryption at rest and DB access control (manifest served only after Begin; at-rest encryption pending DB)
- [x] Score never returned to any client
- [ ] Electron hardened: context isolation on, node integration off, DevTools gated (code signing pending)
- [x] Secrets never committed to the repository

---

## TESTING (LOAD, CHAOS, END TO END)

- [ ] k6 load test, 700 to 1500 virtual users (login, begin, fetch, answer, submit)
- [ ] Run k6 against localhost first, then against cloud
- [ ] Chaos drills: kill an API node mid-exam, drop a client network, RDS failover
- [ ] Resume correctness tests (same-device and different-device)
- [ ] Deadline and auto-submit tests using fast-clock mode
- [ ] Stale-write and monotonic-guard test
- [ ] Offline-at-deadline answer-sync test
- [ ] Full mock exam dress rehearsal at scale

---

## OPERATIONS AND RUNBOOK

- [ ] Operations runbook (start, monitor, intervene, close)
- [ ] Monitoring dashboards and alerting
- [ ] Backup and restore procedure documented and tested
- [ ] Incident procedures: add time, reset session, release device binding
- [ ] Post-exam results publication and export procedure
