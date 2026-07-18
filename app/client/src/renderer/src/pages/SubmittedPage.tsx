import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RotateCw } from 'lucide-react'
import { useExam } from '@renderer/context/ExamProvider'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { buffer } from '@renderer/lib/buffer'
import wclLogo from '@renderer/assets/images/wcl.logo.png'
import type { ExamResult } from '@renderer/types/exam'

/**
 * Post-submission screen. Shows only the total score (no per-question review),
 * silently records a default 5/5 feedback, and closes the application after
 * 15 seconds so the machine is ready for the next candidate.
 */
export default function SubmittedPage(): React.JSX.Element {
  const { token, exam } = useExam()
  const [result, setResult] = useState<ExamResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const closing = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    if (!token) {
      setError('Your session is no longer available.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setResult(await api.result(token))
      // Score has been seen: drop the persisted session so the next launch
      // starts at the login screen for the next candidate.
      buffer.clearSession()
      if (!closing.current) {
        closing.current = true
        // Feedback is auto-submitted with full marks; a failure here must not
        // block the candidate, and repeats are ignored server-side.
        api.feedback(token, { platformRating: 5, infrastructureRating: 5 }).catch(() => undefined)
        // Give the candidate time to read the score, then close the app. The
        // exam lock is already released, so the main process honors this.
        setTimeout(() => window.electron.ipcRenderer.send('window-close'), 15_000)
      }
    } catch (err) {
      // Covers the transient 409 "Result not ready" race right after submit.
      setError(err instanceof Error ? err.message : 'Could not load your result')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading your result…
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md py-6">
        <div className="mb-8 flex justify-center">
          <img src={wclLogo} alt="Western Coalfields Limited" className="h-14 object-contain" />
        </div>

        <div className="bg-card text-card-foreground flex flex-col justify-center rounded-xl border p-8 text-center shadow-sm">
          <div className="bg-success/10 text-success mx-auto flex size-16 items-center justify-center rounded-full">
            <CheckCircle2 className="size-9" />
          </div>
          <h1 className="mt-5 text-xl font-semibold">Examination submitted</h1>
          {exam?.title && <p className="text-muted-foreground mt-1 text-sm">{exam.title}</p>}

          {result ? (
            <div className="mt-6">
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Your score
              </div>
              <div className="text-foreground mt-1 text-4xl font-semibold tabular-nums">
                {result.score}
                <span className="text-muted-foreground ml-1 text-xl">/ {result.maxScore}</span>
              </div>
              <p className="text-muted-foreground mt-6 text-sm">
                You may now leave the examination hall. The application will close shortly.
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your responses have been recorded. We could not load your score just now.
              </p>
              {error && (
                <div
                  role="alert"
                  className="bg-destructive/10 text-destructive border-destructive/30 mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button className="mt-4" variant="outline" onClick={() => void load()}>
                <RotateCw className="size-4" />
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
