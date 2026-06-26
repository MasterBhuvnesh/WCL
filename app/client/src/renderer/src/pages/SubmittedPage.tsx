import { CheckCircle2 } from 'lucide-react'
import { useExam } from '@renderer/context/ExamProvider'

/**
 * Final, calm confirmation after submission. No score is shown here; results
 * are published by the administrator later. There is intentionally no path back
 * into the exam.
 */
export default function SubmittedPage(): React.JSX.Element {
  const { exam } = useExam()

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="bg-card text-card-foreground w-full max-w-md rounded-xl border p-8 text-center shadow-sm">
        <div className="bg-success/10 text-success mx-auto flex size-16 items-center justify-center rounded-full">
          <CheckCircle2 className="size-9" />
        </div>

        <h1 className="mt-6 text-xl font-semibold">Examination submitted</h1>

        {exam?.title && <p className="text-muted-foreground mt-1 text-sm">{exam.title}</p>}

        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
          Your responses have been recorded successfully. Results are not shown here and will be
          published by the administrator at a later time.
        </p>

        <p className="text-muted-foreground mt-6 text-xs">
          You may now leave the examination. It is safe to close this window when instructed.
        </p>
      </div>
    </div>
  )
}
