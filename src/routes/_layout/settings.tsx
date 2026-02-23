import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { resourceMiddleware } from '#/middleware/resource'
import { Settings } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Unauthorized } from '@/components/shared/Unauthorized'

const getPageData = createServerFn({ method: 'GET' })
  .middleware([resourceMiddleware('settings')])
  .handler(async () => {
    return { authorized: true }
  })

export const Route = createFileRoute('/_layout/settings')({
  loader: () => getPageData(),
  errorComponent: () => <Unauthorized />,
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">General</CardTitle>
          <CardDescription className="text-xs">
            Application settings will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No configurable settings yet.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
