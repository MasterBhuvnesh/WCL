/**
 * Local write-buffer for the exam session. Backed by the main-process store
 * (SQLite via node:sqlite, or a JSON file fallback) over synchronous IPC, with
 * a localStorage fallback when that bridge is absent (e.g. web dev mode). The
 * interface is intentionally narrow so callers never see the backend.
 *
 * It persists the active session token, the client state-machine status, and
 * the per-question answer states so a relaunch on the same device can restore
 * optimistic local state and the correct screen immediately while the server
 * remains the source of truth.
 */

import { STORAGE_PREFIX } from './config'
import type { AnswerState, SessionStatus } from '../types/exam'

interface PersistedSession {
  token: string
  sessionId: string
  examId: string
  /** Optional: absent in sessions persisted before the watermark existed. */
  username?: string
  /** Persisted state-machine status so relaunch resumes on the right screen. */
  status?: SessionStatus
}

const SESSION_KEY = `${STORAGE_PREFIX}.session`
const answersKey = (sessionId: string): string => `${STORAGE_PREFIX}.answers.${sessionId}`

interface RawStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

/** Prefer the main-process store bridge; fall back to localStorage in web dev. */
function storage(): RawStore {
  if (typeof window !== 'undefined' && window.store) return window.store
  return {
    get: (key) => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* best-effort */
      }
    },
    delete: (key) => {
      try {
        localStorage.removeItem(key)
      } catch {
        /* best-effort */
      }
    }
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = storage().get(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    storage().set(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable: optimistic local cache is best-effort */
  }
}

export const buffer = {
  saveSession(session: PersistedSession): void {
    write(SESSION_KEY, session)
  },

  loadSession(): PersistedSession | null {
    return read<PersistedSession>(SESSION_KEY)
  },

  /** Persist a state-machine transition onto the existing session record. */
  saveStatus(status: SessionStatus): void {
    const session = read<PersistedSession>(SESSION_KEY)
    if (session) write(SESSION_KEY, { ...session, status })
  },

  clearSession(): void {
    const session = read<PersistedSession>(SESSION_KEY)
    try {
      storage().delete(SESSION_KEY)
      if (session) storage().delete(answersKey(session.sessionId))
    } catch {
      /* ignore */
    }
  },

  loadAnswers(sessionId: string): Record<string, AnswerState> {
    return read<Record<string, AnswerState>>(answersKey(sessionId)) ?? {}
  },

  saveAnswers(sessionId: string, answers: Record<string, AnswerState>): void {
    write(answersKey(sessionId), answers)
  }
}

export type { PersistedSession }
