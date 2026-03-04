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
  Building2,
  Users,
} from 'lucide-react'
import { z } from 'zod'

// ── Types ─────────────────────────────────────────────────────────────────────

type BranchRow = {
  id: string
  name: string
  address: string | null
  createdAt: Date
  userCount: number
}

// ── Validation ────────────────────────────────────────────────────────────────

const branchSchema = z.object({
  name:    z.string().trim().min(2, 'Name must be at least 2 characters'),
  address: z.string().trim().optional(),
})

type BranchInput = z.infer<typeof branchSchema>

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'branches' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [branches, archived] = await Promise.all([
      db.branch.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { userRoles: true } } },
      }),
      context.isAdmin
        ? db.branch.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    return {
      authorized: true as const,
      branches,
      archived,
      access: extractAccess(context),
    }
  })

const createBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: BranchInput) => {
    const parsed = branchSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data, context }) => {
    await checkUniqueName(db.branch, data.name, {
      errorMessage: 'Unable to save branch. The name may already be in use.',
    })

    const branch = await db.branch.create({
      data: { name: data.name, address: data.address ?? null },
    })

    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'branches', resourceId: branch.id, newValue: { name: data.name, address: data.address } }).catch(() => {})
    return { success: true }
  })

const updateBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: BranchInput & { id: string }) => {
    const parsed = branchSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data, context }) => {
    await checkUniqueName(db.branch, data.name, {
      excludeId: data.id,
      errorMessage: 'Unable to save branch. The name may already be in use.',
    })

    const old = await db.branch.findUnique({ where: { id: data.id } })
    await db.branch.update({
      where: { id: data.id },
      data: { name: data.name, address: data.address ?? null },
    })

    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'branches', resourceId: data.id, oldValue: old ? { name: old.name, address: old.address } : undefined, newValue: { name: data.name, address: data.address } }).catch(() => {})
    return { success: true }
  })

const softDeleteBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await softDeleteRecord(db.branch, data.id, [
      { model: db.userRole, where: { branchId: data.id }, errorTemplate: 'Cannot archive — {count} user(s) are assigned to this branch.' },
      { model: db.transaction, where: { branchId: data.id }, errorTemplate: 'Cannot archive — {count} transaction(s) reference this branch.' },
      { model: db.uploadBatch, where: { branchId: data.id }, errorTemplate: 'Cannot archive — {count} upload batch(es) reference this branch.' },
    ], { userId: context.user.id, userEmail: context.user.email }, 'branches')
    return { success: true }
  })

const restoreBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await restoreRecord(db.branch, data.id, { userId: context.user.id, userEmail: context.user.email }, 'branches')
    return { success: true }
  })

const permanentDeleteBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await permanentDeleteRecord(db.branch, data.id, { userId: context.user.id, userEmail: context.user.email }, 'branches')
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/branches')({
  loader: () => getPageData(),
  component: BranchesPage,
})

// ── Create Dialog ─────────────────────────────────────────────────────────────

function CreateBranchDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm]           = useState({ name: '', address: '' })

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await createBranch({ data: { name: form.name, address: form.address || undefined } })
      setOpen(false)
      setForm({ name: '', address: '' })
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to create branch.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="w-4 h-4 mr-2" />
          Add Branch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Branch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Branch Name</Label>
            <Input
              placeholder="e.g. Aranmanai"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              placeholder="Full address of the branch"
              rows={3}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────

function EditBranchDialog({ branch, onSuccess }: { branch: BranchRow; onSuccess: () => void }) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm]           = useState({ name: branch.name, address: branch.address ?? '' })

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await updateBranch({ data: { id: branch.id, name: form.name, address: form.address || undefined } })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update branch.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Branch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Branch Name</Label>
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

function BranchesPage() {
  const loaderData = Route.useLoaderData()
  const router     = useRouter()

  const [sorting, setSorting]                   = useState<SortingState>([])
  const [globalFilter, setGlobalFilter]         = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  if (!loaderData.authorized) return <Unauthorized />
  const { branches, archived, access } = loaderData

  function refresh() { router.invalidate() }

  const data: BranchRow[] = useMemo(
    () =>
      branches.map((b) => ({
        id:        b.id,
        name:      b.name,
        address:   b.address ?? null,
        createdAt: b.createdAt,
        userCount: b._count.userRoles,
      })),
    [branches]
  )

  const archivedRecords: ArchivedRecord[] = useMemo(
    () =>
      archived.map((b) => ({
        id:        b.id,
        name:      b.name,
        extra:     b.address ?? null,
        deletedAt: b.deletedAt!,
        deletedBy: b.deletedBy ?? null,
      })),
    [archived]
  )

  const columns: ColumnDef<BranchRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <SortableHeader column={column} label="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{row.getValue('name')}</span>
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
        accessorKey: 'userCount',
        header: ({ column }) => <SortableHeader column={column} label="Users" />,
        cell: ({ row }) => {
          const count = row.getValue('userCount') as number
          return (
            <Badge variant={count > 0 ? 'secondary' : 'outline'} className="gap-1">
              <Users className="w-3 h-3" />
              {count}
            </Badge>
          )
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
          const branch = row.original
          return (
            <RoleGate {...access} requireAdmin>
              <div className="flex items-center justify-end gap-1">
                <EditBranchDialog branch={branch} onSuccess={refresh} />
                <DeleteDialog
                  title="Archive Branch"
                  description={<>Archive <strong>{branch.name}</strong>? It will be hidden from active lists but can be restored later.</>}
                  disabled={branch.userCount > 0}
                  disabledReason={branch.userCount > 0 ? `This branch has ${branch.userCount} assigned user${branch.userCount !== 1 ? 's' : ''} and cannot be archived.` : undefined}
                  onConfirm={async () => { await softDeleteBranch({ data: { id: branch.id } }); refresh() }}
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
          <h1 className="text-3xl font-bold tracking-tight">Branches</h1>
          <p className="text-muted-foreground">Manage branch locations and assignments</p>
        </div>
        <div className="flex items-center gap-2">
          <RoleGate {...access} requireAdmin>
            <ArchivedRecordsDrawer
              title="Archived Branches"
              records={archivedRecords}
              onRestore={async (id) => { await restoreBranch({ data: { id } }); refresh() }}
              onPermanentDelete={async (id) => { await permanentDeleteBranch({ data: { id } }); refresh() }}
              onOpenChange={(open) => { if (!open) refresh() }}
            />
            <CreateBranchDialog onSuccess={refresh} />
          </RoleGate>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Branches</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} branches
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <TableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            searchPlaceholder="Search branches..."
            exportFilename="branches"
            exportSheetName="Branches"
            exportData={table.getFilteredRowModel().rows.map((r) => ({
              Name: r.original.name,
              Address: r.original.address ?? '',
              Users: r.original.userCount,
              Created: new Date(r.original.createdAt).toLocaleDateString('en-IN'),
            }))}
          />

          <DataTable
            table={table}
            columns={columns}
            emptyMessage="No branches found."
            mobileCard={(branch) => (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{branch.name}</span>
                  </div>
                  <RoleGate {...access} requireAdmin>
                    <div className="flex items-center gap-1 shrink-0">
                      <EditBranchDialog branch={branch} onSuccess={refresh} />
                      <DeleteDialog
                        title="Archive Branch"
                        description={<>Archive <strong>{branch.name}</strong>? It can be restored later.</>}
                        disabled={branch.userCount > 0}
                        disabledReason={branch.userCount > 0 ? `Has ${branch.userCount} assigned user${branch.userCount !== 1 ? 's' : ''}.` : undefined}
                        onConfirm={async () => { await softDeleteBranch({ data: { id: branch.id } }); refresh() }}
                      />
                    </div>
                  </RoleGate>
                </div>
                {branch.address
                  ? <p className="text-sm text-muted-foreground">{branch.address}</p>
                  : <p className="text-xs text-muted-foreground italic">No address</p>
                }
                <div className="flex items-center justify-between">
                  <Badge variant={branch.userCount > 0 ? 'secondary' : 'outline'} className="gap-1">
                    <Users className="w-3 h-3" />
                    {branch.userCount} user{branch.userCount !== 1 ? 's' : ''}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(branch.createdAt).toLocaleDateString('en-IN')}
                  </span>
                </div>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
