import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'

/**
 * examBridge: the renderer-facing surface for kiosk lockdown, the developer
 * override, and integrity reporting. The on* methods subscribe to an
 * ipcRenderer channel and return an unsubscribe function.
 */
interface ExamBridge {
  getDevMode(): Promise<boolean>
  onDevModeChanged(cb: (enabled: boolean) => void): () => void
  reportIntegrity(event: { type: string; meta?: Record<string, unknown> }): void
  onIntegrityWarning(cb: (info: { type: string; message: string }) => void): () => void
  onIntegrityEvent(
    cb: (event: { type: string; meta?: Record<string, unknown> }) => void
  ): () => void
  setExamLock(locked: boolean): void
  getDeviceId(): Promise<string>
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
  /** Apply the downloaded update now: quit, install, and relaunch. */
  restartToUpdate(): Promise<void>
}

/** Auto-update lifecycle status pushed from the main process. */
interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

/**
 * Synchronous key/value bridge over the main-process store (SQLite or JSON).
 * Synchronous so lib/buffer.ts keeps its localStorage-like API; get blocks on a
 * round-trip, set/delete are fire-and-forget but stay FIFO-ordered before get.
 */
interface StoreBridge {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

const store: StoreBridge = {
  get: (key) => ipcRenderer.sendSync('store:get', key),
  set: (key, value) => ipcRenderer.send('store:set', { key, value }),
  delete: (key) => ipcRenderer.send('store:delete', key)
}

const examBridge: ExamBridge = {
  getDevMode: () => ipcRenderer.invoke('exam:get-dev-mode'),
  getDeviceId: () => ipcRenderer.invoke('app:get-device-id'),
  onDevModeChanged: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean): void => cb(enabled)
    ipcRenderer.on('dev-mode-changed', listener)
    return () => {
      ipcRenderer.removeListener('dev-mode-changed', listener)
    }
  },
  reportIntegrity: (event) => {
    ipcRenderer.send('exam:report-integrity', event)
  },
  onIntegrityWarning: (cb) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      info: { type: string; message: string }
    ): void => cb(info)
    ipcRenderer.on('integrity-warning', listener)
    return () => {
      ipcRenderer.removeListener('integrity-warning', listener)
    }
  },
  onIntegrityEvent: (cb) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: { type: string; meta?: Record<string, unknown> }
    ): void => cb(event)
    ipcRenderer.on('integrity-event', listener)
    return () => {
      ipcRenderer.removeListener('integrity-event', listener)
    }
  },
  setExamLock: (locked) => {
    ipcRenderer.send('exam:set-lock', locked)
  },
  onUpdateStatus: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('updates:status', listener)
    return () => {
      ipcRenderer.removeListener('updates:status', listener)
    }
  },
  restartToUpdate: () => ipcRenderer.invoke('updates:quit-and-install')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('examBridge', examBridge)
    contextBridge.exposeInMainWorld('store', store)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.examBridge = examBridge
  // @ts-ignore (define in dts)
  window.store = store
}
