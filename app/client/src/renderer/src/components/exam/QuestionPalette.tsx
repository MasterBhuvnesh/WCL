import { Send } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import { cn } from '@renderer/lib/utils'
import type { ManifestQuestion, PaletteCounts, QuestionStatus } from '@renderer/types/exam'

interface QuestionPaletteProps {
  questions: ManifestQuestion[]
  answers: Record<string, { status: QuestionStatus }>
  currentIndex: number
  counts: PaletteCounts
  onGoto: (index: number) => void
  onSubmit: () => void
}

function statusClasses(status: QuestionStatus): string {
  switch (status) {
    case 'answered':
      return 'bg-success text-success-foreground border-transparent'
    case 'not_answered':
      return 'bg-destructive text-white border-transparent'
    case 'marked_for_review':
      return 'bg-violet-600 text-white border-transparent'
    case 'answered_marked':
      return 'bg-yellow-400 text-yellow-950 border-transparent'
    case 'not_visited':
    default:
      return 'bg-card text-foreground border-input'
  }
}

interface LegendEntry {
  label: string
  swatch: string
  count: number
}

export function QuestionPalette({
  questions,
  answers,
  currentIndex,
  counts,
  onGoto,
  onSubmit
}: QuestionPaletteProps): React.JSX.Element {
  const legend: LegendEntry[] = [
    { label: 'Answered', swatch: 'bg-success', count: counts.answered },
    { label: 'Not answered', swatch: 'bg-destructive', count: counts.notAnswered },
    { label: 'Marked for review', swatch: 'bg-violet-600', count: counts.markedForReview },
    {
      label: 'Answered & marked',
      swatch: 'bg-yellow-400',
      count: counts.answeredMarked
    },
    { label: 'Not visited', swatch: 'bg-card border border-input', count: counts.notVisited }
  ]

  return (
    <aside className="bg-card flex h-full w-76 shrink-0 flex-col border-l">
      <div className="shrink-0 px-4 py-3">
        <h2 className="text-sm font-semibold">Question Palette</h2>
        <p className="text-muted-foreground text-xs">
          {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-5 gap-2">
          {questions.map((question, index) => {
            const status = answers[question.questionId]?.status ?? 'not_visited'
            const isCurrent = index === currentIndex
            const isAnsweredMarked = status === 'answered_marked'
            return (
              <button
                key={question.questionId}
                type="button"
                onClick={() => onGoto(index)}
                aria-current={isCurrent ? 'true' : undefined}
                className={cn(
                  'relative flex h-9 items-center justify-center rounded-md border text-sm font-medium transition-colors',
                  statusClasses(status),
                  isCurrent && 'ring-ring ring-2 ring-offset-1'
                )}
              >
                {index + 1}
                {isAnsweredMarked && (
                  <span className="bg-success absolute -right-0.5 -top-0.5 size-2.5 rounded-full border border-white" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <Separator />
      <div className="shrink-0 px-4 py-3">
        <ul className="flex flex-col gap-1.5">
          {legend.map((entry) => (
            <li key={entry.label} className="text-muted-foreground flex items-center gap-2 text-xs">
              <span className={cn('size-3 shrink-0 rounded-sm', entry.swatch)} />
              <span className="flex-1">{entry.label}</span>
              <span className="text-foreground font-semibold tabular-nums">{entry.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <Separator />
      <div className="shrink-0 p-4">
        <Button variant="destructive" className="w-full" onClick={onSubmit}>
          <Send className="size-4" />
          Submit Exam
        </Button>
      </div>
    </aside>
  )
}
