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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  LayoutDashboard,
  Users,
  Building2,
  Shield,
  Upload,
  Settings,
  UserCircle,
  Layout,
  FileText,
  BarChart2,
  ShoppingCart,
  Package,
  Truck,
  ClipboardList,
  Bell,
  Lock,
  Globe,
  Mail,
  Calendar,
  Map,
  Tag,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import { z } from 'zod'
import { cn } from '@/lib/utils'

// ── Icon registry ─────────────────────────────────────────────────────────────

const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
  { name: 'LayoutDashboard', icon: LayoutDashboard },
  { name: 'Users',           icon: Users           },
  { name: 'UserCircle',      icon: UserCircle      },
  { name: 'Building2',       icon: Building2       },
  { name: 'Shield',          icon: Shield          },
  { name: 'Upload',          icon: Upload          },
  { name: 'Settings',        icon: Settings        },
  { name: 'Layout',          icon: Layout          },
  { name: 'FileText',        icon: FileText        },
  { name: 'BarChart2',       icon: BarChart2       },
  { name: 'ShoppingCart',    icon: ShoppingCart    },
  { name: 'Package',         icon: Package         },
  { name: 'Truck',           icon: Truck           },
  { name: 'ClipboardList',   icon: ClipboardList   },
  { name: 'Bell',            icon: Bell            },
  { name: 'Lock',            icon: Lock            },
  { name: 'Globe',           icon: Globe           },
  { name: 'Mail',            icon: Mail            },
  { name: 'Calendar',        icon: Calendar        },
  { name: 'Map',             icon: Map             },
  { name: 'Tag',             icon: Tag             },
  { name: 'Layers',          icon: Layers          },
]

export function getIcon(name: string): LucideIcon {
  return ICON_OPTIONS.find((o) => o.name === name)?.icon ?? FileText
}

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
  .middleware([authMiddleware])
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
  .inputValidator((data: PageInput) => data)
  .handler(async ({ data }) => {
    const parsed = pageSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)

    const existing = await db.page.findUnique({ where: { resource: parsed.data.resource } })
    if (existing) throw new Error('A page with this resource key already exists.')

    const { navGroupId, ...rest } = parsed.data
    await db.page.create({ data: { ...rest, navGroupId: navGroupId || null } })
    return { success: true }
  })

const updatePage = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: PageInput & { id: string }) => data)
  .handler(async ({ data }) => {
    const parsed = pageSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)

    const existing = await db.page.findFirst({
      where: { resource: parsed.data.resource, NOT: { id: data.id } },
    })
    if (existing) throw new Error('Another page with this resource key already exists.')

    const { navGroupId, ...rest } = parsed.data
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
    } catch (e: any) {
      setNgError(e.message ?? 'Failed to create nav group.')
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
    } catch (e: any) {
      setError(e.message ?? 'Failed to create page.')
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
    } catch (e: any) {
      setError(e.message ?? 'Failed to update page.')
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
        <CreatePageDialog onSuccess={refresh} navGroups={navGroups} />
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
