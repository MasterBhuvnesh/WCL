import { ArrowLeft, ArrowRight, Bookmark, Check, Eraser } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { ManifestQuestion } from '@renderer/types/exam'

interface QuestionViewProps {
  question: ManifestQuestion
  index: number
  total: number
  selectedOptionIds: string[]
  hasSelection: boolean
  isFirst: boolean
  isLast: boolean
  onSelectOption: (optionId: string) => void
  onPrev: () => void
  onClear: () => void
  onMarkForReviewNext: () => void
  onSaveNext: () => void
}

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * Central question presentation: prompt, selection-mode hint, marks, and the
 * answer options rendered as large clickable rows. SCQ uses a radio affordance,
 * MCQ a checkbox affordance. The action bar lives at the bottom.
 */
export function QuestionView({
  question,
  index,
  total,
  selectedOptionIds,
  hasSelection,
  isFirst,
  isLast,
  onSelectOption,
  onPrev,
  onClear,
  onMarkForReviewNext,
  onSaveNext
}: QuestionViewProps): React.JSX.Element {
  const isMcq = question.type === 'MCQ'
  const hint = isMcq ? 'Select all that apply' : 'Select one option'

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm font-semibold">
              Question {index + 1} of {total}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs font-medium',
                isMcq
                  ? 'bg-chart-3/10 text-chart-3 border-transparent'
                  : 'bg-primary/10 text-primary border-transparent'
              )}
            >
              {question.type}
            </span>
            <span className="text-muted-foreground text-xs">{hint}</span>
            <span className="ml-auto rounded-full border px-2 py-0.5 text-xs font-medium">
              {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
            </span>
          </div>

          <p className="text-foreground mt-4 whitespace-pre-wrap text-lg leading-relaxed">
            {question.text}
          </p>
          {question.imageUrl && (
            <img
              src={question.imageUrl}
              className="mt-4 max-h-72 rounded-lg border object-contain"
              alt=""
            />
          )}

          <div className="mt-6 flex flex-col gap-3">
            {question.options.map((option, optionIndex) => {
              const selected = selectedOptionIds.includes(option.optionId)
              return (
                <button
                  key={option.optionId}
                  type="button"
                  onClick={() => onSelectOption(option.optionId)}
                  aria-pressed={selected}
                  className={cn(
                    'group flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 ring-primary/40 ring-1'
                      : 'bg-card hover:border-primary/40 hover:bg-accent'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center border text-sm font-semibold transition-colors',
                      isMcq ? 'rounded-md' : 'rounded-full',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'text-muted-foreground border-input'
                    )}
                  >
                    {selected ? <Check className="size-4" /> : optionLabel(optionIndex)}
                  </span>
                  <span className="text-foreground flex-1 text-base leading-relaxed">
                    {option.text}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="bg-card flex shrink-0 flex-wrap items-center gap-2 border-t px-6 py-3">
        <Button variant="outline" onClick={onPrev} disabled={isFirst}>
          <ArrowLeft className="size-4" />
          Previous
        </Button>
        <Button variant="outline" onClick={onClear} disabled={!hasSelection}>
          <Eraser className="size-4" />
          Clear Response
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onMarkForReviewNext}>
            <Bookmark className="size-4" />
            Mark for Review &amp; Next
          </Button>
          <Button onClick={onSaveNext} disabled={isLast}>
            Save &amp; Next
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
