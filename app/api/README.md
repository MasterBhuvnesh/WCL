<div align="center">

# WCL Examination API

<img src="https://img.shields.io/badge/-Bun-000000?style=for-the-badge&logo=bun&logoColor=fbf0df" alt="Bun" />
<img src="https://img.shields.io/badge/-TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=blue" alt="TypeScript" />
<img src="https://img.shields.io/badge/-Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
<img src="https://img.shields.io/badge/-PostgreSQL-000000?style=for-the-badge&logo=postgresql&logoColor=4169E1" alt="PostgreSQL" />
<img src="https://img.shields.io/badge/-Drizzle-000000?style=for-the-badge&logo=drizzle&logoColor=C5F74F" alt="Drizzle ORM" />
<img src="https://img.shields.io/badge/-Redis-000000?style=for-the-badge&logo=redis&logoColor=DC382D" alt="Redis" />
<img src="https://img.shields.io/badge/-Amazon%20S3-000000?style=for-the-badge&logo=amazons3&logoColor=569A31" alt="Amazon S3" />
<img src="https://img.shields.io/badge/-Docker-000000?style=for-the-badge&logo=docker&logoColor=2496ED" alt="Docker" />

Backend for the WCL on-center examination system: candidate authentication,
the exam engine (per-candidate shuffling, autosave, resume, auto-submit,
negative marking), administrative operations, the leaderboard, and
hall-ticket data.

</div>

## Architecture

- **Express over Bun.** Bun executes the TypeScript sources directly, so
  there is no build step. `src/index.ts` wires middleware, the two routers,
  and the WebSocket upgrade.
- **PostgreSQL via Drizzle ORM** is the system of record. Migrations live in
  `drizzle/` and are applied with `bun run db:migrate`.
- **Redis** carries the hot state: `session:{id}` (cached candidate session),
  `bank:{examId}` (question bank cache, 600 second TTL, invalidated by admin
  question edits and by the question importer), `leaderboard:{examId}`
  (sorted set behind the leaderboard and its CSV export), rate-limit buckets,
  and a `wcl:*` pub/sub namespace.
- **Admin live updates**: a single Redis subscriber (`PSUBSCRIBE wcl:*`) fans
  events out to admin panels connected on the `/admin/ws` WebSocket.
- **Server-authoritative time.** Deadlines are computed and enforced on the
  server; clients only display them. `GET /time` lets clients estimate their
  clock offset.
- **Question images** are stored in S3-compatible object storage (Floci
  locally, Amazon S3 in production) through Bun's built-in S3 client; the
  database stores only the public object URL.
- **Rate limiting**: login is limited to 10 requests per minute per client
  and the exam routes to 300 per minute per session.

## Candidate exam flow

1. `POST /auth/login` with username, password, and optional exam and device
   identifiers. Logging in again on another machine records a double-login
   integrity event; a submitted session cannot log in again (409).
2. `POST /exam/begin` freezes that candidate's random subset of the question
   bank (`questions_to_serve` of them, shuffled per candidate with a session
   seed) and stamps the deadline. Instructions are shown before this call, so
   the timer starts at begin, not at login.
3. `GET /exam/manifest` returns the served questions and options without
   correct-answer flags.
4. `POST /exam/answer` saves one answer; `POST /exam/heartbeat` batches
   buffered answers, keeps the session alive, and reconciles the clock. Every
   write carries a client sequence number, so a stale or replayed write can
   never overwrite a newer answer.
5. `POST /exam/submit` grades and persists exactly once; sessions that reach
   the deadline are auto-submitted with the same grading path. Correct
   answers score the question's marks, wrong answers deduct 0.5, unanswered
   score zero, and totals may go negative.
6. `GET /exam/result` returns the candidate's score and a per-question review
   (own selections, outcome, and marks awarded; correct answers are never
   sent). `POST /exam/resume` restores an in-progress session after a crash
   or restart.

## Database

Eleven tables, defined in `src/db/schema.ts`: `exams`, `questions`,
`options` (per-option `is_correct`, never serialized to candidates),
`participants`, `hallticket_seats` (seat allocation for the hall-ticket
portal), `exam_sessions`, `answers`, `results`, `admins`, `audit_logs`
(every admin mutation is audited), and `integrity_events`.

## Endpoints

Candidate:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Service health check. |
| GET | `/time` | Authoritative server time. |
| POST | `/auth/login` | Candidate login; returns a session token. |
| POST | `/exam/begin` | Start the exam; freezes served questions and the deadline. |
| GET | `/exam/manifest` | Served questions without correct-answer flags. |
| POST | `/exam/answer` | Save or update a single answer. |
| POST | `/exam/heartbeat` | Batch-save buffered answers and keep the session alive. |
| POST | `/exam/submit` | Submit the exam and grade it. |
| POST | `/exam/resume` | Resume an in-progress session. |
| GET | `/exam/result` | Own score and per-question review. |
| POST | `/exam/integrity` | Report a client integrity event. |

Administrative (bearer token from `/admin/login`; TOTP MFA once enrolled):

| Method | Path | Description |
| --- | --- | --- |
| POST | `/admin/login` | Administrator login. |
| POST | `/admin/mfa/setup` | Begin TOTP enrollment. |
| GET | `/admin/sessions` | Session list with live status. |
| POST | `/admin/sessions/:sessionId/reset` | Reset a session (destroys its answers). |
| POST | `/admin/sessions/:sessionId/release-device` | Release the device lock so the candidate can move machines. |
| POST | `/admin/sessions/:sessionId/add-time` | Extend one candidate's deadline. |
| POST | `/admin/exams/:examId/add-time` | Extend every active session of an exam. |
| POST | `/admin/exams/:examId/open` / `close` | Open or close the exam for login. |
| POST | `/admin/exams/:examId/publish` | Publish or unpublish results. |
| GET | `/admin/questions` / POST `/admin/questions` | Read or upsert the question bank (SCQ/MCQ validation). |
| DELETE | `/admin/questions/:id` | Delete a question. |
| POST | `/admin/upload` | Upload a question image; returns its public URL. |
| GET | `/admin/participants` | Participant list (includes date of birth). |
| POST | `/admin/participants/import` | Bulk participant import; secret-less rows get the common password. |
| GET | `/admin/hallticket` | Seat allocations joined with participants. |
| GET | `/admin/results` / `/admin/results/:sessionId` | Result list and per-session review. |
| PATCH | `/admin/results/:sessionId` | Override a final score (audited). |
| GET | `/admin/leaderboard` | Ranked scores. |
| GET | `/admin/export/results.csv` / `/admin/export/leaderboard.csv` | CSV exports. |
| GET | `/admin/integrity-events` | Integrity events for review. |
| WS | `/admin/ws` | Live event stream for the admin panel. |

Request and response bodies for every endpoint are documented in
[`docs/API.md`](../../docs/API.md).

## Project layout

```
app/api
  drizzle/            SQL migrations (bun run db:migrate applies them)
  scripts/            CSV/XLSX importers and the clean command (see scripts/README.md)
  data/               sample import workbooks and sample image
  src/
    index.ts          app wiring: middleware, routers, /health, /time, WebSocket
    routes/exam.ts    candidate routes (auth + exam lifecycle)
    routes/admin.ts   administrative routes
    services/         exam engine (grading, bank cache, sessions) and admin helpers
    db/               Drizzle client and schema.ts
    env.ts            zod-validated environment with development defaults
    redis.ts          Redis client
    ws.ts             /admin/ws fan-out of wcl:* pub/sub events
    seed.ts           demo data (exam, 700 candidates, seats, admin)
```

## Prerequisites

- **Docker** and Docker Compose, used to run PostgreSQL, Redis, and Floci (a
  local S3-compatible store for question images).
- **Bun** 1.1 or newer.

## Quick start

```bash
# From the repository root: start PostgreSQL, Redis, and Floci.
docker compose up -d

# One-time: create the image bucket in Floci (only needed for question images).
curl -X PUT http://localhost:4566/wcl-images

# From app/api: install, migrate, seed demo data, run.
cd app/api
bun install
bun run db:migrate
bun run seed
bun run dev            # http://localhost:4000
```

The seed provisions the demonstration exam `WCL-EXAM`, 700 candidates with
seat allocations, and one administrator account. It prints the development
credentials on completion. These are development defaults; set real values
through the environment for any real event. `bun run seed --fresh` wipes all
data (PostgreSQL and Redis) and reseeds from scratch.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run with hot reload on port 4000. |
| `bun run start` | Run without watch (production entry point). |
| `bun run typecheck` | Run `tsc --noEmit` over `src/` and `scripts/`. |
| `bun run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and the browser studio. |
| `bun run seed [--fresh]` | Seed demo data; `--fresh` wipes first. |
| `bun run import:questions <file> [examId]` | Bulk-load questions (with images) from CSV or XLSX. |
| `bun run import:participants <file>` | Bulk-load participants from CSV or XLSX. |
| `bun run import:seats <file>` | Bulk-load hall-ticket seat allocations from CSV or XLSX. |
| `bun run clean <target> [--yes]` | Remove imported data; preview by default. |

The importers validate the whole file first, report every error at once, and
write nothing when any row is invalid. All of them support `--dry-run`.
Column contracts, sample XLSX workbooks, spreadsheet-preparation steps, and
undo SQL are documented in [`scripts/README.md`](./scripts/README.md).

## Fast-clock mode

The `CLOCK_MULTIPLIER` environment variable accelerates exam time for
testing: `CLOCK_MULTIPLIER=60` makes an hour-long exam last one minute. It
must be `1` for a real exam; the boot log prints the active value.

## Environment

Copy `.env.example` to `.env` and adjust as needed. Every variable has a safe
local default, so a development run works without an `.env` file. Never
commit `.env`: it holds the database URL and storage credentials of whatever
environment it points at, and the seed and all scripts follow `DATABASE_URL`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port. |
| `DATABASE_URL` | `postgres://wcl:wcl@localhost:5432/wcl` | PostgreSQL connection string. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string. |
| `JWT_SECRET` | development-only value | Session token secret. Production refuses the default. |
| `NODE_ENV` | `development` | `production` enables bootstrap and safety checks. |
| `CLOCK_MULTIPLIER` | `1` | Fast-clock factor for testing. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | development-only values | Administrator created on first production boot. Production refuses the default password. |
| `EXAM_ID` / `EXAM_TITLE` / `EXAM_DURATION_SECONDS` / `EXAM_QUESTIONS_TO_SERVE` | `WCL-EXAM` and related | Exam created on first production boot. |
| `PARTICIPANT_PASSWORD` | development-only value | Common candidate password for seeded users and secret-less imports. |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Floci on localhost | Question-image storage; point at real S3 for production. |
| `S3_PUBLIC_URL` | `${S3_ENDPOINT}/${S3_BUCKET}` | Public base URL for image links (S3 or CloudFront). |

## Docker image

```bash
docker build -t wcl-api app/api
docker run --env-file .env -p 4000:4000 wcl-api

# The same image runs one-off jobs:
docker run --rm --env-file .env wcl-api bun run db:migrate
```

The `.dockerignore` file keeps `.env` out of the image, so credentials are
injected at runtime only. The CI workflow
(`.github/workflows/api-docker.yml`) typechecks, builds, and pushes the image
to Docker Hub tagged `v<package.json version>` and `latest` on every
`app/api` change on `main`.

## API reference and guides

- [`docs/API.md`](../../docs/API.md): every endpoint with request and response bodies.
- [`docs/NEW_EXAM.md`](../../docs/NEW_EXAM.md): running a fresh exam end to end.
- [`docs/RUNBOOK.md`](../../docs/RUNBOOK.md): day-of-event operations.
- [`docs/S3_MIGRATION.md`](../../docs/S3_MIGRATION.md): moving images from Floci to AWS S3.
- `postman/` (repository root): ready-made collection. Run **Candidate > Login**
  or **Admin > Login** first to populate tokens.
