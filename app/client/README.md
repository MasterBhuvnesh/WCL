<div align="center">

<img src="./assets/platform%20banner.png" alt="WCL Exam Client" width="100%">

<br />

# 𝔚ℭ𝔏 𝔈𝔵𝔞𝔪 ℭ𝔩𝔦𝔢𝔫𝔱

<img src="https://img.shields.io/badge/-Electron-000000?style=for-the-badge&logo=electron&logoColor=9FEAF9" alt="Electron" />
<img src="https://img.shields.io/badge/-React-000000?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
<img src="https://img.shields.io/badge/-TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=blue" alt="TypeScript" />
<img src="https://img.shields.io/badge/-Vite-000000?style=for-the-badge&logo=vite&logoColor=646CFF" alt="Vite" />
<img src="https://img.shields.io/badge/-Tailwind%20CSS-000000?style=for-the-badge&logo=tailwindcss&logoColor=06B6D4" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/-Bun-000000?style=for-the-badge&logo=bun&logoColor=fbf0df" alt="Bun" />

Kiosk desktop application on which candidates take the examination.

</div>

## Capabilities

- **Kiosk lockdown from launch**: fullscreen, frameless, always-on-top
  enforcement while the exam runs. Leaving fullscreen, minimising, or losing
  focus during the exam is recorded as an integrity event for proctor review.
- **Offline-tolerant autosave**: answers buffer locally and synchronise via
  heartbeat. Network loss does not lose work, and the session resumes after a
  crash or restart.
- **Server-authoritative clock**: the on-screen timer follows the server, and
  the exam submits automatically at the deadline.
- **Immediate results**: after submitting, the candidate sees their score and
  a per-question review (their own answers and outcomes only; correct answers
  are never sent to the client). Once the score has been viewed, closing the
  application signs the candidate out so the next candidate can use the
  machine.
- **Image preloading**: question images are fetched when the paper arrives,
  so navigation does not wait on the network.

## Quick start

```bash
cd app/client
bun install
bun run dev
```

Point the renderer at the API with `VITE_API_BASE` (default
`http://localhost:4000`) and start `app/api` first. Candidates sign in with
the credentials distributed for the event; development credentials come from
the API seed (see [`app/api/README.md`](../api/README.md)).

## Commands

| Command                                           | Purpose                                  |
| ------------------------------------------------- | ---------------------------------------- |
| `bun run dev`                                     | Run in development with hot reload.      |
| `bun run typecheck`                               | Node and web tsconfig checks.            |
| `bun run lint` / `bun run format`                 | ESLint and Prettier.                     |
| `bun run build:win` / `build:mac` / `build:linux` | Package installers via electron-builder. |
| `bun run build:unpack`                            | Unpacked build for quick inspection.     |

## Deployment & auto-update

Every push to `main` that touches the client is built on Windows by
[`release-client.yml`](../../.github/workflows/release-client.yml) and published
to [GitHub Releases](https://github.com/MasterBhuvnesh/WCL/releases). Installed
clients check on launch (and every 30 min), download in the background, and
prompt **"Update ready — Restart now?"** — except during an active exam, where
the update installs quietly on the next quit so a candidate is never interrupted.

### Install on a device

Paste into **cmd** on the target machine. Downloads the latest installer and
installs it silently for the current user (no admin, no UAC), then drops a
desktop shortcut:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/MasterBhuvnesh/WCL/main/app/client/scripts/install-wcl.ps1)"
```

Add `-WindowStyle Hidden` for a fully silent push from a login script or MDM.
See [`scripts/README.md`](scripts/README.md) for machine-wide installs and
other options.

## Configuration

Renderer settings live in `src/renderer/src/config.ts` (API base, heartbeat
cadence, reconnect backoff, storage keys). Packaged-application icons come
from `build/` (`icon.ico`, `icon.icns`, `icon.png`).
