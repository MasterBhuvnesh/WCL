import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { TitleBar } from './components/TitleBar'

function Placeholder(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">WCL Exam Client</h1>
        <p className="text-muted-foreground text-sm">Clean slate. Build exam screens here.</p>
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100vh', paddingTop: '32px' }}
      >
        <TitleBar title="WCL" />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Placeholder />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

export default App
