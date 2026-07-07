# OPERATIONS RUNBOOK

Operational procedures for running one exam event on the WCL system. Covers the
checklist's OPERATIONS AND RUNBOOK section: **start, monitor, intervene, close,
backup/restore**.

Scope of the current build:

- The API (`app/api`) is the real production backend: PostgreSQL + Redis + WS.
- The admin panel (`app/admin`) ships the **results dashboard, per-candidate
  review, CSV export**, and an operations UI under `/admin` (login+MFA,
  questions, exam open/close/publish, participant import, live leaderboard,
  sessions with reset/add-time/score-edit, integrity events). Every control is
  also available as `curl` below — the runbook documents the API form so it
  works even if the panel is down. For the exact request and response body of
  every route, see [API.md](API.md).
- Anything AWS (ALB, RDS, ElastiCache, CloudWatch) is **production only /
  pending** — not built. Sections that need it say so explicitly.

Conventions used below:

```bash
API=http://localhost:4000          # production: your ALB https URL
EXAM=WCL-EXAM                       # the exam id (DEFAULT_EXAM_ID)
# Obtain an admin token once; reuse it as $TOKEN for every admin call.
TOKEN=$(curl -s $API/admin/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@wcl.local","password":"adminpass"}' | jq -r .token)
# If the admin has TOTP enrolled, add "totp":"123456" to the login body.
AUTH="authorization: Bearer $TOKEN"
```

---

## 1. START (pre-exam bring-up)

Run from repo root unless a step says `app/api`.

1. **Bring up Postgres + Redis:**
   ```bash
   docker compose up -d
   docker compose ps          # both wcl-postgres and wcl-redis must be healthy
   ```
   Wait until STATUS shows `healthy` (compose healthchecks: `pg_isready`,
   `redis-cli ping`).

2. **Install + migrate + seed** (first bring-up, or after `--fresh`):
   ```bash
   cd app/api
   bun install
   bun run db:migrate         # applies committed drizzle migrations
   bun run seed               # 1 exam (WCL-EXAM), 100-Q bank, 700 participants, 1 admin
   # bun run seed --fresh     # ONLY to wipe everything and reseed. Never on exam data.
   ```
   Real participants/questions replace the seed via
   `POST /admin/participants/import` and `POST /admin/questions` (see §3).

   **Production: skip `bun run seed` entirely.** With `NODE_ENV=production`
   the API self-initializes on first boot: it creates the admin account
   (`ADMIN_EMAIL`/`ADMIN_PASSWORD` from env) and the exam (`EXAM_ID`,
   `EXAM_TITLE`, `EXAM_DURATION_SECONDS`, `EXAM_QUESTIONS_TO_SERVE`),
   created **closed** — open it via §3.1 when the event starts. The server
   refuses to boot with the default `ADMIN_PASSWORD` or `JWT_SECRET`.
   Existing rows are never modified; changing `ADMIN_PASSWORD` later does
   not update an existing admin. Then load questions and participants via
   the admin panel or the two endpoints above.

3. **Start the API node(s):**
   ```bash
   cd app/api
   bun run start             # production: NODE_ENV=production, real JWT_SECRET
   ```
   - Production `.env` MUST override: `JWT_SECRET` (long random), `DATABASE_URL`,
     `REDIS_URL`, `NODE_ENV=production`. Confirm `CLOCK_MULTIPLIER=1` — a leftover
     fast-clock value silently shortens every exam. Log line at boot prints
     `clockMultiplier`; verify it reads 1.
   - Two nodes = redundancy (per plan). They are stateless; run the same command
     on each behind the load balancer. No shared local state.

4. **Start the admin panel:**
   ```bash
   cd app/admin
   bun install && bun run dev     # or bun run build && bun run start; port 5000
   ```

5. **Pre-exam smoke checks:**
   ```bash
   curl -s $API/health            # {"status":"ok",...}   (liveness only, see note)
   curl -s $API/time              # {"serverTime":"..."}  clock sanity
   curl -s $API/admin/login -H 'content-type: application/json' \
     -d '{"email":"admin@wcl.local","password":"adminpass"}'   # returns a token
   curl -s $API/admin/sessions -H "$AUTH" | jq .counts         # all zero pre-exam
   ```
   > NOTE: `/health` is **liveness only** — it does not probe DB or Redis. Prove
   > those with `docker compose ps` and one real admin call (`/admin/sessions`,
   > which hits both Postgres and Redis).

6. **Open the availability window** (allows candidate login + begin):
   ```bash
   curl -s $API/admin/exams/$EXAM/open -X POST -H "$AUTH"    # {"ok":true,"isOpen":true}
   ```
   > GAP: `open` only flips `isOpen`. The window bounds `available_from` /
   > `available_until` have **no admin endpoint** — the seed leaves them null
   > (login allowed whenever `isOpen`). To enforce a hard start/close time you
   > must set those columns directly in the DB (or via seed) before the event.
   > Flag this if a hard window is required.

---

## 2. MONITOR (during the exam)

Watch these continuously. "Healthy" is stated per signal.

1. **Health / node liveness** — every node:
   ```bash
   watch -n5 'curl -s $API/health'
   ```
   Healthy: HTTP 200 `status:ok` from every node. Any node non-200 → treat as
   dead (§3.6).

2. **Session status counts:**
   ```bash
   watch -n15 'curl -s $API/admin/sessions -H "$AUTH" | jq .counts'
   ```
   Returns `{not_started, in_progress, submitted, auto_submitted}`.
   Healthy shape over the event: `not_started` drains → `in_progress` rises →
   late on, `submitted` rises. Watch for:
   - `in_progress` stuck high past the window end → auto-submit sweep or a node
     is wedged.
   - A spike in `auto_submitted` vs `submitted` → many clients not submitting
     manually (network); expected somewhat, investigate if large.

3. **Live leaderboard WS** (confirms pub/sub fan-out and scoring flow):
   ```bash
   # any WS client, e.g. websocat:
   websocat "ws://localhost:4000/admin/ws?token=$TOKEN"
   ```
   Healthy: connects (401 = bad/expired token), streams `{channel,payload}`
   frames as sessions finalize and on add-time. Silence with finishing sessions
   → pub/sub problem.

4. **Integrity events** (proctor review — double-login, focus-loss, device change):
   ```bash
   watch -n30 'curl -s "$API/admin/integrity-events?examId=$EXAM&limit=50" -H "$AUTH" | jq .'
   ```
   Healthy: trickle of `focus_lost`. Escalate: repeated `double_login` for one
   username (credential sharing) → proctor resolves physically (§3.4).

5. **pino logs** (per node):
   ```bash
   # dev: pretty to stdout. production: JSON to stdout — ship to your log sink.
   bun run start 2>&1 | tee /var/log/wcl-api.log     # or your process manager's log
   ```
   Healthy: `auto-submit sweep` at debug, request noise, no `error`-level lines.
   Watch for: `auto-submit: finalize failed`, `PSUBSCRIBE wcl:* failed`, any DB
   connection errors. `LOG_LEVEL=debug` for more detail while diagnosing.

6. **Suggested alarm conditions — PRODUCTION ONLY / PENDING (AWS CloudWatch).**
   None of this is wired yet; documented as targets per plan §3 / infra checklist:
   - **5xx / error rate** > ~1% of requests over 1 min (ALB `HTTPCode_Target_5XX`,
     plus pino `level>=50` count).
   - **Target latency** p95 > ~1s sustained (ALB `TargetResponseTime`).
   - **DB connections** > ~80% of RDS `max_connections` (`DatabaseConnections`) —
     the t=0 begin spike and t=end submit spike are the risk windows.
   - **Unhealthy host count** ≥ 1 (ALB target group) → a node is down (§3.6).
   - **Redis** ElastiCache CPU / evictions / connection count climbing.
   - **RDS failover** event → expect a 30–60s client-retry blip (plan §11).

---

## 3. INTERVENE (incident procedures)

All commands assume `$AUTH` from the top. Every mutating call writes an
`audit_log` automatically. Find a candidate's `sessionId` from `/admin/sessions`
(it lists `sessionId` + `username`).

### 3.1 Add time to ONE participant
```bash
SID=<sessionId>
curl -s $API/admin/sessions/$SID/add-time -X POST -H "$AUTH" \
  -H 'content-type: application/json' -d '{"seconds":600}'
```
`seconds` 1–7200. Session must be `in_progress` (else 409). Pushes new
`deadlineAt` over WS immediately and is picked up on the next heartbeat.

### 3.2 Add time to ALL in-progress participants (center-wide outage)
```bash
curl -s $API/admin/exams/$EXAM/add-time -X POST -H "$AUTH" \
  -H 'content-type: application/json' -d '{"seconds":600}'
```
Extends every in-progress session AND extends `available_until` by the same
amount when it is set (so the hard close does not cap the grant). Returns
`{ok,updated:<n>}`.

### 3.3 Reset a participant session
Wipes answers + result, returns the session to `not_started` (fresh
subset/seed on next begin), clears Redis session/deadline, removes them from the
leaderboard.
```bash
curl -s $API/admin/sessions/$SID/reset -X POST -H "$AUTH"
```
Use for a corrupted session or an authorized restart. Destructive — audited.

### 3.4 Release / rebind device binding
Binding is **strict**: a login from a **different** `deviceId` is blocked with
`409` and logs a `device_change` integrity event (`allowed:false`). Rebinding
requires an explicit proctor action:
```bash
curl -s $API/admin/sessions/$SID/release-device -X POST -H "$AUTH"
```
Audited (`session-release-device`); nulls the binding and clears the Redis
session cache. The candidate then logs in on the new machine — the session
rebinds (logged as `device_change` `allowed:true`), they resume via
`/exam/resume`, and the timer continues against the fixed deadline.
- To fully clear state (suspected sharing / corrupted session): **session
  reset** (§3.3) instead — it wipes answers and binding together.

### 3.5 Handle double-login integrity events
```bash
curl -s "$API/admin/integrity-events?examId=$EXAM&limit=100" -H "$AUTH" \
  | jq '.[] | select(.type=="double_login")'
```
`double_login` = a login arrived while a session was already `in_progress`.
Resolution is **physical/proctoring**, not software: proctor confirms who is the
legitimate candidate at the seat. The rightful device's next heartbeat keeps the
session; if the wrong machine bound it, reset (§3.3) and let the correct
candidate log back in.

### 3.6 An API node dies mid-exam
Nodes are stateless; all session state lives in Redis + Postgres, and clients
buffer locally and retry — no data loss.
- **Production (ALB):** the health check drops the dead target; ALB routes to the
  healthy node. Replace/restart the instance; it rejoins with no migration.
- **Local / single-box:** just restart it:
  ```bash
  cd app/api && bun run start
  ```
- No action needed on client state — they replay unsynced answers idempotently
  on reconnect (monotonic `client_seq` guard prevents stale overwrites).
- The **auto-submit sweep** runs inside each node (every 5s); as long as ≥1 node
  is up, overdue sessions still finalize.

### 3.7 Edit a candidate's score
```bash
curl -s $API/admin/results/$SID -X PATCH -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"finalScore": 42, "reason": "manual regrade: ambiguous Q17"}'
```
Audited (`result.score_edit`, with old/new score and reason), updates the Redis
leaderboard and pushes to the live admin WS. Also available on the admin
panel's Sessions screen. Always record a reason.

---

## 4. CLOSE (post-exam)

1. **Close the availability window** (blocks new logins/begins):
   ```bash
   curl -s $API/admin/exams/$EXAM/close -X POST -H "$AUTH"   # {"ok":true,"isOpen":false}
   ```
   Close only after all deadlines have passed, or in-progress candidates would be
   locked out of resume. Prefer waiting out the window; use add-time (§3.2) for
   genuine outages rather than early close.

2. **Verify every session finalized:**
   ```bash
   curl -s $API/admin/sessions -H "$AUTH" | jq .counts
   ```
   `in_progress` and (ideally) `not_started` should be 0. The auto-submit sweep
   finalizes anything past `deadline + 10s grace`; if `in_progress` lingers,
   confirm at least one node is up and check logs for `finalize failed`.

3. **Grading / results verification** (grading is automatic at finalize):
   ```bash
   curl -s "$API/admin/results?examId=$EXAM" -H "$AUTH" | jq 'length'
   curl -s $API/admin/leaderboard -H "$AUTH" | jq '.total, .entries[0]'
   ```
   `results` count should match finalized sessions. Spot-check a candidate:
   ```bash
   curl -s $API/admin/results/$SID -H "$AUTH" | jq '{score,maxScore,status}'
   ```
   Policy check: no negative marking, all-or-nothing; MCQ correct only on exact
   set match.

4. **Publish results** (flips `results_published`; gates visibility):
   ```bash
   curl -s $API/admin/exams/$EXAM/publish -X POST -H "$AUTH" \
     -H 'content-type: application/json' -d '{"published":true}'
   # to un-publish: {"published":false}
   ```

5. **Export results CSV:**
   ```bash
   curl -s "$API/admin/export/results.csv?examId=$EXAM" -H "$AUTH" -o results-$EXAM.csv
   ```
   Columns: Username, Exam, Status, Score, Max score, Correct, Wrong,
   Unanswered, Started at, Submitted at. The admin panel also offers this export
   plus per-candidate answer CSVs.

---

## 5. BACKUP AND RESTORE

### 5.1 Local / docker-compose (Postgres source of truth)
Redis is a cache/leaderboard and is rebuildable from Postgres — back up
**Postgres**.

**Backup (run anytime; take one immediately before and after the exam):**
```bash
docker exec wcl-postgres pg_dump -U wcl -d wcl -Fc \
  > backup-$(date +%Y%m%d-%H%M%S).dump
```

**Restore (into a clean DB — destructive to current data):**
```bash
# drop + recreate, then restore the custom-format dump
docker exec -i wcl-postgres psql -U wcl -d postgres \
  -c "DROP DATABASE IF EXISTS wcl WITH (FORCE);" -c "CREATE DATABASE wcl OWNER wcl;"
docker exec -i wcl-postgres pg_restore -U wcl -d wcl < backup-YYYYmmdd-HHMMSS.dump
# then rebuild Redis-side state:
cd app/api    # leaderboard/session/deadline caches repopulate lazily on demand;
              # a full rebuild happens on next /admin/leaderboard call.
```

### 5.2 Production (RDS) — PRODUCTION ONLY / PENDING
- Rely on **RDS automated backups + a manual snapshot taken right before the
  window opens**: `aws rds create-db-snapshot --db-instance-identifier <id>
  --db-snapshot-identifier wcl-pre-exam-$(date +%Y%m%d)`.
- Restore = `aws rds restore-db-instance-from-db-snapshot` to a new instance,
  then repoint `DATABASE_URL`. ElastiCache/Redis is rebuildable — no restore
  needed.
- Multi-AZ handles the failover blip (plan §11); snapshots handle data-loss
  recovery. Neither the RDS instance nor these commands exist yet — infra is
  unbuilt.

### 5.3 Restore drill — NOT YET EXECUTED
> The backup/restore drill (checklist: "Backup and restore procedure documented
> and tested" / infra "Backup and restore drill") has **NOT been run or dated.**
> Before exam day: execute §5.1 end-to-end (dump → restore into a scratch DB →
> verify row counts and one candidate result), and record the operator and date
> here:
>
> - Local restore drill executed: **PENDING** — _(name / date)_
> - RDS snapshot+restore drill executed: **PENDING (production only)** — _(name / date)_
>
> A backup you have never restored is not a backup. Do the drill.

---

## Known gaps (capabilities the runbook needs but the system lacks)

1. **No endpoint to set `available_from` / `available_until`** (§1.6) — only an
   `isOpen` toggle and add-time extension exist; a hard timed window needs a DB
   edit / seed.
2. **`/health` is liveness only** — no DB/Redis readiness probe.
3. **All AWS monitoring/alarms and RDS backups are unbuilt** — production only /
   pending.
4. **Restore drill not yet executed/dated** (§5.3).
