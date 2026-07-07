# Starting a Fresh Exam

Step-by-step for running an exam with **everything new** — no leftover sessions,
answers, or results. Two paths: a quick reset while testing, and a full clean
start. Exact request/response bodies for every endpoint are in [API.md](API.md);
day-of-event operations are in [RUNBOOK.md](RUNBOOK.md).

The exam id everywhere is `WCL-EXAM`.

---

## A. Quick reset while testing

You don't need a full wipe between test runs.

**Re-run one candidate:** admin panel → Sessions → **Reset** on that session.
This deletes their answers/result and puts them back at `not_started`; they log
in and begin again with a freshly shuffled paper.

**Change duration / number of questions:** run Drizzle Studio and edit the row —

```bash
cd app/api
bun run db:studio        # opens https://local.drizzle.studio
```

Open the `exams` table and edit `duration_seconds` / `questions_to_serve`.
Applies to the **next** begin; already-started sessions keep their old deadline
(reset them). Don't edit questions/sessions in Studio — use the admin panel, or
clear the matching Redis key after (see the caveats at the end).

**Short exams for testing:** start the API with a fast clock instead of editing
duration: `CLOCK_MULTIPLIER=360` makes a 1-hour exam last 10 seconds.

**Full wipe back to demo data:**

```bash
cd app/api
bun run seed --fresh     # wipes ALL tables + Redis state, reseeds WCL-EXAM demo
```

---

## B. Everything new (clean start)

### 0. Save anything you still need

A wipe is unrecoverable. If a previous run mattered, export first:
admin panel → Results → export, or `GET /admin/export/results.csv?examId=WCL-EXAM`.

### 1. Clean slate

Stop the API, then either:

```bash
cd app/api
bun run seed --fresh                 # dev: wipe + demo data (700 users / password)
```

or, for a **real event** (no demo data at all):

```bash
docker compose down -v && docker compose up -d   # empty Postgres + Redis
cd app/api
bun run db:migrate                               # recreate tables
```

### 2. Start the API

Dev:

```bash
bun run dev            # port 4000
```

Real event: set the `.env` first — `NODE_ENV=production`, a long random
`JWT_SECRET`, a real `ADMIN_PASSWORD`, and the exam settings
(`EXAM_ID=WCL-EXAM`, `EXAM_TITLE`, `EXAM_DURATION_SECONDS`,
`EXAM_QUESTIONS_TO_SERVE`) — then:

```bash
bun run start
```

On first boot against the empty database the server creates the admin account
and the exam itself (the exam starts **closed**). It refuses to boot on the
default password. Check the log for `bootstrap: exam created from env` and
`clockMultiplier: 1` — a leftover fast-clock value silently shortens the exam.

### 3. Start the admin panel and log in

```bash
cd app/admin && bun run dev          # http://localhost:5000
```

Log in with the admin credentials. Optionally set up MFA now (overview page) —
after scanning the QR, login needs the 6-digit code.

### 4. Load the question bank

Admin panel → **Questions** → add/paste your questions, or one call to
`POST /admin/questions` with the whole bank (validates SCQ = exactly 1 correct,
MCQ ≥ 1). The exam serves a random subset of `questions_to_serve` per candidate,
so the bank must have **at least** that many questions — more is better.

### 5. Import participants

Admin panel → **Participants** → paste a JSON array
(`[{ "username": "...", "secret": "...", "displayName": "..." }]`, max 1000 per
call). Passwords are hashed on ingest — keep the plaintext list somewhere safe
to distribute to candidates; it cannot be recovered from the DB.

### 6. Dry run (recommended)

While the exam is still closed, do one end-to-end check:

1. Temporarily open the exam (Sessions page or `POST /admin/exams/WCL-EXAM/open`).
2. Log in from the client as one real participant, begin, answer a couple of
   questions, submit.
3. Check the result appears under Results.
4. **Reset that session** (Sessions → Reset) so the candidate starts clean, and
   close the exam again.

### 7. Open the exam

When candidates are seated: admin panel → open exam
(or `POST /admin/exams/WCL-EXAM/open`). Candidates can now log in and begin.
Each candidate's clock starts at **their own** begin, not at exam open.

### 8. During the exam

Watch the Sessions page (status counts) and Integrity page (focus-loss,
double-login, device-change). Interventions — all on the Sessions page:
- **Add time** to one candidate or everyone.
- **Release device** if a machine dies and the candidate must move seats.
- **Reset** a session only as a last resort (destroys their answers).

### 9. Close and publish

1. Close the exam (`POST /admin/exams/WCL-EXAM/close`) — blocks new logins;
   in-progress candidates finish normally and auto-submit at their deadline.
2. Wait until `in_progress` drains to 0 on the Sessions page.
3. Review results; fix any score disputes via the score-edit control (audited).
4. Export the CSV. Then publish: `POST /admin/exams/WCL-EXAM/publish`
   with `{ "published": true }`.

---

## Caveats that bite

- **Postgres and Redis travel together.** Never wipe one without the other —
  `seed --fresh` and `docker compose down -v` both handle this; manual SQL
  cleanup does not. Stale Redis keys (`session:*`, `deadline:*`,
  `leaderboard:*`, `bank:*`) will haunt the next exam.
- **Editing questions in Drizzle Studio doesn't clear the Redis bank cache.**
  Use the admin panel, or run
  `docker exec wcl-redis redis-cli del bank:WCL-EXAM` after.
- **`CLOCK_MULTIPLIER` must be 1 for a real exam.** The boot log prints it.
- **A candidate who submitted cannot log in again** (409). That's by design;
  reset the session if it was a test run.
