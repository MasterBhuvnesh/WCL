/**
 * Local write-buffer for the exam session. For this phase it is backed by
 * localStorage; the interface is intentionally narrow so it can later be
 * swapped for a better-sqlite3-backed store without touching callers
 * (see docs/EXAM_SYSTEM_PLAN.md section 4b).
 *
 * It persists the active session token and the per-question answer states so a
 * relaunch on the same device can restore optimistic local state immediately
 * while the server remains the source of truth.
 */

import { STORAGE_PREFIX } from './config'
import type { AnswerState } from '../types/exam'

interface PersistedSession {
  token: string
  sessionId: string
  examId: string
}

const SESSION_KEY = `${STORAGE_PREFIX}.session`
const answersKey = (sessionId: string): string => `${STORAGE_PREFIX}.answers.${sessionId}`

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
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

  clearSession(): void {
    const session = read<PersistedSession>(SESSION_KEY)
    try {
      localStorage.removeItem(SESSION_KEY)
      if (session) localStorage.removeItem(answersKey(session.sessionId))
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
