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
} from '@tanstack/react-table'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { authMiddleware } from '#/middleware/auth'
import { extractAccess, invalidateAccessCache } from '#/lib/rbac'
import { logAudit } from '#/lib/logger'
import { DeleteDialog } from '@/components/shared/DeleteDialog'
import { RoleGate } from '@/components/shared/RoleGate'
import { ArchivedRecordsDrawer, type ArchivedRecord } from '@/components/shared/ArchivedRecordsDrawer'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import {
  Loader2,
  PlusCircle,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Shield,
  Users,
  Key,
} from 'lucide-react'
import { z } from 'zod'
import { cn, getErrorMessage } from '@/lib/utils'
import { ALL_RESOURCES, ALL_ACTIONS, type Resource, type Action } from '#/lib/constants'

// ── Types ─────────────────────────────────────────────────────────────────────

type PagePermission = {
  resource: string
  actions: string[]
}

type RoleRow = {
  id: string
  name: string
  type: string
  description: string | null
  userCount: number
  pagePermissions: PagePermission[]
  createdAt: Date
}

// ── Validation ────────────────────────────────────────────────────────────────

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
})

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'roles' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [roles, archived] = await Promise.all([
      db.role.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        include: {
          pagePermissions: true,
          _count: { select: { userRoles: true } },
        },
      }),
      context.isAdmin
        ? db.role.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    let users: { id: string; name: string; email: string }[] = []
    let branches: { id: string; name: string }[] = []

    if (context.isAdmin) {
      ;[users, branches] = await Promise.all([
        db.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }),
        db.branch.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      ])
    }

    return {
      authorized: true as const,
      roles,
      archived,
      users,
      branches,
      access: extractAccess(context),
    }
  })

const createRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: {
    name: string
    description: string
    pagePermissions: PagePermission[]
  }) => {
    const parsed = roleSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, description: data.description, pagePermissions: data.pagePermissions }
  })
  .handler(async ({ data, context }) => {
    const existing = await db.role.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, deletedAt: null },
    })
    if (existing) throw new Error('A role with this name already exists.')

    await db.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name:        data.name,
          type:        'CUSTOM',
          description: data.description || null,
        },
      })
      if (data.pagePermissions.length > 0) {
        await tx.pagePermission.createMany({
          data: data.pagePermissions.map((pp) => ({
            roleId:   role.id,
            resource: pp.resource,
            actions:  pp.actions,
          })),
        })
      }
    })

    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'roles', newValue: { name: data.name } }).catch(() => {})
    return { success: true }
  })

const updateRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: {
    id: string
    name: string
    description: string
    pagePermissions: PagePermission[]
  }) => {
    const parsed = roleSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id, description: data.description, pagePermissions: data.pagePermissions }
  })
  .handler(async ({ data, context }) => {
    const existing = await db.role.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id: data.id }, deletedAt: null },
    })
    if (existing) throw new Error('A role with this name already exists.')

    const old = await db.role.findUnique({ where: { id: data.id } })

    await db.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: data.id },
        data: { name: data.name, description: data.description || null },
      })
      await tx.pagePermission.deleteMany({ where: { roleId: data.id } })
      if (data.pagePermissions.length > 0) {
        await tx.pagePermission.createMany({
          data: data.pagePermissions.map((pp) => ({
            roleId:   data.id,
            resource: pp.resource,
            actions:  pp.actions,
          })),
        })
      }
    })

    invalidateAccessCache() // role permissions changed — clear all cached access
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'roles', resourceId: data.id, oldValue: old ? { name: old.name } : undefined, newValue: { name: data.name } }).catch(() => {})
    return { success: true }
  })

const softDeleteRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const role = await db.role.findUnique({ where: { id: data.id } })
    if (!role) throw new Error('Role not found.')
    if (role.type !== 'CUSTOM')
      throw new Error(`System roles cannot be archived.`)

    const userCount = await db.userRole.count({ where: { roleId: data.id } })
    if (userCount > 0)
      throw new Error(`Cannot archive — ${userCount} user(s) are assigned to this role.`)

    await db.role.update({
      where: { id: data.id },
      data: { deletedAt: new Date(), deletedBy: context.user.email },
    })

    invalidateAccessCache() // role removed — clear all cached access
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'roles', resourceId: data.id, oldValue: { name: role.name } }).catch(() => {})
    return { success: true }
  })

const restoreRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const role = await db.role.findUnique({ where: { id: data.id } })
    const conflict = await db.role.findFirst({
      where: { name: { equals: role?.name, mode: 'insensitive' }, deletedAt: null },
    })
    if (conflict) throw new Error(`A role named "${role?.name}" already exists. Rename it before restoring.`)

    await db.role.update({
      where: { id: data.id },
      data: { deletedAt: null, deletedBy: null },
    })

    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'roles', resourceId: data.id, newValue: { restored: true } }).catch(() => {})
    return { success: true }
  })

const permanentDeleteRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const old = await db.role.findUnique({ where: { id: data.id } })
    await db.role.delete({ where: { id: data.id } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'roles', resourceId: data.id, oldValue: old ? { name: old.name, permanentDelete: true } : undefined }).catch(() => {})
    return { success: true }
  })

const assignRole = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { userId: string; roleId: string; branchId?: string }) => data)
  .handler(async ({ data }) => {
    const existing = await db.userRole.findFirst({
      where: {
        userId:   data.userId,
        roleId:   data.roleId,
        branchId: data.branchId ?? null,
      },
    })
    if (existing) throw new Error('This role is already assigned to this user.')

    await db.userRole.create({
      data: {
        userId:   data.userId,
        roleId:   data.roleId,
        branchId: data.branchId ?? null,
      },
    })

    invalidateAccessCache(data.userId)
    return { success: true }
  })

// ── Permission Editor ─────────────────────────────────────────────────────────

function PermissionEditor({
  value,
  onChange,
}: {
  value: PagePermission[]
  onChange: (next: PagePermission[]) => void
}) {
  function getActions(resource: string): string[] {
    return value.find((p) => p.resource === resource)?.actions ?? []
  }

  function toggleAction(resource: Resource, action: Action) {
    const current = getActions(resource)
    const hasAction = current.includes(action)
    const next = hasAction ? current.filter((a) => a !== action) : [...current, action]

    if (next.length === 0) {
      onChange(value.filter((p) => p.resource !== resource))
    } else {
      const exists = value.find((p) => p.resource === resource)
      if (exists) {
        onChange(value.map((p) => p.resource === resource ? { ...p, actions: next } : p))
      } else {
        onChange([...value, { resource, actions: next }])
      }
    }
  }

  function toggleResource(resource: Resource) {
    const current = getActions(resource)
    const allSelected = ALL_ACTIONS.every((a) => current.includes(a))
    if (allSelected) {
      onChange(value.filter((p) => p.resource !== resource))
    } else {
      const exists = value.find((p) => p.resource === resource)
      if (exists) {
        onChange(value.map((p) => p.resource === resource ? { ...p, actions: [...ALL_ACTIONS] } : p))
      } else {
        onChange([...value, { resource, actions: [...ALL_ACTIONS] }])
      }
    }
  }

  return (
    <div className="rounded-md border overflow-hidden max-h-72 overflow-y-auto">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_repeat(5,_2rem)] gap-x-1 px-3 py-2 bg-muted/50 border-b sticky top-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Resource
        </span>
        {ALL_ACTIONS.map((a) => (
          <span key={a} className="text-xs font-semibold text-muted-foreground text-center capitalize">
            {a.slice(0, 1).toUpperCase()}
          </span>
        ))}
        <span className="text-xs font-semibold text-muted-foreground text-center">All</span>
      </div>

      {/* Resource rows */}
      {ALL_RESOURCES.map((resource, i) => {
        const current      = getActions(resource)
        const allSelected  = ALL_ACTIONS.every((a) => current.includes(a))
        const someSelected = ALL_ACTIONS.some((a) => current.includes(a))
        const isActive     = current.length > 0

        return (
          <div
            key={resource}
            className={cn(
              'grid grid-cols-[1fr_repeat(5,_2rem)] gap-x-1 items-center px-3 py-2',
              i % 2 === 0 ? 'bg-background' : 'bg-muted/20',
              isActive && 'bg-primary/5'
            )}
          >
            <span className="text-sm font-medium capitalize truncate">{resource}</span>
            {ALL_ACTIONS.map((action) => (
              <div key={action} className="flex items-center justify-center">
                <Checkbox
                  id={`${resource}-${action}`}
                  checked={current.includes(action)}
                  onCheckedChange={() => toggleAction(resource, action)}
                />
              </div>
            ))}
            <div className="flex items-center justify-center">
              <Checkbox
                id={`res-${resource}`}
                checked={allSelected}
                data-state={someSelected && !allSelected ? 'indeterminate' : undefined}
                onCheckedChange={() => toggleResource(resource)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Create Role Dialog ────────────────────────────────────────────────────────

function CreateRoleDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen]               = useState(false)
  const [isPending, setIsPending]     = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [pagePermissions, setPagePermissions] = useState<PagePermission[]>([])

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await createRole({ data: { name, description, pagePermissions } })
      setOpen(false)
      setName('')
      setDescription('')
      setPagePermissions([])
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to create role.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="min-w-0 flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-3">
          <PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 shrink-0" />
          <span className="hidden sm:inline">Add Role</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create New Role</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Role Name</Label>
            <Input
              placeholder="e.g. Accountant"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              placeholder="Brief description of this role"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Page Permissions</Label>
            <PermissionEditor value={pagePermissions} onChange={setPagePermissions} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} className="w-full">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Role Dialog ──────────────────────────────────────────────────────────

function EditRoleDialog({
  role,
  onSuccess,
}: {
  role: RoleRow
  onSuccess: () => void
}) {
  const [open, setOpen]               = useState(false)
  const [isPending, setIsPending]     = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [name, setName]               = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [pagePermissions, setPagePermissions] = useState<PagePermission[]>(role.pagePermissions)

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(role.name)
      setDescription(role.description ?? '')
      setPagePermissions(role.pagePermissions)
      setError(null)
    }
    setOpen(next)
  }

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      await updateRole({ data: { id: role.id, name, description, pagePermissions } })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update role.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Role</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Role Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              placeholder="Brief description of this role"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Page Permissions</Label>
            <PermissionEditor value={pagePermissions} onChange={setPagePermissions} />
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

// ── Assign Role Dialog ────────────────────────────────────────────────────────

function AssignRoleDialog({
  roles,
  users,
  branches,
  onSuccess,
}: {
  roles: RoleRow[]
  users: { id: string; name: string; email: string }[]
  branches: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [userId, setUserId]       = useState('')
  const [roleId, setRoleId]       = useState('')
  const [branchId, setBranchId]   = useState('none')

  async function handleSubmit() {
    if (!userId || !roleId) { setError('Please select a user and a role.'); return }
    setError(null)
    setIsPending(true)
    try {
      await assignRole({
        data: { userId, roleId, branchId: branchId === 'none' ? undefined : branchId },
      })
      setOpen(false)
      setUserId('')
      setRoleId('')
      setBranchId('none')
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to assign role.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-3">
          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 shrink-0" />
          <span className="hidden sm:inline">Assign Role</span>
          <span className="sm:hidden">Assign</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Role to User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>User</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Select a user" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} — <span className="text-muted-foreground">{u.email}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={branchId} onValueChange={setBranchId}>
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
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Assigning...</> : 'Assign Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function RolesPage() {
  const loaderData = Route.useLoaderData()
  const router     = useRouter()

  const [sorting, setSorting]           = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  if (!loaderData.authorized) return <Unauthorized />
  const { roles, archived, users, branches, access } = loaderData

  function refresh() { router.invalidate() }

  const data: RoleRow[] = useMemo(
    () =>
      roles.map((r) => ({
        id:              r.id,
        name:            r.name,
        type:            r.type,
        description:     r.description,
        userCount:       r._count.userRoles,
        pagePermissions: r.pagePermissions,
        createdAt:       r.createdAt,
      })),
    [roles]
  )

  const archivedRecords: ArchivedRecord[] = useMemo(
    () =>
      archived.map((r) => ({
        id:        r.id,
        name:      r.name,
        extra:     r.description ?? null,
        deletedAt: r.deletedAt!,
        deletedBy: r.deletedBy ?? null,
      })),
    [archived]
  )

  const columns: ColumnDef<RoleRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            Role
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
              : <ArrowUpDown className="ml-2 w-3 h-3" />}
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">{row.getValue('name')}</p>
              {row.original.description && (
                <p className="text-xs text-muted-foreground truncate">{row.original.description}</p>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs capitalize">
            {row.getValue<string>('type').toLowerCase().replace('_', ' ')}
          </Badge>
        ),
      },
      {
        accessorKey: 'pagePermissions',
        header: 'Pages',
        enableSorting: false,
        cell: ({ row }) => {
          const perms = row.getValue('pagePermissions') as PagePermission[]
          if (perms.length === 0)
            return <span className="text-xs text-muted-foreground italic">No pages</span>
          return (
            <div className="flex flex-wrap gap-1">
              {perms.map((pp) => (
                <Badge key={pp.resource} variant="secondary" className="text-xs gap-1">
                  <Key className="w-2.5 h-2.5" />
                  {pp.resource}
                  {pp.actions.length < 4 && (
                    <span className="text-muted-foreground">· {pp.actions.join(', ')}</span>
                  )}
                </Badge>
              ))}
            </div>
          )
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
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const role = row.original
          const isSystem = role.type !== 'CUSTOM'
          return (
            <RoleGate {...access} requireAdmin>
              <div className="flex items-center justify-end gap-1">
                <EditRoleDialog role={role} onSuccess={refresh} />
                <DeleteDialog
                  title="Archive Role"
                  description={<>Archive <strong>{role.name}</strong>? It will be hidden from active lists but can be restored later.</>}
                  disabled={role.userCount > 0 || isSystem}
                  disabledReason={
                    isSystem
                      ? 'System roles cannot be archived.'
                      : role.userCount > 0
                      ? `This role has ${role.userCount} assigned user${role.userCount !== 1 ? 's' : ''} and cannot be archived.`
                      : undefined
                  }
                  onConfirm={async () => { await softDeleteRole({ data: { id: role.id } }); refresh() }}
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
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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
          <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
          <p className="text-muted-foreground">Manage roles and page permissions</p>
        </div>
        <RoleGate {...access} requireAdmin>
          <div className="flex items-center gap-2">
            <ArchivedRecordsDrawer
              title="Archived Roles"
              records={archivedRecords}
              onRestore={async (id) => { await restoreRole({ data: { id } }); refresh() }}
              onPermanentDelete={async (id) => { await permanentDeleteRole({ data: { id } }); refresh() }}
              onOpenChange={(open) => { if (!open) refresh() }}
            />
            <AssignRoleDialog roles={data} users={users} branches={branches} onSuccess={refresh} />
            <CreateRoleDialog onSuccess={refresh} />
          </div>
        </RoleGate>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Roles</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} roles
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search roles..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="flex-1 md:max-w-sm"
            />
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
                      No roles found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Card list — mobile */}
          <div className="flex flex-col gap-2 md:hidden">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const role = row.original
                const isSystem = role.type !== 'CUSTOM'
                return (
                  <div key={role.id} className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-sm leading-tight truncate">{role.name}</p>
                          {role.description && (
                            <p className="text-xs text-muted-foreground truncate">{role.description}</p>
                          )}
                        </div>
                      </div>
                      <RoleGate {...access} requireAdmin>
                        <div className="flex items-center gap-1 shrink-0">
                          <EditRoleDialog role={role} onSuccess={refresh} />
                          <DeleteDialog
                            title="Archive Role"
                            description={<>Archive <strong>{role.name}</strong>? It can be restored later.</>}
                            disabled={role.userCount > 0 || isSystem}
                            disabledReason={
                              isSystem
                                ? 'System roles cannot be archived.'
                                : role.userCount > 0
                                ? `Has ${role.userCount} assigned user${role.userCount !== 1 ? 's' : ''}.`
                                : undefined
                            }
                            onConfirm={async () => { await softDeleteRole({ data: { id: role.id } }); refresh() }}
                          />
                        </div>
                      </RoleGate>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs capitalize shrink-0">
                        {role.type.toLowerCase().replace('_', ' ')}
                      </Badge>
                      <Badge variant={role.userCount > 0 ? 'secondary' : 'outline'} className="gap-1 text-xs shrink-0">
                        <Users className="w-3 h-3" />
                        {role.userCount} user{role.userCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    {role.pagePermissions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {role.pagePermissions.map((pp) => (
                          <Badge key={pp.resource} variant="secondary" className="text-xs gap-1 shrink-0">
                            <Key className="w-2.5 h-2.5" />
                            {pp.resource}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="text-center py-10 text-muted-foreground text-sm">No roles found.</p>
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

export const Route = createFileRoute('/_layout/roles')({
  loader: () => getPageData(),
  component: RolesPage,
})