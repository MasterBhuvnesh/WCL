# WCL test suite

Load, correctness, and chaos testing for the on-center exam system. Everything
here runs against a **live API** — there is no mocking. Start the stack, seed
it, point the tests at it.

```
tests/
  load/exam-flow.js          k6 load test: full candidate lifecycle, 10..1500 VUs
  integration/               plain `bun run` correctness scripts (assert-style)
    _lib.ts                  shared fetch/login/assert helpers + API contract
    resume.test.ts           same-device + different-device (strict-binding) resume
    stale-write.test.ts      monotonic client_seq guard
    deadline.test.ts         deadline enforcement + auto-submit (fast-clock)
    offline-sync.test.ts     before-deadline buffered answers sync at the boundary
  README.md
```

---

## 1. Bring up the stack

From the repo root:

```bash
docker compose up -d                 # Postgres + Redis
cd app/api
bun install
bun run db:migrate                   # apply Drizzle migrations
bun run seed                         # 1 exam (WCL-EXAM), 100-Q bank, 700 candidates, 1 admin
#   bun run seed --fresh             # wipe + reseed (needed before a repeat load run)
```

**Seeded credentials** (see `app/api/src/seed.ts`):

| Who | Username / email | Secret | Notes |
|---|---|---|---|
| Candidates | `user001` .. `user700` | `wclrbu2026` | exam id `WCL-EXAM`, all share the common exam password |
| Admin | `admin@wcl.local` | `adminpass` | no TOTP by default |

The exam bank is 100 questions; each session is served a frozen 60-question
subset. Duration is 3600s (1 hour) of real time.

### Run the API

```bash
cd app/api
bun run dev                          # or: bun src/index.ts   (listens on :4000)
```

Key env vars (`app/api/src/env.ts`, all have dev defaults):

| Var | Default | Why it matters for tests |
|---|---|---|
| `PORT` | `4000` | API port; matches `BASE_URL` below |
| `DATABASE_URL` | `postgres://wcl:wcl@localhost:5432/wcl` | from docker compose |
| `REDIS_URL` | `redis://localhost:6379` | from docker compose |
| `CLOCK_MULTIPLIER` | `1` | **fast-clock**: exam time runs this many times faster. `360` makes the hour last 10s. Required for the deadline / offline-sync tests. |

> The deadline and offline-sync tests need a **short** exam. Run a dedicated API
> instance with a fast clock, e.g. `CLOCK_MULTIPLIER=360 bun src/index.ts`
> (=> 10s exam), and point those two tests at it. The resume and stale-write
> tests are timing-independent and run fine against a normal-clock instance.
> A convenient split is two instances: one real-clock, one fast-clock on a
> second `PORT`.

---

## 2. Integration correctness scripts

Each is a standalone `bun run` script; no framework. They exit non-zero on any
failed assertion, `2` if a fast-clock test finds the exam window too long to
wait out.

```bash
# Real-clock instance (e.g. :4000) — timing-independent:
BASE_URL=http://localhost:4000 bun tests/integration/resume.test.ts
BASE_URL=http://localhost:4000 bun tests/integration/stale-write.test.ts

# Fast-clock instance (CLOCK_MULTIPLIER=360, e.g. :4600) — needs a short exam:
BASE_URL=http://localhost:4600 bun tests/integration/deadline.test.ts
BASE_URL=http://localhost:4600 bun tests/integration/offline-sync.test.ts
```

They are **re-runnable**: each resets its candidate's session first via the
admin API (`/admin/sessions/:id/reset` + `/admin/sessions/:id/release-device`),
so no `seed --fresh` is required between runs. Dedicated candidates
`user695`..`user698` are used so they never collide with a low-numbered load run
(override with `RESUME_USER` / `STALE_USER` / `DEADLINE_USER` / `OFFLINE_USER`).

Env knobs (all optional, sane defaults): `BASE_URL`, `EXAM_ID`,
`PARTICIPANT_PW`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

What each proves:

- **resume** — after a fresh login (simulated relaunch) `/exam/resume` returns
  the identical `shuffle_seed`, ordered manifest, saved answers, and deadline.
  Different-device: while bound, a new device is **blocked** (409) with a
  `device_change` (allowed:false) integrity event; a proctor `release-device`
  then lets the new device re-bind and resume against the **same** deadline
  (no extra time), logging `device_change` (allowed:true).
- **stale-write** — a lower `client_seq` never overwrites a higher one. Note the
  server still ACKs a stale write (so the client stops retrying) but ignores it
  at the DB level, so the test checks the **stored** state via resume, not the ack.
- **deadline** — answers stamped after `deadline + grace` (10s) are rejected;
  the session auto-finalizes (`auto_submitted`); `/exam/submit` afterwards
  returns the already-finalized status without re-opening or re-grading.
- **offline-sync** — answers stamped *before* the deadline but pushed in a batch
  *after* it (within grace) are accepted and persisted; an answer stamped after
  `deadline + grace` in the same batch is dropped. Enforcement is by
  `answered_at`, not arrival time.

---

## 3. k6 load test

Install k6 (not bundled): https://grafana.com/docs/k6/latest/set-up/install-k6/
(`brew install k6`, `choco install k6`, `winget install k6`, or the Docker image
`grafana/k6`).

```bash
# Smoke first (10 VUs) — proves the flow end to end:
SCENARIO=smoke k6 run tests/load/exam-flow.js

# Full load (default 700 VUs, one iteration each):
k6 run tests/load/exam-flow.js

# Scale up (seed has 700 participants; >700 VUs reuse usernames — see below):
VUS=1500 k6 run tests/load/exam-flow.js

# Against cloud:
BASE_URL=https://api.example.com VUS=1500 k6 run tests/load/exam-flow.js
```

Each VU is a distinct seeded candidate (`user001`..`user700`, wrapping for
`VUS > 700`) running login → begin → manifest → answer loop (monotonic
`client_seq`, interleaved heartbeats) → submit exactly once. Thresholds:
`http_req_duration p95 < 800ms` (tune with `P95_MS`) and unexpected-error
`rate < 0.01` (`ERROR_RATE`). Other knobs: `ANSWERS`, `HEARTBEAT_EVERY`,
`THINK_MS`.

**Re-runs need a clean slate.** A candidate that has submitted returns 409 on the
next login, so `bun run seed --fresh` (or reset sessions) before each full run.
For `VUS > 700`, wrapped usernames collide within the same run — raise the
participant count in `seed.ts` for a true 1500-unique run.

### localhost-first, then cloud (per the plan, §10)

1. **Smoke on localhost** (`SCENARIO=smoke`) to shake out logic and the contract.
2. **Full load on localhost** to find app-level limits (DB pool `DB_POOL_MAX`,
   Redis, file descriptors) — the numbers are not representative, the *failures*
   are.
3. **Re-run in the cloud** against the ALB for real latency/throughput numbers,
   then tune pools, RDS `max_connections`, PgBouncer, ALB idle timeout
   (> heartbeat interval), OS fd limits.

> **Per-IP rate limiting caveat.** The API rate-limits per client IP
> (`/auth/login` 10/min, exam routes 300/min — see `http/middleware.ts`). From a
> single load-gen host **all VUs share one IP**, so a localhost 700-VU run will
> be throttled with 429s. The k6 script counts 429s as `rate_limited` (visible)
> rather than `errors`, so thresholds stay meaningful, but for real numbers you
> must run **distributed** (k6 Cloud or several agents, one IP each) or use a
> test build with the limits raised. Expect ~0 `rate_limited` in a proper
> distributed run; a high count on localhost is the single-IP artifact, not a bug.

---

## 4. Chaos-drill playbook

Not automatable here — these are procedures to run against real (or staging)
infra during a mock exam with live VUs. Goal: prove **no answer is lost and no
one gains time**. Run each with a k6 load in the background and the admin
session monitor (`/admin/sessions`) open.

### Drill A — kill an API node mid-exam

1. Start a full load run; confirm two API nodes are healthy behind the ALB.
2. Mid-exam, `kill -9` (or stop the container / terminate the instance) of one node.
3. **Expect:** ALB health check ejects it within its interval; in-flight requests
   to that node fail once and clients retry (buffered locally); the other node
   absorbs traffic. Sessions live in Redis + Postgres, not node memory, so
   nothing is lost.
4. **Verify:** k6 error rate blips then recovers; no session stuck; on submit,
   answer counts match what was sent. Bring the node back and confirm it rejoins.

### Drill B — drop a client's network

1. Pick one live client (or one k6 VU segment). Sever its network mid-exam
   (pull the cable / block egress) for 30–60s, then restore.
2. **Expect:** the client keeps buffering answers locally and the wall clock
   keeps running (fairness — yanking the cable must not stop the timer). On
   reconnect it replays unsynced answers on the next heartbeat (idempotent).
3. **Verify:** buffered answers stamped before the deadline sync and count
   (this is exactly what `offline-sync.test.ts` proves in miniature); the
   deadline did not move.

### Drill C — RDS failover

1. During load, trigger a Multi-AZ failover (RDS reboot-with-failover).
2. **Expect:** a ~30–60s write blip while the standby is promoted; clients retry
   with backoff and buffer; Redis-cached reads (sessions, deadlines, bank)
   keep the hot path alive.
3. **Verify:** after the blip, writes resume; no duplicate results (finalize is
   idempotent — atomic `in_progress → submitted` claim); leaderboard consistent;
   answer counts intact. Note the observed blip duration for the runbook.

For a genuine center-wide outage the remedy is an **audited admin time grant**
(`/admin/exams/:id/add-time`), not code — verify that path grants time and
extends `available_until`.

---

## 5. Dress-rehearsal checklist

Full mock exam at scale before the real event (plan §9, days 10–12).

**Before**
- [ ] Cloud stack up: 2 API nodes, ALB (idle timeout > heartbeat), RDS Multi-AZ,
      ElastiCache, secrets in SSM/Secrets Manager.
- [ ] `seed --fresh` with the real participant count; admin account + MFA set.
- [ ] CloudWatch dashboards + alarms live (error rate, p95 latency, DB connections).
- [ ] Pools tuned: `DB_POOL_MAX`, RDS `max_connections`, PgBouncer, OS fd limits.
- [ ] `CLOCK_MULTIPLIER=1` (real time) confirmed in the exam environment.
- [ ] Backup taken; restore procedure rehearsed at least once.
- [ ] Client build pinned and distributed to centers; kiosk lockdown verified.

**During**
- [ ] Smoke (`SCENARIO=smoke`) against the cloud URL passes.
- [ ] Full load run (700 → 1500 VUs, distributed) meets p95 and error thresholds.
- [ ] Watch the t=0 manifest herd and the t=end submit burst on the dashboards.
- [ ] Run chaos drills A, B, C; each recovers with zero lost answers.
- [ ] Exercise admin ops: add-time (one + all), session reset, release-device,
      integrity-event review, open/close, publish results, CSV export.

**After**
- [ ] Answer/result counts reconcile (submitted sessions == graded results).
- [ ] No sessions stuck `in_progress` past `available_until`.
- [ ] Latency/error graphs archived; limits that were hit recorded in the runbook.
- [ ] Results export verified; publish-results toggle gates visibility correctly.
- [ ] `seed --fresh` to clear rehearsal data before the real exam.
