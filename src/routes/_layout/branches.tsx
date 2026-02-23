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
import { authMiddleware } from '#/middleware/auth'
import { adminMiddleware } from '#/middleware/admin'
import { resourceMiddleware } from '#/middleware/resource'
import { RoleGate } from '@/components/shared/RoleGate'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Loader2,
  PlusCircle,
  Trash2,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
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
  name:    z.string().min(2, 'Name must be at least 2 characters'),
  address: z.string().optional(),
})

type BranchInput = z.infer<typeof branchSchema>

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([resourceMiddleware('branches')])
  .handler(async ({ context }) => {
    const branches = await db.branch.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { userRoles: true } } },
    })

    return {
      branches,
      access: {
        isAdmin:     context.isAdmin,
        roles:       context.roles,
        permissions: context.permissions,
      },
    }
  })

const createBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: BranchInput) => data)
  .handler(async ({ data }) => {
    const parsed = branchSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)

    const existing = await db.branch.findFirst({
      where: { name: { equals: parsed.data.name, mode: 'insensitive' } },
    })
    if (existing) throw new Error('A branch with this name already exists.')

    await db.branch.create({
      data: { name: parsed.data.name, address: parsed.data.address ?? null },
    })

    return { success: true }
  })

const updateBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: BranchInput & { id: string }) => data)
  .handler(async ({ data }) => {
    const parsed = branchSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)

    const existing = await db.branch.findFirst({
      where: { name: { equals: parsed.data.name, mode: 'insensitive' }, NOT: { id: data.id } },
    })
    if (existing) throw new Error('A branch with this name already exists.')

    await db.branch.update({
      where: { id: data.id },
      data: { name: parsed.data.name, address: parsed.data.address ?? null },
    })

    return { success: true }
  })

const deleteBranch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const [userCount, transactionCount, batchCount] = await Promise.all([
      db.userRole.count({ where: { branchId: data.id } }),
      db.transaction.count({ where: { branchId: data.id } }),
      db.uploadBatch.count({ where: { branchId: data.id } }),
    ])

    if (userCount > 0)
      throw new Error(`Cannot delete — ${userCount} user(s) are assigned to this branch.`)
    if (transactionCount > 0)
      throw new Error(`Cannot delete — ${transactionCount} transaction(s) reference this branch.`)
    if (batchCount > 0)
      throw new Error(`Cannot delete — ${batchCount} upload batch(es) reference this branch.`)

    await db.branch.delete({ where: { id: data.id } })
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/branches')({
  loader: () => getPageData(),
  errorComponent: () => <Unauthorized />,
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
    } catch (e: any) {
      setError(e.message ?? 'Failed to create branch.')
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
    } catch (e: any) {
      setError(e.message ?? 'Failed to update branch.')
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
  const { branches, access } = Route.useLoaderData()
  const router = useRouter()

  const [sorting, setSorting]                   = useState<SortingState>([])
  const [globalFilter, setGlobalFilter]         = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [deleteError, setDeleteError]           = useState<string | null>(null)

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

  const columns: ColumnDef<BranchRow>[] = useMemo(
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
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
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
        accessorKey: 'userCount',
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            Users
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
              : <ArrowUpDown className="ml-2 w-3 h-3" />}
          </Button>
        ),
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
          const branch = row.original
          return (
            <RoleGate {...access} requireAdmin>
              <div className="flex items-center justify-end gap-1">
                <EditBranchDialog branch={branch} onSuccess={refresh} />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteError(null)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Branch</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete <strong>{branch.name}</strong>? This cannot be undone.
                        {branch.userCount > 0 && (
                          <span className="block mt-2 text-destructive font-medium">
                            ⚠ This branch has {branch.userCount} assigned user{branch.userCount !== 1 ? 's' : ''} and cannot be deleted.
                          </span>
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {deleteError && (
                      <Alert variant="destructive">
                        <AlertDescription>{deleteError}</AlertDescription>
                      </Alert>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        disabled={branch.userCount > 0}
                        onClick={async () => {
                          try {
                            await deleteBranch({ data: { id: branch.id } })
                            refresh()
                          } catch (e: any) {
                            setDeleteError(e.message ?? 'Failed to delete branch.')
                          }
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </RoleGate>
          )
        },
      },
    ],
    [access, deleteError]
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
        <RoleGate {...access} requireAdmin>
          <CreateBranchDialog onSuccess={refresh} />
        </RoleGate>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Branches</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} branches
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search branches..."
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
                    <TableCell colSpan={columns.length} className="text-center py-10 text-muted-foreground">
                      No branches found.
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
                const branch = row.original
                return (
                  <div key={branch.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{branch.name}</span>
                      </div>
                      <RoleGate {...access} requireAdmin>
                        <div className="flex items-center gap-1 shrink-0">
                          <EditBranchDialog branch={branch} onSuccess={refresh} />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteError(null)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Branch</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete <strong>{branch.name}</strong>? This cannot be undone.
                                  {branch.userCount > 0 && (
                                    <span className="block mt-2 text-destructive font-medium">
                                      ⚠ This branch has {branch.userCount} assigned user{branch.userCount !== 1 ? 's' : ''} and cannot be deleted.
                                    </span>
                                  )}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              {deleteError && (
                                <Alert variant="destructive">
                                  <AlertDescription>{deleteError}</AlertDescription>
                                </Alert>
                              )}
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  disabled={branch.userCount > 0}
                                  onClick={async () => {
                                    try {
                                      await deleteBranch({ data: { id: branch.id } })
                                      refresh()
                                    } catch (e: any) {
                                      setDeleteError(e.message ?? 'Failed to delete branch.')
                                    }
                                  }}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
                )
              })
            ) : (
              <p className="text-center py-10 text-muted-foreground text-sm">No branches found.</p>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </p>
            <div className="flex items-center gap-2">
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