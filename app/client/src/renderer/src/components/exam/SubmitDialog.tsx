import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import type { PaletteCounts } from '@renderer/types/exam'

interface SubmitDialogProps {
  counts: PaletteCounts
  totalQuestions: number
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * Confirmation modal shown before final submission. Built as a self-contained
 * fixed overlay rather than relying on a shadcn dialog primitive. Submission is
 * irreversible, so the candidate is asked to confirm and the summary is shown.
 */
export function SubmitDialog({
  counts,
  totalQuestions,
  onConfirm,
  onCancel
}: SubmitDialogProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false)

  const answered = counts.answered + counts.answeredMarked
  const marked = counts.markedForReview + counts.answeredMarked
  const notAnswered = counts.notAnswered + counts.markedForReview
  const notVisited = counts.notVisited

  const summary = [
    { label: 'Answered', value: answered },
    { label: 'Not answered', value: notAnswered },
    { label: 'Marked for review', value: marked },
    { label: 'Not visited', value: notVisited }
  ]

  const handleConfirm = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-dialog-title"
    >
      <div className="bg-card text-card-foreground w-full max-w-md rounded-xl border p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="bg-warning/15 text-warning-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
            <AlertTriangle className="text-warning size-5" />
          </div>
          <div className="flex-1">
            <h2 id="submit-dialog-title" className="text-lg font-semibold">
              Submit examination?
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Review your progress before submitting. Once submitted, your responses are final and
              cannot be changed.
            </p>
          </div>
        </div>

        <div className="bg-muted/40 mt-5 rounded-lg border p-4">
          <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
            Summary · {totalQuestions} questions
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {summary.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground text-sm">{item.label}</dt>
                <dd className="text-foreground text-sm font-semibold tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Separator className="my-5" />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleConfirm()} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Exam'}
          </Button>
        </div>
      </div>
    </div>
  )
}
