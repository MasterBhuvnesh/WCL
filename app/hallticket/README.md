<div align="center">

# WCL Hall-Ticket Portal

<img src="https://img.shields.io/badge/-Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js" />
<img src="https://img.shields.io/badge/-React-000000?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
<img src="https://img.shields.io/badge/-TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=blue" alt="TypeScript" />
<img src="https://img.shields.io/badge/-Tailwind%20CSS-000000?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/-PostgreSQL-000000?style=for-the-badge&logo=postgresql&logoColor=4169E1" alt="PostgreSQL" />
<img src="https://img.shields.io/badge/-npm-000000?style=for-the-badge&logo=npm&logoColor=CB3837" alt="npm" />

Public portal where candidates view and download their examination admit card.

</div>

## How it works

- Candidates sign in with their **employee ID and date of birth** (dd/mm/yyyy).
- Per-candidate data comes from the exam database: `participants` (username,
  name, date of birth) joined with `hallticket_seats` (building, floor, lab,
  seat).
- Exam-wide details (date, reporting, gate-close and start times, venue, and
  instructions) live in [`data/exam.json`](./data/exam.json). Edit that single
  file for each event.
- The on-screen ticket is real DOM (`HallTicketPreview`), so it always
  renders. The downloadable PDF (`HallTicketDocument`, built with
  @react-pdf/renderer) is produced from the same data. Keep the two
  components in step when changing the layout.

## Quick start

```bash
cd app/hallticket
npm install
npm run dev        # http://localhost:5001
```

Set `DATABASE_URL` to point at the exam database (it defaults to the local
development Postgres from `docker compose up -d`). The roster is queried
server-side only and is never shipped to the browser.

## Loading data

From `app/api`:

```bash
bun run import:participants candidates.xlsx   # usernames, names, dates of birth
bun run import:seats seats.xlsx               # building/floor/lab/seat per candidate
```

Column contracts and sample workbooks are documented in
[`app/api/scripts/README.md`](../api/scripts/README.md). A candidate receives
a hall ticket only when both their participant row and their seat row exist,
and the date of birth is required for portal login, so include it in the
participant import.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 5001. |
| `npm run build` / `npm run start` | Production build and serve. |
| `npm run lint` | ESLint. |
