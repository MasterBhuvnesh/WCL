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

## ELECTRON CLIENT (DESKTOP)

- [ ] Scaffold Electron, React, Vite, TypeScript
- [ ] Security baseline: `contextIsolation: true`, `nodeIntegration: false`, no remote module
- [ ] Kiosk and fullscreen mode; DevTools disabled in production
- [ ] Local SQLite (better-sqlite3) write-ahead buffer for answers and session state
- [ ] Device fingerprint capture for session binding
- [ ] Login screen (roll number plus secret)
- [ ] Lobby screen (within availability window, not started)
- [ ] Begin action calls `/exam/begin`
- [ ] Fetch and render manifest (served subset, shuffled, without `is_correct`)
- [ ] Question palette with five statuses: not_visited, not_answered, answered, marked_for_review, answered_marked
- [ ] Countdown timer driven by server `remainingSeconds` with NTP-style offset correction
- [ ] Optimistic local write on every answer or flag change, stamped with monotonic `client_seq`
- [ ] Two-tier sync: prompt per-change push plus heartbeat every 10 to 15 seconds
- [ ] Reconnect with backoff; replay unsynced buffer (idempotent)
- [ ] Resume on relaunch: same-device (local plus server) and different-device (rebind plus server)
- [ ] Auto-submit at deadline with jitter; manual submit
- [ ] Submitted and locked screen (confirmation only, no score)
- [ ] Focus-loss detection: on-screen warning overlay plus `integrity_event`
- [ ] Offline state indicator and handling
- [ ] State-machine transitions persisted to local SQLite
- [ ] Installer and ASAR packaging
- [ ] Code signing (TIER 2; start certificate procurement on day 0)
- [ ] Full kiosk lockdown beyond fullscreen (TIER 2)

---

## BACKEND API (BUN AND EXPRESS)

- [ ] Bun and Express project with exact pinned versions
- [ ] Smoke-test middleware stack on Bun (JWT auth, body parsing, rate-limit, CORS, WebSocket)
- [ ] Thin, framework-agnostic handlers (business logic in plain functions)
- [ ] Schema and migrations for all tables in the data model
- [ ] Auth: `/auth/login` with hashed secret verification (argon2 or bcrypt)
- [ ] Short-lived session JWT, device-bound, one active session per participant
- [ ] `/exam/begin`: stamp `started_at`, set `deadline_at`, allocate `shuffle_seed`, freeze `served_question_ids`
- [ ] Seeded subset selection (60 of 100) plus server-side shuffle of questions and options
- [ ] `/exam/manifest`: strip `is_correct`, ordered by seed, stable IDs, only after Begin
- [ ] `/time` endpoint for offset calculation
- [ ] `/exam/heartbeat`: accept answers, return remaining, serverTime, acked, deadline, status
- [ ] `/exam/answer`: idempotent upsert with monotonic `client_seq` guard
- [ ] `/exam/submit`: finalize, return confirmation only (never the score)
- [ ] `/exam/resume`: server-authoritative state (seed, manifest, answers, deadline, remaining)
- [ ] Grading engine: no negative marking, all-or-nothing, MCQ scores only on exact set match
- [ ] Deadline enforcement by `answered_at` plus grace; `effective_deadline = min(deadline_at, available_until)`
- [ ] Redis integration: sessions, deadline cache, leaderboard sorted set, pub/sub, idempotency keys, rate limiting
- [ ] Question bank cached in Redis
- [ ] WebSocket for admin live leaderboard and add-time push (pub/sub across nodes)
- [ ] Rate limiting and input validation on every endpoint
- [ ] Structured logging (pino)
- [ ] Health-check endpoint for the ALB

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

- [ ] Scaffold Next.js and React, admin auth and MFA UI
- [ ] Exam and question bank management screens
- [ ] Participant import screen
- [ ] Live leaderboard view
- [ ] Score edit, session reset, add-time controls
- [ ] Exam open and close, publish results controls
- [ ] Integrity-events dashboard
- [ ] Results export action

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

- [ ] `is_correct` never serialized to any client response
- [ ] All grading server-side; client submits answers only
- [ ] `deadline_at` server-side only; client time advisory
- [ ] Deadline enforced by `answered_at`, not arrival time
- [ ] Short-lived JWT, device-bound, single active session per participant
- [ ] TLS 1.2 or higher everywhere via system trust store (pinning deferred, TIER 2)
- [ ] Idempotency keys plus monotonic `client_seq` guard against stale overwrites
- [ ] Rate limiting and input validation on every endpoint
- [ ] Admin MFA; all admin mutations audited
- [ ] Encryption at rest and DB access control; manifest served only after Begin
- [ ] Score never returned to any client; results gated by `results_published`
- [ ] Electron hardened (context isolation on, node integration off, DevTools off, signed)
- [ ] Secrets never committed to the repository

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
