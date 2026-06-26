/**
 * ExamProvider owns all exam state and side effects: authentication, the
 * server-reconciled countdown, per-question answer state, the buffered sync
 * loop, and integration with the Electron bridge (dev mode, exam lock,
 * integrity warnings). Screens are pure consumers via useExam().
 *
 * Timing model (see docs/EXAM_SYSTEM_PLAN.md section 4a): the server owns the
 * clock. We store the absolute deadline plus an estimated clock offset and
 * derive remainingSeconds locally each second, re-reconciling on every
 * heartbeat. Reaching zero triggers auto-submit. The server still enforces the
 * real deadline; the client timer is a faithful display only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { api, ApiError } from '../lib/api'
import { buffer } from '../lib/buffer'
import { HEARTBEAT_INTERVAL_MS, ANSWER_PUSH_DEBOUNCE_MS } from '../lib/config'
import type {
  AnswerState,
  AnswerUpsert,
  ExamManifest,
  ExamMeta,
  LoginRequest,
  ManifestQuestion,
  PaletteCounts,
  QuestionStatus,
  SessionStatus
} from '../types/exam'

export interface ExamContextValue {
  loading: boolean
  error: string | null
  online: boolean
  devMode: boolean
  integrityWarning: { type: string; message: string } | null

  token: string | null
  exam: ExamMeta | null
  sessionStatus: SessionStatus
  isAuthenticated: boolean
  isStarted: boolean
  isSubmitted: boolean

  manifest: ExamManifest | null
  questions: ManifestQuestion[]
  answers: Record<string, AnswerState>
  currentIndex: number
  currentQuestion: ManifestQuestion | null
  remainingSeconds: number
  counts: PaletteCounts

  login: (req: LoginRequest) => Promise<void>
  beginExam: () => Promise<void>
  goto: (index: number) => void
  next: () => void
  prev: () => void
  selectOption: (questionId: string, optionId: string) => void
  toggleMarkForReview: (questionId: string) => void
  clearResponse: (questionId: string) => void
  submitExam: () => Promise<void>
  dismissIntegrityWarning: () => void
  clearError: () => void
}

const ExamContext = createContext<ExamContextValue | null>(null)

function nowIso(): string {
  return new Date().toISOString()
}

function isMarked(status: QuestionStatus): boolean {
  return status === 'marked_for_review' || status === 'answered_marked'
}

function deriveStatus(hasSelection: boolean, marked: boolean): QuestionStatus {
  if (hasSelection) return marked ? 'answered_marked' : 'answered'
  return marked ? 'marked_for_review' : 'not_answered'
}

export function ExamProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [devMode, setDevMode] = useState(false)
  const [integrityWarning, setIntegrityWarning] = useState<{ type: string; message: string } | null>(
    null
  )

  const [token, setToken] = useState<string | null>(null)
  const [exam, setExam] = useState<ExamMeta | null>(null)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('not_started')
  const [manifest, setManifest] = useState<ExamManifest | null>(null)
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  // Refs for values accessed inside intervals/timeouts (avoid stale closures).
  const tokenRef = useRef<string | null>(null)
  const answersRef = useRef<Record<string, AnswerState>>({})
  const sessionIdRef = useRef<string | null>(null)
  const deadlineMsRef = useRef<number | null>(null)
  const offsetMsRef = useRef(0)
  const seqRef = useRef(1)
  const statusRef = useRef<SessionStatus>('not_started')
  const syncingRef = useRef(false)
  const submittingRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  tokenRef.current = token
  answersRef.current = answers
  statusRef.current = sessionStatus

  const persistAnswers = useCallback((next: Record<string, AnswerState>) => {
    if (sessionIdRef.current) buffer.saveAnswers(sessionIdRef.current, next)
  }, [])

  const recomputeRemaining = useCallback((): number => {
    if (deadlineMsRef.current == null) return 0
    const ms = deadlineMsRef.current - (Date.now() + offsetMsRef.current)
    return Math.max(0, Math.round(ms / 1000))
  }, [])

  // --- buffered sync via the heartbeat endpoint --------------------------------
  const sync = useCallback(async (): Promise<void> => {
    const t = tokenRef.current
    if (!t || syncingRef.current) return
    if (statusRef.current === 'submitted' || statusRef.current === 'auto_submitted') return

    const unsynced: AnswerUpsert[] = Object.values(answersRef.current)
      .filter((a) => !a.synced)
      .map(({ questionId, selectedOptionIds, status, clientSeq, answeredAt }) => ({
        questionId,
        selectedOptionIds,
        status,
        clientSeq,
        answeredAt
      }))

    syncingRef.current = true
    try {
      const res = await api.heartbeat(t, { answers: unsynced, clientTime: nowIso() })
      setOnline(true)
      offsetMsRef.current = new Date(res.serverTime).getTime() - Date.now()
      deadlineMsRef.current = new Date(res.deadlineAt).getTime()
      setRemainingSeconds(recomputeRemaining())

      if (res.acked.length) {
        const ackedSet = new Set(res.acked)
        setAnswers((prev) => {
          const next = { ...prev }
          for (const id of ackedSet) {
            if (next[id]) next[id] = { ...next[id], synced: true }
          }
          persistAnswers(next)
          return next
        })
      }

      if (res.status === 'auto_submitted' && statusRef.current === 'in_progress') {
        finalizeSubmitted('auto_submitted')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setOnline(false)
    } finally {
      syncingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recomputeRemaining, persistAnswers])

  const scheduleSync = useCallback(() => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => void sync(), ANSWER_PUSH_DEBOUNCE_MS)
  }, [sync])

  const stopLoops = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    heartbeatRef.current = null
    tickRef.current = null
    pushTimerRef.current = null
  }, [])

  const finalizeSubmitted = useCallback(
    (status: SessionStatus) => {
      stopLoops()
      setSessionStatus(status)
      statusRef.current = status
      window.examBridge?.setExamLock(false)
    },
    [stopLoops]
  )

  const startLoops = useCallback(() => {
    stopLoops()
    heartbeatRef.current = setInterval(() => void sync(), HEARTBEAT_INTERVAL_MS)
    tickRef.current = setInterval(() => {
      const remaining = recomputeRemaining()
      setRemainingSeconds(remaining)
      if (remaining <= 0 && statusRef.current === 'in_progress' && !submittingRef.current) {
        void submitExam()
      }
    }, 1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, recomputeRemaining, stopLoops])

  // --- answer mutations --------------------------------------------------------
  const upsertAnswer = useCallback(
    (questionId: string, mutate: (prev: AnswerState | undefined) => AnswerState) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: mutate(prev[questionId]) }
        persistAnswers(next)
        return next
      })
      scheduleSync()
    },
    [persistAnswers, scheduleSync]
  )

  const questionType = useCallback(
    (questionId: string) => manifest?.questions.find((q) => q.questionId === questionId)?.type,
    [manifest]
  )

  const selectOption = useCallback(
    (questionId: string, optionId: string) => {
      upsertAnswer(questionId, (prev) => {
        const marked = prev ? isMarked(prev.status) : false
        const existing = prev?.selectedOptionIds ?? []
        let selected: string[]
        if (questionType(questionId) === 'MCQ') {
          selected = existing.includes(optionId)
            ? existing.filter((id) => id !== optionId)
            : [...existing, optionId]
        } else {
          selected = [optionId]
        }
        return {
          questionId,
          selectedOptionIds: selected,
          status: deriveStatus(selected.length > 0, marked),
          clientSeq: seqRef.current++,
          answeredAt: nowIso(),
          synced: false
        }
      })
    },
    [upsertAnswer, questionType]
  )

  const toggleMarkForReview = useCallback(
    (questionId: string) => {
      upsertAnswer(questionId, (prev) => {
        const selected = prev?.selectedOptionIds ?? []
        const marked = prev ? isMarked(prev.status) : false
        return {
          questionId,
          selectedOptionIds: selected,
          status: deriveStatus(selected.length > 0, !marked),
          clientSeq: seqRef.current++,
          answeredAt: nowIso(),
          synced: false
        }
      })
    },
    [upsertAnswer]
  )

  const clearResponse = useCallback(
    (questionId: string) => {
      upsertAnswer(questionId, (prev) => {
        const marked = prev ? isMarked(prev.status) : false
        return {
          questionId,
          selectedOptionIds: [],
          status: deriveStatus(false, marked),
          clientSeq: seqRef.current++,
          answeredAt: nowIso(),
          synced: false
        }
      })
    },
    [upsertAnswer]
  )

  const markVisited = useCallback(
    (questionId: string) => {
      const existing = answersRef.current[questionId]
      if (existing && existing.status !== 'not_visited') return
      upsertAnswer(questionId, () => ({
        questionId,
        selectedOptionIds: [],
        status: 'not_answered',
        clientSeq: seqRef.current++,
        answeredAt: nowIso(),
        synced: false
      }))
    },
    [upsertAnswer]
  )

  const goto = useCallback(
    (index: number) => {
      const list = manifest?.questions ?? []
      if (index < 0 || index >= list.length) return
      setCurrentIndex(index)
      markVisited(list[index].questionId)
    },
    [manifest, markVisited]
  )

  const next = useCallback(() => goto(currentIndex + 1), [goto, currentIndex])
  const prev = useCallback(() => goto(currentIndex - 1), [goto, currentIndex])

  // --- session lifecycle -------------------------------------------------------
  const hydrateFromManifest = useCallback(
    (m: ExamManifest, restored: Record<string, AnswerState>) => {
      setManifest(m)
      setAnswers(restored)
      answersRef.current = restored
      const maxSeq = Object.values(restored).reduce((acc, a) => Math.max(acc, a.clientSeq), 0)
      seqRef.current = maxSeq + 1
      const firstId = m.questions[0]?.questionId
      setCurrentIndex(0)
      if (firstId && !restored[firstId]) {
        // mark the first question visited once state is set
        setTimeout(() => markVisited(firstId), 0)
      }
    },
    [markVisited]
  )

  const login = useCallback(async (req: LoginRequest) => {
    setError(null)
    try {
      const res = await api.login(req)
      setToken(res.token)
      tokenRef.current = res.token
      sessionIdRef.current = res.sessionId
      setExam(res.exam)
      setSessionStatus(res.sessionStatus)
      statusRef.current = res.sessionStatus
      buffer.saveSession({ token: res.token, sessionId: res.sessionId, examId: res.exam.examId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
      throw err
    }
  }, [])

  const beginExam = useCallback(async () => {
    const t = tokenRef.current
    if (!t) throw new Error('Not authenticated')
    setError(null)
    try {
      const begin = await api.begin(t)
      offsetMsRef.current = new Date(begin.serverTime).getTime() - Date.now()
      deadlineMsRef.current = new Date(begin.deadlineAt).getTime()
      setSessionStatus('in_progress')
      statusRef.current = 'in_progress'
      const m = await api.manifest(t)
      const restored = sessionIdRef.current ? buffer.loadAnswers(sessionIdRef.current) : {}
      hydrateFromManifest(m, restored)
      setRemainingSeconds(recomputeRemaining())
      window.examBridge?.setExamLock(true)
      startLoops()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start the exam'
      setError(message)
      throw err
    }
  }, [hydrateFromManifest, recomputeRemaining, startLoops])

  const submitExam = useCallback(async () => {
    const t = tokenRef.current
    if (!t || submittingRef.current) return
    submittingRef.current = true
    try {
      await sync()
      const res = await api.submit(t)
      finalizeSubmitted(res.status)
      if (sessionIdRef.current) buffer.clearSession()
    } catch (err) {
      // Even if the network submit fails, lock locally; the server enforces the
      // deadline regardless and buffered answers will reconcile.
      if (err instanceof ApiError && err.status === 0) setOnline(false)
      finalizeSubmitted('submitted')
    } finally {
      submittingRef.current = false
    }
  }, [sync, finalizeSubmitted])

  // --- resume on launch (same-device crash recovery) ---------------------------
  useEffect(() => {
    let cancelled = false
    const persisted = buffer.loadSession()
    if (!persisted) {
      setLoading(false)
      return
    }
    setToken(persisted.token)
    tokenRef.current = persisted.token
    sessionIdRef.current = persisted.sessionId
    api
      .resume(persisted.token)
      .then((res) => {
        if (cancelled) return
        setExam(res.exam)
        setSessionStatus(res.status)
        statusRef.current = res.status
        offsetMsRef.current = new Date(res.serverTime).getTime() - Date.now()
        deadlineMsRef.current = new Date(res.deadlineAt).getTime()
        const restored: Record<string, AnswerState> = {}
        for (const a of res.answers) restored[a.questionId] = { ...a, synced: true }
        const local = buffer.loadAnswers(persisted.sessionId)
        for (const [id, a] of Object.entries(local)) {
          if (!restored[id] || a.clientSeq > restored[id].clientSeq) restored[id] = a
        }
        hydrateFromManifest(res.manifest, restored)
        setRemainingSeconds(recomputeRemaining())
        if (res.status === 'in_progress') {
          window.examBridge?.setExamLock(true)
          startLoops()
        }
      })
      .catch(() => {
        if (cancelled) return
        // stale/expired session: fall back to a clean login
        buffer.clearSession()
        setToken(null)
        tokenRef.current = null
        setSessionStatus('not_started')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Electron bridge: dev mode, integrity warnings, lifecycle ----------------
  useEffect(() => {
    const bridge = window.examBridge
    if (!bridge) return
    void bridge.getDevMode().then(setDevMode)
    const offDev = bridge.onDevModeChanged(setDevMode)
    const offWarn = bridge.onIntegrityWarning((info) => setIntegrityWarning(info))
    return () => {
      offDev?.()
      offWarn?.()
    }
  }, [])

  // Renderer-side integrity signal: tab/window hidden during an active exam.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden' && statusRef.current === 'in_progress') {
        window.examBridge?.reportIntegrity({ type: 'visibility_hidden' })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // online/offline indicator from the platform
  useEffect(() => {
    const on = (): void => setOnline(true)
    const off = (): void => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => stopLoops, [stopLoops])

  // --- derived -----------------------------------------------------------------
  const questions = manifest?.questions ?? []
  const currentQuestion = questions[currentIndex] ?? null

  const counts = useMemo<PaletteCounts>(() => {
    const c: PaletteCounts = {
      notVisited: 0,
      notAnswered: 0,
      answered: 0,
      markedForReview: 0,
      answeredMarked: 0
    }
    for (const q of questions) {
      const status = answers[q.questionId]?.status ?? 'not_visited'
      if (status === 'not_visited') c.notVisited++
      else if (status === 'not_answered') c.notAnswered++
      else if (status === 'answered') c.answered++
      else if (status === 'marked_for_review') c.markedForReview++
      else if (status === 'answered_marked') c.answeredMarked++
    }
    return c
  }, [questions, answers])

  const isSubmitted = sessionStatus === 'submitted' || sessionStatus === 'auto_submitted'

  const value: ExamContextValue = {
    loading,
    error,
    online,
    devMode,
    integrityWarning,
    token,
    exam,
    sessionStatus,
    isAuthenticated: !!token,
    isStarted: sessionStatus === 'in_progress' && manifest != null,
    isSubmitted,
    manifest,
    questions,
    answers,
    currentIndex,
    currentQuestion,
    remainingSeconds,
    counts,
    login,
    beginExam,
    goto,
    next,
    prev,
    selectOption,
    toggleMarkForReview,
    clearResponse,
    submitExam,
    dismissIntegrityWarning: () => setIntegrityWarning(null),
    clearError: () => setError(null)
  }

  return <ExamContext.Provider value={value}>{children}</ExamContext.Provider>
}

export function useExam(): ExamContextValue {
  const ctx = useContext(ExamContext)
  if (!ctx) throw new Error('useExam must be used within an ExamProvider')
  return ctx
}
