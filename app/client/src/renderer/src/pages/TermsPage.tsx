import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Clock, FileText, Loader2 } from 'lucide-react'
import { useExam } from '@renderer/context/ExamProvider'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import wclLogo from '@renderer/assets/images/wcl.png'
import rbuLogo from '@renderer/assets/images/rbu.png'

/**
 * Pre-exam lobby. Presents the exam metadata, the authored instructions, and
 * the standard examination terms. The candidate must explicitly accept before
 * beginning; beginning stamps the server-side start time and starts the clock.
 */
const STANDARD_TERMS: string[] = [
  'The timer starts the moment you begin the examination and cannot be paused.',
  'Leaving or switching away from the examination window is recorded for proctor review.',
  'Do not refresh, minimise, or close the application during the examination.',
  'Your answers are saved automatically as you progress.',
  'The examination submits automatically when the allotted time expires.'
]

export default function TermsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { exam, beginExam, error, clearError } = useExam()

  const [accepted, setAccepted] = useState(false)
  const [starting, setStarting] = useState(false)

  const durationMinutes = exam ? Math.round(exam.durationSeconds / 60) : 0
  const questionCount = exam?.questionsToServe ?? 0
  const instructions = exam?.instructions ?? []

  async function handleBegin(): Promise<void> {
    if (!accepted || starting) return
    clearError()
    setStarting(true)
    try {
      await beginExam()
      navigate('/exam')
    } catch {
      // The error is exposed via useExam().error and rendered below.
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="border-b px-6 py-5">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">
              {exam?.title ?? 'Examination'}
            </h1>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" />
                {durationMinutes} minute{durationMinutes === 1 ? '' : 's'}
              </span>
              <span className="flex items-center gap-1.5">
                <FileText className="size-4" />
                {questionCount} question{questionCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <img src={wclLogo} alt="Western Coalfields Limited" className="h-10 object-contain" />
            <img src={rbuLogo} alt="Ramdeobaba University" className="h-10 object-contain" />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-3xl">
          {instructions.length > 0 && (
            <section>
              <h2 className="text-foreground text-base font-semibold">Instructions</h2>
              <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                {instructions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </section>
          )}

          {instructions.length > 0 && <Separator className="my-6" />}

          <section>
            <h2 className="text-foreground text-base font-semibold">Examination terms</h2>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {STANDARD_TERMS.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <footer className="border-t px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="border-input text-primary focus-visible:ring-ring/50 mt-0.5 size-4 shrink-0 cursor-pointer rounded border accent-primary focus-visible:ring-[3px] focus-visible:outline-none"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span className="text-foreground">
              I have read and accept the examination instructions and terms.
            </span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              The timer starts immediately once you begin the examination.
            </p>
            <Button
              type="button"
              size="lg"
              className="w-full sm:w-auto"
              disabled={!accepted || starting}
              onClick={handleBegin}
            >
              {starting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Starting...
                </>
              ) : (
                'Begin Examination'
              )}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}
