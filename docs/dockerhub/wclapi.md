# WCL API

`wclapi` is the API behind the WCL examination platform used for the Western
Coalfields Limited examination at Ramdeobaba University. It owns
authentication, exam sessions, answer sync, the server side clock, grading,
results, and candidate feedback. PostgreSQL holds the truth, Redis holds the
hot exam state, and question images live in S3.

Bun 1 on `oven/bun:1-slim`, Express and Drizzle ORM, written in TypeScript.
Built from [MasterBhuvnesh/WCL](https://github.com/MasterBhuvnesh/WCL).

## QUICK START

```bash
docker run -d --name wclapi \
  -p 4000:4000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgres://user:pass@host:5432/wcl" \
  -e REDIS_URL="redis://host:6379" \
  -e JWT_SECRET="<long random string>" \
  -e ADMIN_EMAIL="admin@example.com" \
  -e ADMIN_PASSWORD="<real password>" \
  bhuvneshverma/wclapi:latest
```

Migrations and the import jobs run from the same image, so nothing else needs
Bun installed:

```bash
docker run --rm --env-file .env bhuvneshverma/wclapi:latest bun run db:migrate
docker run --rm --env-file .env -v ./data:/app/data \
  bhuvneshverma/wclapi:latest bun run import:questions data/questions.xlsx
```

Other jobs on the same pattern: `import:participants`, `import:seats`,
`clean`, `wipe`.

## THE PORT IS 4000

The image declares `EXPOSE 4000` and `PORT` defaults to `4000`. Publish it
wherever you like on the host, for example `-p 8080:4000`. The container runs
as the unprivileged `bun` user.

## TAGS

| Tag | What it is |
| --- | --- |
| `latest` | The most recent release. Moved only by an `api-v*` git tag. |
| `v0.1.7` | A specific release. Immutable. |

Pin to a version tag in production. `latest` moves under you.

## ENVIRONMENT

Every variable has a default, so the container boots with none of them set.
The defaults are development values, and a production instance refuses to
start on two of them: with `NODE_ENV=production`, leaving `JWT_SECRET` or
`ADMIN_PASSWORD` at the default is a named boot failure rather than a silent
weak deployment.

Set these for any real deployment:

- **`NODE_ENV=production`**. The default is `development`, which also skips
  the bootstrap described below.
- **`DATABASE_URL`**, **`REDIS_URL`**. Default to localhost.
- **`JWT_SECRET`**. A long random string. Signs participant and admin session
  tokens.
- **`ADMIN_EMAIL`**, **`ADMIN_PASSWORD`**. On first boot against an empty
  database the API creates this admin account and the exam itself, so a clean
  deployment needs no manual SQL. Existing rows are never updated, so changing
  these later has no effect.

Exam shape, read at that same first boot: `EXAM_ID`, `EXAM_TITLE`,
`EXAM_DURATION_SECONDS`, `EXAM_QUESTIONS_TO_SERVE`. `EXAM_ID` must match the
value given to the hall ticket and result portals.

Question images: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, and optionally `S3_PUBLIC_URL`, which defaults to
`${S3_ENDPOINT}/${S3_BUCKET}`.

Operational settings worth knowing:

- `METRICS_TOKEN` is the bearer token for `GET /metrics`. Unset disables the
  endpoint entirely, which is the right default when a load balancer forwards
  every path to the API.
- `TRUST_PROXY_HOPS` defaults to `1` for a single load balancer in front. Set
  `0` when the API is exposed directly, otherwise every request appears to
  come from the proxy and shares one rate limit bucket.
- `CLOCK_MULTIPLIER` runs exam time faster than real time for testing. `60`
  makes a one hour exam last one minute. Leave it at `1` in production.
- `SESSION_TOKEN_TTL_SECONDS`, `ADMIN_TOKEN_TTL_SECONDS`, `DB_POOL_MAX`,
  `LOG_LEVEL`, `PARTICIPANT_PASSWORD`.

## ENDPOINTS

`GET /health` is the liveness probe and reports the running version.
`GET /time` returns server time, which the exam client uses to correct its own
clock offset. Candidate routes are mounted at the root, administrator routes
under `/admin`, and the live session feed is a WebSocket at `/admin/ws`.
`GET /metrics` is the Prometheus scrape target.

## RELATED IMAGES

`bhuvneshverma/wcladmin`, `bhuvneshverma/wclhallticket`, and
`bhuvneshverma/wclresult` are the three web applications in front of this API.

## LICENSE

Copyright (c) 2026 Bhuvnesh Verma and Vivian Demello. All rights reserved.
The source is published so it can be read and studied. It is not open source:
using, copying, modifying, or redistributing it requires written permission
from both copyright holders.
