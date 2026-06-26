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
  setExamLock(locked: boolean): void
}

const examBridge: ExamBridge = {
  getDevMode: () => ipcRenderer.invoke('exam:get-dev-mode'),
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
  setExamLock: (locked) => {
    ipcRenderer.send('exam:set-lock', locked)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('examBridge', examBridge)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.examBridge = examBridge
}
