<div align="center">

# WCL Exam Client

<img src="https://img.shields.io/badge/-Electron-000000?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron" />
<img src="https://img.shields.io/badge/-React-000000?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
<img src="https://img.shields.io/badge/-TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=blue" alt="TypeScript" />
<img src="https://img.shields.io/badge/-Vite-000000?style=for-the-badge&logo=vite&logoColor=646CFF" alt="Vite" />
<img src="https://img.shields.io/badge/-Tailwind%20CSS-000000?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/-Bun-000000?style=for-the-badge&logo=bun&logoColor=fbf0df" alt="Bun" />

Kiosk desktop application the candidates take the exam on.

</div>

## What it does

- **Kiosk lockdown from launch** — fullscreen, frameless, always-on-top
  enforcement while the exam runs; leaving fullscreen, minimising, or losing
  focus during the exam is reported as an integrity event for proctor review.
- **Offline-tolerant autosave** — answers buffer locally and sync via
  heartbeat; network loss never loses work, and the session **resumes** after
  a crash or restart.
- **Server-authoritative clock** — the on-screen timer follows the server;
  the exam auto-submits at the deadline.
- **Immediate results** — after submit the candidate sees their score and a
  per-question review (own answers and outcomes only — correct answers are
  never sent to the client). Once the score has been seen, closing the app
  signs the candidate out so the next one can use the machine.
- **Question images** are preloaded when the paper arrives, so navigation
  never waits on the network.

## Quick start

```bash
cd app/client
bun install
bun run dev
```

Point the renderer at the API with `VITE_API_BASE` (default
`http://localhost:4000`) — start `app/api` first. Candidates sign in with the
credentials distributed for the event; development credentials come from the
API seed (see [`app/api/README.md`](../api/README.md)).

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Run in development (hot reload). |
| `bun run typecheck` | Node + web tsconfig checks. |
| `bun run lint` / `bun run format` | ESLint / Prettier. |
| `bun run build:win` / `build:mac` / `build:linux` | Package installers via electron-builder. |
| `bun run build:unpack` | Unpacked build for quick inspection. |

## Configuration

Renderer settings live in `src/renderer/src/config.ts` (API base, heartbeat
cadence, reconnect backoff, storage keys). Packaged-app icons come from
`build/` (`icon.ico` / `icon.icns` / `icon.png`).
