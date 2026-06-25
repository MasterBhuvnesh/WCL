# On-Center Examination System — Plan of Action & Software Spec

> Single source of truth for the build. Lock the **data model** and **API contract**
> (Sections 6–7) on Day 1 — changing them later causes cascading rework.

**Status:** Draft v1 · **Last updated:** 2026-06-26

---

## 0. Guiding insight

This is an **on-center, proctored** exam. Humans handle identity verification and gross
cheating, so we avoid the hardest problems (video/audio proctoring, remote identity fraud,
gaze detection). The software only has to guarantee three things:

1. **Integrity of data** — no answer is ever lost, no score is ever forged.
2. **Authoritative, fair timing** — the server owns the clock; nobody gains time via failures.
3. **Survivability** — a PC crash, WiFi blip, or backend restart never corrupts an exam-in-progress.

**"Hack-proof" = the client is untrusted and powerless.** It displays questions and buffers
answers, but it **cannot grade, cannot extend time, and cannot submit a score**. Everything
that matters happens server-side.

---

## 1. Locked decisions

| Area | Decision | Implication |
|---|---|---|
| Backend runtime | **Bun + Express** | Familiar middleware ecosystem on Bun's speed. See compatibility caveat (§3). |
| Center network | **Reliable internet, client buffering only** | No center-local relay server. SQLite buffer + heartbeat + `/resume`. Relay is a documented Phase-2 option only. |
| Focus / alt-tab policy | **Warn on-screen + log** | Dismissible overlay + `integrity_event`. No auto-submit, no auto-disqualify. |
| Student auth | **Roll number + pre-issued secret** | Bulk CSV import, hashed secret, device-bound session, one active session per participant. |
| Database | **PostgreSQL (RDS Multi-AZ in cloud)** | Source of truth. |
| Cache / realtime | **Redis (ElastiCache in cloud)** | Sessions, deadlines, leaderboard, pub/sub, idempotency, rate limiting. |
| Admin frontend | **Next.js / React** | Hosted on Vercel or EC2/S3+CloudFront. |
| Desktop client | **Electron + React + Vite + TS** | Kiosk, locked down, code-signed. |
| Exam path transport | **HTTP heartbeat (10–15s)** | WebSocket only for admin live leaderboard + push of add-time. |
| Timer start model | **Per-participant start on begin** | `deadline_at = started_at + duration + extra`. `started_at` is set when the participant begins, inside an admin-controlled availability window with a hard close. |
| Question delivery | **Per-participant subset: 60 drawn from a 100-question bank, shuffled** | The exam holds a bank (e.g. 100); each session is served a seeded 60-question subset, then questions and options are shuffled by the same seed. The served subset is frozen on the session for stability. |
| Scoring policy | **No negative marking, all-or-nothing** | Correct earns the question's marks; wrong and blank earn zero. MCQ scores only when the selected set exactly matches the correct set. |
| Result visibility | **Admin-only, published later** | Student sees a submission confirmation only, no score. Results and leaderboard are admin-only until an admin sets the exam to published. |

**Scale target:** ~700 concurrent, 60 questions (configurable), 60-minute exam (configurable).
Single active exam assumed for this timeline; schema is multi-exam ready.

> **Reality check on scale:** 700 users answering 60 MCQs over an hour is a *light*
> steady-state load. The only spikes are **t=0** (everyone fetches questions) and **t=end**
> (everyone auto-submits). Two API nodes are for redundancy, not throughput. Load testing
> exists to prove resilience and find config limits (pools, file descriptors, ALB timeouts).

---

## 2. Architecture

```
  CENTER (per PC)                 CLOUD (AWS)                          ADMIN
 ┌───────────────┐         ┌──────────────────────────┐        ┌──────────────┐
 │ Electron app  │  HTTPS  │   ALB (TLS term)         │  HTTPS │ Next.js admin│
 │ (kiosk)       │◄───────►│        │                 │◄──────►│ (Vercel/EC2) │
 │ - local SQLite│   WSS   │   ┌────┴────┐  ┌────────┐│        └──────────────┘
 │   write-buffer│         │   │ Bun API │  │ Bun API││
 │ - countdown   │         │   │ node 1  │  │ node 2 ││  (stateless, N+1)
 └───────────────┘         │   └────┬────┘  └───┬────┘│
                           │        └─────┬─────┘     │
                           │        ┌─────┴─────┐     │
                           │        │  Redis    │  (sessions, deadlines,
                           │        │ElastiCache│   leaderboard, pub/sub,
                           │        └─────┬─────┘   rate-limit, idempotency)
                           │        ┌─────┴─────┐  │
                           │        │RDS Postgres│ (Multi-AZ, source of truth)
                           │        └───────────┘  │
                           └──────────────────────────┘
```

**Why:** stateless API nodes behind an ALB give failover + trivial scale. Redis absorbs the
read-heavy hot path so RDS only takes durable writes. Clients buffer locally so the network
can disappear without data loss.

---

## 3. Tech stack & risk flags

| Layer | Choice | Notes |
|---|---|---|
| Desktop | Electron + React + Vite + TS | `contextIsolation: true`, `nodeIntegration: false`, DevTools off in prod, kiosk/fullscreen, code-signed. |
| Client local store | SQLite (`better-sqlite3`) | Write-ahead buffer for answers + session; robust under power loss. |
| Backend | **Bun + Express** | ⚠️ See caveat below. |
| DB | PostgreSQL on RDS (Multi-AZ) | Use a pooler (PgBouncer or built-in pool). |
| Cache/realtime | Redis (ElastiCache; container locally) | Sessions, deadlines, leaderboard (sorted set), WS pub/sub, idempotency, rate limiting. |
| Admin | Next.js / React | |
| Load balancer | AWS ALB | TLS termination, health checks, 2× API nodes. |
| Migrations/ORM | Drizzle or Prisma | Type-safe schema + migrations. |
| Load testing | k6 (+ custom Electron-flow simulator) | login→fetch→answer→submit for 700+ VUs. |
| Monitoring | CloudWatch + pino structured logs | Alarms on error rate, latency, DB connections. |

### ⚠️ Bun + Express compatibility caveat
Express runs on Bun via its Node-compat layer, but it is **not 100%** — some Node internals
and middleware touching raw `http`/streams can misbehave. Mitigations:

- **Pin exact Bun + Express versions** on Day 0; never float them.
- Keep route handlers **thin and framework-agnostic** (business logic in plain functions, not
  buried in middleware) so a swap to Hono/Fastify is hours, not a rewrite.
- **Smoke-test the real middleware stack on Bun in the first 2 days** (JWT auth, body parsing,
  rate-limit, CORS, WS) before building on top of it. Don't discover a gap on Day 9.

---

## 4. Core subsystems (the hard parts)

### 4a. Authoritative timing & sync
- **Per-participant start.** `started_at` is stamped server-side when the participant begins the
  exam (the Begin action after login), and `deadline_at = started_at + duration + extra_time`.
  Each participant runs their own clock, so two students who begin at different times finish at
  different wall-clock times.
- **Availability window with hard close.** The exam carries `available_from` and
  `available_until`. A participant may only begin within the window, and no session can run past
  `available_until` regardless of individual deadline, so `effective_deadline = min(deadline_at,
  available_until)`. This bounds the whole event for staff and infrastructure.
- **Server is the only clock.** The client clock is never trusted.
- **NTP-style offset:** client calls `GET /time` a few times, computes
  `offset = serverTime - (localTime + rtt/2)`, renders countdown against `deadline_at`
  corrected by offset. Re-syncs every heartbeat.
- **Every heartbeat returns** `remainingSeconds`, `serverTime`, `deadline_at`, `status`;
  client reconciles — drift, sleep/wake, and clock tampering self-correct.
- **Enforcement is server-side, judged by `answered_at` not arrival time.** The server accepts a
  write if the answer was *stamped* (`answered_at`) at or before `effective_deadline + grace`
  (~10s for skew), even if it arrives slightly late. This is deliberate: a client that goes
  offline right at the deadline can still sync its buffered, before-deadline answers on
  reconnect or at auto-submit, so nothing legitimate is lost. Answers genuinely created after
  the deadline are rejected, so a hacked client that keeps its timer running gains nothing.
- **"Add time"** = admin updates `deadline_at` / `extra_time_seconds`; pushed via WS and also
  picked up on the next heartbeat.

### 4b. Failure & offline resilience
**Principle: optimistic local-first writes + idempotent server upserts + server-authoritative recovery.**

- Answer or flag change → instant local SQLite write
  (`session_id, question_id, selected_option_ids, status, client_seq, answered_at, synced=0`).
- **Two-tier sync:** each change is pushed promptly (debounced) AND every `synced=0` record is
  re-sent on the **heartbeat (10 to 15s)** as a safety net. Server upserts idempotently on
  `unique(session_id, question_id)` and returns `acked[]`; client marks synced. A dropped
  network only delays sync; nothing is lost. Prompt per-change push matters specifically for
  the PC-change case, where the local buffer dies with the old machine and only server-synced
  state survives.
- **Stale-write protection (monotonic upsert):** the client stamps each change with a
  per-session monotonic `client_seq`. The server applies an upsert **only if the incoming
  `client_seq` is greater than the stored one**, otherwise it ignores it as `acked`. Without
  this, a retried older request arriving after a newer one would silently overwrite the newer
  answer. This is a correctness requirement, not an optimization.
- **Same-device crash / power loss → relaunch → `POST /resume`:** local SQLite still holds the
  buffer, so no synced or unsynced state is lost. Server is authoritative on conflict.
- **Different-device resume (hardware failure, participant moved):** on login the server finds
  the existing `in_progress` session, re-binds it to the new `device_fingerprint`, issues a
  fresh JWT, and logs an `integrity_event` of type `device_change` for proctor review.
  Optionally gate this behind an admin "release device binding" action for stricter control.
- **`POST /resume` returns, as source of truth:** `shuffle_seed` plus the ordered manifest (so
  order is identical on the new machine), all saved answers with their `status`, `deadline_at`,
  and `remainingSeconds`. The countdown resumes against the fixed deadline, so a PC change does
  not grant extra time. Time genuinely lost to hardware failure is compensated by an admin
  "add time" grant (audited).
- **Backend restart:** clients keep buffering, retry with backoff, reconnect, replay
  (idempotent → safe).
- **Fairness rule:** wall clock keeps running during a local outage (else a student could yank
  the cable to stop the timer). Genuine center-wide outages → **admin grants extra time**
  (a logged human decision).

### 4c. Anti-cheat / hack-proofing
| Threat | Mitigation |
|---|---|
| Reading correct answers in client | `is_correct` **never** leaves the server. Grading is 100% server-side. |
| DevTools / reverse engineering | DevTools off in prod, context isolation on, no node integration in renderer, code-signed, ASAR (packaging only). |
| Forged score submission | Client cannot submit scores — only answers. Score = server-computed; edits only via authenticated, audited admin endpoint. |
| Self-extending time | `deadline_at` server-side only; client input ignored. |
| Replay / forged requests | Short-lived session JWT bound to participant + device fingerprint; TLS; idempotency keys; server checks ownership. |
| Credential sharing / double login | One active session per participant; device-bound on first login; second login blocked + integrity event. |
| Question leakage | Storage encryption at rest (RDS) + strict DB access control; questions released only when the participant begins; per-participant 60-of-100 subset + seeded shuffle. App-level field encryption is intentionally NOT used (key-management cost without real benefit here). |
| Reverse-engineering display order to find answers | Answers persisted by stable `option_id`, never display position, so shuffle is purely presentational and leaks nothing. |
| MITM / packet capture | TLS 1.2+ with the system trust store. Certificate pinning is deferred (Phase 2): on a short timeline a bad pin or routine cert rotation can brick every client in the field, which outweighs its marginal benefit on-center. |
| Leaving the app / alt-tab | Kiosk fullscreen; capture focus-loss → on-screen warning + `integrity_event` for proctor review. No auto-action. |

### 4d. Scale & the thundering herd
- **Fetch load is naturally staggered:** with per-participant start, manifest fetches spread
  across the time participants begin rather than hitting one t=0 spike. The full bank is the
  same for everyone, so cache it once in Redis/in-memory; the per-session 60-of-100 subset and
  ordering are computed cheaply from the seed per request, without hitting RDS per participant.
- **Submit load is also staggered** by per-participant deadlines; auto-submit still adds a small
  **jitter** as a safety net. Submissions are tiny idempotent writes.
- **Connection hygiene:** tune Bun/Express pool, RDS `max_connections`, PgBouncer, OS file
  descriptors, ALB idle timeout > heartbeat interval.
- **Heartbeat over WS for the exam path** — fewer failure modes; WS only for admin live view.

### 4e. Randomization and per-question state

**Subset selection.** At Begin, the server uses the session `shuffle_seed` to deterministically
draw 60 question IDs from the exam's 100-question bank, and **freezes that list on the session**
(`served_question_ids`). Freezing, rather than re-deriving on each request, guarantees the subset
never changes across resume even if the bank is edited mid-event. Grading and `max_score` are
computed over the served subset only.

> Honest note on the leak mitigation: a 60-of-100 draw still gives two participants roughly 36
> questions in common on average, so this reduces but does not eliminate overlap. The real
> control remains proctoring policy (no early departure, no devices). A larger bank (150 to 200)
> would sharpen the effect if authoring capacity allows.

**Seed is server-authoritative, not derived from credentials.**
- At session start the server generates a random `shuffle_seed`, stores it on `exam_sessions`,
  draws the subset, applies the deterministic shuffle to the served questions and their options,
  and returns the manifest already in the participant's order with stable IDs.
- On any resume, including a different device, the same seed returns the same order.
- Do NOT derive the seed from username and password: credential material must not be reused as
  a function input, and a credential reset would silently change the order. Server-side seeding
  removes both problems and avoids the client and server disagreeing on the shuffle algorithm.
- Server-side shuffling is preferred over client-side: the payload is tiny and computed once,
  so there is no performance reason to push it to the client, and a single source of truth for
  ordering is more maintainable.

**Integrity is independent of order.** Every answer is persisted by stable `question_id` and
`option_id`, never by display position. The shuffle is therefore purely presentational and
cannot affect grading, storage, or resume.

**Per-question navigation state.** Each question carries an explicit status, synced alongside
the selected options:

| Status | Meaning |
|---|---|
| `not_visited` | Never opened |
| `not_answered` | Opened, left without selecting |
| `answered` | Option(s) selected |
| `marked_for_review` | Flagged, no selection |
| `answered_marked` | Flagged and selected |

The server therefore always holds the count and status of every question, which is exactly the
state restored on resume.

---

## 5. Student authentication flow

1. Admin bulk-imports participants (CSV) → each row assigned a secret; store only `credential_hash`.
2. Student enters `roll + secret` → server issues short-lived session JWT **bound to a device
   fingerprint** captured on first login.
3. **One active session per participant.** A second login from another device is blocked and
   raises an integrity event (proctor resolves physically). Re-login on the **same** device
   after a crash is allowed → that's the `/resume` path.
4. **Timer starts on Begin, not on login.** After login the participant lands in the lobby; the
   clock starts only when they explicitly begin, which stamps `started_at`. Begin is allowed
   only while the exam is within its availability window.

---

## 6. Data model (lock Day 1)

```sql
exams(id, title, duration_seconds, questions_to_serve, available_from, available_until,
      status[draft|open|closed], results_published[bool], shuffle_questions, shuffle_options,
      created_by)
      -- The full question bank is the set of `questions` rows for this exam (e.g. 100);
      --   questions_to_serve (e.g. 60) is the per-session subset size.
      -- Locked policy: no negative marking, all-or-nothing. negative_marks kept on questions
      --   for a future configurable engine but unused now. results_published gates visibility.

questions(id, exam_id, type[SCQ|MCQ], text, media_url, marks, negative_marks, active)

options(id, question_id, text, is_correct)        -- is_correct NEVER serialized to client

participants(id, exam_id, identifier/roll, name, center, seat, credential_hash, status)

exam_sessions(id, participant_id, exam_id, started_at, deadline_at, extra_time_seconds,
      submitted_at, status[not_started|in_progress|submitted|auto_submitted|disqualified],
      shuffle_seed, served_question_ids[], device_fingerprint, ip)
      -- shuffle_seed: server-generated at Begin, NOT derived from credentials; guarantees the
      --   same subset and order on any device, including after resume.
      -- served_question_ids: the frozen 60-of-100 subset for this session; grading uses it only.

answers(id, session_id, question_id, selected_option_ids[], status, answered_at, client_seq, synced)
      -- status: not_visited | not_answered | answered | marked_for_review | answered_marked
      -- selected_option_ids reference stable server option IDs, never display position.
      UNIQUE(session_id, question_id)             -- idempotent upsert key

results(session_id, score, max_score, correct, wrong, unanswered, rank, percentile, graded_at)

admins(id, email, password_hash, role, mfa_secret)

audit_logs(id, actor, action, target, before_json, after_json, ts)   -- score edits, time grants, resets

integrity_events(id, session_id, type[focus_lost|reconnect|resume|double_login|device_change|...], ts, meta)
```

---

## 7. API contract (lock Day 1)

### Client
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | `{roll, secret}` → session JWT, exam meta, availability window. No timer yet (lobby). |
| POST | `/exam/begin` | Stamps `started_at`, sets `deadline_at`, allocates `shuffle_seed`. Allowed only inside the availability window. Idempotent: re-calling returns the existing session. |
| GET | `/exam/manifest` | Questions **without** `is_correct`, already ordered by `shuffle_seed`, with stable question/option IDs. Available only after Begin. |
| GET | `/time` | Server time for offset calc. |
| POST | `/exam/heartbeat` | `{answers[] (each w/ status), clientTime}` → `{remainingSeconds, serverTime, acked[], deadline_at, status}`. |
| POST | `/exam/answer` | Per-change idempotent upsert (selected options + status); also batched on heartbeat. |
| POST | `/exam/submit` | Finalize (also triggered automatically at deadline). Returns a submission confirmation only, never the score. |
| POST | `/exam/resume` | Server-authoritative state: `shuffle_seed` + ordered manifest, saved answers + status, `deadline_at`, `remainingSeconds`. |

### Admin (auth + MFA)
| Method | Path | Purpose |
|---|---|---|
| — | CRUD | exams / questions |
| POST | `/admin/participants/import` | bulk CSV import |
| GET | `/admin/leaderboard` | paged + live via WS |
| PATCH | `/admin/result/:id` | edit score (audited) |
| POST | `/admin/session/:id/reset` | reset a participant's test |
| POST | `/admin/time/grant` | add time (one participant **or** all); optionally extends `available_until` too, since the hard close otherwise caps the grant |
| POST | `/admin/exam/:id/open` · `/close` | open/close the availability window |
| POST | `/admin/exam/:id/publish-results` | flip `results_published`; until then results and leaderboard are admin-only |
| GET | `/admin/integrity-events` | review focus-loss / double-login / device-change events |
| GET | `/admin/export` | results export |

Every mutating admin action writes an `audit_log`.
Student score is never exposed by any client endpoint; results visibility is gated by
`results_published` and surfaced only through admin endpoints until published.

---

## 8. Client state machine (Electron app spec)

```
LAUNCH → AUTH → LOBBY(in window, not started) → BEGIN(stamps started_at) → IN_EXAM ⇄ OFFLINE_BUFFERING
                                                                              │
                                              ├─ same-device relaunch → RESUME(local + server) → IN_EXAM
                                              ├─ different-device login → REBIND(+integrity_event) → RESUME(server) → IN_EXAM
                                              └─ deadline/manual → SUBMITTING → SUBMITTED(confirmation only, locked)
```

Each transition is persisted in local SQLite so any relaunch lands in the correct state.
On a different device the local buffer is gone, so RESUME relies on server-synced state only.

---

## 9. Plan of action — 10–12 days (local-first → cloud)

Parallel workstreams: **BE** backend · **CL** client · **AD** admin · **INF** infra/QA.
Compresses/expands with team size.

### Scope tiers (protects the timeline)

The timeline is the dominant risk, so scope is tiered. **Tier 1 must ship; Tier 2 ships only
after Tier 1 is solid** and can slip without preventing a correct, fair exam.

- **Tier 1 (non-negotiable integrity path):** auth, Begin, subset + manifest, answer sync with
  monotonic guard, server-side grading, deadline enforcement by `answered_at`, resume
  (same-device and device-change), and the admin utilities (leaderboard, edit score, reset,
  add time, open/close, publish results, audit log). Plus load and chaos testing.
- **Tier 2 (hardening, defer if needed):** code signing (start certificate procurement on day 0
  regardless, since issuance is slow), full kiosk lockdown, and any later strengthening. TLS is
  Tier 1; certificate pinning is explicitly out of scope (see §4c).

| Days | Phase | Deliverables |
|---|---|---|
| **0–1** | Foundations | Monorepo, schema + migrations, auth, app skeletons, `docker-compose` (Postgres+Redis), seed script (1 exam + 700 fake participants), CI. **Smoke-test Bun+Express middleware stack.** |
| **2–4** | Core flow (local, e2e) | Login → manifest fetch → answer → heartbeat + time sync → submit → server-side grade. Admin CRUD + basic leaderboard. *Milestone: one full exam runs locally.* |
| **4–6** | Resilience | Local write-buffer, `/resume`, auto-submit w/ jitter, reconnect/backoff, server-side deadline enforcement. Admin utilities: add-time, reset, edit-score, audit log. |
| **6–8** | Hardening | Electron kiosk/lockdown, anti-tamper, TLS + cert pinning, rate limiting, idempotency, validation, integrity events + on-screen warning. |
| **8–10** | Cloud + load | EC2 + RDS(Multi-AZ) + ElastiCache + ALB + secrets + CloudWatch. k6 load test 700→1500 VUs, tune pools/limits. |
| **10–12** | Dress rehearsal + buffer | Full mock exam at scale; chaos drills (kill a node mid-exam, drop a client's network, fail over RDS); backup/restore drill; **operations runbook**; bug-fix buffer. |

**Efficiency levers:** lock data model + API contract Day 1; idempotent-everything from the
start; one shared TypeScript types package across all apps; feature-flag risky bits; write
load/chaos tests early so regressions surface immediately.

---

## 10. Local testing setup (starting phase)

- `docker-compose up` → Postgres + Redis. Bun/Express API on localhost, Next admin on
  localhost, Electron dev pointing at it.
- Seed script generates 700 fake participants + a 60-Q exam.
- **Fast-clock test mode** (env-flag time multiplier) to validate the 1-hour timer,
  auto-submit, and add-time in seconds.
- Run **k6 against localhost first** to shake out logic, then re-run in cloud for real numbers.
  Same compose stack is the CI integration target.

---

## 11. Failure-mode matrix (edge cases)

| Failure | Behavior |
|---|---|
| WiFi drops mid-exam | Answers buffered locally; sync on reconnect; timer keeps running. |
| PC power loss | Relaunch → `/resume`; answers restored from server; timer resumes against fixed deadline. |
| Backend node dies | ALB routes to healthy node; clients retry; stateless + Redis = no session loss. |
| RDS failover | Multi-AZ promotes standby; clients retry during the ~30–60s blip (buffered). |
| Client clock wrong/changed | Server `remainingSeconds` overrides every heartbeat. |
| Duplicate/replayed submit | Idempotency key → no double effect. |
| Center-wide outage | Proctor reports → admin grants extra time (audited). |
| Whole exam needs more time | Admin "add time to all". |

---

## 12. Security checklist

- [ ] `is_correct` never serialized to any client response.
- [ ] All grading server-side; client submits answers only.
- [ ] `deadline_at` server-side only; client time advisory.
- [ ] Server rejects writes after `deadline_at + grace`.
- [ ] Short-lived session JWT, device-bound, one active session/participant.
- [ ] TLS 1.2+ everywhere via system trust store (pinning deferred to Phase 2).
- [ ] Idempotency keys on answer/submit; monotonic `client_seq` guard against stale overwrites.
- [ ] Deadline enforced by `answered_at`, not arrival time, so before-deadline buffered answers sync.
- [ ] Rate limiting + input validation on every endpoint.
- [ ] Admin MFA; all admin mutations audited.
- [ ] Storage encryption at rest (RDS) + DB access control; manifest served only after Begin.
- [ ] Score never returned to any client; results gated by `results_published`.
- [ ] Electron: context isolation on, node integration off, DevTools off in prod, code-signed.
- [ ] Secrets in AWS Secrets Manager / SSM, never in repo.

---

## 13. Top recommendations (TL;DR)

1. **Untrusted client** — server grades, owns the clock, enforces deadlines. Non-negotiable.
2. **Idempotent local-first writes + `/resume`** — this is what makes it truly fail-proof.
3. **Don't over-engineer scale** — 700 is small; spend the saved effort on resilience + chaos testing.
4. **Heartbeat over WebSocket** for the exam path; WS only for admin live view.
5. **Lock schema + API contract Day 1** to avoid rework on a 10-day clock.
6. **Build the fast-clock test mode and load/chaos tests early.**

---

## 14. Open items / Phase-2 backlog

- Center-local relay server (only if a center proves network-flaky).
- Read replica for admin leaderboard if read load grows.
- Configurable scoring engine (negative marking, MCQ partial credit). Current policy is fixed:
  no negative marking, all-or-nothing.
- Larger question bank (150 to 200) to further reduce subset overlap, if authoring allows.
- Certificate pinning, code signing follow-through, full kiosk lockdown (Tier 2).
- Multiple concurrent exams / multi-tenant centers (schema ready, not exercised this phase).
- Disqualification policy escalation (currently warn-only).
