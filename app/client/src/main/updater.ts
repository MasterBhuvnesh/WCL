import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import pkg from 'electron-updater'

// electron-updater ships CommonJS; destructure the default export so this stays
// compatible with electron-vite's ESM main bundle.
const { autoUpdater } = pkg

/**
 * Status pushed to the renderer over the `updates:status` channel so the UI can
 * surface progress. `state` mirrors the electron-updater lifecycle.
 */
export interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  /** Target version, when known (available / downloading / downloaded). */
  version?: string
  /** 0–100 download percentage, present while `state === 'downloading'`. */
  percent?: number
  /** Human-readable error, present when `state === 'error'`. */
  message?: string
}

/**
 * Last status pushed to renderers. The IPC push is fire-and-forget, so a
 * terminal event (`downloaded` / `error`) can fire before the kiosk renderer has
 * mounted and subscribed — it would then be lost forever. We cache it here and
 * let the renderer pull it on mount via `updates:get-status`.
 */
let lastStatus: UpdateStatus | null = null

/**
 * Once an update is downloaded it's staged and there's nothing more to do until
 * restart. We mark it sticky so the periodic re-check (which re-emits `checking`
 * / `not-available`) can't overwrite the cached `downloaded` state and make the
 * renderer's "Restart now" prompt vanish.
 */
let downloaded = false

function broadcast(status: UpdateStatus): void {
  // After a successful download, ignore lower-priority lifecycle noise; only a
  // fresh `downloaded` or an `error` may supersede the staged state.
  if (downloaded && status.state !== 'downloaded' && status.state !== 'error') return

  lastStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updates:status', status)
  }
}

/**
 * Wire background auto-updates. Update checks run every 30 s, but only while
 * the renderer is on the login screen: the renderer gates the poll via
 * `updates:set-polling` (see Updates.tsx), so no checks fire on the rules page
 * or during an exam. Once an update is downloaded the renderer shows a
 * "Restart now?" prompt — login screen only — that calls
 * `updates:quit-and-install`; if the user defers, the update still installs on
 * the next quit (`autoInstallOnAppQuit`). We never force-restart a running
 * exam.
 *
 * In dev, updates are skipped unless FORCE_UPDATE_CHECK=1 (with a
 * dev-app-update.yml present) so local runs don't hit GitHub releases.
 */
export function initAutoUpdates(): void {
  // Renderer-initiated "Restart now": quit and apply the downloaded update,
  // relaunching into the new version. Silent so no NSIS UI flashes on the
  // kiosk. Registered unconditionally (even in dev) so the invoke never
  // rejects; the renderer only calls it once an update has actually downloaded.
  ipcMain.handle('updates:quit-and-install', () => {
    autoUpdater.quitAndInstall(true, true)
  })

  // Replay the latest status to a renderer that subscribes after the event
  // fired. Registered unconditionally so the invoke never rejects in dev.
  ipcMain.handle('updates:get-status', () => lastStatus)

  const forced = process.env.FORCE_UPDATE_CHECK === '1'
  if (is.dev && !forced) return

  autoUpdater.autoDownload = true
  // Fallback for users who dismiss the prompt: still install on the next quit.
  autoUpdater.autoInstallOnAppQuit = true
  // Persist updater logs to disk (%APPDATA%/WCL/logs/main.log and equivalents)
  // so update failures on a packaged kiosk are diagnosable after the fact.
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  // Poll timer, active only while the renderer says the login screen is up.
  let pollTimer: ReturnType<typeof setInterval> | null = null
  // A check (or the download it triggered) is in flight; skip poll ticks until
  // it reaches a terminal state so 30 s ticks can't stack concurrent checks.
  let busy = false

  autoUpdater.on('checking-for-update', () => {
    busy = true
    broadcast({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => {
    busy = false
    broadcast({ state: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) =>
    broadcast({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    // Staged: installs on "Restart now" (quitAndInstall) or the next quit via
    // autoInstallOnAppQuit. Mark it sticky and stop polling — a later check
    // would only re-emit noise that hides the renderer's prompt.
    downloaded = true
    stopPolling()
    broadcast({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    busy = false
    broadcast({ state: 'error', message: err == null ? 'unknown' : (err.stack || err).toString() })
  })

  const check = (): void => {
    if (downloaded || busy) return
    // Fire-and-forget; failures surface via the 'error' event above.
    autoUpdater.checkForUpdates().catch((err) => {
      busy = false
      console.error('[updater] check failed', err)
    })
  }

  const POLL_INTERVAL = 30 * 1000
  const startPolling = (): void => {
    if (downloaded || pollTimer) return
    check()
    pollTimer = setInterval(check, POLL_INTERVAL)
  }
  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // The renderer gates polling by screen: enabled on the login page, disabled
  // on the rules page and during/after an exam. An in-flight download is not
  // cancelled by disabling — it finishes silently and installs on quit.
  ipcMain.on('updates:set-polling', (_event, active: boolean) => {
    if (active) startPolling()
    else stopPolling()
  })

  app.on('will-quit', stopPolling)
}
