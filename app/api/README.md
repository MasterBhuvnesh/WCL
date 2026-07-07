# WCL Examination API

Production backend for the WCL on-center examination system. Built with Bun,
Express, PostgreSQL, and Redis.

## Prerequisites

- **Docker** and Docker Compose, used to run PostgreSQL and Redis locally.
- **Bun** version 1.1 or newer, used to install dependencies and run the server.

## Quick start

Run these commands from the repository root, then from `app/api`:

```bash
# From the repository root: start PostgreSQL and Redis.
docker compose up -d

# From app/api: install dependencies, apply migrations, seed, and run.
cd app/api
bun install
bun run db:migrate
bun run seed
bun run dev
```

The API listens on `http://localhost:4000` by default. Re-run the seed with
`bun run seed --fresh` to wipe all data and Redis state and reseed from scratch.

## Development credentials

The seed script provisions the demonstration exam `WCL-EXAM` together with the
following accounts.

| Role      | Identifier                    | Secret      | Notes                     |
| --------- | ----------------------------- | ----------- | ------------------------- |
| Candidate | `user001` through `user700`   | `password`  | Log in with `examId` `WCL-EXAM`. |
| Admin     | `admin@wcl.local`             | `adminpass` | TOTP MFA is not enrolled. |

## Fast-clock mode

The `CLOCK_MULTIPLIER` environment variable accelerates exam time for testing.
The effective exam duration is divided by the multiplier when a session begins,
so `CLOCK_MULTIPLIER=60` makes the hour-long exam last one minute. A value of
`1` (the default) runs in real time.

```bash
CLOCK_MULTIPLIER=60 bun run dev
```

## Environment variables

The following variables mirror `.env.example`. All have sensible development
defaults, so a local run works without an `.env` file.

| Variable          | Default                                | Description                                              |
| ----------------- | -------------------------------------- | ------------------------------------------------------- |
| `PORT`            | `4000`                                 | HTTP port the API listens on.                           |
| `DATABASE_URL`    | `postgres://wcl:wcl@localhost:5432/wcl`| PostgreSQL connection string.                           |
| `REDIS_URL`       | `redis://localhost:6379`               | Redis connection string.                                |
| `JWT_SECRET`      | `dev-only-secret-change-me`            | HMAC secret for session tokens. Override in production. |
| `CLOCK_MULTIPLIER`| `1`                                    | Fast-clock factor. `60` makes a 1-hour exam last 1 minute. |
| `LOG_LEVEL`       | `info`                                 | Pino log level (`debug`, `info`, `warn`, `error`).      |

## Endpoint summary

### Candidate

| Method | Path              | Description                                        |
| ------ | ----------------- | -------------------------------------------------- |
| GET    | `/health`         | Service health check.                              |
| GET    | `/time`           | Authoritative server time.                         |
| POST   | `/auth/login`     | Candidate login; returns a session token.          |
| POST   | `/exam/begin`     | Start the exam, freezing the served questions and deadline. |
| GET    | `/exam/manifest`  | Served questions for the session, without correct-answer flags. |
| POST   | `/exam/answer`    | Save or update a single answer.                    |
| POST   | `/exam/heartbeat` | Autosave a batch of answers and keep the session alive. |
| POST   | `/exam/submit`    | Submit the exam.                                   |
| POST   | `/exam/resume`    | Resume an in-progress session.                     |
| POST   | `/exam/integrity` | Report a client integrity event.                   |

### Admin

| Method | Path                                | Description                                  |
| ------ | ----------------------------------- | -------------------------------------------- |
| POST   | `/admin/login`                      | Administrator login; returns an admin token. |
| POST   | `/admin/mfa/setup`                  | Begin TOTP multi-factor enrollment.          |
| GET    | `/admin/leaderboard`                | Ranked scores for an exam.                   |
| GET    | `/admin/sessions`                   | Session list for an exam.                    |
| GET    | `/admin/results`                    | Result list for an exam.                     |
| GET    | `/admin/results/:sessionId`         | Detailed result for a single session.        |
| GET    | `/admin/export/results.csv`         | Export results for an exam as CSV.           |
| POST   | `/admin/sessions/:sessionId/reset`  | Reset a session.                             |
| POST   | `/admin/sessions/:sessionId/add-time` | Extend the deadline for one session.       |
| POST   | `/admin/exams/:examId/add-time`     | Extend the deadline for every session of an exam. |
| POST   | `/admin/exams/:examId/open`         | Open an exam for candidate login.            |
| POST   | `/admin/exams/:examId/close`        | Close an exam.                               |
| POST   | `/admin/exams/:examId/publish`      | Publish or unpublish results.                |
| GET    | `/admin/integrity-events`           | Integrity events for an exam.                |
| GET    | `/admin/questions`                  | Question bank for an exam.                    |
| POST   | `/admin/questions`                  | Create or update questions.                  |
| DELETE | `/admin/questions/:questionId`      | Delete a question.                           |
| POST   | `/admin/participants/import`        | Bulk import participants.                     |

## Postman usage

A ready-made collection lives in the `postman` directory at the repository root.

1. Import both `postman/WCL.postman_collection.json` and
   `postman/WCL.local.postman_environment.json` into Postman.
2. Select the **WCL Local** environment.
3. Run the **Candidate > Login** request first. Its test script stores the
   returned `token` and `sessionId` in the environment, which the remaining
   candidate requests reuse automatically.
4. For administrator requests, run **Admin > Login** first to populate
   `adminToken`.

## Results file note

In addition to the `results` table in PostgreSQL, completed exams are also
appended to `app/api/data/results.json`. The current admin panel reads that
file, so it is kept in sync as a convenience for local review.
