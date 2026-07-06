import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ExamProvider, useExam } from './context/ExamProvider'
import { TitleBar } from './components/TitleBar'
import { DevModeBadge } from './components/DevModeBadge'
import { IntegrityOverlay } from './components/IntegrityOverlay'
import { Watermark } from './components/Watermark'
import LoginPage from './pages/LoginPage'
import TermsPage from './pages/TermsPage'
import ExamPage from './pages/ExamPage'
import SubmittedPage from './pages/SubmittedPage'

function LoadingScreen(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  )
}

function AppRoutes(): React.JSX.Element {
  const { loading, isAuthenticated, isStarted, isSubmitted } = useExam()

  if (loading) return <LoadingScreen />

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={
          isSubmitted ? (
            <Navigate to="/submitted" replace />
          ) : isStarted ? (
            <Navigate to="/exam" replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/terms"
        element={
          !isAuthenticated ? (
            <Navigate to="/login" replace />
          ) : isSubmitted ? (
            <Navigate to="/submitted" replace />
          ) : isStarted ? (
            <Navigate to="/exam" replace />
          ) : (
            <TermsPage />
          )
        }
      />
      <Route
        path="/exam"
        element={
          isSubmitted ? (
            <Navigate to="/submitted" replace />
          ) : isStarted ? (
            <ExamPage />
          ) : isAuthenticated ? (
            <Navigate to="/terms" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/submitted"
        element={isSubmitted ? <SubmittedPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function AppShell(): React.JSX.Element {
  const { devMode, isStarted, integrityWarning, dismissIntegrityWarning } = useExam()

  // During an active exam (and not in developer mode) the window controls are
  // hidden; the title bar remains as a drag region only.
  const showControls = devMode || !isStarted

  // Prevent selecting and copying exam content. Selection is also disabled in
  // CSS; here we block copy, cut, the context menu, and drag. Developer mode
  // lifts all of it (and adds the `dev-mode` class that relaxes the CSS) so the
  // app stays debuggable.
  useEffect(() => {
    const root = document.documentElement
    if (devMode) {
      root.classList.add('dev-mode')
      return
    }
    root.classList.remove('dev-mode')

    const isEditable = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      !!target.closest('input, textarea, [contenteditable="true"]')

    const block = (event: Event): void => {
      if (isEditable(event.target)) return
      event.preventDefault()
    }

    const events: Array<keyof DocumentEventMap> = [
      'copy',
      'cut',
      'contextmenu',
      'dragstart',
      'selectstart'
    ]
    events.forEach((name) => document.addEventListener(name, block))
    return () => events.forEach((name) => document.removeEventListener(name, block))
  }, [devMode])

  return (
    <div className="bg-background text-foreground flex h-screen flex-col" style={{ paddingTop: 32 }}>
      <TitleBar title="WCL Examination" showControls={showControls} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <AppRoutes />
      </main>
      <Watermark />
      {devMode && <DevModeBadge />}
      {integrityWarning && (
        <IntegrityOverlay message={integrityWarning.message} onDismiss={dismissIntegrityWarning} />
      )}
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <ExamProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </ExamProvider>
  )
}

export default App
