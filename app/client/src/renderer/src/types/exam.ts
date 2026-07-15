/**
 * Shared client-side types for the WCL exam flow. These mirror the backend
 * API contract (see docs/EXAM_SYSTEM_PLAN.md section 7). The client never
 * receives correct answers; grading is server-side only.
 */

export type SessionStatus = 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted'

export type QuestionType = 'SCQ' | 'MCQ'

export type QuestionStatus =
  | 'not_visited'
  | 'not_answered'
  | 'answered'
  | 'marked_for_review'
  | 'answered_marked'

export interface ExamMeta {
  examId: string
  title: string
  durationSeconds: number
  questionsToServe: number
  instructions: string[]
}

export interface LoginRequest {
  username: string
  password: string
  examId?: string
  /** Stable machine fingerprint for session/device binding. */
  deviceId?: string
}

export interface LoginResponse {
  token: string
  sessionId: string
  exam: ExamMeta
  sessionStatus: SessionStatus
}

export interface ManifestOption {
  optionId: string
  text: string
}

export interface ManifestQuestion {
  questionId: string
  type: QuestionType
  text: string
  marks: number
  imageUrl: string | null
  options: ManifestOption[]
}

export interface ExamManifest {
  examId: string
  shuffleSeed: string
  questions: ManifestQuestion[]
}

export interface BeginResponse {
  startedAt: string
  deadlineAt: string
  serverTime: string
  durationSeconds: number
  status: SessionStatus
}

export interface AnswerUpsert {
  questionId: string
  /** Stable server option IDs, never display position. */
  selectedOptionIds: string[]
  status: QuestionStatus
  /** Per-session monotonic sequence for stale-write protection. */
  clientSeq: number
  /** ISO-8601 timestamp. */
  answeredAt: string
}

export interface HeartbeatRequest {
  answers: AnswerUpsert[]
  clientTime: string
  /** Queued integrity events piggybacking on this heartbeat (no extra request). */
  integrityEvents?: { type: string; meta?: Record<string, unknown> }[]
}

export interface HeartbeatResponse {
  serverTime: string
  remainingSeconds: number
  deadlineAt: string
  status: SessionStatus
  acked: string[]
}

export interface SubmitResponse {
  status: SessionStatus
  submittedAt: string
}

export interface ResumeResponse {
  exam: ExamMeta
  manifest: ExamManifest
  answers: AnswerUpsert[]
  deadlineAt: string
  remainingSeconds: number
  serverTime: string
  status: SessionStatus
}

export interface TimeResponse {
  serverTime: string
}

export interface AnswerAck {
  acked: string[]
}

/**
 * Local, in-memory + buffered answer state for a single question. `synced`
 * tracks whether the server has acknowledged the latest change.
 */
export interface AnswerState {
  questionId: string
  selectedOptionIds: string[]
  status: QuestionStatus
  clientSeq: number
  answeredAt: string
  synced: boolean
}

export interface PaletteCounts {
  notVisited: number
  notAnswered: number
  answered: number
  markedForReview: number
  answeredMarked: number
}

export type ResultOutcome = 'correct' | 'wrong' | 'unanswered'

/**
 * One reviewed question in the post-submit result. Deliberately carries no
 * correct-answer marker — only the candidate's own selections, the outcome, and
 * the marks awarded (+marks | −0.5 | 0). Options keep the shuffled order shown
 * during the exam.
 */
export interface ResultQuestion {
  questionId: string
  type: QuestionType
  text: string
  imageUrl: string | null
  marks: number
  options: ManifestOption[]
  selectedOptionIds: string[]
  outcome: ResultOutcome
  marksAwarded: number
}

export interface ExamResult {
  sessionId: string
  examId: string
  status: SessionStatus
  submittedAt: string
  score: number
  maxScore: number
  correct: number
  wrong: number
  unanswered: number
  questions: ResultQuestion[]
}
