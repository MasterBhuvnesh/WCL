/**
 * Thin typed client for the WCL backend. All exam endpoints require a bearer
 * token obtained from /auth/login. Network/transport concerns live here; the
 * exam logic lives in the ExamProvider.
 */

import { API_BASE } from './config'
import type {
  AnswerAck,
  AnswerUpsert,
  BeginResponse,
  ExamManifest,
  ExamResult,
  HeartbeatRequest,
  HeartbeatResponse,
  LoginRequest,
  LoginResponse,
  ResumeResponse,
  SubmitResponse,
  TimeResponse
} from '../types/exam'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {}
): Promise<T> {
  const { method = 'GET', body, token, signal } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    })
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : 'Network request failed')
  }

  const text = await res.text()
  const data = text ? safeParse(text) : undefined

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    if (data && typeof data === 'object' && 'error' in data) {
      const e = (data as { error?: unknown }).error
      if (e) message = String(e)
    }
    throw new ApiError(res.status, message)
  }
  return data as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const api = {
  health: () => request<{ status: string; service: string; time: string }>('/health'),

  login: (req: LoginRequest) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: req }),

  begin: (token: string) => request<BeginResponse>('/exam/begin', { method: 'POST', token }),

  manifest: (token: string) => request<ExamManifest>('/exam/manifest', { token }),

  time: () => request<TimeResponse>('/time'),

  answer: (token: string, answer: AnswerUpsert) =>
    request<AnswerAck>('/exam/answer', { method: 'POST', token, body: answer }),

  heartbeat: (token: string, req: HeartbeatRequest) =>
    request<HeartbeatResponse>('/exam/heartbeat', { method: 'POST', token, body: req }),

  submit: (token: string) => request<SubmitResponse>('/exam/submit', { method: 'POST', token }),

  resume: (token: string) => request<ResumeResponse>('/exam/resume', { method: 'POST', token }),

  result: (token: string) => request<ExamResult>('/exam/result', { token })
}
