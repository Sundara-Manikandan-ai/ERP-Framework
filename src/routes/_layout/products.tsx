import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { authMiddleware } from '#/middleware/auth'
import { extractAccess } from '#/lib/rbac'
import { logAudit } from '#/lib/logger'
import { RoleGate } from '@/components/shared/RoleGate'
import { DeleteDialog } from '@/components/shared/DeleteDialog'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Loader2,
  PlusCircle,
  Pencil,
  Package,
  FolderOpen,
  Folder,
  Search,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { z } from 'zod'
import { cn, getErrorMessage } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

// Flat DB row returned from server
type CategoryNode = {
  id:        string
  name:      string
  parentId:  string | null
  createdAt: Date
  updatedAt: Date
}

type ProductRow = {
  id:               string
  name:             string
  categoryId:       string
  unit:             string
  isActive:         boolean
  transactionCount: number
  createdAt:        Date
}

// Client-side tree node built from flat list
type TreeNode = CategoryNode & {
  children:     TreeNode[]
  productCount: number   // products directly in this node
  totalCount:   number   // products in this node + all descendants
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name:     z.string().trim().min(1, 'Name is required'),
  parentId: z.string().nullable(),
})

const productSchema = z.object({
  name:       z.string().trim().min(1, 'Name is required'),
  categoryId: z.string().trim().min(1, 'Category is required'),
  unit:       z.string().trim().min(1, 'Unit is required'),
})

// ── Server Functions ───────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'products' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [categories, products] = await Promise.all([
      db.productCategory.findMany({ orderBy: { name: 'asc' } }),
      db.product.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { transactions: true } } },
      }),
    ])

    return {
      authorized: true as const,
      access: extractAccess(context),
      categories: categories.map((c) => ({
        id:        c.id,
        name:      c.name,
        parentId:  c.parentId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      products: products.map((p) => ({
        id:               p.id,
        name:             p.name,
        categoryId:       p.categoryId,
        unit:             p.unit,
        isActive:         p.isActive,
        transactionCount: p._count.transactions,
        createdAt:        p.createdAt,
      })),
    }
  })

// ── Category mutations ─────────────────────────────────────────────────────────

const createCategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { name: string; parentId: string | null }) => {
    const parsed = categorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data, context }) => {
    const existing = await db.productCategory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, parentId: data.parentId },
    })
    if (existing) throw new Error('A category with this name already exists at this level.')
    const cat = await db.productCategory.create({
      data: { name: data.name, parentId: data.parentId },
    })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'products', resourceId: cat.id, newValue: { name: data.name, parentId: data.parentId } }).catch(() => {})
    return { success: true }
  })

const updateCategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; name: string; parentId: string | null }) => {
    const parsed = categorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data, context }) => {
    // Prevent moving a node under one of its own descendants
    if (data.parentId) {
      let cursor = data.parentId
      while (cursor) {
        if (cursor === data.id) throw new Error('Cannot move a category under one of its own children.')
        const parent = await db.productCategory.findUnique({ where: { id: cursor } })
        cursor = parent?.parentId ?? ''
      }
    }
    const conflict = await db.productCategory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, parentId: data.parentId, NOT: { id: data.id } },
    })
    if (conflict) throw new Error('A category with this name already exists at this level.')

    const old = await db.productCategory.findUnique({ where: { id: data.id } })
    await db.productCategory.update({ where: { id: data.id }, data: { name: data.name, parentId: data.parentId } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'products', resourceId: data.id, oldValue: old ? { name: old.name, parentId: old.parentId } : undefined, newValue: { name: data.name, parentId: data.parentId } }).catch(() => {})
    return { success: true }
  })

const deleteCategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const childCount   = await db.productCategory.count({ where: { parentId: data.id } })
    if (childCount > 0) throw new Error(`Cannot delete — ${childCount} child categor${childCount === 1 ? 'y' : 'ies'} exist under this node.`)
    const productCount = await db.product.count({ where: { categoryId: data.id } })
    if (productCount > 0) throw new Error(`Cannot delete — ${productCount} product${productCount === 1 ? '' : 's'} exist in this category.`)

    const old = await db.productCategory.findUnique({ where: { id: data.id } })
    await db.productCategory.delete({ where: { id: data.id } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'products', resourceId: data.id, oldValue: old ? { name: old.name } : undefined }).catch(() => {})
    return { success: true }
  })

// ── Product mutations ──────────────────────────────────────────────────────────

const createProduct = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { name: string; categoryId: string; unit: string }) => {
    const parsed = productSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data, context }) => {
    const existing = await db.product.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, categoryId: data.categoryId },
    })
    if (existing) throw new Error('A product with this name already exists in this category.')
    const product = await db.product.create({ data: { name: data.name, categoryId: data.categoryId, unit: data.unit } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'create', resource: 'products', resourceId: product.id, newValue: { name: data.name, categoryId: data.categoryId, unit: data.unit } }).catch(() => {})
    return { success: true }
  })

const updateProduct = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; name: string; categoryId: string; unit: string }) => {
    const parsed = productSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data, context }) => {
    const conflict = await db.product.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, categoryId: data.categoryId, NOT: { id: data.id } },
    })
    if (conflict) throw new Error('A product with this name already exists in this category.')
    const old = await db.product.findUnique({ where: { id: data.id } })
    await db.product.update({ where: { id: data.id }, data: { name: data.name, categoryId: data.categoryId, unit: data.unit } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'update', resource: 'products', resourceId: data.id, oldValue: old ? { name: old.name, categoryId: old.categoryId } : undefined, newValue: { name: data.name, categoryId: data.categoryId } }).catch(() => {})
    return { success: true }
  })

const toggleProductActive = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ data }) => {
    await db.product.update({ where: { id: data.id }, data: { isActive: data.isActive } })
    return { success: true }
  })

const deleteProduct = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const count = await db.transaction.count({ where: { productId: data.id } })
    if (count > 0) throw new Error(`Cannot delete — ${count} transaction${count === 1 ? '' : 's'} reference this product.`)
    const old = await db.product.findUnique({ where: { id: data.id } })
    await db.product.delete({ where: { id: data.id } })
    logAudit({ userId: context.user.id, userEmail: context.user.email, action: 'delete', resource: 'products', resourceId: data.id, oldValue: old ? { name: old.name } : undefined }).catch(() => {})
    return { success: true }
  })

// ── Route ──────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/products')({
  loader: () => getPageData(),
  component: ProductsPage,
})

// ── Tree builder ───────────────────────────────────────────────────────────────

function buildTree(nodes: CategoryNode[], products: ProductRow[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()
  for (const n of nodes) {
    nodeMap.set(n.id, { ...n, children: [], productCount: 0, totalCount: 0 })
  }
  // Count direct products per node
  for (const p of products) {
    const node = nodeMap.get(p.categoryId)
    if (node) node.productCount++
  }
  // Assemble tree
  const roots: TreeNode[] = []
  for (const n of nodeMap.values()) {
    if (n.parentId) {
      nodeMap.get(n.parentId)?.children.push(n)
    } else {
      roots.push(n)
    }
  }
  // Compute totalCount (products in subtree) bottom-up
  function computeTotal(node: TreeNode): number {
    node.totalCount = node.productCount + node.children.reduce((sum, c) => sum + computeTotal(c), 0)
    return node.totalCount
  }
  roots.forEach(computeTotal)
  return roots
}

// ── Get breadcrumb path for a node ────────────────────────────────────────────

function getBreadcrumb(nodeId: string, flat: CategoryNode[]): string {
  const map = new Map(flat.map((n) => [n.id, n]))
  const parts: string[] = []
  let cursor: CategoryNode | undefined = map.get(nodeId)
  while (cursor) {
    parts.unshift(cursor.name)
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
  }
  return parts.join(' / ')
}

// ── Flatten tree to sorted list for selects ───────────────────────────────────

function flattenTree(nodes: TreeNode[], depth = 0): { id: string; label: string; depth: number }[] {
  const result: { id: string; label: string; depth: number }[] = []
  for (const node of nodes) {
    result.push({ id: node.id, label: node.name, depth })
    result.push(...flattenTree(node.children, depth + 1))
  }
  return result
}

// ── Unit options ───────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['pcs', 'kg', 'g', 'box', 'dozen', 'tray', 'bag', 'litre']

// ── Category Dialog ────────────────────────────────────────────────────────────

function CategoryDialog({
  mode, category, parentId, flatCategories, onSuccess, onCreated, trigger,
  open: controlledOpen, onOpenChange: controlledOnOpenChange,
}: {
  mode: 'create' | 'edit'
  category?: CategoryNode
  parentId?: string | null       // pre-fill parent for "Add child" action
  flatCategories: { id: string; label: string; depth: number }[]
  onSuccess: () => void
  onCreated?: () => void
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen

  const [name, setName]           = useState(category?.name ?? '')
  const [parent, setParent]       = useState<string>(category?.parentId ?? parentId ?? '__root__')
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (v) {
      setName(category?.name ?? '')
      setParent(category?.parentId ?? parentId ?? '__root__')
      setError(null)
    }
  }

  async function handleSubmit() {
    setError(null); setIsPending(true)
    try {
      const resolvedParent = parent === '__root__' ? null : parent
      if (mode === 'create') await createCategory({ data: { name, parentId: resolvedParent } })
      else await updateCategory({ data: { id: category!.id, name, parentId: resolvedParent } })
      setOpen(false); onSuccess(); onCreated?.()
    } catch (e: unknown) { setError(getErrorMessage(e, 'Something went wrong.')) }
    finally { setIsPending(false) }
  }

  const defaultTrigger = mode === 'create'
    ? <Button size="sm" className="min-w-0 text-xs sm:text-sm px-2 sm:px-3"><PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 shrink-0" /><span className="hidden sm:inline">Add Category</span><span className="sm:hidden">Category</span></Button>
    : <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Category' : 'Edit Category'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Layer Cake"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Parent Category <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">— Root (top level) —</SelectItem>
                {flatCategories
                  .filter((c) => c.id !== category?.id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {'  '.repeat(c.depth)}{c.depth > 0 ? '└ ' : ''}{c.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Category Tree Picker (Popover) ──────────────────────────────────────────

function CategoryTreePicker({
  categories, value, onChange,
}: {
  categories: CategoryNode[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { childMap, nodeMap } = useMemo(() => {
    const childMap = new Map<string | null, CategoryNode[]>()
    const nodeMap = new Map<string, CategoryNode>()
    for (const c of categories) {
      nodeMap.set(c.id, c)
      const key = c.parentId ?? null
      if (!childMap.has(key)) childMap.set(key, [])
      childMap.get(key)!.push(c)
    }
    return { childMap, nodeMap }
  }, [categories])

  const selectedLabel = useMemo(() => {
    if (!value) return 'Select category...'
    const parts: string[] = []
    let cur: CategoryNode | undefined = nodeMap.get(value)
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parentId ? nodeMap.get(cur.parentId) : undefined
    }
    return parts.join(' / ')
  }, [value, nodeMap])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function select(id: string) {
    onChange(id)
    setOpen(false)
  }

  function renderNodes(parentId: string | null, depth: number): React.ReactNode {
    const children = childMap.get(parentId)
    if (!children?.length) return null
    return children.map((node) => {
      const hasChildren = childMap.has(node.id) && childMap.get(node.id)!.length > 0
      const isExpanded = expanded.has(node.id)
      const isSelected = node.id === value
      return (
        <div key={node.id}>
          <div
            className={cn(
              'flex items-center gap-1.5 py-1 pr-2 text-sm cursor-pointer rounded-sm hover:bg-accent',
              isSelected && 'bg-accent font-medium'
            )}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
            onClick={() => select(node.id)}
          >
            {hasChildren ? (
              <ChevronDown
                className={cn('w-3 h-3 shrink-0 transition-transform', !isExpanded && '-rotate-90')}
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.id) }}
              />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>
          {hasChildren && isExpanded && renderNodes(node.id, depth + 1)}
        </div>
      )
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-9 px-3"
        >
          <span className="truncate text-sm">{selectedLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[var(--radix-popover-trigger-width)] p-0">
        <div className="max-h-64 overflow-y-auto py-1">
          {renderNodes(null, 0)}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Product Dialog ─────────────────────────────────────────────────────────────

function ProductDialog({
  mode, product, categories, flatCategories, defaultCategoryId, onSuccess, trigger,
}: {
  mode: 'create' | 'edit'
  product?: ProductRow
  categories: CategoryNode[]
  flatCategories: { id: string; label: string; depth: number }[]
  defaultCategoryId?: string
  onSuccess: () => void
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen]             = useState(false)
  const [name, setName]             = useState(product?.name ?? '')
  const [unit, setUnit]             = useState(product?.unit ?? 'pcs')
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId ?? '')
  const [isPending, setIsPending]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [showNewCat, setShowNewCat] = useState(false)

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (v) {
      setName(product?.name ?? ''); setUnit(product?.unit ?? 'pcs')
      setCategoryId(product?.categoryId ?? defaultCategoryId ?? '')
      setError(null)
      setShowNewCat(false)
    }
  }

  async function handleSubmit() {
    setError(null); setIsPending(true)
    try {
      if (mode === 'create') await createProduct({ data: { name, categoryId, unit } })
      else await updateProduct({ data: { id: product!.id, name, categoryId, unit } })
      setOpen(false); onSuccess()
    } catch (e: unknown) { setError(getErrorMessage(e, 'Something went wrong.')) }
    finally { setIsPending(false) }
  }

  async function handleCategoryCreated() {
    await router.invalidate()
    const fresh = await getPageData()
    if (fresh.authorized) {
      // Select the newest category (most recent createdAt)
      const newest = fresh.categories.reduce((a, b) =>
        new Date(b.createdAt) > new Date(a.createdAt) ? b : a
      )
      if (newest) setCategoryId(newest.id)
    }
  }

  const defaultTrigger = mode === 'create'
    ? <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"><PlusCircle className="w-3 h-3" />Product</Button>
    : <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{mode === 'create' ? 'Add Product' : 'Edit Product'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <CategoryTreePicker categories={categories} value={categoryId} onChange={setCategoryId} />
              </div>
              <Button
                type="button" variant="outline" size="icon"
                className="h-9 w-9 shrink-0"
                title="Create new category"
                onClick={() => setShowNewCat(true)}
              >
                <PlusCircle className="w-4 h-4" />
              </Button>
            </div>
            <CategoryDialog
              mode="create"
              flatCategories={flatCategories}
              onSuccess={onSuccess}
              onCreated={handleCategoryCreated}
              open={showNewCat}
              onOpenChange={setShowNewCat}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Product Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chocolate Mud Cake" />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{UNIT_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim() || !categoryId}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Tree Node Component ────────────────────────────────────────────────────────

function TreeNodeRow({
  node, products, selected, onSelect, expanded, onToggle,
  depth, access, flatCategories, onSuccess,
}: {
  node:           TreeNode
  products:       ProductRow[]
  selected:       { kind: 'category' | 'product'; id: string } | null
  onSelect:       (s: { kind: 'category' | 'product'; id: string }) => void
  expanded:       Set<string>
  onToggle:       (id: string) => void
  depth:          number
  access:         { isAdmin: boolean; permissions: any[] }
  flatCategories: { id: string; label: string; depth: number }[]
  onSuccess:      () => void
}) {
  const isOpen     = expanded.has(node.id)
  const isSelected = selected?.kind === 'category' && selected.id === node.id
  const hasChildren = node.children.length > 0
  const nodeProds  = products.filter((p) => p.categoryId === node.id)

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer select-none transition-colors group',
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          onSelect({ kind: 'category', id: node.id })
          if (hasChildren || nodeProds.length > 0) onToggle(node.id)
        }}
      >
        {/* Expand arrow */}
        <span className={cn('w-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}>
          {(hasChildren || nodeProds.length > 0)
            ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            : <span className="w-3.5 inline-block" />}
        </span>

        {/* Folder icon */}
        {isOpen
          ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          : <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />}

        <span className="text-sm flex-1 truncate font-medium">{node.name}</span>

        {node.totalCount > 0 && (
          <Badge variant="secondary" className="text-xs h-4 px-1 font-normal shrink-0">{node.totalCount}</Badge>
        )}
      </div>

      {isOpen && (
        <ul>
          {/* Child category nodes */}
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child} products={products} selected={selected}
              onSelect={onSelect} expanded={expanded} onToggle={onToggle}
              depth={depth + 1} access={access} flatCategories={flatCategories}
              onSuccess={onSuccess}
            />
          ))}

          {/* Products directly in this node */}
          {nodeProds.map((prod) => {
            const isProdSelected = selected?.kind === 'product' && selected.id === prod.id
            return (
              <li key={prod.id}>
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer select-none transition-colors',
                    isProdSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
                  )}
                  style={{ paddingLeft: `${8 + (depth + 1) * 16 + 4}px` }}
                  onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'product', id: prod.id }) }}
                >
                  <Package className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate">{prod.name}</span>
                  {!prod.isActive && (
                    <Badge variant="secondary" className="text-xs h-4 px-1 font-normal shrink-0">off</Badge>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({
  selected, categories, products, flatCategories, access, onSuccess,
}: {
  selected:       { kind: 'category' | 'product'; id: string } | null
  categories:     CategoryNode[]
  products:       ProductRow[]
  flatCategories: { id: string; label: string; depth: number }[]
  access:         { isAdmin: boolean; permissions: any[] }
  onSuccess:      () => void
}) {
  if (!selected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 py-16">
        <Folder className="w-10 h-10 opacity-20" />
        <p className="text-sm">Select a category or product from the tree to view details</p>
      </div>
    )
  }

  if (selected.kind === 'category') {
    const cat      = categories.find((c) => c.id === selected.id)
    if (!cat) return null
    const children = categories.filter((c) => c.parentId === selected.id)
    const prods    = products.filter((p) => p.categoryId === selected.id)
    const breadcrumb = getBreadcrumb(selected.id, categories)

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{breadcrumb.includes('/') ? breadcrumb.split('/').slice(0, -1).join(' / ') : 'Root'}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              <h2 className="text-lg sm:text-xl font-semibold truncate">{cat.name}</h2>
            </div>
          </div>
          <RoleGate {...access} requireAdmin>
            <div className="flex items-center gap-1 shrink-0">
              <CategoryDialog mode="edit" category={cat} flatCategories={flatCategories} onSuccess={onSuccess} />
              <DeleteDialog
                title="Delete Category"
                description={<>Delete <strong>{cat.name}</strong>? This cannot be undone.</>}
                disabled={children.length > 0 || prods.length > 0}
                disabledReason={
                  children.length > 0 ? `${children.length} child categor${children.length === 1 ? 'y' : 'ies'} must be removed first.`
                  : prods.length > 0 ? `${prods.length} product${prods.length === 1 ? '' : 's'} must be removed first.`
                  : undefined
                }
                onConfirm={async () => { await deleteCategory({ data: { id: cat.id } }); onSuccess() }}
              />
            </div>
          </RoleGate>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
            <p className="text-2xl font-bold">{children.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sub-categories</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
            <p className="text-2xl font-bold">{prods.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Direct products</p>
          </div>
        </div>

        {/* Sub-categories */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Sub-categories</p>
            <RoleGate {...access} requireAdmin>
              <CategoryDialog mode="create" parentId={cat.id} flatCategories={flatCategories} onSuccess={onSuccess} />
            </RoleGate>
          </div>
          {children.length === 0
            ? <p className="text-sm text-muted-foreground italic">No sub-categories.</p>
            : <div className="space-y-1">
                {children.map((child) => (
                  <div key={child.id} className="flex items-center gap-2 px-3 py-2 rounded-md border bg-card text-sm">
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="flex-1 truncate">{child.name}</span>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Products in this category */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Products in this category</p>
            <RoleGate {...access} requireAdmin>
              <ProductDialog mode="create" categories={categories} flatCategories={flatCategories} defaultCategoryId={cat.id} onSuccess={onSuccess} />
            </RoleGate>
          </div>
          {prods.length === 0
            ? <p className="text-sm text-muted-foreground italic">No products directly in this category.</p>
            : <div className="space-y-1">
                {prods.map((prod) => (
                  <div key={prod.id} className="flex items-center gap-2 px-3 py-2 rounded-md border bg-card text-sm">
                    <Package className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{prod.name}</span>
                    <span className="text-xs text-muted-foreground">{prod.unit}</span>
                    <Badge variant={prod.isActive ? 'default' : 'secondary'} className="text-xs h-4 px-1">{prod.isActive ? 'on' : 'off'}</Badge>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
    )
  }

  if (selected.kind === 'product') {
    const prod = products.find((p) => p.id === selected.id)
    if (!prod) return null
    const breadcrumb = getBreadcrumb(prod.categoryId, categories)

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{breadcrumb}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Package className="w-4 h-4 text-muted-foreground shrink-0" />
              <h2 className="text-lg sm:text-xl font-semibold truncate">{prod.name}</h2>
            </div>
          </div>
          <RoleGate {...access} requireAdmin>
            <div className="flex items-center gap-1 shrink-0">
              <ProductDialog mode="edit" product={prod} categories={categories} flatCategories={flatCategories} onSuccess={onSuccess} />
              <DeleteDialog
                title="Delete Product"
                description={<>Delete <strong>{prod.name}</strong>? This cannot be undone.</>}
                disabled={prod.transactionCount > 0}
                disabledReason={prod.transactionCount > 0 ? `${prod.transactionCount} transaction${prod.transactionCount === 1 ? '' : 's'} reference this product.` : undefined}
                onConfirm={async () => { await deleteProduct({ data: { id: prod.id } }); onSuccess() }}
              />
            </div>
          </RoleGate>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
            <p className="text-2xl font-bold">{prod.unit}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Unit</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
            <p className="text-2xl font-bold">{prod.transactionCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Transactions</p>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Active</span>
            <RoleGate {...access} requireAdmin fallback={
              <Badge variant={prod.isActive ? 'default' : 'secondary'} className="text-xs">{prod.isActive ? 'Active' : 'Inactive'}</Badge>
            }>
              <div className="flex items-center gap-2">
                <Switch
                  checked={prod.isActive}
                  onCheckedChange={async (v) => { await toggleProductActive({ data: { id: prod.id, isActive: v } }); onSuccess() }}
                />
                <span className="text-sm text-muted-foreground">{prod.isActive ? 'Active' : 'Inactive'}</span>
              </div>
            </RoleGate>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Category path</span>
            <span className="text-sm text-muted-foreground text-right max-w-[60%] truncate">{breadcrumb}</span>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function ProductsPage() {
  const loaderData = Route.useLoaderData()
  const router     = useRouter()

  const [selected, setSelected] = useState<{ kind: 'category' | 'product'; id: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch]     = useState('')

  if (!loaderData.authorized) return <Unauthorized />
  const { categories, products, access } = loaderData

  function refresh() { router.invalidate() }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tree = useMemo(() => buildTree(categories, products), [categories, products])
  const flatCategories = useMemo(() => flattenTree(tree), [tree])

  function expandAll() {
    const keys = categories.map((c) => c.id)
    setExpanded(new Set(keys))
  }
  function collapseAll() {
    setExpanded(new Set())
    setSelected(null)
  }

  // Filter tree nodes by search
  const q = search.toLowerCase()

  function nodeMatchesSearch(node: TreeNode): boolean {
    if (node.name.toLowerCase().includes(q)) return true
    if (products.some((p) => p.categoryId === node.id && p.name.toLowerCase().includes(q))) return true
    return node.children.some(nodeMatchesSearch)
  }

  const visibleRoots = q ? tree.filter(nodeMatchesSearch) : tree

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground text-sm hidden sm:block">Manage your product category tree and products</p>
        </div>
        <RoleGate {...access} requireAdmin>
          <div className="flex items-center gap-2">
            <ProductDialog
              mode="create" categories={categories} flatCategories={flatCategories} onSuccess={refresh}
              trigger={<Button size="sm" className="min-w-0 text-xs sm:text-sm px-2 sm:px-3"><PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 shrink-0" /><span className="hidden sm:inline">Add Product</span><span className="sm:hidden">Product</span></Button>}
            />
            <CategoryDialog mode="create" flatCategories={flatCategories} onSuccess={refresh} />
          </div>
        </RoleGate>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3 items-start">

        {/* ── Tree Panel ── */}
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); if (e.target.value) expandAll() }}
                className="pl-7 h-7 text-xs"
              />
            </div>
            <button onClick={expandAll}   className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">+All</button>
            <button onClick={collapseAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">−All</button>
          </div>

          {/* Tree */}
          <div className="p-1.5 max-h-[400px] md:max-h-[600px] overflow-y-auto">
            {visibleRoots.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">
                {search ? 'No matches.' : 'No categories yet. Add one to get started.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {visibleRoots.map((node) => (
                  <TreeNodeRow
                    key={node.id}
                    node={node} products={products} selected={selected}
                    onSelect={setSelected} expanded={expanded} onToggle={toggleExpand}
                    depth={0} access={access} flatCategories={flatCategories}
                    onSuccess={refresh}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer stats */}
          <div className="border-t px-3 py-2 text-xs text-muted-foreground bg-muted/20">
            {categories.length} categories · {products.length} products
          </div>
        </div>

        {/* ── Detail Panel ── */}
        <div className="rounded-lg border bg-card p-3 sm:p-4 min-h-[200px] md:min-h-[300px]">
          <DetailPanel
            selected={selected}
            categories={categories} products={products}
            flatCategories={flatCategories}
            access={access} onSuccess={refresh}
          />
        </div>

      </div>
    </div>
  )
}
