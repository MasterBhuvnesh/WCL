import { ElectronAPI } from '@electron-toolkit/preload'

export {}

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
  getAppVersion(): Promise<string>
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
  getUpdateStatus(): Promise<UpdateStatus | null>
  restartToUpdate(): Promise<void>
  setUpdatePolling(active: boolean): void
}

interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

interface StoreBridge {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    examBridge: ExamBridge
    store?: StoreBridge
  }
}
