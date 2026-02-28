import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { authMiddleware } from '#/middleware/auth'
import { extractAccess } from '#/lib/rbac'
import { logAudit } from '#/lib/logger'
import { RoleGate } from '@/components/shared/RoleGate'
import { DeleteDialog } from '@/components/shared/DeleteDialog'
import { ArchivedRecordsDrawer, type ArchivedRecord } from '@/components/shared/ArchivedRecordsDrawer'
import { getErrorMessage } from '@/lib/utils'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Loader2,
  PlusCircle,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ArrowLeftRight,
} from 'lucide-react'
import { z } from 'zod'

// ── Types ─────────────────────────────────────────────────────────────────────

type TxTypeRow = {
  id: string
  name: string
  description: string | null
  pairedWith: string | null
  isActive: boolean
  createdAt: Date
  transactionCount: number
}

// ── Validation ────────────────────────────────────────────────────────────────

const txTypeSchema = z.object({
  name:        z.string().trim().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  pairedWith:  z.string().nullable().optional(),
})

type TxTypeInput = z.infer<typeof txTypeSchema>

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'transactionTypes' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [txTypes, archived] = await Promise.all([
      db.transactionType.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { transactions: true } } },
      }),
      context.isAdmin
        ? db.transactionType.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    return { authorized: true as const, txTypes, archived, access: extractAccess(context) }
  })

const createTransactionType = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: TxTypeInput) => {
    const parsed = txTypeSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data, context }) => {
    const existing = await db.transactionType.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, deletedAt: null },
    })
    if (existing) throw new Error('A transaction type with this name already exists.')
    if (data.pairedWith) {
      const paired = await db.transactionType.findFirst({
        where: { name: { equals: data.pairedWith, mode: 'insensitive' }, deletedAt: null },
      })
      if (!paired) throw new Error(`Paired type "${data.pairedWith}" does not exist.`)
    }
    const tt = await db.transactionType.create({
      data: {
        name:        data.name,
        description: data.description ?? null,
        pairedWith:  data.pairedWith ?? null,
      },
    })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'transactionTypes', resourceId: tt.id, newValue: { name: data.name, pairedWith: data.pairedWith } }).catch(() => {})
    return { success: true }
  })

const updateTransactionType = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: TxTypeInput & { id: string; isActive: boolean }) => {
    const parsed = txTypeSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id, isActive: data.isActive }
  })
  .handler(async ({ data, context }) => {
    const existing = await db.transactionType.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id: data.id }, deletedAt: null },
    })
    if (existing) throw new Error('A transaction type with this name already exists.')
    if (data.pairedWith) {
      const paired = await db.transactionType.findFirst({
        where: { name: { equals: data.pairedWith, mode: 'insensitive' }, NOT: { id: data.id }, deletedAt: null },
      })
      if (!paired) throw new Error(`Paired type "${data.pairedWith}" does not exist.`)
    }
    const old = await db.transactionType.findUnique({ where: { id: data.id } })
    await db.transactionType.update({
      where: { id: data.id },
      data: {
        name:        data.name,
        description: data.description ?? null,
        pairedWith:  data.pairedWith ?? null,
        isActive:    data.isActive,
      },
    })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'transactionTypes', resourceId: data.id, oldValue: old ? { name: old.name, isActive: old.isActive, pairedWith: old.pairedWith } : undefined, newValue: { name: data.name, isActive: data.isActive, pairedWith: data.pairedWith } }).catch(() => {})
    return { success: true }
  })

const softDeleteTransactionType = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const [transactionCount, batchCount] = await Promise.all([
      db.transaction.count({ where: { transactionTypeId: data.id } }),
      db.uploadBatch.count({ where: { transactionTypeId: data.id } }),
    ])
    if (transactionCount > 0)
      throw new Error(`Cannot archive — ${transactionCount} transaction(s) use this type.`)
    if (batchCount > 0)
      throw new Error(`Cannot archive — ${batchCount} upload batch(es) use this type.`)

    const old = await db.transactionType.findUnique({ where: { id: data.id } })
    await db.transactionType.update({
      where: { id: data.id },
      data: { deletedAt: new Date(), deletedBy: context.user.email },
    })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'transactionTypes', resourceId: data.id, oldValue: old ? { name: old.name } : undefined }).catch(() => {})
    return { success: true }
  })

const restoreTransactionType = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const tt = await db.transactionType.findUnique({ where: { id: data.id } })
    const conflict = await db.transactionType.findFirst({
      where: { name: { equals: tt?.name, mode: 'insensitive' }, deletedAt: null },
    })
    if (conflict) throw new Error(`A transaction type named "${tt?.name}" already exists. Rename it before restoring.`)

    await db.transactionType.update({
      where: { id: data.id },
      data: { deletedAt: null, deletedBy: null },
    })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'transactionTypes', resourceId: data.id, newValue: { restored: true } }).catch(() => {})
    return { success: true }
  })

const permanentDeleteTransactionType = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const old = await db.transactionType.findUnique({ where: { id: data.id } })
    await db.transactionType.delete({ where: { id: data.id } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'transactionTypes', resourceId: data.id, oldValue: old ? { name: old.name, permanentDelete: true } : undefined }).catch(() => {})
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/transaction-types')({
  loader: () => getPageData(),
  component: TransactionTypesPage,
})

// ── Create Dialog ─────────────────────────────────────────────────────────────

function CreateTxTypeDialog({
  existingNames,
  onSuccess,
}: {
  existingNames: string[]
  onSuccess: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm]           = useState({ name: '', description: '', pairedWith: '' })

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await createTransactionType({
        data: {
          name:        form.name,
          description: form.description || undefined,
          pairedWith:  form.pairedWith || null,
        },
      })
      setOpen(false)
      setForm({ name: '', description: '', pairedWith: '' })
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to create transaction type.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><PlusCircle className="w-4 h-4 mr-2" />Add Type</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create Transaction Type</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Sales"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              placeholder="Describe this transaction type"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Paired With <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select
              value={form.pairedWith || '__none__'}
              onValueChange={(v) => setForm({ ...form, pairedWith: v === '__none__' ? '' : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="None (unpaired)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (unpaired)</SelectItem>
                {existingNames.map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────

function EditTxTypeDialog({
  txType,
  existingNames,
  onSuccess,
}: {
  txType: TxTypeRow
  existingNames: string[]
  onSuccess: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm]           = useState({
    name:        txType.name,
    description: txType.description ?? '',
    pairedWith:  txType.pairedWith ?? '',
    isActive:    txType.isActive,
  })

  const pairOptions = existingNames.filter((n) => n !== txType.name)

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await updateTransactionType({
        data: {
          id:          txType.id,
          name:        form.name,
          description: form.description || undefined,
          pairedWith:  form.pairedWith || null,
          isActive:    form.isActive,
        },
      })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update transaction type.'))
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
        <DialogHeader><DialogTitle>Edit Transaction Type</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Paired With <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select
              value={form.pairedWith || '__none__'}
              onValueChange={(v) => setForm({ ...form, pairedWith: v === '__none__' ? '' : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="None (unpaired)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (unpaired)</SelectItem>
                {pairOptions.map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function TransactionTypesPage() {
  const loaderData = Route.useLoaderData()
  const router     = useRouter()

  const [sorting, setSorting]                   = useState<SortingState>([])
  const [globalFilter, setGlobalFilter]         = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  if (!loaderData.authorized) return <Unauthorized />
  const { txTypes, archived, access } = loaderData

  function refresh() { router.invalidate() }

  const data: TxTypeRow[] = useMemo(
    () =>
      txTypes.map((t) => ({
        id:               t.id,
        name:             t.name,
        description:      t.description ?? null,
        pairedWith:       t.pairedWith ?? null,
        isActive:         t.isActive,
        createdAt:        t.createdAt,
        transactionCount: t._count.transactions,
      })),
    [txTypes]
  )

  const existingNames = useMemo(() => data.map((d) => d.name), [data])

  const archivedRecords: ArchivedRecord[] = useMemo(
    () =>
      archived.map((t) => ({
        id:        t.id,
        name:      t.name,
        extra:     t.description ?? null,
        deletedAt: t.deletedAt!,
        deletedBy: t.deletedBy ?? null,
      })),
    [archived]
  )

  const columns: ColumnDef<TxTypeRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            Name
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
              : <ArrowUpDown className="ml-2 w-3 h-3" />}
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium">{row.getValue('name')}</span>
          </div>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Description',
        enableSorting: false,
        cell: ({ row }) => {
          const desc = row.getValue('description') as string | null
          return desc
            ? <span className="text-muted-foreground text-sm">{desc}</span>
            : <span className="text-xs text-muted-foreground italic">—</span>
        },
      },
      {
        accessorKey: 'pairedWith',
        header: 'Paired With',
        enableSorting: false,
        cell: ({ row }) => {
          const paired = row.getValue('pairedWith') as string | null
          return paired
            ? <Badge variant="secondary">{paired}</Badge>
            : <span className="text-xs text-muted-foreground italic">—</span>
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
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            Transactions
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
              : <ArrowUpDown className="ml-2 w-3 h-3" />}
          </Button>
        ),
        cell: ({ row }) => {
          const count = row.getValue('transactionCount') as number
          return <Badge variant={count > 0 ? 'secondary' : 'outline'}>{count}</Badge>
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            Created
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
              : <ArrowUpDown className="ml-2 w-3 h-3" />}
          </Button>
        ),
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
          const txType = row.original
          return (
            <RoleGate {...access} requireAdmin>
              <div className="flex items-center justify-end gap-1">
                <EditTxTypeDialog txType={txType} existingNames={existingNames} onSuccess={refresh} />
                <DeleteDialog
                  title="Archive Transaction Type"
                  description={<>Archive <strong>{txType.name}</strong>? It will be hidden from active lists but can be restored later.</>}
                  disabled={txType.transactionCount > 0}
                  disabledReason={txType.transactionCount > 0 ? `This type has ${txType.transactionCount} transaction(s) and cannot be archived.` : undefined}
                  onConfirm={async () => { await softDeleteTransactionType({ data: { id: txType.id } }); refresh() }}
                />
              </div>
            </RoleGate>
          )
        },
      },
    ],
    [access, existingNames]
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
          <h1 className="text-3xl font-bold tracking-tight">Transaction Types</h1>
          <p className="text-muted-foreground">Manage transaction type definitions</p>
        </div>
        <div className="flex items-center gap-2">
          <RoleGate {...access} requireAdmin>
            <ArchivedRecordsDrawer
              title="Archived Transaction Types"
              records={archivedRecords}
              onRestore={async (id) => { await restoreTransactionType({ data: { id } }); refresh() }}
              onPermanentDelete={async (id) => { await permanentDeleteTransactionType({ data: { id } }); refresh() }}
              onOpenChange={(open) => { if (!open) refresh() }}
            />
            <CreateTxTypeDialog existingNames={existingNames} onSuccess={refresh} />
          </RoleGate>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Transaction Types</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} types
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search types..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="flex-1 md:max-w-sm"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden md:flex shrink-0">
                  <SlidersHorizontal className="w-4 h-4 mr-2" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((c) => c.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(v) => column.toggleVisibility(!!v)}
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Table — desktop */}
          <div className="hidden md:block rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                      No transaction types found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Card list — mobile */}
          <div className="flex flex-col gap-3 md:hidden">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const t = row.original
                return (
                  <div key={t.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowLeftRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{t.name}</span>
                      </div>
                      <RoleGate {...access} requireAdmin>
                        <div className="flex items-center gap-1 shrink-0">
                          <EditTxTypeDialog txType={t} existingNames={existingNames} onSuccess={refresh} />
                          <DeleteDialog
                            title="Archive Transaction Type"
                            description={<>Archive <strong>{t.name}</strong>? It can be restored later.</>}
                            disabled={t.transactionCount > 0}
                            disabledReason={t.transactionCount > 0 ? `Has ${t.transactionCount} transaction(s).` : undefined}
                            onConfirm={async () => { await softDeleteTransactionType({ data: { id: t.id } }); refresh() }}
                          />
                        </div>
                      </RoleGate>
                    </div>
                    {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                    {t.pairedWith && (
                      <p className="text-xs text-muted-foreground">
                        Paired: <Badge variant="secondary" className="ml-1">{t.pairedWith}</Badge>
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      {t.isActive
                        ? <Badge variant="default">Active</Badge>
                        : <Badge variant="secondary">Inactive</Badge>}
                      <Badge variant="outline">{t.transactionCount} transactions</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="text-center text-muted-foreground py-8 text-sm">No transaction types found.</p>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}