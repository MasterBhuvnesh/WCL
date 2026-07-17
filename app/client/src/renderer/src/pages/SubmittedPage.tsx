import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RotateCw, Star } from 'lucide-react'
import { useExam } from '@renderer/context/ExamProvider'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { buffer } from '@renderer/lib/buffer'
import wclLogo from '@renderer/assets/images/wcl.logo.png'
import rbuLogo from '@renderer/assets/images/rbu.png'
import { cn } from '@renderer/lib/utils'
import type { ExamResult } from '@renderer/types/exam'

/**
 * Post-submission screen. Shows only the total score (no per-question review),
 * then collects candidate feedback on the platform and the college
 * infrastructure. The window stays fullscreen with no title bar.
 */

function StarRating({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (n: number) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-foreground text-sm font-medium">{label}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} out of 5`}
            onClick={() => onChange(n)}
            className="p-1"
          >
            <Star
              className={cn(
                'size-7 transition-colors',
                n <= value ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40'
              )}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

function FeedbackForm({ token }: { token: string }): React.JSX.Element {
  const [platformRating, setPlatformRating] = useState(0)
  const [infrastructureRating, setInfrastructureRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = platformRating > 0 && infrastructureRating > 0 && !submitting

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      await api.feedback(token, {
        platformRating,
        infrastructureRating,
        comment: comment.trim() || undefined
      })
      setDone(true)
      // Give the candidate a moment to read the thank-you, then close the app
      // so the machine is ready for the next login. The exam lock is already
      // released after submission, so the main process honors window-close.
      setTimeout(() => window.electron.ipcRenderer.send('window-close'), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your feedback')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
        <CheckCircle2 className="text-success size-4" />
        Thank you for your feedback. The application will close shortly.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div>
        <h2 className="text-foreground text-base font-semibold">Your feedback</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Please rate your experience before you leave. This does not affect your score.
        </p>
      </div>

      <StarRating
        label="How was the examination platform?"
        value={platformRating}
        onChange={setPlatformRating}
      />
      <StarRating
        label="How was the college infrastructure (seating, labs, facilities)?"
        value={infrastructureRating}
        onChange={setInfrastructureRating}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="comment" className="text-foreground text-sm font-medium">
          Anything else? <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="comment"
          rows={3}
          maxLength={1000}
          placeholder="Tell us what went well or what we should improve"
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-none rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive border-destructive/30 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sending...
          </>
        ) : (
          'Submit feedback'
        )}
      </Button>
    </form>
  )
}

export default function SubmittedPage(): React.JSX.Element {
  const { token, exam } = useExam()
  const [result, setResult] = useState<ExamResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      <div className="w-full max-w-4xl py-6">
        <div className="mb-8 flex items-center justify-center gap-6">
          <img src={wclLogo} alt="Western Coalfields Limited" className="h-14 object-contain" />
          <img src={rbuLogo} alt="Ramdeobaba University" className="h-14 object-contain" />
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
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

          <div className="bg-card text-card-foreground rounded-xl border p-8 shadow-sm">
            {token ? (
              <FeedbackForm token={token} />
            ) : (
              <p className="text-muted-foreground text-center text-sm">
                You may now leave the examination hall.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
