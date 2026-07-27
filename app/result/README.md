<div align="center">

# WCL Result Portal

<img src="https://img.shields.io/badge/-Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js" />
<img src="https://img.shields.io/badge/-React-000000?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
<img src="https://img.shields.io/badge/-TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=blue" alt="TypeScript" />
<img src="https://img.shields.io/badge/-Tailwind%20CSS-000000?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/-PostgreSQL-000000?style=for-the-badge&logo=postgresql&logoColor=4169E1" alt="PostgreSQL" />
<img src="https://img.shields.io/badge/-npm-000000?style=for-the-badge&logo=npm&logoColor=CB3837" alt="npm" />

Public portal where candidates view their examination score and per-question
answer breakdown.

</div>

## How it works

- Candidates sign in with their **employee ID and date of birth** (dd/mm/yyyy) —
  the same credentials and the same login screen as the
  [hall-ticket portal](../hallticket).
- On success they see the same review an administrator sees at
  **Admin → Results → (candidate)**: headline score, correct / wrong /
  unanswered counts, the outcome pie, and every served question with the
  options they marked and the correct answer highlighted.
- Headline figures come from the `results` row written at grading time — the
  official record. The per-question list is rebuilt from the session's
  `served_question_ids` plus `answers` and `options`, mirroring the API's
  `GET /admin/results/:sessionId`.

## Publication gate

Nothing is disclosed until an administrator publishes results:
`exams.results_published` must be `true` for the candidate's exam. Until then
every sign-in returns *"Results have not been published yet"*, and the portal
reveals neither the score nor whether a session was even graded.

Flip it from the admin panel: **Exam & questions → Publish results**
(`POST /admin/exams/:examId/publish`).

> The answer key (`options.is_correct`) is read server-side only and is sent to
> the browser exclusively through this gate. Do not add a client-side query path
> that bypasses it.

## Quick start

```bash
cd app/result
npm install
npm run dev        # http://localhost:5002
```

Set `DATABASE_URL` to point at the exam database (it defaults to the local
development Postgres from `docker compose up -d`). See [`.env.example`](./.env.example).

## Testing against the production database

RDS is reachable only from inside the VPC, so a local run has to tunnel in.
[`secret/result-prod.sh`](../../secret/result-prod.sh) does the whole chain —
EC2 Instance Connect tunnel → SSH port-forward → portal — and is safe to re-run
from a cold boot:

```bash
cd <repo root>
aws sso login            # or however this machine authenticates
./secret/result-prod.sh creds    # sample candidate logins (employee ID + DOB)
./secret/result-prod.sh serve    # portal on http://localhost:5002, prod data
./secret/result-prod.sh psql     # interactive psql, if you need to dig
```

`serve` builds the Docker image on first use, so the thing you test is the same
artifact that ships. Ctrl-C stops the portal and tears both tunnels down. It
runs SELECTs only; nothing writes to production.

Requirements: the AWS CLI logged in, Docker running, and `secret/wcl-backend.pem`
present. If a run dies with a port already in use, the script reuses a live
tunnel rather than opening a second one.

> Docker's published-port path (`-p`) is broken on the current dev kernel
> (iptables DNAT unavailable), so the script uses `--network host`.

## Sign-in outcomes

| Situation | Response |
| --- | --- |
| Employee ID + DOB do not match a participant | 401 — "No result found for those details." |
| Exam not published | 403 — "Results have not been published yet." |
| Published, but no graded `results` row | 404 — "No graded result was found for your session." |
| Published and graded | 200 — full scorecard |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 5002. |
| `npm run build` / `npm run start` | Production build and serve. |
| `npm run lint` | ESLint. |

## Container

```bash
docker build -t wclresult:local .
docker run --rm -p 5002:5002 -e DATABASE_URL=... wclresult:local
```

Built and pushed by [`result-docker.yml`](../../.github/workflows/result-docker.yml)
as `<user>/wclresult`, triggered only by a `result-v*` tag from
`./release.sh result`. `DATABASE_URL` is read at run time, not baked in.

The service exists in
[`docker-compose.frontend.yml`](../../docker-compose.frontend.yml) behind the
`result` profile, so it is **not** started by a plain `up -d` — no image has
been pushed yet. To deploy once one has:

```bash
docker compose -f docker-compose.frontend.yml --profile result up -d
```

Then drop the `profiles:` line to fold it into the default set, and add an ALB
host rule for port 5002. It reuses the `DATABASE_URL` already in
`.env.prod.frontend` (same RDS as the hall-ticket portal).
