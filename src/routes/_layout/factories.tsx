import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { authMiddleware } from '#/middleware/auth'
import { extractAccess } from '#/lib/rbac'
import { logAudit } from '#/lib/logger'
import { checkUniqueName, softDeleteRecord, restoreRecord, permanentDeleteRecord } from '#/lib/crud-helpers'
import { RoleGate } from '@/components/shared/RoleGate'
import { DeleteDialog } from '@/components/shared/DeleteDialog'
import { ArchivedRecordsDrawer, type ArchivedRecord } from '@/components/shared/ArchivedRecordsDrawer'
import { SortableHeader } from '@/components/shared/SortableHeader'
import { DataTable } from '@/components/shared/DataTable'
import { TableToolbar } from '@/components/shared/TableToolbar'
import { getErrorMessage } from '@/lib/utils'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Loader2,
  PlusCircle,
  Pencil,
  Factory,
} from 'lucide-react'
import { z } from 'zod'

// ── Types ─────────────────────────────────────────────────────────────────────

type FactoryRow = {
  id: string
  name: string
  address: string | null
  isActive: boolean
  createdAt: Date
  transactionCount: number
}

// ── Validation ────────────────────────────────────────────────────────────────

const factorySchema = z.object({
  name:    z.string().trim().min(2, 'Name must be at least 2 characters'),
  address: z.string().trim().optional(),
})

type FactoryInput = z.infer<typeof factorySchema>

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'factories' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [factories, archived] = await Promise.all([
      db.factory.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { transactions: true } } },
      }),
      context.isAdmin
        ? db.factory.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    return { authorized: true as const, factories, archived, access: extractAccess(context) }
  })

const createFactory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: FactoryInput) => {
    const parsed = factorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data, context }) => {
    await checkUniqueName(db.factory, data.name, {
      errorMessage: 'Unable to save factory. The name may already be in use.',
    })
    const factory = await db.factory.create({ data: { name: data.name, address: data.address ?? null } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'factories', resourceId: factory.id, newValue: { name: data.name, address: data.address } }).catch(() => {})
    return { success: true }
  })

const updateFactory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: FactoryInput & { id: string; isActive: boolean }) => {
    const parsed = factorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id, isActive: data.isActive }
  })
  .handler(async ({ data, context }) => {
    await checkUniqueName(db.factory, data.name, {
      excludeId: data.id,
      errorMessage: 'Unable to save factory. The name may already be in use.',
    })
    const old = await db.factory.findUnique({ where: { id: data.id } })
    await db.factory.update({
      where: { id: data.id },
      data: { name: data.name, address: data.address ?? null, isActive: data.isActive },
    })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'factories', resourceId: data.id, oldValue: old ? { name: old.name, address: old.address, isActive: old.isActive } : undefined, newValue: { name: data.name, address: data.address, isActive: data.isActive } }).catch(() => {})
    return { success: true }
  })

const softDeleteFactory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await softDeleteRecord(db.factory, data.id, [
      { model: db.transaction, where: { factoryId: data.id }, errorTemplate: 'Cannot archive — {count} transaction(s) reference this factory.' },
      { model: db.uploadBatch, where: { factoryId: data.id }, errorTemplate: 'Cannot archive — {count} upload batch(es) reference this factory.' },
    ], { userId: context.user.id, userEmail: context.user.email }, 'factories')
    return { success: true }
  })

const restoreFactory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await restoreRecord(db.factory, data.id, { userId: context.user.id, userEmail: context.user.email }, 'factories')
    return { success: true }
  })

const permanentDeleteFactory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await permanentDeleteRecord(db.factory, data.id, { userId: context.user.id, userEmail: context.user.email }, 'factories')
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/factories')({
  loader: () => getPageData(),
  component: FactoriesPage,
})

// ── Create Dialog ─────────────────────────────────────────────────────────────

function CreateFactoryDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm]           = useState({ name: '', address: '' })

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await createFactory({ data: { name: form.name, address: form.address || undefined } })
      setOpen(false)
      setForm({ name: '', address: '' })
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to create factory.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><PlusCircle className="w-4 h-4 mr-2" />Add Factory</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create New Factory</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Factory Name</Label>
            <Input
              placeholder="e.g. Main Factory"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              placeholder="Full address of the factory"
              rows={3}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Factory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────

function EditFactoryDialog({ factory, onSuccess }: { factory: FactoryRow; onSuccess: () => void }) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm]           = useState({
    name:     factory.name,
    address:  factory.address ?? '',
    isActive: factory.isActive,
  })

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await updateFactory({
        data: { id: factory.id, name: form.name, address: form.address || undefined, isActive: form.isActive },
      })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update factory.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Factory</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Factory Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              rows={3}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Active</Label>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function FactoriesPage() {
  const loaderData = Route.useLoaderData()
  const router     = useRouter()

  const [sorting, setSorting]                   = useState<SortingState>([])
  const [globalFilter, setGlobalFilter]         = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  if (!loaderData.authorized) return <Unauthorized />
  const { factories, archived, access } = loaderData

  function refresh() { router.invalidate() }

  const data: FactoryRow[] = useMemo(
    () =>
      factories.map((f) => ({
        id:               f.id,
        name:             f.name,
        address:          f.address ?? null,
        isActive:         f.isActive,
        createdAt:        f.createdAt,
        transactionCount: f._count.transactions,
      })),
    [factories]
  )

  const archivedRecords: ArchivedRecord[] = useMemo(
    () =>
      archived.map((f) => ({
        id:        f.id,
        name:      f.name,
        extra:     f.address ?? null,
        deletedAt: f.deletedAt!,
        deletedBy: f.deletedBy ?? null,
      })),
    [archived]
  )

  const columns: ColumnDef<FactoryRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <SortableHeader column={column} label="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Factory className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium">{row.getValue('name')}</span>
          </div>
        ),
      },
      {
        accessorKey: 'address',
        header: 'Address',
        enableSorting: false,
        cell: ({ row }) => {
          const address = row.getValue('address') as string | null
          return address
            ? <span className="text-muted-foreground text-sm">{address}</span>
            : <span className="text-xs text-muted-foreground italic">No address</span>
        },
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ row }) => (
          row.getValue('isActive')
            ? <Badge variant="default">Active</Badge>
            : <Badge variant="secondary">Inactive</Badge>
        ),
      },
      {
        accessorKey: 'transactionCount',
        header: ({ column }) => <SortableHeader column={column} label="Transactions" />,
        cell: ({ row }) => {
          const count = row.getValue('transactionCount') as number
          return <Badge variant={count > 0 ? 'secondary' : 'outline'}>{count}</Badge>
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <SortableHeader column={column} label="Created" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {new Date(row.getValue('createdAt')).toLocaleDateString('en-IN')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const factory = row.original
          return (
            <RoleGate {...access} requireAdmin>
              <div className="flex items-center justify-end gap-1">
                <EditFactoryDialog factory={factory} onSuccess={refresh} />
                <DeleteDialog
                  title="Archive Factory"
                  description={<>Archive <strong>{factory.name}</strong>? It will be hidden from active lists but can be restored later.</>}
                  disabled={factory.transactionCount > 0}
                  disabledReason={factory.transactionCount > 0 ? `This factory has ${factory.transactionCount} transaction(s) and cannot be archived.` : undefined}
                  onConfirm={async () => { await softDeleteFactory({ data: { id: factory.id } }); refresh() }}
                />
              </div>
            </RoleGate>
          )
        },
      },
    ],
    [access]
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Factories</h1>
          <p className="text-muted-foreground">Manage factory locations</p>
        </div>
        <div className="flex items-center gap-2">
          <RoleGate {...access} requireAdmin>
            <ArchivedRecordsDrawer
              title="Archived Factories"
              records={archivedRecords}
              onRestore={async (id) => { await restoreFactory({ data: { id } }); refresh() }}
              onPermanentDelete={async (id) => { await permanentDeleteFactory({ data: { id } }); refresh() }}
              onOpenChange={(open) => { if (!open) refresh() }}
            />
            <CreateFactoryDialog onSuccess={refresh} />
          </RoleGate>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Factories</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} factories
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <TableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            searchPlaceholder="Search factories..."
            exportFilename="factories"
            exportSheetName="Factories"
            exportData={table.getFilteredRowModel().rows.map((r) => ({
              Name: r.original.name,
              Address: r.original.address ?? '',
              Active: r.original.isActive ? 'Yes' : 'No',
              Transactions: r.original.transactionCount,
              Created: new Date(r.original.createdAt).toLocaleDateString('en-IN'),
            }))}
          />

          <DataTable
            table={table}
            columns={columns}
            emptyMessage="No factories found."
            mobileCard={(f) => (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Factory className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{f.name}</span>
                  </div>
                  <RoleGate {...access} requireAdmin>
                    <div className="flex items-center gap-1 shrink-0">
                      <EditFactoryDialog factory={f} onSuccess={refresh} />
                      <DeleteDialog
                        title="Archive Factory"
                        description={<>Archive <strong>{f.name}</strong>? It can be restored later.</>}
                        disabled={f.transactionCount > 0}
                        disabledReason={f.transactionCount > 0 ? `Has ${f.transactionCount} transaction(s).` : undefined}
                        onConfirm={async () => { await softDeleteFactory({ data: { id: f.id } }); refresh() }}
                      />
                    </div>
                  </RoleGate>
                </div>
                <div className="flex items-center justify-between">
                  {f.isActive
                    ? <Badge variant="default">Active</Badge>
                    : <Badge variant="secondary">Inactive</Badge>}
                  <Badge variant="outline">{f.transactionCount} transactions</Badge>
                </div>
                {f.address && <p className="text-sm text-muted-foreground">{f.address}</p>}
                <span className="text-xs text-muted-foreground">
                  {new Date(f.createdAt).toLocaleDateString('en-IN')}
                </span>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
