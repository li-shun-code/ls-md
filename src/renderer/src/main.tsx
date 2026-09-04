import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

const reportLog = (level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void => {
  void window.desktop?.logToFile?.(level, message, meta).catch(() => undefined)
}

window.addEventListener('error', (event) => {
  console.error('Window error captured:', event.error || event.message)
  reportLog('error', event.message || 'window error', {
    error: event.error instanceof Error ? { message: event.error.message, stack: event.error.stack } : event.error,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection captured:', event.reason)
  reportLog('error', 'unhandledrejection', {
    reason: event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : event.reason,
  })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
