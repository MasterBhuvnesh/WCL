<div align="center">

# WCL Admin Panel

<img src="https://img.shields.io/badge/-Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js" />
<img src="https://img.shields.io/badge/-React-000000?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
<img src="https://img.shields.io/badge/-TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=blue" alt="TypeScript" />
<img src="https://img.shields.io/badge/-Tailwind%20CSS-000000?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/-Radix%20UI-000000?style=for-the-badge&logo=radixui&logoColor=white" alt="Radix UI" />
<img src="https://img.shields.io/badge/-Bun-000000?style=for-the-badge&logo=bun&logoColor=fbf0df" alt="Bun" />

Operations console for the WCL examination system — everything an invigilation
team needs before, during, and after the exam.

</div>

## What's inside

- **Overview** — exam state (open/closed, published), quick actions, MFA enrollment.
- **Exam & questions** — question bank editor with image upload, SCQ/MCQ validation.
- **Participants** — single-entry form + bulk JSON import; DOB shown for hall-ticket use.
- **Hall tickets** — searchable seat-allocation list (building / floor / lab / seat).
- **Sessions** — live status, add time (one or all), release device, reset.
- **Leaderboard** — ranked scores with CSV export.
- **Results** — score list, per-session review, CSV export.
- **Integrity** — focus-loss, double-login, and device-change events.

## Quick start

```bash
cd app/admin
bun install
bun run dev        # http://localhost:5000
```

The panel talks to the API at `NEXT_PUBLIC_API_BASE` (default
`http://localhost:4000`), so start `app/api` first. Sign in with the admin
account — in development that's the one the API seed prints (see
[`app/api/README.md`](../api/README.md)); real deployments bootstrap their own
via environment variables.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on port 5000. |
| `bun run build` | Production build (don't run while the dev server is up). |
| `bun run start` | Serve the production build on port 5000. |
| `bun run lint` | ESLint. |

## Notes

- Admin sessions use a bearer token stored client-side; TOTP MFA can be
  enrolled from the overview page and is then required at login.
- CSV exports and image uploads authenticate with the same token; uploads land
  in the S3 bucket configured on the API side.
