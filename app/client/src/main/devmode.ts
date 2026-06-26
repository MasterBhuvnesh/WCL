import { BrowserWindow, globalShortcut } from 'electron'
import { lockdown } from './lockdown'

/**
 * Developer override for the WCL exam client.
 *
 * The global shortcut Ctrl+Shift+Alt+X toggles developer mode. This is the escape
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

const DEV_MODE_TOGGLE = 'Control+Shift+Alt+X'

let devModeEnabled = false
let targetWindow: BrowserWindow | null = null
let lastToggleAt = 0

function broadcastDevMode(enabled: boolean): void {
  const win = targetWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send('dev-mode-changed', enabled)
  }
}

function toggleDevMode(): void {
  const win = targetWindow
  if (!win || win.isDestroyed()) return

  // Debounce: both the global shortcut and the in-window key fallback can fire,
  // and key auto-repeat would otherwise flip the mode many times per second.
  const now = Date.now()
  if (now - lastToggleAt < 400) return
  lastToggleAt = now

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
 * Register the Ctrl+Shift+Alt+X developer-mode toggle. Two independent paths make the
 * escape hatch reliable:
 *
 * 1. A global shortcut, which also works when the window is not focused. This
 *    can fail to register on Windows when the OS or another application (for
 *    example Intel graphics hotkeys) already owns the combo; that failure is
 *    non-fatal and only logged as a warning.
 * 2. A window-level before-input-event handler, which always works while the
 *    window is focused. During an exam the window is held focused, so this path
 *    guarantees the escape hatch even when the global registration fails.
 *
 * Must be called once after the window exists.
 */
export function registerDevModeShortcut(window: BrowserWindow): void {
  targetWindow = window

  // Path 1: best-effort global shortcut.
  try {
    const ok = globalShortcut.register(DEV_MODE_TOGGLE, toggleDevMode)
    if (!ok) {
      console.warn(
        '[devmode] global shortcut',
        DEV_MODE_TOGGLE,
        'is unavailable (likely reserved by the OS or another app); using the in-window fallback instead.'
      )
    }
  } catch (error) {
    console.warn('[devmode] error registering global escape-hatch shortcut', error)
  }

  // Path 2: reliable in-window fallback (Ctrl+Shift+Alt+X while the window is focused).
  window.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown' &&
      input.control &&
      input.shift &&
      input.alt &&
      !input.meta &&
      input.code === 'KeyX'
    ) {
      toggleDevMode()
    }
  })
}

export function isDevMode(): boolean {
  return devModeEnabled
}
