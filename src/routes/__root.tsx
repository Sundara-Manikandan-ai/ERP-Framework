import {
  HeadContent,
  Scripts,
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '#/lib/query'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { IdleWarningDialog } from '@/components/shared/IdleWarningDialog'
import { useIdleTimeout } from '#/hooks/useIdleTimeout'
import { getAppSettingsFn } from '@/contexts/AppSettingProvider'
import { useState, useEffect } from 'react'

import appCss from '../styles.css?url'

const PUBLIC_ROUTES = ['/login', '/register']

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Loading…' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  loader: () => getAppSettingsFn(),
  component: RootComponent,
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
      <a href="/" className="text-primary underline">Go home</a>
    </div>
  ),
})

function RootComponent() {
  const { appName } = Route.useLoaderData()
  const pathname   = useRouterState({ select: (s) => s.location.pathname })
  const isPublic   = PUBLIC_ROUTES.includes(pathname)
  const [showWarning, setShowWarning] = useState(false)

  useEffect(() => {
    document.title = appName
  }, [appName])

  const { resetTimers } = useIdleTimeout({
    enabled:   !isPublic,
    onWarning: () => setShowWarning(true),
    onTimeout: () => setShowWarning(false),
  })

  function handleStaySignedIn() {
    setShowWarning(false)
    resetTimers()
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <Outlet />
          <IdleWarningDialog
            open={showWarning}
            onStaySignedIn={handleStaySignedIn}
            onSignOut={() => setShowWarning(false)}
          />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}