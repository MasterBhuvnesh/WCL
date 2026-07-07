# Kiosk Lockdown: hard-blocking Alt+Tab and the Windows key (TODO)

Notes for finishing the lockdown later. Constraint: ~700 borrowed college PCs
for one day. No OS imaging, no Assigned Access / Shell Launcher, no admin, leave
no trace.

## Current state (done, in `app/client/src/main/lockdown.ts` + `devmode.ts`)

Soft, runtime-only layer, active only when `examLock === true AND devMode === false`:
- Window held in kiosk + fullscreen + `setAlwaysOnTop(true, 'screen-saver')`.
- On `blur` / `minimize` / `leave-full-screen`: re-assert the trap, refocus, and
  log an `integrity_event`.
- Best-effort `globalShortcut` + `before-input-event` blocking of reload,
  DevTools, zoom, Ctrl+W/M/Q, F11, F12, Alt+F4.
- Dev escape `Ctrl+Shift+Alt+X` toggles dev mode (global shortcut + in-window
  fallback), which disables enforcement.

### The gap (observed)
Alt+Tab and the Win key still fire. The app only *reacts* (refocus + log), so
the console shows repeated `focus_lost` / `visibility_hidden` events. Always-on-top
covers other windows and snaps focus back, but the keystrokes are not suppressed
and the Start menu can still flash (Windows treats Start as above even
screen-saver level).

## Plan: native low-level keyboard hook

Only way to truly suppress these in-app without OS config. Runtime-only, no admin,
unloads on exit (no trace).

### Mechanism
A small native addon installs `SetWindowsHookEx(WH_KEYBOARD_LL)`. The callback
returns "handled" (non-zero, skip `CallNextHookEx`) for blocked combos so they
never reach the shell:
- Alt+Tab, Alt+Esc
- Left/Right Win keys (and Win+anything)
- Ctrl+Esc (Start)
- optionally Alt+F4
- Pass-through allowlist: normal typing, and `Ctrl+Shift+Alt+X` so the dev
  escape still works.

Cannot be blocked (OS-protected by design): Ctrl+Alt+Del, and on some builds
Win+L. Proctor covers this residual.

### Work pieces
1. Native addon (N-API / C++): exposes `start()` / `stop()`. Hook runs on a
   dedicated thread with its own message loop; `stop()` unhooks. ~80 lines C++.
2. Wire into `lockdown.ts`: `start()` when strict enforcement turns on,
   `stop()` when it turns off or dev mode engages. Wrap in try/catch; if the
   addon is missing or AV-blocked, fall back to today's soft behavior and log.
3. Packaging: the compiled `.node` must be `asarUnpack`-ed in electron-builder
   (native binaries cannot load from inside asar). Target x64.
4. Side effect: once Alt+Tab/Win are suppressed, the `focus_lost` spam stops
   because the switch never occurs.

### Risks
1. Build toolchain: needs Visual Studio Build Tools (Desktop C++ workload) +
   Python + node-gyp or cmake-js, built against Electron 39's ABI
   (`@electron/rebuild`). This is the main cost; no toolchain means no addon.
2. Antivirus / SmartScreen: a global keyboard hook in an unsigned exe is exactly
   what Defender heuristics flag. Code-signing the app before exam day strongly
   mitigates it.

### Decisions needed before coding
1. Can VS Build Tools (C++ workload) + Python be installed on the dev machine to
   compile the addon? (Required.)
2. Will the app be code-signed before exam day? (Strongly recommended.)
3. Confirm targets are Windows x64.

## Fallback if the native hook is rejected
Ship the soft layer above + the portable build, and rely on proctors plus the
integrity-event log. This is the standard on-center model and leaves the borrowed
machines untouched.
