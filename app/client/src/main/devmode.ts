import { BrowserWindow, globalShortcut } from 'electron'
import { lockdown } from './lockdown'

/**
 * Developer override for the WCL exam client.
 *
 * The global shortcut Ctrl+Alt+X toggles developer mode. This is the escape
 * hatch and MUST always work regardless of the exam-lock state, so it is
 * registered independently of the lockdown shortcut blocking and is never
 * unregistered while the app is running.
 *
 * Entering dev mode: disables kiosk, allows minimizing and app switching, allows
 * leaving fullscreen, opens DevTools, removes the blocking shortcuts (handled by
 * lockdown when enforcement is recomputed), and broadcasts 'dev-mode-changed'
 * with true.
 *
 * Leaving dev mode: re-applies enforcement (re-asserting the lock if an exam is
 * active), closes DevTools, and broadcasts 'dev-mode-changed' with false.
 */

const DEV_MODE_TOGGLE = 'Control+Alt+X'

let devModeEnabled = false
let targetWindow: BrowserWindow | null = null

function broadcastDevMode(enabled: boolean): void {
  const win = targetWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send('dev-mode-changed', enabled)
  }
}

function toggleDevMode(): void {
  const win = targetWindow
  if (!win || win.isDestroyed()) return

  devModeEnabled = !devModeEnabled

  // Inform lockdown first so enforcement is recomputed before we touch the UI.
  lockdown.setDevMode(devModeEnabled)

  if (devModeEnabled) {
    // Free the user: leave kiosk and fullscreen, open DevTools.
    if (win.isKiosk()) win.setKiosk(false)
    if (win.isFullScreen()) win.setFullScreen(false)
    if (!win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    lockdown.recordIntegrity({ type: 'dev_mode_enter' })
  } else {
    // Re-assert enforcement. lockdown.setDevMode already re-applied it; this
    // also re-enters fullscreen/kiosk when an exam is locked.
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools()
    }
    lockdown.applyEnforcement()
    lockdown.recordIntegrity({ type: 'dev_mode_exit' })
  }

  broadcastDevMode(devModeEnabled)
}

/**
 * Register the Ctrl+Alt+X global shortcut. This must be called once after the
 * window exists and remain registered for the app lifetime so the escape hatch
 * is always available.
 */
export function registerDevModeShortcut(window: BrowserWindow): void {
  targetWindow = window
  try {
    const ok = globalShortcut.register(DEV_MODE_TOGGLE, toggleDevMode)
    if (!ok) {
      console.error('[devmode] failed to register escape-hatch shortcut', DEV_MODE_TOGGLE)
    }
  } catch (error) {
    console.error('[devmode] error registering escape-hatch shortcut', error)
  }
}

export function isDevMode(): boolean {
  return devModeEnabled
}
