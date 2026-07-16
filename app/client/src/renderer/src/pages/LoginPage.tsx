import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, KeyRound, Loader2, User, WifiOff } from 'lucide-react'
import { useExam } from '@renderer/context/ExamProvider'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import wclLogo from '@renderer/assets/images/wcl.logo.png'
import rbuLogo from '@renderer/assets/images/rbu.png'

/**
 * Authentication screen. Collects the candidate credentials and an optional
 * exam identifier, then delegates to useExam().login. On success the candidate
 * advances to the terms/lobby screen; failures surface via useExam().error.
 */
export default function LoginPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { login, error, clearError, online } = useExam()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [examId, setExamId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return
    clearError()
    setSubmitting(true)
    try {
      await login({
        username: username.trim(),
        password,
        examId: examId.trim() || undefined
      })
      navigate('/terms')
    } catch {
      // The error is exposed via useExam().error and rendered below.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-muted/40 flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex items-center justify-center gap-6">
            <img src={wclLogo} alt="Western Coalfields Limited" className="h-14 object-contain" />
            <img src={rbuLogo} alt="Ramdeobaba University" className="h-14 object-contain" />
          </div>
          <h1 className="text-foreground mt-4 text-3xl font-semibold tracking-tight">
             WCL Examination Login
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Sign in with your assigned credentials to continue.
          </p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-foreground text-sm font-medium">
                Username
              </label>
              <div className="relative">
                <User className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="Enter your roll number"
                  className="pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-foreground text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <KeyRound className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="examId" className="text-foreground text-sm font-medium">
                Exam ID / Engine
                <span className="text-muted-foreground ml-1 font-normal">(optional)</span>
              </label>
              <Input
                id="examId"
                type="text"
                autoComplete="off"
                placeholder="Optional, leave blank to use the default"
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </div>

        {!online && (
          <div className="text-muted-foreground mt-3 flex items-center justify-center gap-1.5 text-xs">
            <WifiOff className="size-3.5" />
            <span>You appear to be offline. Sign in may not succeed until the connection returns.</span>
          </div>
        )}
      </div>
    </div>
  )
}
