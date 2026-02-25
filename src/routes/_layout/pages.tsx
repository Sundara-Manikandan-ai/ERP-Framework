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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
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
  DialogDescription,
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
  Check,
  X,
  ChevronDown,
  FolderOpen,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { z } from 'zod'
import { cn, getErrorMessage } from '@/lib/utils'
import { ICON_OPTIONS, getIcon } from '@/lib/icons'
import { resourceMiddleware } from '#/middleware/resource'

// ── Types ─────────────────────────────────────────────────────────────────────

type NavGroupOption = { id: string; name: string; order: number }

type RoleAccess = {
  roleId:   string
  roleName: string
  actions:  string[]
}

type PageRow = {
  id:         string
  resource:   string
  label:      string
  path:       string
  icon:       string
  group:      string
  navGroupId: string | null
  order:      number
  isActive:   boolean
  roles:      RoleAccess[]
}

// ── Validation ────────────────────────────────────────────────────────────────

const pageSchema = z.object({
  resource:   z.string().min(1, 'Resource key is required').regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens only'),
  label:      z.string().min(1, 'Label is required'),
  path:       z.string().min(1, 'Path is required').startsWith('/', 'Path must start with /'),
  icon:       z.string().min(1),
  navGroupId: z.string().nullable().optional(),
  order:      z.number().int(),
})

type PageInput = z.infer<typeof pageSchema>

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([resourceMiddleware('pages')])
  .handler(async () => {
    const [pages, roles, navGroups] = await Promise.all([
      db.page.findMany({
        orderBy: { order: 'asc' },
        include: { navGroup: true },
      }),
      db.role.findMany({
        orderBy: { name: 'asc' },
        include: { pagePermissions: true },
      }),
      db.navGroup.findMany({ orderBy: { order: 'asc' } }),
    ])
    return { pages, roles, navGroups }
  })

const createPage = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: PageInput) => {
    const parsed = pageSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data }) => {
    const existing = await db.page.findUnique({ where: { resource: data.resource } })
    if (existing) throw new Error('A page with this resource key already exists.')

    const { navGroupId, ...rest } = data
    await db.page.create({ data: { ...rest, navGroupId: navGroupId || null } })
    return { success: true }
  })

const updatePage = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: PageInput & { id: string }) => {
    const parsed = pageSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data }) => {
    const existing = await db.page.findFirst({
      where: { resource: data.resource, NOT: { id: data.id } },
    })
    if (existing) throw new Error('Another page with this resource key already exists.')

    const { navGroupId, ...rest } = data
    await db.page.update({ where: { id: data.id }, data: { ...rest, navGroupId: navGroupId || null } })
    return { success: true }
  })

const togglePageActive = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ data }) => {
    await db.page.update({ where: { id: data.id }, data: { isActive: data.isActive } })
    return { success: true }
  })

const deletePage = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const page = await db.page.findUnique({ where: { id: data.id } })
    if (!page) throw new Error('Page not found.')

    await db.pagePermission.deleteMany({ where: { resource: page.resource } })
    await db.page.delete({ where: { id: data.id } })
    return { success: true }
  })

const createNavGroup = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { name: string; order: number }) => data)
  .handler(async ({ data }) => {
    const name = data.name.trim()
    if (!name) throw new Error('Name is required.')

    const existing = await db.navGroup.findUnique({ where: { name } })
    if (existing) throw new Error('A nav group with this name already exists.')

    return db.navGroup.create({ data: { name, order: data.order } })
  })

const updateNavGroup = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; name: string; order: number }) => data)
  .handler(async ({ data }) => {
    const name = data.name.trim()
    if (!name) throw new Error('Name is required.')

    const existing = await db.navGroup.findFirst({
      where: { name, NOT: { id: data.id } },
    })
    if (existing) throw new Error('A nav group with this name already exists.')

    return db.navGroup.update({ where: { id: data.id }, data: { name, order: data.order } })
  })

const deleteNavGroup = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    // Unlink pages from this group before deleting
    await db.page.updateMany({ where: { navGroupId: data.id }, data: { navGroupId: null } })
    await db.navGroup.delete({ where: { id: data.id } })
    return { success: true }
  })

// ── Icon Picker ───────────────────────────────────────────────────────────────

function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (name: string) => void
}) {
  return (
    <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 p-1">
      {ICON_OPTIONS.map(({ name, icon: Icon }) => (
        <button
          key={name}
          type="button"
          title={name}
          onClick={() => onChange(name)}
          className={cn(
            'flex items-center justify-center rounded-md p-2 border transition-colors',
            value === name
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
          )}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  )
}

// ── Page Form ─────────────────────────────────────────────────────────────────

function PageForm({
  initial,
  onSubmit,
  isPending,
  error,
  isEdit,
  navGroups,
  onNavGroupCreated,
}: {
  initial: PageInput
  onSubmit: (data: PageInput) => void
  isPending: boolean
  error: string | null
  isEdit?: boolean
  navGroups: NavGroupOption[]
  onNavGroupCreated: (ng: NavGroupOption) => void
}) {
  const [form, setForm] = useState<PageInput>(initial)

  // NavGroup creation dialog state
  const [ngDialogOpen, setNgDialogOpen]       = useState(false)
  const [ngName, setNgName]                   = useState('')
  const [ngOrder, setNgOrder]                 = useState(0)
  const [ngPending, setNgPending]             = useState(false)
  const [ngError, setNgError]                 = useState<string | null>(null)

  function set<K extends keyof PageInput>(key: K, val: PageInput[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function handleCreateNavGroup() {
    setNgError(null)
    setNgPending(true)
    try {
      const newGroup = await createNavGroup({ data: { name: ngName.trim(), order: ngOrder } })
      onNavGroupCreated(newGroup)
      set('navGroupId', newGroup.id)
      setNgDialogOpen(false)
      setNgName('')
      setNgOrder(0)
    } catch (e: unknown) {
      setNgError(getErrorMessage(e, 'Failed to create nav group.'))
    } finally {
      setNgPending(false)
    }
  }

  return (
    <div className="space-y-3 py-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Resource Key</Label>
          <Input
            placeholder="e.g. reports"
            value={form.resource}
            disabled={isEdit}
            onChange={(e) => set('resource', e.target.value.toLowerCase())}
          />
          <p className="text-xs text-muted-foreground">Lowercase, no spaces. Used for permissions.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Label</Label>
          <Input
            placeholder="e.g. Reports"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Path</Label>
          <Input
            placeholder="e.g. /reports"
            value={form.path}
            onChange={(e) => set('path', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Order</Label>
          <Input
            type="number"
            value={form.order}
            onChange={(e) => set('order', parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Nav Group</Label>
        <div className="flex items-center gap-2">
          <Select
            value={form.navGroupId ?? '__none__'}
            onValueChange={(v) => set('navGroupId', v === '__none__' ? null : v)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None (top-level)</SelectItem>
              {navGroups.map((ng) => (
                <SelectItem key={ng.id} value={ng.id}>
                  {ng.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={ngDialogOpen} onOpenChange={(v) => { setNgDialogOpen(v); if (!v) setNgError(null) }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0" type="button">
                <PlusCircle className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xs">
              <DialogHeader>
                <DialogTitle>New Nav Group</DialogTitle>
                <DialogDescription>Create a new sidebar group for organizing pages.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {ngError && (
                  <Alert variant="destructive">
                    <AlertDescription>{ngError}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g. reports"
                    value={ngName}
                    onChange={(e) => setNgName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Order</Label>
                  <Input
                    type="number"
                    value={ngOrder}
                    onChange={(e) => setNgOrder(parseInt(e.target.value) || 0)}
                  />
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateNavGroup} disabled={ngPending} className="w-full">
                    {ngPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
                      : 'Create'
                    }
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <p className="text-xs text-muted-foreground">None = top-level sidebar item. A group name = collapsible submenu.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Icon</Label>
        <div className="rounded-md border">
          <IconPicker value={form.icon} onChange={(name) => set('icon', name)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Selected: <span className="font-medium">{form.icon}</span>
        </p>
      </div>

      <DialogFooter>
        <Button onClick={() => onSubmit(form)} disabled={isPending} className="w-full">
          {isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isEdit ? 'Saving...' : 'Creating...'}</>
            : isEdit ? 'Save Changes' : 'Create Page'
          }
        </Button>
      </DialogFooter>
    </div>
  )
}

// ── Manage Groups Dialog ──────────────────────────────────────────────────────

function ManageGroupsDialog({
  navGroups: initialGroups,
  onSuccess,
}: {
  navGroups: NavGroupOption[]
  onSuccess: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [groups, setGroups]       = useState(initialGroups)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editOrder, setEditOrder] = useState(0)
  const [editError, setEditError] = useState<string | null>(null)
  const [editPending, setEditPending] = useState(false)

  const [newName, setNewName]   = useState('')
  const [newOrder, setNewOrder] = useState(0)
  const [newError, setNewError] = useState<string | null>(null)
  const [newPending, setNewPending] = useState(false)

  // Keep local groups in sync when dialog opens
  function handleOpenChange(v: boolean) {
    if (v) setGroups(initialGroups)
    setOpen(v)
    setEditingId(null)
    setEditError(null)
    setNewError(null)
  }

  async function handleCreate() {
    if (!newName.trim()) { setNewError('Name is required.'); return }
    setNewError(null)
    setNewPending(true)
    try {
      const ng = await createNavGroup({ data: { name: newName.trim(), order: newOrder } })
      setGroups((prev) => [...prev, ng])
      setNewName('')
      setNewOrder(0)
      onSuccess()
    } catch (e: unknown) {
      setNewError(getErrorMessage(e, 'Failed to create group.'))
    } finally {
      setNewPending(false)
    }
  }

  function startEdit(ng: NavGroupOption) {
    setEditingId(ng.id)
    setEditName(ng.name)
    setEditOrder(ng.order)
    setEditError(null)
  }

  async function handleSaveEdit() {
    if (!editName.trim()) { setEditError('Name is required.'); return }
    setEditError(null)
    setEditPending(true)
    try {
      await updateNavGroup({ data: { id: editingId!, name: editName.trim(), order: editOrder } })
      setGroups((prev) =>
        prev.map((g) => g.id === editingId ? { ...g, name: editName.trim(), order: editOrder } : g)
      )
      setEditingId(null)
      onSuccess()
    } catch (e: unknown) {
      setEditError(getErrorMessage(e, 'Failed to update group.'))
    } finally {
      setEditPending(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteNavGroup({ data: { id } })
      setGroups((prev) => prev.filter((g) => g.id !== id))
      onSuccess()
    } catch (e: unknown) {
      setEditError(getErrorMessage(e, 'Failed to delete group.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-3">
          <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 shrink-0" />
          <span className="hidden sm:inline">Manage Groups</span>
          <span className="sm:hidden">Groups</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Nav Groups</DialogTitle>
          <DialogDescription>
            Create, rename or delete sidebar groups. Deleting a group moves its pages to top-level.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Existing groups */}
          <div className="space-y-2">
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No groups yet.</p>
            )}
            {groups.map((ng) => (
              <div key={ng.id} className="rounded-md border bg-card p-2.5 space-y-2">
                {editingId === ng.id ? (
                  <>
                    {editError && (
                      <Alert variant="destructive">
                        <AlertDescription>{editError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Group name"
                        className="h-8 text-sm"
                      />
                      <Input
                        type="number"
                        value={editOrder}
                        onChange={(e) => setEditOrder(parseInt(e.target.value) || 0)}
                        className="h-8 text-sm w-16"
                        placeholder="Order"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={handleSaveEdit}
                        disabled={editPending}
                      >
                        {editPending
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <><Check className="w-3 h-3 mr-1" />Save</>
                        }
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="w-3 h-3 mr-1" />Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{ng.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">#{ng.order}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => startEdit(ng)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Group</AlertDialogTitle>
                            <AlertDialogDescription>
                              Delete <strong>{ng.name}</strong>? Pages in this group will become top-level sidebar items.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-white hover:bg-destructive/90"
                              onClick={() => handleDelete(ng.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Separator />

          {/* Create new group */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              New Group
            </Label>
            {newError && (
              <Alert variant="destructive">
                <AlertDescription>{newError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                placeholder="Group name e.g. Reports"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
              />
              <Input
                type="number"
                value={newOrder}
                onChange={(e) => setNewOrder(parseInt(e.target.value) || 0)}
                className="h-8 text-sm w-16"
                placeholder="Order"
              />
            </div>
            <Button
              className="w-full"
              size="sm"
              onClick={handleCreate}
              disabled={newPending}
            >
              {newPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
                : <><PlusCircle className="w-4 h-4 mr-2" />Create Group</>
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
// ── Create Dialog ─────────────────────────────────────────────────────────────

function CreatePageDialog({
  onSuccess,
  navGroups: initialNavGroups,
}: {
  onSuccess: () => void
  navGroups: NavGroupOption[]
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [navGroups, setNavGroups] = useState(initialNavGroups)

  const initial: PageInput = {
    resource:   '',
    label:      '',
    path:       '/',
    icon:       'FileText',
    navGroupId: null,
    order:      0,
  }

  async function handleSubmit(data: PageInput) {
    setError(null)
    setIsPending(true)
    try {
      await createPage({ data })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to create page.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setNavGroups(initialNavGroups) }}>
      <DialogTrigger asChild>
        <Button size="sm" className="min-w-0 flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-3">
          <PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 shrink-0" />
          <span className="hidden sm:inline">Add Page</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Page</DialogTitle>
          <DialogDescription>Define a new page with its route, icon and sidebar placement.</DialogDescription>
        </DialogHeader>
        <PageForm
          initial={initial}
          onSubmit={handleSubmit}
          isPending={isPending}
          error={error}
          navGroups={navGroups}
          onNavGroupCreated={(ng) => setNavGroups((prev) => [...prev, ng])}
        />
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────

function EditPageDialog({
  page,
  onSuccess,
  navGroups: initialNavGroups,
}: {
  page: PageRow
  onSuccess: () => void
  navGroups: NavGroupOption[]
}) {
  const [open, setOpen]           = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [navGroups, setNavGroups] = useState(initialNavGroups)

  const initial: PageInput = {
    resource:   page.resource,
    label:      page.label,
    path:       page.path,
    icon:       page.icon,
    navGroupId: page.navGroupId || null,
    order:      page.order,
  }

  async function handleSubmit(data: PageInput) {
    setError(null)
    setIsPending(true)
    try {
      await updatePage({ data: { ...data, id: page.id } })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update page.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); if (v) setNavGroups(initialNavGroups) }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Page</DialogTitle>
          <DialogDescription>Update this page's details, icon or sidebar placement.</DialogDescription>
        </DialogHeader>
        <PageForm
          initial={initial}
          onSubmit={handleSubmit}
          isPending={isPending}
          error={error}
          isEdit
          navGroups={navGroups}
          onNavGroupCreated={(ng) => setNavGroups((prev) => [...prev, ng])}
        />
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function PagesPage() {
  const { pages, roles, navGroups } = Route.useLoaderData()
  const router = useRouter()

  const [sorting, setSorting]           = useState<SortingState>([{ id: 'order', desc: false }])
  const [globalFilter, setGlobalFilter] = useState('')

  function refresh() { router.invalidate() }

  const data: PageRow[] = useMemo(
    () =>
      pages.map((p) => ({
        id:         p.id,
        resource:   p.resource,
        label:      p.label,
        path:       p.path,
        icon:       p.icon,
        group:      p.navGroup?.name ?? '',
        navGroupId: p.navGroupId ?? null,
        order:      p.order,
        isActive:   p.isActive,
        roles: roles
          .filter((r) => r.pagePermissions.some((pp) => pp.resource === p.resource))
          .map((r) => ({
            roleId:   r.id,
            roleName: r.name,
            actions:  r.pagePermissions.find((pp) => pp.resource === p.resource)?.actions ?? [],
          })),
      })),
    [pages, roles]
  )

  const columns: ColumnDef<PageRow>[] = useMemo(
    () => [
      {
        accessorKey: 'order',
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            #
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 w-3 h-3" />
              : <ArrowUpDown className="ml-1 w-3 h-3" />}
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.getValue('order')}</span>
        ),
        size: 50,
      },
      {
        accessorKey: 'label',
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
            Page
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
              : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
              : <ArrowUpDown className="ml-2 w-3 h-3" />}
          </Button>
        ),
        cell: ({ row }) => {
          const Icon = getIcon(row.original.icon)
          return (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md border bg-muted/50 flex items-center justify-center shrink-0">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm">{row.getValue('label')}</p>
                <p className="text-xs text-muted-foreground font-mono">{row.original.path}</p>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'resource',
        header: 'Resource',
        cell: ({ row }) => (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
            {row.getValue('resource')}
          </code>
        ),
      },
      {
        accessorKey: 'group',
        header: 'Group',
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs capitalize">
            {row.getValue('group') as string}
          </Badge>
        ),
      },
      {
        accessorKey: 'roles',
        header: 'Role Access',
        enableSorting: false,
        cell: ({ row }) => {
          const roleAccess = row.getValue('roles') as RoleAccess[]
          if (roleAccess.length === 0)
            return <span className="text-xs text-muted-foreground italic">No roles</span>
          return (
            <div className="flex flex-wrap gap-1">
              {roleAccess.map((r) => (
                <Badge key={r.roleId} variant="secondary" className="text-xs">
                  {r.roleName}
                </Badge>
              ))}
            </div>
          )
        },
      },
      {
        accessorKey: 'isActive',
        header: 'Active',
        cell: ({ row }) => {
          const page = row.original
          return (
            <Switch
              checked={page.isActive}
              onCheckedChange={async (v) => {
                await togglePageActive({ data: { id: page.id, isActive: v } })
                refresh()
              }}
            />
          )
        },
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        enableSorting: false,
        cell: ({ row }) => {
          const page = row.original
          return (
            <div className="flex items-center justify-end gap-1">
              <EditPageDialog page={page} onSuccess={refresh} navGroups={navGroups} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Page</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete <strong>{page.label}</strong>? This will also
                      remove all role permissions referencing this page. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      onClick={async () => { await deletePage({ data: { id: page.id } }); refresh() }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )
        },
      },
    ],
    [navGroups]
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pages</h1>
          <p className="text-muted-foreground">Manage pages, paths and role access</p>
        </div>
        <div className="flex items-center gap-2">
          <ManageGroupsDialog navGroups={navGroups} onSuccess={refresh} />
          <CreatePageDialog onSuccess={refresh} navGroups={navGroups} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Pages</CardTitle>
          <CardDescription>
            {table.getFilteredRowModel().rows.length} of {data.length} pages
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Input
            placeholder="Search pages..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-sm"
          />

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
                      No pages found.
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
                const page = row.original
                const Icon = getIcon(page.icon)
                return (
                  <div key={page.id} className="rounded-lg border bg-card p-3 space-y-2">
                    {/* Row 1 — icon + label + actions */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-md border bg-muted/50 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{page.label}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">{page.path}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <EditPageDialog page={page} onSuccess={refresh} navGroups={navGroups} />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Page</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete <strong>{page.label}</strong>? This will
                                also remove all role permissions referencing this page.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-white hover:bg-destructive/90"
                                onClick={async () => { await deletePage({ data: { id: page.id } }); refresh() }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {/* Row 2 — resource + group + active */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {page.resource}
                        </code>
                        <Badge variant="outline" className="text-xs capitalize">
                          {page.group}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">Active</span>
                        <Switch
                          checked={page.isActive}
                          onCheckedChange={async (v) => {
                            await togglePageActive({ data: { id: page.id, isActive: v } })
                            refresh()
                          }}
                        />
                      </div>
                    </div>

                    {/* Row 3 — role badges */}
                    {page.roles.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {page.roles.map((r) => (
                          <Badge key={r.roleId} variant="secondary" className="text-xs shrink-0">
                            {r.roleName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="text-center py-10 text-muted-foreground text-sm">No pages found.</p>
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

export const Route = createFileRoute('/_layout/pages')({
  loader: () => getPageData(),
  component: PagesPage,
})
