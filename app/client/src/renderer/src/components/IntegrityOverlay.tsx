import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'

interface IntegrityOverlayProps {
  message: string
  onDismiss: () => void
}

/**
 * Blocking warning shown when the proctored environment is violated (for
 * example the exam window loses focus). Per the plan this warns the candidate
 * and is logged; it does not auto-submit or disqualify.
 */
export function IntegrityOverlay({ message, onDismiss }: IntegrityOverlayProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-6">
      <div className="bg-card text-card-foreground w-full max-w-md rounded-xl border p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-full">
            <AlertTriangle className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Exam integrity warning</h2>
            <p className="text-muted-foreground mt-1 text-sm">{message}</p>
            <p className="text-muted-foreground mt-3 text-xs">
              This event has been recorded for proctor review. Remain in the exam window for the
              entire duration.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onDismiss}>I understand</Button>
        </div>
      </div>
    </div>
  )
}
