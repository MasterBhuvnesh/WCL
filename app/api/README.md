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

## Prerequisites

- **Docker** and Docker Compose, used to run PostgreSQL, Redis, and Floci (a
  local S3-compatible store for question images).
- **Bun** 1.1 or newer, used to install dependencies and run the server. Bun
  executes TypeScript directly, so there is no build step.

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

## Scoring

Each correct answer scores the question's marks. Each wrong answer deducts
0.5 marks, so totals may go negative. Unanswered questions score zero. After
submitting, a candidate can fetch their own score and a per-question review
(outcome and marks only, never the correct answers) from `GET /exam/result`.

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
