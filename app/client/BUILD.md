# Building & shipping the WCL exam client

The client ships as a **standalone portable Windows `.exe`** — a single file a proctor can copy
to any Windows machine and double-click. There is no installer and nothing is written to
Program Files; the app self-extracts to a temp dir and runs.

## How the production build is made

Windows `.exe` files are built by GitHub Actions on a native Windows runner, not locally on
Linux. The workflow lives at [`.github/workflows/build-windows.yml`](../../.github/workflows/build-windows.yml).

### One-time setup: repository variables

The packaged app must know which backend to talk to. This is injected **at build time** (the
renderer's Content-Security-Policy is locked down, so the backend origin has to be baked in).

In GitHub: **Settings → Secrets and variables → Actions → Variables**, add:

| Variable           | Example                                              | Purpose                                              |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| `VITE_API_BASE`    | `https://api.your-domain.com`                        | Base URL for API / WebSocket calls.                  |
| `VITE_CONNECT_SRC` | `https://api.your-domain.com wss://api.your-domain.com` | CSP `connect-src` origins (HTTP**S** **and** WS**S**). |

If these are unset the build falls back to the localhost defaults baked into
`electron.vite.config.ts`, and the exe will only work on a machine that itself runs the backend
on that port.

### Producing an exe

- **Manual:** Actions → **Build Windows** → **Run workflow**.
- **On release:** push a tag like `v1.0.0` — the workflow builds and attaches the exe to a GitHub Release.

The artifact `wcl-portable-windows` (`wcl-<version>-portable.exe`) is downloadable from the run
summary.

## Local development

```bash
cd app/client
bun install      # runs the electron postinstall fix
bun run dev      # hot-reloading dev app, talks to localhost:4000
```

## Local build sanity-check (Linux)

You **cannot** produce a Windows `.exe` on Linux without Wine, but you can validate the config:

```bash
cd app/client
bun run build                        # typecheck + electron-vite build -> out/
# confirm the backend origin was injected into the CSP:
grep connect-src out/renderer/index.html
bunx electron-builder --dir          # validates electron-builder.yml, packs unpacked app
```

To preview a production-pointed CSP locally:

```bash
VITE_API_BASE="https://api.test" VITE_CONNECT_SRC="https://api.test wss://api.test" bun run build
grep connect-src out/renderer/index.html   # should now show the api.test origins
```

## Configuration reference

- **`electron.vite.config.ts`** — localhost defaults for `VITE_API_BASE` / `VITE_CONNECT_SRC`
  (via `??=`). Real builds override these through the environment; values present at build time win.
- **`electron-builder.yml`** — packaging config. `win.target: [portable]` selects the portable
  exe; `portable.artifactName` names it. The `nsis:` block remains configured but inactive (add
  `nsis` back to `win.target` to also produce an installer).
- **`src/renderer/src/lib/config.ts`** — reads `VITE_API_BASE` (single source of truth for the URL).
- **`src/renderer/index.html`** — CSP uses the `%VITE_CONNECT_SRC%` placeholder.

## Caveats

- **Unsigned binary:** the exe is not code-signed, so Windows SmartScreen shows a
  "Windows protected your PC" prompt on first run (More info → Run anyway). Code signing
  (a cert + `CSC_LINK` / `CSC_KEY_PASSWORD`) is a future step if needed.
- **No auto-update:** portable builds don't self-update; distribute a new exe per release.
- **Kiosk lockdown:** once an exam is locked the window is trapped fullscreen with no controls;
  the only escape hatch is the `Ctrl+Shift+Alt+X` developer override.
