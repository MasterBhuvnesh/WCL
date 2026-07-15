import { BrowserWindow, globalShortcut, Input, ipcMain } from 'electron'

/**
 * Kiosk lockdown and integrity enforcement for the WCL exam client.
 *
 * Strict enforcement is ACTIVE only when (examLock === true AND devMode === false).
 * While active the window is trapped in kiosk + fullscreen, common escape and
 * tooling shortcuts are swallowed, and any attempt to leave the window is logged
 * as an integrity event and reversed.
 *
 * IMPORTANT WINDOWS LIMITATION:
 * Alt+Tab and the Windows Super (Win) key CANNOT be reliably intercepted from
 * pure Electron on Windows. The OS reserves them for the shell, and Chromium's
 * `before-input-event` plus `globalShortcut` do not receive them. Fully blocking
 * these requires either a native OS-level low-level keyboard hook
 * (WH_KEYBOARD_LL in a native addon) or Windows Assigned Access / kiosk policy
 * (a Group Policy / Shell Launcher configuration). This module implements every
 * defence achievable in pure Electron and deliberately does NOT claim to block
 * Alt+Tab or the Windows key.
 */

export interface IntegrityEvent {
  type: string
  meta?: Record<string, unknown>
  ts: number
}

// Global shortcuts swallowed while strict enforcement is active.
const BLOCKED_GLOBAL_SHORTCUTS = [
  'CommandOrControl+R',
  'CommandOrControl+Shift+R',
  'CommandOrControl+Shift+I',
  'CommandOrControl+W',
  'CommandOrControl+M',
  'CommandOrControl+Q',
  'F11',
  'F12'
]

class Lockdown {
  private window: BrowserWindow | null = null
  private examLock = false
  private devMode = false
  private enforcing = false
  private readonly integrityEvents: IntegrityEvent[] = []

  // Bound handlers so they can be detached reliably.
  private readonly onLeaveFullScreen = (): void => this.handleLeaveFullScreen()
  private readonly onMinimize = (): void => this.handleMinimize()
  private readonly onBlur = (): void => this.handleBlur()
  private readonly onBeforeInput = (event: Electron.Event, input: Input): void =>
    this.handleBeforeInput(event, input)

  /** Attach the main window. Call once after the window is created. */
  public attach(window: BrowserWindow): void {
    this.window = window
    window.on('leave-full-screen', this.onLeaveFullScreen)
    window.on('minimize', this.onMinimize)
    window.on('blur', this.onBlur)
    window.webContents.on('before-input-event', this.onBeforeInput)
    window.on('closed', () => {
      this.window = null
      this.enforcing = false
      this.unregisterShortcuts()
    })
  }

  /** Strict enforcement is active only when locked AND not in dev mode. */
  public isEnforcing(): boolean {
    return this.examLock && !this.devMode
  }

  public getDevMode(): boolean {
    return this.devMode
  }

  /** Set by the renderer via examBridge.setExamLock. Re-applies enforcement. */
  public setExamLock(locked: boolean): void {
    this.examLock = locked
    this.applyEnforcement()
  }

  /**
   * Set by the developer override (Ctrl+Shift+Alt+X). When leaving dev mode the lock
   * is re-asserted if an exam is still active.
   */
  public setDevMode(enabled: boolean): void {
    this.devMode = enabled
    this.applyEnforcement()
  }

  public getIntegrityEvents(): readonly IntegrityEvent[] {
    return this.integrityEvents
  }

  /**
   * Record an integrity event: log it, buffer it, and forward it to the
   * renderer, which owns the session token and uploads it to /exam/integrity.
   */
  public recordIntegrity(event: { type: string; meta?: Record<string, unknown> }): void {
    const entry: IntegrityEvent = {
      type: event.type,
      meta: event.meta,
      ts: Date.now()
    }
    this.integrityEvents.push(entry)
    console.log('[integrity]', JSON.stringify(entry))
    this.window?.webContents.send('integrity-event', { type: entry.type, meta: entry.meta })
  }

  /**
   * Re-evaluate the current state and bring the window and shortcut registration
   * in line with it. Safe to call repeatedly (idempotent for a given state).
   */
  public applyEnforcement(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return

    const shouldEnforce = this.isEnforcing()
    this.enforcing = shouldEnforce

    if (this.devMode) {
      // (a) Developer mode: release everything so the app stays debuggable.
      this.unregisterShortcuts()
      if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false)
      if (win.isKiosk()) win.setKiosk(false)
    } else if (shouldEnforce) {
      // (b) Active exam: trap the window with kiosk + fullscreen + always-on-top.
      // 'screen-saver' is the highest level: it keeps the window over the
      // taskbar and any Start menu / other window the user manages to open, and
      // combined with the blur refocus makes the desktop effectively unreachable.
      if (!win.isVisible()) win.show()
      if (win.isMinimized()) win.restore()
      if (!win.isKiosk()) win.setKiosk(true)
      if (!win.isFullScreen()) win.setFullScreen(true)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.focus()
      this.registerShortcuts()
    } else {
      // (c) Pre-exam / post-submit (non-dev): assert kiosk + fullscreen only.
      // No always-on-top, no global shortcut grabbing, and no integrity events.
      this.unregisterShortcuts()
      if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false)
      if (!win.isKiosk()) win.setKiosk(true)
      if (!win.isFullScreen()) win.setFullScreen(true)
    }
  }

  /**
   * The renderer requests window minimize/maximize/close via IPC. While strict
   * enforcement is active these must be ignored. Returns true when the action is
   * permitted, false when it is blocked.
   */
  public allowWindowControl(): boolean {
    return !this.isEnforcing()
  }

  // --- Window event handlers ---------------------------------------------

  private handleLeaveFullScreen(): void {
    // Re-assert kiosk whenever we are not in dev mode (login screen included);
    // only an active exam records it as an integrity event.
    if (this.devMode) return
    const win = this.window
    if (!win || win.isDestroyed()) return
    // Immediately restore and re-enter fullscreen.
    if (!win.isFullScreen()) win.setFullScreen(true)
    if (!win.isKiosk()) win.setKiosk(true)
    win.focus()
    if (this.isEnforcing()) this.recordIntegrity({ type: 'fullscreen_exit_blocked' })
  }

  private handleMinimize(): void {
    if (this.devMode) return
    const win = this.window
    if (!win || win.isDestroyed()) return
    // Immediately restore and re-enter fullscreen.
    win.restore()
    if (!win.isFullScreen()) win.setFullScreen(true)
    if (!win.isKiosk()) win.setKiosk(true)
    win.focus()
    if (this.isEnforcing()) this.recordIntegrity({ type: 'minimize_blocked' })
  }

  private handleBlur(): void {
    if (!this.isEnforcing()) return
    const win = this.window
    if (!win || win.isDestroyed()) return
    // Re-assert the trap and pull focus back above whatever was opened.
    win.setAlwaysOnTop(true, 'screen-saver')
    if (!win.isFullScreen()) win.setFullScreen(true)
    if (!win.isKiosk()) win.setKiosk(true)
    win.show()
    win.focus()
    win.webContents.send('integrity-warning', {
      type: 'focus_lost',
      message: 'Leaving the exam window is not allowed.'
    })
    this.recordIntegrity({ type: 'focus_lost' })
  }

  /**
   * Best-effort in-renderer key blocking while strict enforcement is active.
   * Covers DevTools, reload, zoom, Ctrl+W, Ctrl+M and Alt+F4.
   *
   * NOTE: Alt+Tab and the Windows (Super) key are handled by the OS shell and
   * never reach this handler, so they cannot be blocked here. See file header.
   */
  private handleBeforeInput(event: Electron.Event, input: Input): void {
    if (!this.enforcing) return
    if (input.type !== 'keyDown') return

    const ctrl = input.control || input.meta
    const key = input.key

    const isFunctionDevTools = key === 'F12'
    const isFunctionReload = key === 'F5'
    const isFunctionFullscreen = key === 'F11'
    const isDevTools = ctrl && input.shift && (key === 'I' || key === 'i')
    const isReload = ctrl && (key === 'R' || key === 'r')
    const isClose = ctrl && (key === 'W' || key === 'w')
    const isMinimizeKey = ctrl && (key === 'M' || key === 'm')
    const isQuit = ctrl && (key === 'Q' || key === 'q')
    const isZoom = ctrl && (key === '+' || key === '-' || key === '=' || key === '0')
    const isAltF4 = input.alt && key === 'F4'

    if (
      isFunctionDevTools ||
      isFunctionReload ||
      isFunctionFullscreen ||
      isDevTools ||
      isReload ||
      isClose ||
      isMinimizeKey ||
      isQuit ||
      isZoom ||
      isAltF4
    ) {
      event.preventDefault()
    }
  }

  // --- Global shortcut registration --------------------------------------

  private registerShortcuts(): void {
    for (const accelerator of BLOCKED_GLOBAL_SHORTCUTS) {
      if (globalShortcut.isRegistered(accelerator)) continue
      try {
        // Registering with a no-op handler swallows the shortcut globally.
        globalShortcut.register(accelerator, () => {
          this.recordIntegrity({ type: 'shortcut_blocked', meta: { accelerator } })
        })
      } catch (error) {
        console.error('[lockdown] failed to register shortcut', accelerator, error)
      }
    }
  }

  private unregisterShortcuts(): void {
    for (const accelerator of BLOCKED_GLOBAL_SHORTCUTS) {
      if (globalShortcut.isRegistered(accelerator)) {
        globalShortcut.unregister(accelerator)
      }
    }
  }
}

/** Singleton lockdown controller for the main process. */
export const lockdown = new Lockdown()

/**
 * Register the examBridge IPC handlers. Call once after app is ready.
 * The window-control channels are intentionally NOT registered here; they live
 * in index.ts and must consult lockdown.allowWindowControl().
 */
export function registerLockdownIpc(): void {
  ipcMain.handle('exam:get-dev-mode', () => lockdown.getDevMode())
  ipcMain.on('exam:set-lock', (_event, locked: boolean) => {
    lockdown.setExamLock(Boolean(locked))
  })
  ipcMain.on(
    'exam:report-integrity',
    (_event, payload: { type: string; meta?: Record<string, unknown> }) => {
      if (payload && typeof payload.type === 'string') {
        lockdown.recordIntegrity({ type: payload.type, meta: payload.meta })
      }
    }
  )
}
