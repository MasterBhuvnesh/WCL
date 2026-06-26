import { FileText } from 'lucide-react'
import { ExamTimer } from './ExamTimer'

interface ExamHeaderProps {
  title: string
  currentNumber: number
  totalQuestions: number
  marks: number
  remainingSeconds: number
}

/**
 * Top bar of the exam workspace: exam title and a small position/marks
 * indicator on the left, the prominent countdown timer on the right.
 */
export function ExamHeader({
  title,
  currentNumber,
  totalQuestions,
  marks,
  remainingSeconds
}: ExamHeaderProps): React.JSX.Element {
  return (
    <header className="bg-card flex shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          <p className="text-muted-foreground text-xs">
            Question {currentNumber} of {totalQuestions}
            <span className="mx-1.5">·</span>
            {marks} {marks === 1 ? 'mark' : 'marks'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground hidden text-xs font-medium uppercase tracking-wide sm:inline">
          Time remaining
        </span>
        <ExamTimer remainingSeconds={remainingSeconds} />
      </div>
    </header>
  )
}
