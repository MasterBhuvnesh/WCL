import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain } from 'electron'
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

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updates:status', status)
  }
}

/**
 * Wire background auto-updates. Downloads happen silently on startup. Once an
 * update is downloaded the renderer shows a "Restart now?" prompt (except during
 * an active exam) that calls `updates:quit-and-install`; if the user defers, the
 * update still installs on the next quit (`autoInstallOnAppQuit`). We never
 * force-restart a running exam.
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

  const forced = process.env.FORCE_UPDATE_CHECK === '1'
  if (is.dev && !forced) return

  autoUpdater.autoDownload = true
  // Fallback for users who dismiss the prompt: still install on the next quit.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    broadcast({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    // Installed automatically on the next quit via autoInstallOnAppQuit.
    broadcast({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) =>
    broadcast({ state: 'error', message: err == null ? 'unknown' : (err.stack || err).toString() })
  )

  // Fire-and-forget; network failures surface via the 'error' event above and
  // must never block app startup.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] initial check failed', err)
  })

  // Re-check periodically for long-lived sessions (every 30 min). Still only
  // installs on quit, so this is safe during an exam.
  const THIRTY_MINUTES = 30 * 60 * 1000
  const timer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] periodic check failed', err)
    })
  }, THIRTY_MINUTES)
  app.on('will-quit', () => clearInterval(timer))
}
