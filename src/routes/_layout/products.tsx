import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
import { db } from '#/lib/db'
import { adminMiddleware } from '#/middleware/admin'
import { resourceMiddleware } from '#/middleware/resource'
import { extractAccess } from '#/lib/rbac'
import { RoleGate } from '@/components/shared/RoleGate'
import { DeleteDialog } from '@/components/shared/DeleteDialog'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
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
import {
  Loader2,
  PlusCircle,
  Pencil,
  Package,
  Layers,
  Tag,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { z } from 'zod'
import { cn, getErrorMessage } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type CategoryRow = {
  id: string
  name: string
  subcategoryCount: number
  productCount: number
  createdAt: Date
}

type SubcategoryRow = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  productCount: number
  createdAt: Date
}

type ProductRow = {
  id: string
  name: string
  subcategoryId: string
  subcategoryName: string
  categoryId: string
  categoryName: string
  unit: string
  isActive: boolean
  transactionCount: number
  createdAt: Date
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

const subcategorySchema = z.object({
  name:       z.string().min(1, 'Name is required'),
  categoryId: z.string().min(1, 'Category is required'),
})

const productSchema = z.object({
  name:          z.string().min(1, 'Name is required'),
  subcategoryId: z.string().min(1, 'Subcategory is required'),
  unit:          z.string().min(1, 'Unit is required'),
})

// ── Server Functions ───────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([resourceMiddleware('products')])
  .handler(async ({ context }) => {
    const [categories, subcategories, products] = await Promise.all([
      db.productCategory.findMany({
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { subcategories: true } },
          subcategories: { include: { _count: { select: { products: true } } } },
        },
      }),
      db.productSubcategory.findMany({
        orderBy: { name: 'asc' },
        include: {
          category: true,
          _count: { select: { products: true } },
        },
      }),
      db.product.findMany({
        orderBy: { name: 'asc' },
        include: {
          subcategory: { include: { category: true } },
          _count: { select: { transactions: true } },
        },
      }),
    ])

    return {
      access: extractAccess(context),
      categories: categories.map((c) => ({
        id:               c.id,
        name:             c.name,
        subcategoryCount: c._count.subcategories,
        productCount:     c.subcategories.reduce((sum, s) => sum + s._count.products, 0),
        createdAt:        c.createdAt,
      })),
      subcategories: subcategories.map((s) => ({
        id:           s.id,
        name:         s.name,
        categoryId:   s.categoryId,
        categoryName: s.category.name,
        productCount: s._count.products,
        createdAt:    s.createdAt,
      })),
      products: products.map((p) => ({
        id:               p.id,
        name:             p.name,
        subcategoryId:    p.subcategoryId,
        subcategoryName:  p.subcategory.name,
        categoryId:       p.subcategory.categoryId,
        categoryName:     p.subcategory.category.name,
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
  .inputValidator((data: { name: string }) => {
    const parsed = categorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data }) => {
    const existing = await db.productCategory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    })
    if (existing) throw new Error('A category with this name already exists.')
    await db.productCategory.create({ data: { name: data.name } })
    return { success: true }
  })

const updateCategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; name: string }) => {
    const parsed = categorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data }) => {
    const existing = await db.productCategory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id: data.id } },
    })
    if (existing) throw new Error('A category with this name already exists.')
    await db.productCategory.update({ where: { id: data.id }, data: { name: data.name } })
    return { success: true }
  })

const deleteCategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const count = await db.productSubcategory.count({ where: { categoryId: data.id } })
    if (count > 0) throw new Error(`Cannot delete — ${count} subcategor${count === 1 ? 'y' : 'ies'} exist under this category.`)
    await db.productCategory.delete({ where: { id: data.id } })
    return { success: true }
  })

// ── Subcategory mutations ──────────────────────────────────────────────────────

const createSubcategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { name: string; categoryId: string }) => {
    const parsed = subcategorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data }) => {
    const existing = await db.productSubcategory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, categoryId: data.categoryId },
    })
    if (existing) throw new Error('A subcategory with this name already exists in this category.')
    await db.productSubcategory.create({ data: { name: data.name, categoryId: data.categoryId } })
    return { success: true }
  })

const updateSubcategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; name: string; categoryId: string }) => {
    const parsed = subcategorySchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data }) => {
    const existing = await db.productSubcategory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, categoryId: data.categoryId, NOT: { id: data.id } },
    })
    if (existing) throw new Error('A subcategory with this name already exists in this category.')
    await db.productSubcategory.update({ where: { id: data.id }, data: { name: data.name, categoryId: data.categoryId } })
    return { success: true }
  })

const deleteSubcategory = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const count = await db.product.count({ where: { subcategoryId: data.id } })
    if (count > 0) throw new Error(`Cannot delete — ${count} product${count === 1 ? '' : 's'} exist under this subcategory.`)
    await db.productSubcategory.delete({ where: { id: data.id } })
    return { success: true }
  })

// ── Product mutations ──────────────────────────────────────────────────────────

const createProduct = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { name: string; subcategoryId: string; unit: string }) => {
    const parsed = productSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return parsed.data
  })
  .handler(async ({ data }) => {
    const existing = await db.product.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, subcategoryId: data.subcategoryId },
    })
    if (existing) throw new Error('A product with this name already exists in this subcategory.')
    await db.product.create({ data: { name: data.name, subcategoryId: data.subcategoryId, unit: data.unit } })
    return { success: true }
  })

const updateProduct = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string; name: string; subcategoryId: string; unit: string }) => {
    const parsed = productSchema.safeParse(data)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    return { ...parsed.data, id: data.id }
  })
  .handler(async ({ data }) => {
    const existing = await db.product.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, subcategoryId: data.subcategoryId, NOT: { id: data.id } },
    })
    if (existing) throw new Error('A product with this name already exists in this subcategory.')
    await db.product.update({ where: { id: data.id }, data: { name: data.name, subcategoryId: data.subcategoryId, unit: data.unit } })
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
  .handler(async ({ data }) => {
    const count = await db.transaction.count({ where: { productId: data.id } })
    if (count > 0) throw new Error(`Cannot delete — ${count} transaction${count === 1 ? '' : 's'} reference this product.`)
    await db.product.delete({ where: { id: data.id } })
    return { success: true }
  })

// ── Route ──────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/products')({
  loader: () => getPageData(),
  errorComponent: () => <Unauthorized />,
  component: ProductsPage,
})

// ── Helpers ────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10

function useSortedFiltered<T extends Record<string, any>>(
  items: T[],
  searchKeys: (keyof T)[],
  search: string,
  sortKey: keyof T,
  sortDir: 'asc' | 'desc'
) {
  return useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q
      ? items.filter((item) => searchKeys.some((k) => String(item[k] ?? '').toLowerCase().includes(q)))
      : items
    return [...filtered].sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [items, search, sortKey, sortDir])
}

function usePaginated<T>(items: T[], page: number) {
  const pageCount = Math.ceil(items.length / PAGE_SIZE) || 1
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  return { pageItems, pageCount }
}

function SortBtn({
  label, sorted, onToggle,
}: { label: string; sorted: 'asc' | 'desc' | false; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wide transition-colors"
    >
      {label}
      <span className="opacity-50">{sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}</span>
    </button>
  )
}

function PaginationBar({
  page, pageCount, total, filtered, onPrev, onNext,
}: {
  page: number; pageCount: number; total: number; filtered: number
  onPrev: () => void; onNext: () => void
}) {
  if (pageCount <= 1 && total === filtered) return null
  return (
    <div className="flex items-center justify-between pt-1">
      <p className="text-sm text-muted-foreground">
        {filtered < total ? `${filtered} of ${total}` : `${total} total`}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPrev} disabled={page === 0}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{page + 1} / {pageCount}</span>
          <Button variant="outline" size="sm" onClick={onNext} disabled={page >= pageCount - 1}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function TabBtn({
  active, onClick, icon: Icon, label, count,
}: { active: boolean; onClick: () => void; icon: React.ElementType; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
      <Badge variant={active ? 'default' : 'secondary'} className="text-xs h-5 px-1.5">{count}</Badge>
    </button>
  )
}

// ── Category Dialog ────────────────────────────────────────────────────────────

function CategoryDialog({
  mode, category, onSuccess,
}: { mode: 'create' | 'edit'; category?: CategoryRow; onSuccess: () => void }) {
  const [open, setOpen]           = useState(false)
  const [name, setName]           = useState(category?.name ?? '')
  const [isPending, setIsPending] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (v) { setName(category?.name ?? ''); setError(null) }
  }

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      if (mode === 'create') await createCategory({ data: { name } })
      else await updateCategory({ data: { id: category!.id, name } })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Something went wrong.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {mode === 'create'
          ? <Button size="sm"><PlusCircle className="w-4 h-4 mr-2" />Add Category</Button>
          : <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
        }
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Category' : 'Edit Category'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cake"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
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

// ── Subcategory Dialog ─────────────────────────────────────────────────────────

function SubcategoryDialog({
  mode, subcategory, categories, defaultCategoryId, onSuccess,
}: {
  mode: 'create' | 'edit'
  subcategory?: SubcategoryRow
  categories: CategoryRow[]
  defaultCategoryId?: string
  onSuccess: () => void
}) {
  const [open, setOpen]               = useState(false)
  const [name, setName]               = useState(subcategory?.name ?? '')
  const [categoryId, setCategoryId]   = useState(subcategory?.categoryId ?? defaultCategoryId ?? '')
  const [isPending, setIsPending]     = useState(false)
  const [error, setError]             = useState<string | null>(null)

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (v) {
      setName(subcategory?.name ?? '')
      setCategoryId(subcategory?.categoryId ?? defaultCategoryId ?? '')
      setError(null)
    }
  }

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      if (mode === 'create') await createSubcategory({ data: { name, categoryId } })
      else await updateSubcategory({ data: { id: subcategory!.id, name, categoryId } })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Something went wrong.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {mode === 'create'
          ? <Button size="sm"><PlusCircle className="w-4 h-4 mr-2" />Add Subcategory</Button>
          : <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
        }
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Subcategory' : 'Edit Subcategory'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select category..." /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Layer Cake"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
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

// ── Product Dialog ─────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['pcs', 'kg', 'g', 'box', 'dozen', 'tray', 'bag', 'litre']

function ProductDialog({
  mode, product, categories, subcategories, defaultSubcategoryId, onSuccess,
}: {
  mode: 'create' | 'edit'
  product?: ProductRow
  categories: CategoryRow[]
  subcategories: SubcategoryRow[]
  defaultSubcategoryId?: string
  onSuccess: () => void
}) {
  const [open, setOpen]                   = useState(false)
  const [name, setName]                   = useState(product?.name ?? '')
  const [unit, setUnit]                   = useState(product?.unit ?? 'pcs')
  const [categoryId, setCategoryId]       = useState(
    product?.categoryId ?? subcategories.find((s) => s.id === defaultSubcategoryId)?.categoryId ?? ''
  )
  const [subcategoryId, setSubcategoryId] = useState(product?.subcategoryId ?? defaultSubcategoryId ?? '')
  const [isPending, setIsPending]         = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  const filteredSubs = subcategories.filter((s) => s.categoryId === categoryId)

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (v) {
      setName(product?.name ?? '')
      setUnit(product?.unit ?? 'pcs')
      const sc = subcategories.find((s) => s.id === (product?.subcategoryId ?? defaultSubcategoryId))
      setCategoryId(product?.categoryId ?? sc?.categoryId ?? '')
      setSubcategoryId(product?.subcategoryId ?? defaultSubcategoryId ?? '')
      setError(null)
    }
  }

  function handleCategoryChange(val: string) {
    setCategoryId(val)
    setSubcategoryId('')
  }

  async function handleSubmit() {
    setError(null)
    setIsPending(true)
    try {
      if (mode === 'create') await createProduct({ data: { name, subcategoryId, unit } })
      else await updateProduct({ data: { id: product!.id, name, subcategoryId, unit } })
      setOpen(false)
      onSuccess()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Something went wrong.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {mode === 'create'
          ? <Button size="sm"><PlusCircle className="w-4 h-4 mr-2" />Add Product</Button>
          : <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
        }
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Product' : 'Edit Product'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={handleCategoryChange}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select category..." /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Subcategory</Label>
            <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={categoryId ? 'Select subcategory...' : 'Select category first'} />
              </SelectTrigger>
              <SelectContent>
                {filteredSubs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Product Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chocolate Fudge Cake"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim() || !subcategoryId}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function ProductsPage() {
  const router  = useRouter()
  const { access, categories, subcategories, products } = Route.useLoaderData()
  const refresh = () => router.invalidate()

  const [tab, setTab] = useState<'categories' | 'subcategories' | 'products'>('categories')

  const [filterCategoryId,    setFilterCategoryId]    = useState('')
  const [filterSubcategoryId, setFilterSubcategoryId] = useState('')

  const [catSearch,  setCatSearch]  = useState('')
  const [subSearch,  setSubSearch]  = useState('')
  const [prodSearch, setProdSearch] = useState('')

  const [catSort,  setCatSort]  = useState<{ key: keyof CategoryRow;    dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [subSort,  setSubSort]  = useState<{ key: keyof SubcategoryRow; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [prodSort, setProdSort] = useState<{ key: keyof ProductRow;     dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })

  const [catPage,  setCatPage]  = useState(0)
  const [subPage,  setSubPage]  = useState(0)
  const [prodPage, setProdPage] = useState(0)

  function toggleSort<T>(
    current: { key: keyof T; dir: 'asc' | 'desc' },
    key: keyof T,
    set: (v: { key: keyof T; dir: 'asc' | 'desc' }) => void,
    resetPage: () => void
  ) {
    set(current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
    resetPage()
  }

  const filteredSubcategories = useMemo(
    () => filterCategoryId ? subcategories.filter((s) => s.categoryId === filterCategoryId) : subcategories,
    [subcategories, filterCategoryId]
  )
  const filteredProducts = useMemo(() => {
    let p = products
    if (filterCategoryId)    p = p.filter((pr) => pr.categoryId === filterCategoryId)
    if (filterSubcategoryId) p = p.filter((pr) => pr.subcategoryId === filterSubcategoryId)
    return p
  }, [products, filterCategoryId, filterSubcategoryId])

  const sortedCats  = useSortedFiltered(categories,            ['name'],                                          catSearch,  catSort.key,  catSort.dir)
  const sortedSubs  = useSortedFiltered(filteredSubcategories, ['name', 'categoryName'],                          subSearch,  subSort.key,  subSort.dir)
  const sortedProds = useSortedFiltered(filteredProducts,      ['name', 'categoryName', 'subcategoryName', 'unit'], prodSearch, prodSort.key, prodSort.dir)

  const { pageItems: catItems,  pageCount: catPageCount  } = usePaginated(sortedCats,  catPage)
  const { pageItems: subItems,  pageCount: subPageCount  } = usePaginated(sortedSubs,  subPage)
  const { pageItems: prodItems, pageCount: prodPageCount } = usePaginated(sortedProds, prodPage)

  function drillToSubs(categoryId: string) {
    setFilterCategoryId(categoryId)
    setFilterSubcategoryId('')
    setSubSearch('')
    setSubPage(0)
    setTab('subcategories')
  }

  function drillToProds(opts: { categoryId?: string; subcategoryId?: string }) {
    if (opts.categoryId)    setFilterCategoryId(opts.categoryId)
    if (opts.subcategoryId) setFilterSubcategoryId(opts.subcategoryId)
    setProdSearch('')
    setProdPage(0)
    setTab('products')
  }

  const activeCategoryName    = categories.find((c) => c.id === filterCategoryId)?.name
  const activeSubcategoryName = subcategories.find((s) => s.id === filterSubcategoryId)?.name

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">Manage categories, subcategories and products</p>
        </div>
      </div>

      <Card>
        {/* Tab bar */}
        <div className="flex border-b overflow-x-auto">
          <TabBtn active={tab === 'categories'}    onClick={() => setTab('categories')}    icon={Layers}  label="Categories"    count={categories.length} />
          <TabBtn active={tab === 'subcategories'} onClick={() => setTab('subcategories')} icon={Tag}     label="Subcategories" count={subcategories.length} />
          <TabBtn active={tab === 'products'}      onClick={() => setTab('products')}      icon={Package} label="Products"      count={products.length} />
        </div>

        <CardContent className="p-3 space-y-3">

          {/* ── CATEGORIES ─────────────────────────────────────────── */}
          {tab === 'categories' && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 md:max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search categories..."
                    value={catSearch}
                    onChange={(e) => { setCatSearch(e.target.value); setCatPage(0) }}
                    className="pl-8"
                  />
                </div>
                <RoleGate {...access} requireAdmin>
                  <CategoryDialog mode="create" onSuccess={refresh} />
                </RoleGate>
              </div>

              {/* Desktop table */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortBtn label="Name" sorted={catSort.key === 'name' ? catSort.dir : false} onToggle={() => toggleSort(catSort, 'name', setCatSort, () => setCatPage(0))} /></TableHead>
                      <TableHead className="text-right">Subcategories</TableHead>
                      <TableHead className="text-right">Products</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catItems.length ? catItems.map((cat) => (
                      <TableRow key={cat.id}>
                        <TableCell className="font-medium">{cat.name}</TableCell>
                        <TableCell className="text-right">
                          <button onClick={() => drillToSubs(cat.id)} className="text-sm text-primary hover:underline underline-offset-2">
                            {cat.subcategoryCount}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <button onClick={() => drillToProds({ categoryId: cat.id })} className="text-sm text-primary hover:underline underline-offset-2">
                            {cat.productCount}
                          </button>
                        </TableCell>
                        <TableCell>
                          <RoleGate {...access} requireAdmin>
                            <div className="flex items-center justify-end gap-1">
                              <CategoryDialog mode="edit" category={cat} onSuccess={refresh} />
                              <DeleteDialog
                                title="Delete Category"
                                description={<>Are you sure you want to delete <strong>{cat.name}</strong>? This cannot be undone.</>}
                                disabled={cat.subcategoryCount > 0}
                                disabledReason={cat.subcategoryCount > 0 ? `${cat.subcategoryCount} subcategor${cat.subcategoryCount === 1 ? 'y' : 'ies'} must be removed first.` : undefined}
                                onConfirm={async () => { await deleteCategory({ data: { id: cat.id } }); refresh() }}
                              />
                            </div>
                          </RoleGate>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No categories found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {catItems.length ? catItems.map((cat) => (
                  <div key={cat.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{cat.name}</span>
                      </div>
                      <RoleGate {...access} requireAdmin>
                        <div className="flex items-center gap-1 shrink-0">
                          <CategoryDialog mode="edit" category={cat} onSuccess={refresh} />
                          <DeleteDialog
                            title="Delete Category"
                            description={<>Are you sure you want to delete <strong>{cat.name}</strong>?</>}
                            disabled={cat.subcategoryCount > 0}
                            disabledReason={cat.subcategoryCount > 0 ? `${cat.subcategoryCount} subcategor${cat.subcategoryCount === 1 ? 'y' : 'ies'} must be removed first.` : undefined}
                            onConfirm={async () => { await deleteCategory({ data: { id: cat.id } }); refresh() }}
                          />
                        </div>
                      </RoleGate>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => drillToSubs(cat.id)} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                        <Tag className="w-3 h-3" />
                        {cat.subcategoryCount} subcategor{cat.subcategoryCount === 1 ? 'y' : 'ies'}
                      </button>
                      <span className="text-muted-foreground/40">·</span>
                      <button onClick={() => drillToProds({ categoryId: cat.id })} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                        <Package className="w-3 h-3" />
                        {cat.productCount} product{cat.productCount === 1 ? '' : 's'}
                      </button>
                    </div>
                  </div>
                )) : (
                  <p className="text-center py-10 text-muted-foreground text-sm">No categories found.</p>
                )}
              </div>

              <PaginationBar page={catPage} pageCount={catPageCount} total={categories.length} filtered={sortedCats.length} onPrev={() => setCatPage((p) => p - 1)} onNext={() => setCatPage((p) => p + 1)} />
            </>
          )}

          {/* ── SUBCATEGORIES ──────────────────────────────────────── */}
          {tab === 'subcategories' && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-0 md:max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search subcategories..."
                    value={subSearch}
                    onChange={(e) => { setSubSearch(e.target.value); setSubPage(0) }}
                    className="pl-8"
                  />
                </div>
                {filterCategoryId && (
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                    onClick={() => setFilterCategoryId('')}
                  >
                    {activeCategoryName} ×
                  </Badge>
                )}
                <RoleGate {...access} requireAdmin>
                  <SubcategoryDialog mode="create" categories={categories} defaultCategoryId={filterCategoryId} onSuccess={refresh} />
                </RoleGate>
              </div>

              {/* Desktop table */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortBtn label="Name" sorted={subSort.key === 'name' ? subSort.dir : false} onToggle={() => toggleSort(subSort, 'name', setSubSort, () => setSubPage(0))} /></TableHead>
                      <TableHead><SortBtn label="Category" sorted={subSort.key === 'categoryName' ? subSort.dir : false} onToggle={() => toggleSort(subSort, 'categoryName', setSubSort, () => setSubPage(0))} /></TableHead>
                      <TableHead className="text-right">Products</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subItems.length ? subItems.map((sub) => (
                      <TableRow key={sub.id}>
                        <TableCell className="font-medium">{sub.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs font-normal">{sub.categoryName}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <button onClick={() => drillToProds({ categoryId: sub.categoryId, subcategoryId: sub.id })} className="text-sm text-primary hover:underline underline-offset-2">
                            {sub.productCount}
                          </button>
                        </TableCell>
                        <TableCell>
                          <RoleGate {...access} requireAdmin>
                            <div className="flex items-center justify-end gap-1">
                              <SubcategoryDialog mode="edit" subcategory={sub} categories={categories} onSuccess={refresh} />
                              <DeleteDialog
                                title="Delete Subcategory"
                                description={<>Are you sure you want to delete <strong>{sub.name}</strong>? This cannot be undone.</>}
                                disabled={sub.productCount > 0}
                                disabledReason={sub.productCount > 0 ? `${sub.productCount} product${sub.productCount === 1 ? '' : 's'} must be removed first.` : undefined}
                                onConfirm={async () => { await deleteSubcategory({ data: { id: sub.id } }); refresh() }}
                              />
                            </div>
                          </RoleGate>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No subcategories found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {subItems.length ? subItems.map((sub) => (
                  <div key={sub.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Tag className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{sub.name}</span>
                      </div>
                      <RoleGate {...access} requireAdmin>
                        <div className="flex items-center gap-1 shrink-0">
                          <SubcategoryDialog mode="edit" subcategory={sub} categories={categories} onSuccess={refresh} />
                          <DeleteDialog
                            title="Delete Subcategory"
                            description={<>Are you sure you want to delete <strong>{sub.name}</strong>?</>}
                            disabled={sub.productCount > 0}
                            disabledReason={sub.productCount > 0 ? `${sub.productCount} product${sub.productCount === 1 ? '' : 's'} must be removed first.` : undefined}
                            onConfirm={async () => { await deleteSubcategory({ data: { id: sub.id } }); refresh() }}
                          />
                        </div>
                      </RoleGate>
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-xs">{sub.categoryName}</Badge>
                      <button onClick={() => drillToProds({ categoryId: sub.categoryId, subcategoryId: sub.id })} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                        <Package className="w-3 h-3" />
                        {sub.productCount} product{sub.productCount === 1 ? '' : 's'}
                      </button>
                    </div>
                  </div>
                )) : (
                  <p className="text-center py-10 text-muted-foreground text-sm">No subcategories found.</p>
                )}
              </div>

              <PaginationBar page={subPage} pageCount={subPageCount} total={subcategories.length} filtered={sortedSubs.length} onPrev={() => setSubPage((p) => p - 1)} onNext={() => setSubPage((p) => p + 1)} />
            </>
          )}

          {/* ── PRODUCTS ───────────────────────────────────────────── */}
          {tab === 'products' && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-0 md:max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search products..."
                    value={prodSearch}
                    onChange={(e) => { setProdSearch(e.target.value); setProdPage(0) }}
                    className="pl-8"
                  />
                </div>
                {filterCategoryId && (
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                    onClick={() => { setFilterCategoryId(''); setFilterSubcategoryId('') }}
                  >
                    {activeCategoryName} ×
                  </Badge>
                )}
                {filterSubcategoryId && (
                  <Badge
                    variant="outline"
                    className="gap-1 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                    onClick={() => setFilterSubcategoryId('')}
                  >
                    {activeSubcategoryName} ×
                  </Badge>
                )}
                <RoleGate {...access} requireAdmin>
                  <ProductDialog mode="create" categories={categories} subcategories={subcategories} defaultSubcategoryId={filterSubcategoryId} onSuccess={refresh} />
                </RoleGate>
              </div>

              {/* Desktop table */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortBtn label="Product" sorted={prodSort.key === 'name' ? prodSort.dir : false} onToggle={() => toggleSort(prodSort, 'name', setProdSort, () => setProdPage(0))} /></TableHead>
                      <TableHead><SortBtn label="Category" sorted={prodSort.key === 'categoryName' ? prodSort.dir : false} onToggle={() => toggleSort(prodSort, 'categoryName', setProdSort, () => setProdPage(0))} /></TableHead>
                      <TableHead><SortBtn label="Subcategory" sorted={prodSort.key === 'subcategoryName' ? prodSort.dir : false} onToggle={() => toggleSort(prodSort, 'subcategoryName', setProdSort, () => setProdPage(0))} /></TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prodItems.length ? prodItems.map((prod) => (
                      <TableRow key={prod.id}>
                        <TableCell className="font-medium">{prod.name}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs font-normal">{prod.categoryName}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs font-normal">{prod.subcategoryName}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{prod.unit}</TableCell>
                        <TableCell>
                          <RoleGate {...access} requireAdmin fallback={
                            <Badge variant={prod.isActive ? 'default' : 'secondary'} className="text-xs">
                              {prod.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          }>
                            <Switch
                              checked={prod.isActive}
                              onCheckedChange={async (v) => { await toggleProductActive({ data: { id: prod.id, isActive: v } }); refresh() }}
                            />
                          </RoleGate>
                        </TableCell>
                        <TableCell>
                          <RoleGate {...access} requireAdmin>
                            <div className="flex items-center justify-end gap-1">
                              <ProductDialog mode="edit" product={prod} categories={categories} subcategories={subcategories} onSuccess={refresh} />
                              <DeleteDialog
                                title="Delete Product"
                                description={<>Are you sure you want to delete <strong>{prod.name}</strong>? This cannot be undone.</>}
                                disabled={prod.transactionCount > 0}
                                disabledReason={prod.transactionCount > 0 ? `${prod.transactionCount} transaction${prod.transactionCount === 1 ? '' : 's'} reference this product.` : undefined}
                                onConfirm={async () => { await deleteProduct({ data: { id: prod.id } }); refresh() }}
                              />
                            </div>
                          </RoleGate>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No products found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {prodItems.length ? prodItems.map((prod) => (
                  <div key={prod.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{prod.name}</span>
                      </div>
                      <RoleGate {...access} requireAdmin>
                        <div className="flex items-center gap-1 shrink-0">
                          <ProductDialog mode="edit" product={prod} categories={categories} subcategories={subcategories} onSuccess={refresh} />
                          <DeleteDialog
                            title="Delete Product"
                            description={<>Are you sure you want to delete <strong>{prod.name}</strong>?</>}
                            disabled={prod.transactionCount > 0}
                            disabledReason={prod.transactionCount > 0 ? `${prod.transactionCount} transaction${prod.transactionCount === 1 ? '' : 's'} reference this product.` : undefined}
                            onConfirm={async () => { await deleteProduct({ data: { id: prod.id } }); refresh() }}
                          />
                        </div>
                      </RoleGate>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">{prod.categoryName}</Badge>
                      <Badge variant="outline" className="text-xs">{prod.subcategoryName}</Badge>
                      <span className="text-xs text-muted-foreground">{prod.unit}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <RoleGate {...access} requireAdmin fallback={
                        <Badge variant={prod.isActive ? 'default' : 'secondary'} className="text-xs">
                          {prod.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      }>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={prod.isActive}
                            onCheckedChange={async (v) => { await toggleProductActive({ data: { id: prod.id, isActive: v } }); refresh() }}
                          />
                          <span className="text-xs text-muted-foreground">{prod.isActive ? 'Active' : 'Inactive'}</span>
                        </div>
                      </RoleGate>
                    </div>
                  </div>
                )) : (
                  <p className="text-center py-10 text-muted-foreground text-sm">No products found.</p>
                )}
              </div>

              <PaginationBar page={prodPage} pageCount={prodPageCount} total={filteredProducts.length} filtered={sortedProds.length} onPrev={() => setProdPage((p) => p - 1)} onNext={() => setProdPage((p) => p + 1)} />
            </>
          )}

        </CardContent>
      </Card>
    </div>
  )
}
