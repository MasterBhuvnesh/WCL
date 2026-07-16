import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Loader2, MinusCircle, RotateCw, XCircle } from 'lucide-react'
import { useExam } from '@renderer/context/ExamProvider'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { buffer } from '@renderer/lib/buffer'
import wclLogo from '@renderer/assets/images/wcl.logo.png'
import rbuLogo from '@renderer/assets/images/rbu.png'
import { cn } from '@renderer/lib/utils'
import type { ExamResult, ResultOutcome } from '@renderer/types/exam'

/**
 * Post-submission result screen. The score is shown immediately (no publish
 * gating). The review lists each question with the candidate's own selections,
 * the outcome, and the marks awarded — it never reveals which option was
 * correct, because the API deliberately never sends that.
 */

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

/** +marks | −0.5 | 0 with a proper minus sign. */
function formatMarks(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

const OUTCOME: Record<
  ResultOutcome,
  { label: string; badge: string; icon: typeof CheckCircle2 }
> = {
  correct: { label: 'Correct', badge: 'bg-success/10 text-success', icon: CheckCircle2 },
  wrong: { label: 'Incorrect', badge: 'bg-destructive/10 text-destructive', icon: XCircle },
  unanswered: { label: 'Unanswered', badge: 'bg-muted text-muted-foreground', icon: MinusCircle }
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
      // starts at the login screen for the next candidate. Resume paths are
      // unaffected — a crash before this point keeps the session and lands
      // back here; in-progress sessions never reach this code.
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

  if (error || !result) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="bg-card text-card-foreground w-full max-w-md rounded-xl border p-8 text-center shadow-sm">
          <div className="bg-success/10 text-success mx-auto flex size-16 items-center justify-center rounded-full">
            <CheckCircle2 className="size-9" />
          </div>
          <h1 className="mt-6 text-xl font-semibold">Examination submitted</h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            Your responses have been recorded successfully. We could not load your result just now.
          </p>
          {error && (
            <div
              role="alert"
              className="bg-destructive/10 text-destructive mt-4 flex items-start gap-2 rounded-md border border-destructive/30 px-3 py-2 text-left text-sm"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Button className="mt-6" onClick={() => void load()}>
            <RotateCw className="size-4" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="border-b px-6 py-5">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="bg-success/10 text-success flex size-12 shrink-0 items-center justify-center rounded-full">
              <CheckCircle2 className="size-7" />
            </div>
            <div>
              <h1 className="text-foreground text-xl font-semibold tracking-tight">
                Examination submitted
              </h1>
              {exam?.title && <p className="text-muted-foreground text-sm">{exam.title}</p>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-4">
              <img src={wclLogo} alt="Western Coalfields Limited" className="h-10 object-contain" />
              <img src={rbuLogo} alt="Ramdeobaba University" className="h-10 object-contain" />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Score
              </div>
              <div className="text-foreground mt-1 text-3xl font-semibold tabular-nums">
                {result.score}
                <span className="text-muted-foreground ml-1 text-lg">/ {result.maxScore}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span className="bg-success/10 text-success rounded-full px-3 py-1 tabular-nums">
                {result.correct} correct
              </span>
              <span className="bg-destructive/10 text-destructive rounded-full px-3 py-1 tabular-nums">
                {result.wrong} wrong
              </span>
              <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 tabular-nums">
                {result.unanswered} unanswered
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {result.questions.map((q, index) => {
            const outcome = OUTCOME[q.outcome]
            const OutcomeIcon = outcome.icon
            const isMcq = q.type === 'MCQ'
            return (
              <div key={q.questionId} className="bg-card rounded-xl border p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground text-sm font-semibold">
                    Question {index + 1}
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
                    {q.type}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        outcome.badge
                      )}
                    >
                      <OutcomeIcon className="size-3.5" />
                      {outcome.label}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                        outcome.badge
                      )}
                    >
                      {formatMarks(q.marksAwarded)}
                    </span>
                  </div>
                </div>

                <p className="text-foreground mt-3 whitespace-pre-wrap leading-relaxed">
                  {q.text}
                </p>
                {q.imageUrl && (
                  <img
                    src={q.imageUrl}
                    className="mt-4 max-h-72 rounded-lg border object-contain"
                    alt=""
                  />
                )}

                <div className="mt-4 flex flex-col gap-2">
                  {q.options.map((option, optionIndex) => {
                    const selected = q.selectedOptionIds.includes(option.optionId)
                    return (
                      <div
                        key={option.optionId}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border p-3',
                          selected ? 'border-primary bg-primary/5 ring-primary/40 ring-1' : 'bg-card'
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center border text-xs font-semibold',
                            isMcq ? 'rounded-md' : 'rounded-full',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'text-muted-foreground border-input'
                          )}
                        >
                          {selected ? <Check className="size-3.5" /> : optionLabel(optionIndex)}
                        </span>
                        <span className="text-foreground flex-1 text-sm leading-relaxed">
                          {option.text}
                        </span>
                        {selected && (
                          <span className="text-primary shrink-0 text-xs font-medium">
                            Your answer
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <p className="text-muted-foreground py-2 text-center text-xs">
            You may now leave the examination. Closing this window signs you out so the next
            candidate can log in.
          </p>
        </div>
      </div>
    </div>
  )
}
