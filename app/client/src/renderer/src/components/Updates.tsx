import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Rocket } from 'lucide-react'
import { AppIcon } from './AppIcon'
import { useExam } from '../context/ExamProvider'

type UpdateStatus = Parameters<Parameters<Window['examBridge']['onUpdateStatus']>[0]>[0]

function IconRotate(): React.JSX.Element {
  return (
    <motion.div
      animate={{ rotate: [0, 10, 0] }}
      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
      style={{ display: 'inline-block' }}
    >
      <AppIcon Icon={Rocket} size={14} strokeWidth={2.5} color="#ffffff" />
    </motion.div>
  )
}

/**
 * Auto-update indicator.
 *
 * - While downloading: a small progress badge.
 * - Once downloaded, and no exam is in progress: a "Restart now?" prompt so the
 *   user can apply the update immediately. Dismissing ("Later") — or ignoring
 *   it — still installs on the next quit via autoInstallOnAppQuit.
 * - Once downloaded during an active exam: a passive badge only, never an
 *   actionable restart, so a student can't restart mid-exam.
 *
 * Idle / up-to-date states render nothing.
 */
export function Updates(): React.JSX.Element | null {
  const { isStarted } = useExam()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    return window.examBridge.onUpdateStatus((next) => {
      // A fresh downloaded event re-arms the prompt even if a prior one was
      // dismissed.
      if (next.state === 'downloaded') setDismissed(false)
      setStatus(next)
    })
  }, [])

  if (!status) return null

  const shell =
    'fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-white shadow-lg'

  if (status.state === 'downloading') {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className={shell}
        >
          <IconRotate />
          <span className="text-xs">Downloading update… {status.percent ?? 0}%</span>
        </motion.div>
      </AnimatePresence>
    )
  }

  if (status.state !== 'downloaded' || dismissed) return null

  // During an active exam, never offer an actionable restart — just note it.
  if (isStarted) {
    return (
      <div className={shell}>
        <IconRotate />
        <span className="text-xs">Update ready — installs on next restart</span>
      </div>
    )
  }

  const onRestart = async (): Promise<void> => {
    setRestarting(true)
    try {
      await window.examBridge.restartToUpdate()
    } catch {
      // If the invoke fails the app stays open; install-on-quit remains the
      // fallback. Re-enable the button so the user can retry.
      setRestarting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="fixed bottom-3 right-3 z-50 flex items-center gap-3 rounded-md bg-blue-600 px-4 py-3 text-white shadow-lg"
      >
        <IconRotate />
        <div className="flex flex-col">
          <span className="text-sm font-medium">Update ready</span>
          <span className="text-xs text-blue-100">Restart to install the latest version.</span>
        </div>
        <div className="ml-2 flex items-center gap-2">
          <button
            onClick={() => setDismissed(true)}
            disabled={restarting}
            className="rounded px-2 py-1 text-xs text-blue-100 hover:text-white disabled:opacity-50"
          >
            Later
          </button>
          <button
            onClick={onRestart}
            disabled={restarting}
            className="rounded bg-white px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {restarting ? 'Restarting…' : 'Restart now'}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
