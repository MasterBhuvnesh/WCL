/**
 * Runtime configuration for the renderer. The API base can be overridden with
 * VITE_API_BASE; it defaults to the local backend used during development.
 */

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:4000'

/** Heartbeat cadence: sync buffered answers and reconcile the clock. */
export const HEARTBEAT_INTERVAL_MS = 12_000

/** Reconnect backoff cap while the API is unreachable (1s → 2s → 4s … → cap). */
export const HEARTBEAT_MAX_BACKOFF_MS = 30_000

/** Number of /time samples used to estimate the client-server clock offset. */
export const TIME_SYNC_SAMPLES = 3

/** localStorage key prefix for the local answer write-buffer and session. */
export const STORAGE_PREFIX = 'wcl.exam'

/** Per-change push debounce. */
export const ANSWER_PUSH_DEBOUNCE_MS = 600
