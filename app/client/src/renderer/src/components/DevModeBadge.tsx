import { Wrench } from 'lucide-react'

/**
 * Persistent indicator shown while developer mode (Ctrl+Shift+Alt+X) is active, so it
 * is always obvious that exam lockdown is currently disabled.
 */
export function DevModeBadge(): React.JSX.Element {
  return (
    <div className="bg-warning text-warning-foreground fixed bottom-3 left-3 z-9998 flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold shadow-md">
      <Wrench className="size-3.5" />
      Developer Mode
    </div>
  )
}
