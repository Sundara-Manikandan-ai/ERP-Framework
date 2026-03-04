import { Component, type ReactNode, type ErrorInfo } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { logError } from '#/lib/logger'

// ── Server fn to receive client-side errors ───────────────────────────────────

const reportClientError = createServerFn({ method: 'POST' })
  .inputValidator((data: { message: string; stack?: string; url?: string }) => data)
  .handler(async ({ data }) => {
    await logError({ ...data, source: 'client' })
    return { ok: true }
  })

// ── Error Boundary ────────────────────────────────────────────────────────────

type Props = { children: ReactNode }
type State = { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError({
      data: {
        message: error.message,
        stack:   `${error.stack ?? ''}\n\nComponent Stack:\n${info.componentStack ?? ''}`,
        url:     typeof window !== 'undefined' ? window.location.href : undefined,
      },
    }).catch(() => {})
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md">
            An unexpected error occurred. It has been logged automatically.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.href = '/'
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
          >
            Go to Home
          </button>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 text-left text-xs bg-muted p-4 rounded-md max-w-2xl overflow-auto max-h-64 w-full">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
