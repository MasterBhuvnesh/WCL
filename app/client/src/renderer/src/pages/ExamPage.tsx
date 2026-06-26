import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useExam } from '@renderer/context/ExamProvider'
import { ExamHeader } from '@renderer/components/exam/ExamHeader'
import { QuestionView } from '@renderer/components/exam/QuestionView'
import { QuestionPalette } from '@renderer/components/exam/QuestionPalette'
import { SubmitDialog } from '@renderer/components/exam/SubmitDialog'

/**
 * The exam workspace: header with the countdown, the central question area, and
 * the right-hand question palette. All state and timing come from useExam();
 * this screen is a pure consumer that renders and dispatches intents.
 */
export default function ExamPage(): React.JSX.Element {
  const {
    exam,
    questions,
    currentIndex,
    currentQuestion,
    answers,
    remainingSeconds,
    counts,
    isSubmitted,
    goto,
    next,
    prev,
    selectOption,
    toggleMarkForReview,
    clearResponse,
    submitExam
  } = useExam()

  const navigate = useNavigate()
  const [submitOpen, setSubmitOpen] = useState(false)

  // Covers both manual submit and automatic submit when the timer hits zero.
  useEffect(() => {
    if (isSubmitted) navigate('/submitted', { replace: true })
  }, [isSubmitted, navigate])

  if (!currentQuestion) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Preparing your exam…
      </div>
    )
  }

  const answer = answers[currentQuestion.questionId]
  const selectedOptionIds = answer?.selectedOptionIds ?? []
  const hasSelection = selectedOptionIds.length > 0

  const handleConfirmSubmit = async (): Promise<void> => {
    await submitExam()
    setSubmitOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      <ExamHeader
        title={exam?.title ?? 'Examination'}
        currentNumber={currentIndex + 1}
        totalQuestions={questions.length}
        marks={currentQuestion.marks}
        remainingSeconds={remainingSeconds}
      />

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <QuestionView
            question={currentQuestion}
            index={currentIndex}
            total={questions.length}
            selectedOptionIds={selectedOptionIds}
            hasSelection={hasSelection}
            isFirst={currentIndex === 0}
            isLast={currentIndex === questions.length - 1}
            onSelectOption={(optionId) => selectOption(currentQuestion.questionId, optionId)}
            onPrev={prev}
            onClear={() => clearResponse(currentQuestion.questionId)}
            onMarkForReviewNext={() => {
              toggleMarkForReview(currentQuestion.questionId)
              next()
            }}
            onSaveNext={next}
          />
        </main>

        <QuestionPalette
          questions={questions}
          answers={answers}
          currentIndex={currentIndex}
          counts={counts}
          onGoto={goto}
          onSubmit={() => setSubmitOpen(true)}
        />
      </div>

      {submitOpen && (
        <SubmitDialog
          counts={counts}
          totalQuestions={questions.length}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setSubmitOpen(false)}
        />
      )}
    </div>
  )
}
