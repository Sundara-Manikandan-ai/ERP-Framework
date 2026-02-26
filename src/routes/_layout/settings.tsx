import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { resourceMiddleware } from '#/middleware/resource'
import { extractAccess } from '#/lib/rbac'
import { RoleGate } from '@/components/shared/RoleGate'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Save } from 'lucide-react'

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([resourceMiddleware('settings')])
  .handler(async ({ context }) => {
    const settings = await db.appSetting.findMany({ orderBy: { key: 'asc' } })
    return { settings, access: extractAccess(context) }
  })

const updateSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { key: string; value: string }) => data)
  .handler(async ({ data }) => {
    await db.appSetting.update({ where: { key: data.key }, data: { value: data.value } })
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/settings')({
  loader: () => getPageData(),
  errorComponent: () => <Unauthorized />,
  component: SettingsPage,
})

// ── Setting Row ───────────────────────────────────────────────────────────────

type AccessType = Awaited<ReturnType<typeof getPageData>>['access']

function SettingRow({
  settingKey,
  initialValue,
  updatedAt,
  access,
}: {
  settingKey: string
  initialValue: string
  updatedAt: Date
  access: AccessType
}) {
  const router = useRouter()
  const [value, setValue]         = useState(initialValue)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [saved, setSaved]         = useState(false)

  const isDirty = value !== initialValue

  async function handleSave() {
    setError(null)
    setIsPending(true)
    try {
      await updateSetting({ data: { key: settingKey, value } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.invalidate()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save setting.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 py-3 border-b last:border-0">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-32">
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{settingKey}</code>
          <p className="text-xs text-muted-foreground mt-1">
            Updated: {new Date(updatedAt).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-48 max-w-sm">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1"
          />
          <RoleGate {...access} requireAdmin>
            <Button
              size="sm"
              disabled={!isDirty || isPending}
              onClick={handleSave}
              variant={saved ? 'outline' : 'default'}
            >
              {isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : saved
                ? 'Saved!'
                : <><Save className="w-4 h-4 mr-1" />Save</>}
            </Button>
          </RoleGate>
        </div>
      </div>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function SettingsPage() {
  const { settings, access } = Route.useLoaderData()

  return (
    <div className="space-y-2 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage application configuration</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Core application settings</CardDescription>
        </CardHeader>
        <CardContent>
          {settings.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No settings found.</p>
          ) : (
            settings.map((s) => (
              <SettingRow
                key={s.key}
                settingKey={s.key}
                initialValue={s.value}
                updatedAt={s.updatedAt}
                access={access}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
