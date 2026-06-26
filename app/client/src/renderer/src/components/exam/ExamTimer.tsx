import { Clock } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface ExamTimerProps {
  remainingSeconds: number
}

function formatHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/**
 * Countdown chip rendered against the server-reconciled remainingSeconds. The
 * client never owns the clock; this is a faithful display only. The chip turns
 * warning-colored under five minutes and destructive-colored under one minute.
 */
export function ExamTimer({ remainingSeconds }: ExamTimerProps): React.JSX.Element {
  const isCritical = remainingSeconds < 60
  const isWarning = !isCritical && remainingSeconds < 300

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-base font-semibold tabular-nums transition-colors',
        isCritical && 'bg-destructive border-transparent text-white',
        isWarning && 'bg-warning border-transparent text-warning-foreground',
        !isCritical && !isWarning && 'bg-card text-foreground'
      )}
      role="timer"
      aria-live="off"
    >
      <Clock className="size-4 shrink-0" />
      <span>{formatHms(remainingSeconds)}</span>
    </div>
  )
}
