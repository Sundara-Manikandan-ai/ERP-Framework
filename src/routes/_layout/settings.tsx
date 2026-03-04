import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { authMiddleware } from '#/middleware/auth'
import { extractAccess } from '#/lib/rbac'
import { logAudit } from '#/lib/logger'
import { RoleGate } from '@/components/shared/RoleGate'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Save } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Australia/Sydney',
  'Africa/Nairobi',
  'UTC',
]

const DATE_FORMATS = [
  { value: 'dd/MM/yyyy', label: 'dd/MM/yyyy  (31/12/2025)' },
  { value: 'MM/dd/yyyy', label: 'MM/dd/yyyy  (12/31/2025)' },
  { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd  (2025-12-31)' },
  { value: 'dd-MM-yyyy', label: 'dd-MM-yyyy  (31-12-2025)' },
  { value: 'dd MMM yyyy', label: 'dd MMM yyyy  (31 Dec 2025)' },
  { value: 'MMM dd, yyyy', label: 'MMM dd, yyyy  (Dec 31, 2025)' },
]

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'settings' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const settings = await db.appSetting.findMany({ orderBy: { key: 'asc' } })
    return { authorized: true as const, settings, access: extractAccess(context) }
  })

const SETTING_VALIDATORS: Record<string, (v: string) => string | null> = {
  appName:    (v) => v.trim().length < 1 ? 'App name cannot be empty' : null,
  timezone:   (v) => v.trim().length < 1 ? 'Timezone cannot be empty' : null,
  dateFormat: (v) => v.trim().length < 1 ? 'Date format cannot be empty' : null,
}

const updateSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { key: string; value: string }) => data)
  .handler(async ({ data, context }) => {
    const validator = SETTING_VALIDATORS[data.key]
    if (validator) {
      const err = validator(data.value)
      if (err) throw new Error(err)
    }
    const old = await db.appSetting.findUnique({ where: { key: data.key } })
    await db.appSetting.update({ where: { key: data.key }, data: { value: data.value.trim() } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'settings', resourceId: data.key, oldValue: old ? { value: old.value } : undefined, newValue: { value: data.value } }).catch(() => {})
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/settings')({
  loader: () => getPageData(),
  component: SettingsPage,
})

// ── Setting Row ───────────────────────────────────────────────────────────────

type PageDataAuthorized = Extract<Awaited<ReturnType<typeof getPageData>>, { authorized: true }>
type AccessType = PageDataAuthorized['access']

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

  function renderInput() {
    if (settingKey === 'timezone') {
      return (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (settingKey === 'dateFormat') {
      return (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1"
      />
    )
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
          {renderInput()}
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
  const loaderData = Route.useLoaderData()
  if (!loaderData.authorized) return <Unauthorized />
  const { settings, access } = loaderData

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
