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
import { extractAccess, invalidateAccessCache } from '#/lib/rbac'
import { logAudit } from '#/lib/logger'
import { restoreRecord, permanentDeleteRecord } from '#/lib/crud-helpers'
import { createUserSchema, type CreateUserInput } from '#/lib/user'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Loader2,
  UserPlus,
  UserCog,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type UserRow = {
  id: string
  name: string
  email: string
  createdAt: Date
  roles: { id: string; roleName: string; branchName: string | null; branchId: string | null }[]
}

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'users' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [users, roles, branches, archived] = await Promise.all([
      db.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: {
            include: { role: true, branch: true },
          },
        },
      }),
      db.role.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      db.branch.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      context.isAdmin
        ? db.user.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    return {
      authorized: true as const,
      users,
      roles,
      branches,
      archived,
      access: extractAccess(context),
    }
  })

const createUser = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: CreateUserInput) => {
    const parsed = createUserSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data, context }) => {
    const existing = await db.user.findUnique({ where: { email: data.email } })
    if (existing) throw new Error('Unable to create user. The email may already be in use.')

    const role = await db.role.findUnique({ where: { name: data.role } })
    if (!role) throw new Error('Role not found.')

    const { hashPassword } = await import('better-auth/crypto')
    const hashedPassword = await hashPassword(data.password)

    let newUserId = ''
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name:          data.name,
          email:         data.email,
          emailVerified: false,
        },
      })
      newUserId = user.id

      await tx.account.create({
        data: {
          id:          crypto.randomUUID(),
          accountId:   user.id,
          providerId:  'credential',
          userId:      user.id,
          password:    hashedPassword,
          createdAt:   new Date(),
          updatedAt:   new Date(),
        },
      })

      await tx.userRole.create({
        data: {
          userId:   user.id,
          roleId:   role.id,
          branchId: data.branchId ?? null,
        },
      })
    })

    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'users', resourceId: newUserId, newValue: { name: data.name, email: data.email, role: data.role } }).catch(() => {})
    return { success: true }
  })

const softDeleteUser = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    if (data.userId === context.user.id) throw new Error('Cannot archive your own account.')

    const batchCount = await db.uploadBatch.count({ where: { uploadedBy: data.userId } })
    if (batchCount > 0) throw new Error(`Cannot archive — user has ${batchCount} upload batch(es) on record.`)

    const targetRoles = await db.userRole.findMany({
      where: { userId: data.userId },
      include: { role: true },
    })
    const isTargetAdmin = targetRoles.some((ur) => ur.role.type === 'ADMIN')
    if (isTargetAdmin) {
      const adminCount = await db.userRole.count({
        where: { role: { type: 'ADMIN' }, user: { deletedAt: null } },
      })
      if (adminCount <= 1) throw new Error('Cannot archive the last admin user.')
    }

    const old = await db.user.findUnique({ where: { id: data.userId }, select: { name: true, email: true } })
    await db.user.update({
      where: { id: data.userId },
      data: { deletedAt: new Date(), deletedBy: context.user.email },
    })
    invalidateAccessCache(data.userId)
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'users', resourceId: data.userId, oldValue: old ?? undefined }).catch(() => {})
    return { success: true }
  })

const restoreUserFn = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    await restoreRecord(db.user, data.userId, { userId: context.user.id, userEmail: context.user.email }, 'users', { field: 'email' })
    return { success: true }
  })

const permanentDeleteUserFn = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    await permanentDeleteRecord(db.user, data.userId, { userId: context.user.id, userEmail: context.user.email }, 'users')
    invalidateAccessCache(data.userId)
    return { success: true }
  })

const updateUserRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { userId: string; roleName: string; branchId?: string }) => data)
  .handler(async ({ data, context }) => {
    const role = await db.role.findUnique({ where: { name: data.roleName } })
    if (!role) throw new Error('Role not found.')

    await db.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: data.userId } })
      await tx.userRole.create({
        data: {
          userId:   data.userId,
          roleId:   role.id,
          branchId: data.branchId ?? null,
        },
      })
    })

    invalidateAccessCache(data.userId)
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'users', resourceId: data.userId, newValue: { role: data.roleName, branchId: data.branchId } }).catch(() => {})
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/users')({
  loader: () => getPageData(),
  component: UsersPage,
})

// ── Dialogs ───────────────────────────────────────────────────────────────────

function CreateUserDialog({
  roles,
  branches,
  onSuccess,
}: {
  roles: { id: string; name: string }[]
  branches: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: '', branchId: 'none',
  })

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await createUser({
        data: {
          name:     form.name,
          email:    form.email,
          password: form.password,
          role:     form.role,
          branchId: form.branchId === 'none' ? undefined : form.branchId,
        },
      })
      setOpen(false)
      setForm({ name: '', email: '', password: '', role: '', branchId: 'none' })
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to create user.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input
              placeholder="Jane Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="jane@company.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              placeholder="Min. 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
              <SelectTrigger><SelectValue placeholder="Global (no branch)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Global (no branch)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UpdateRoleDialog({
  userId,
  currentRole,
  currentBranchId,
  roles,
  branches,
  onSuccess,
}: {
  userId: string
  currentRole: string
  currentBranchId: string | null
  roles: { id: string; name: string }[]
  branches: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [selectedRole, setSelectedRole]     = useState(currentRole)
  const [selectedBranch, setSelectedBranch] = useState(currentBranchId ?? 'none')

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await updateUserRole({
        data: {
          userId,
          roleName: selectedRole,
          branchId: selectedBranch === 'none' ? undefined : selectedBranch,
        },
      })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update role.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <UserCog className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update User Role</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger><SelectValue placeholder="Global (no branch)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Global (no branch)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</> : 'Update Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function UsersPage() {
  const loaderData = Route.useLoaderData()
  const router = useRouter()

  const [sorting, setSorting]                   = useState<SortingState>([])
  const [globalFilter, setGlobalFilter]         = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  if (!loaderData.authorized) return <Unauthorized />
  const { users, roles, branches, archived, access } = loaderData

  function refresh() { router.invalidate() }

  const data: UserRow[] = useMemo(
    () =>
      users.map((u) => ({
        id:        u.id,
        name:      u.name,
        email:     u.email,
        createdAt: u.createdAt,
        roles:     u.userRoles.map((ur) => ({
          id:         ur.id,
          roleName:   ur.role.name,
          branchName: ur.branch?.name ?? null,
          branchId:   ur.branchId ?? null,
        })),
      })),
    [users]
  )

  const archivedRecords: ArchivedRecord[] = useMemo(
    () =>
      archived.map((u) => ({
        id:        u.id,
        name:      u.name,
        extra:     u.email,
        deletedAt: u.deletedAt!,
        deletedBy: u.deletedBy ?? null,
      })),
    [archived]
  )

  const columns: ColumnDef<UserRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <SortableHeader column={column} label="Name" />,
        cell: ({ row }) => <span>{row.getValue('name')}</span>,
      },
      {
        accessorKey: 'email',
        header: ({ column }) => <SortableHeader column={column} label="Email" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.getValue('email')}</span>,
      },
      {
        accessorKey: 'roles',
        header: 'Roles',
        enableSorting: false,
        cell: ({ row }) => {
          const roles = row.getValue('roles') as UserRow['roles']
          return (
            <div className="flex flex-wrap gap-1">
              {roles.length === 0 ? (
                <span className="text-xs text-muted-foreground">No role</span>
              ) : (
                roles.map((r) => (
                  <Badge key={r.id} variant="secondary" className="text-xs">
                    {r.branchName ? `${r.roleName} · ${r.branchName}` : r.roleName}
                  </Badge>
                ))
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <SortableHeader column={column} label="Joined" />,
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
          const user = row.original
          return (
            <RoleGate {...access} requireAdmin>
              <div className="flex items-center justify-end gap-1">
                <UpdateRoleDialog
                  userId={user.id}
                  currentRole={user.roles[0]?.roleName ?? ''}
                  currentBranchId={user.roles[0]?.branchId ?? null}
                  roles={roles}
                  branches={branches}
                  onSuccess={refresh}
                />
                <DeleteDialog
                  title="Archive User"
                  description={<>Archive <strong>{user.name}</strong>? They will be hidden from active lists but can be restored later.</>}
                  onConfirm={async () => { await softDeleteUser({ data: { userId: user.id } }); refresh() }}
                />
              </div>
            </RoleGate>
          )
        },
      },
    ],
    [access, roles, branches]
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and roles</p>
        </div>
        <RoleGate {...access} requireAdmin>
          <div className="flex items-center gap-2">
            <ArchivedRecordsDrawer
              title="Archived Users"
              records={archivedRecords}
              onRestore={async (id) => { await restoreUserFn({ data: { userId: id } }); refresh() }}
              onPermanentDelete={async (id) => { await permanentDeleteUserFn({ data: { userId: id } }); refresh() }}
              onOpenChange={(open) => { if (!open) refresh() }}
            />
            <CreateUserDialog roles={roles} branches={branches} onSuccess={refresh} />
          </div>
        </RoleGate>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} accounts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <TableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            searchPlaceholder="Search users..."
            exportFilename="users"
            exportSheetName="Users"
            exportData={table.getFilteredRowModel().rows.map((r) => ({
              Name: r.original.name,
              Email: r.original.email,
              Roles: r.original.roles.map((ro) => ro.branchName ? `${ro.roleName} (${ro.branchName})` : ro.roleName).join(', '),
              Joined: new Date(r.original.createdAt).toLocaleDateString('en-IN'),
            }))}
          />

          <DataTable
            table={table}
            columns={columns}
            emptyMessage="No users found."
            mobileCard={(user) => (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{user.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <RoleGate {...access} requireAdmin>
                    <div className="flex items-center gap-1 shrink-0">
                      <UpdateRoleDialog
                        userId={user.id}
                        currentRole={user.roles[0]?.roleName ?? ''}
                        currentBranchId={user.roles[0]?.branchId ?? null}
                        roles={roles}
                        branches={branches}
                        onSuccess={refresh}
                      />
                      <DeleteDialog
                        title="Archive User"
                        description={<>Archive <strong>{user.name}</strong>? They can be restored later.</>}
                        onConfirm={async () => { await softDeleteUser({ data: { userId: user.id } }); refresh() }}
                      />
                    </div>
                  </RoleGate>
                </div>
                <div className="flex flex-wrap gap-1">
                  {user.roles.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No role</span>
                  ) : (
                    user.roles.map((r) => (
                      <Badge key={r.id} variant="secondary" className="text-xs">
                        {r.branchName ? `${r.roleName} · ${r.branchName}` : r.roleName}
                      </Badge>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Joined {new Date(user.createdAt).toLocaleDateString('en-IN')}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
