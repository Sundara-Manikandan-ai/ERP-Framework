import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table'
import { db } from '#/lib/db'
import { resourceMiddleware } from '#/middleware/resource'
import { authMiddleware } from '#/middleware/auth'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Loader2, Search, ChevronLeft, ChevronRight, Download, ChevronDown, Folder } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterData = {
  authorized?: true
  branches: { id: string; name: string }[]
  factories: { id: string; name: string }[]
  transactionTypes: { id: string; name: string }[]
  // Flat list of all category nodes; client builds the tree
  categories: { id: string; name: string; parentId: string | null }[]
  // All active products (for the product filter select)
  products: { id: string; name: string; categoryId: string }[]
}

type TransactionRow = {
  id: string
  date: Date
  branchName: string | null
  factoryName: string | null
  categoryPath: string   // full path e.g. "Cake / Layer Cake"
  product: string
  transactionType: string
  quantity: string
  value: string
}

type BatchRow = {
  id: string
  filename: string
  transactionType: string
  dateFrom: Date
  dateTo: Date
  rowCount: number
  successCount: number
  errorCount: number
  status: string
  uploadedBy: string
  uploadedAt: Date
}

type TxFilters = {
  dateFrom: string
  dateTo: string
  branchId: string
  factoryId: string
  transactionTypeId: string
  categoryId: string   // filters by this node AND all its descendants
  productId: string
  page: number
  pageSize: number
}

// ── Server Functions ──────────────────────────────────────────────────────────

const getFilterData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FilterData | { authorized: false }> => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'reports' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const [branches, factories, transactionTypes, categories, products] = await Promise.all([
      db.branch.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      db.factory.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      db.transactionType.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      db.productCategory.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, parentId: true },
      }),
      db.product.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, categoryId: true },
      }),
    ])
    return { authorized: true, branches, factories, transactionTypes, categories, products }
  })

const queryTransactions = createServerFn({ method: 'POST' })
  .middleware([resourceMiddleware('reports')])
  .inputValidator((data: TxFilters) => data)
  .handler(async ({ data }) => {
    const where = await buildTxWhere(data)
    const [total, rows] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: data.page * data.pageSize,
        take: data.pageSize,
        include: {
          branch:  { select: { name: true } },
          factory: { select: { name: true } },
          product: { include: { category: true } },
          transactionType: { select: { name: true } },
        },
      }),
    ])

    return {
      total,
      pageCount: Math.ceil(total / data.pageSize),
      rows: rows.map(mapTxRow),
    }
  })

const exportTransactions = createServerFn({ method: 'POST' })
  .middleware([resourceMiddleware('reports')])
  .inputValidator((data: Omit<TxFilters, 'page' | 'pageSize'>) => data)
  .handler(async ({ data }) => {
    const where = await buildTxWhere({ ...data, page: 0, pageSize: 0 })

    const rows = await db.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        branch:  { select: { name: true } },
        factory: { select: { name: true } },
        product: { include: { category: true } },
        transactionType: { select: { name: true } },
      },
    })

    return rows.map(mapTxRow)
  })

const queryBatchSummaries = createServerFn({ method: 'POST' })
  .middleware([resourceMiddleware('reports')])
  .inputValidator((data: { dateFrom: string; dateTo: string }) => data)
  .handler(async ({ data }) => {
    const where: Record<string, unknown> = {}
    if (data.dateFrom) where.uploadedAt = { gte: new Date(data.dateFrom) }
    if (data.dateTo) {
      const existing = (where.uploadedAt as Record<string, unknown>) ?? {}
      where.uploadedAt = { ...existing, lte: new Date(data.dateTo + 'T23:59:59') }
    }

    const batches = await db.uploadBatch.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      take: 100,
      include: {
        transactionType: { select: { name: true } },
        user: { select: { name: true } },
      },
    })

    return batches.map((b) => ({
      id:              b.id,
      filename:        b.filename,
      transactionType: b.transactionType.name,
      dateFrom:        b.dateFrom,
      dateTo:          b.dateTo,
      rowCount:        b.rowCount,
      successCount:    b.successCount,
      errorCount:      b.errorCount,
      status:          b.status,
      uploadedBy:      b.user.name,
      uploadedAt:      b.uploadedAt,
    }))
  })

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getAllDescendantIds(categoryId: string): Promise<string[]> {
  const all = await db.productCategory.findMany({ select: { id: true, parentId: true } })
  const childMap = new Map<string, string[]>()
  for (const c of all) {
    if (c.parentId) {
      if (!childMap.has(c.parentId)) childMap.set(c.parentId, [])
      childMap.get(c.parentId)!.push(c.id)
    }
  }
  const ids: string[] = []
  const queue = [categoryId]
  while (queue.length) {
    const id = queue.shift()!
    ids.push(id)
    const children = childMap.get(id) ?? []
    queue.push(...children)
  }
  return ids
}

async function buildTxWhere(data: TxFilters) {
  const where: Record<string, unknown> = {}
  if (data.dateFrom) where.date = { gte: new Date(data.dateFrom) }
  if (data.dateTo) {
    const existing = (where.date as Record<string, unknown>) ?? {}
    where.date = { ...existing, lte: new Date(data.dateTo) }
  }
  if (data.branchId)          where.branchId          = data.branchId
  if (data.factoryId)         where.factoryId         = data.factoryId
  if (data.transactionTypeId) where.transactionTypeId = data.transactionTypeId
  if (data.productId) {
    where.productId = data.productId
  } else if (data.categoryId) {
    const ids = await getAllDescendantIds(data.categoryId)
    where.product = { categoryId: { in: ids } }
  }
  return where
}

function mapTxRow(r: {
  id: string
  date: Date
  branch: { name: string } | null
  factory: { name: string } | null
  product: { name: string; category: { name: string; parentId: string | null } }
  transactionType: { name: string }
  quantity: { toString(): string }
  value: { toString(): string }
}): TransactionRow {
  // Build category path — we only have direct parent here, not full ancestry.
  // For the report display we show just the direct category name.
  // For full breadcrumb, getAllDescendantIds would be needed; single level is sufficient for display.
  const categoryPath = r.product.category.name
  return {
    id:              r.id,
    date:            r.date,
    branchName:      r.branch?.name   ?? null,
    factoryName:     r.factory?.name  ?? null,
    categoryPath,
    product:         r.product.name,
    transactionType: r.transactionType.name,
    quantity:        r.quantity.toString(),
    value:           r.value.toString(),
  }
}

// ── Export helper ─────────────────────────────────────────────────────────────

function downloadAsExcel(rows: TransactionRow[], filters: Omit<TxFilters, 'page' | 'pageSize'>) {
  const data = rows.map((r) => ({
    Date:               new Date(r.date).toLocaleDateString('en-IN'),
    'Branch / Factory': r.branchName ?? r.factoryName ?? '—',
    Category:           r.categoryPath,
    Product:            r.product,
    'Transaction Type': r.transactionType,
    Quantity:           parseFloat(r.quantity),
    'Value (₹)':        parseFloat(r.value),
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')

  // Auto-width columns
  const colWidths = Object.keys(data[0] ?? {}).map((key) => ({
    wch: Math.max(key.length, ...data.map((r) => String((r as Record<string, unknown>)[key] ?? '').length)) + 2,
  }))
  ws['!cols'] = colWidths

  const parts = ['transactions']
  if (filters.dateFrom) parts.push(filters.dateFrom)
  if (filters.dateTo)   parts.push(filters.dateTo)
  const filename = parts.join('_') + '.xlsx'

  XLSX.writeFile(wb, filename)
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/reports')({
  loader: () => getFilterData(),
  component: ReportsPage,
})

// ── Category Tree Picker ──────────────────────────────────────────────────────

type CatNode = { id: string; name: string; parentId: string | null }

function CategoryTreePicker({
  categories,
  value,
  onChange,
}: {
  categories: CatNode[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { childMap, nodeMap } = useMemo(() => {
    const childMap = new Map<string | null, CatNode[]>()
    const nodeMap = new Map<string, CatNode>()
    for (const c of categories) {
      nodeMap.set(c.id, c)
      const key = c.parentId ?? null
      if (!childMap.has(key)) childMap.set(key, [])
      childMap.get(key)!.push(c)
    }
    return { childMap, nodeMap }
  }, [categories])

  // Build breadcrumb for selected category
  const selectedLabel = useMemo(() => {
    if (!value) return 'All categories'
    const parts: string[] = []
    let cur: CatNode | undefined = nodeMap.get(value)
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
          <div
            className={cn(
              'flex items-center gap-1.5 py-1 pr-2 text-sm cursor-pointer rounded-sm hover:bg-accent',
              !value && 'bg-accent font-medium'
            )}
            style={{ paddingLeft: '6px' }}
            onClick={() => select('')}
          >
            <span className="w-3 shrink-0" />
            <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>All categories</span>
          </div>
          {renderNodes(null, 0)}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Transactions Tab ──────────────────────────────────────────────────────────

function TransactionsTab({ filterData }: { filterData: FilterData }) {
  const [filters, setFilters] = useState({
    dateFrom: '', dateTo: '', branchId: '', factoryId: '',
    transactionTypeId: '', categoryId: '', productId: '',
  })
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [result, setResult]         = useState<{ rows: TransactionRow[]; total: number; pageCount: number } | null>(null)
  const [isPending, setIsPending]   = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Products filtered by selected category (and descendants)
  const filteredProducts = useMemo(() => {
    if (!filters.categoryId) return filterData.products
    // Collect descendant ids
    const childMap = new Map<string, string[]>()
    for (const c of filterData.categories) {
      if (c.parentId) {
        if (!childMap.has(c.parentId)) childMap.set(c.parentId, [])
        childMap.get(c.parentId)!.push(c.id)
      }
    }
    const ids = new Set<string>()
    const queue = [filters.categoryId]
    while (queue.length) {
      const id = queue.shift()!
      ids.add(id)
      queue.push(...(childMap.get(id) ?? []))
    }
    return filterData.products.filter((p) => ids.has(p.categoryId))
  }, [filterData.categories, filterData.products, filters.categoryId])

  async function handleSearch(page = 0) {
    setIsPending(true)
    try {
      const res = await queryTransactions({
        data: { ...filters, page, pageSize: pagination.pageSize },
      })
      setResult(res)
      setPagination((p) => ({ ...p, pageIndex: page }))
    } finally {
      setIsPending(false)
    }
  }

  async function handleExport() {
    setIsExporting(true)
    try {
      const rows = await exportTransactions({ data: filters })
      downloadAsExcel(rows, filters)
    } finally {
      setIsExporting(false)
    }
  }

  const columns: ColumnDef<TransactionRow>[] = [
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          {new Date(row.getValue('date')).toLocaleDateString('en-IN')}
        </span>
      ),
    },
    {
      id: 'source',
      header: 'Branch / Factory',
      cell: ({ row }) => {
        const r = row.original
        return <span className="text-sm">{r.branchName ?? r.factoryName ?? '—'}</span>
      },
    },
    { accessorKey: 'categoryPath', header: 'Category', cell: ({ row }) => <span className="text-sm">{row.getValue('categoryPath')}</span> },
    { accessorKey: 'product',      header: 'Product',  cell: ({ row }) => <span className="text-sm">{row.getValue('product')}</span> },
    {
      accessorKey: 'transactionType',
      header: 'Type',
      cell: ({ row }) => <Badge variant="outline">{row.getValue('transactionType')}</Badge>,
    },
    {
      accessorKey: 'quantity',
      header: () => <div className="text-right">Qty</div>,
      cell: ({ row }) => <div className="text-right text-sm">{row.getValue('quantity')}</div>,
    },
    {
      accessorKey: 'value',
      header: () => <div className="text-right">Value ₹</div>,
      cell: ({ row }) => (
        <div className="text-right text-sm">
          {parseFloat(row.getValue('value')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data: result?.rows ?? [],
    columns,
    pageCount: result?.pageCount ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
  })

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Branch</Label>
              <Select value={filters.branchId || '__all__'} onValueChange={(v) => setFilters({ ...filters, branchId: v === '__all__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All branches</SelectItem>
                  {filterData.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Factory</Label>
              <Select value={filters.factoryId || '__all__'} onValueChange={(v) => setFilters({ ...filters, factoryId: v === '__all__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="All factories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All factories</SelectItem>
                  {filterData.factories.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transaction Type</Label>
              <Select value={filters.transactionTypeId || '__all__'} onValueChange={(v) => setFilters({ ...filters, transactionTypeId: v === '__all__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All types</SelectItem>
                  {filterData.transactionTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <CategoryTreePicker
                categories={filterData.categories}
                value={filters.categoryId}
                onChange={(id) => setFilters({ ...filters, categoryId: id, productId: '' })}
              />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Product</Label>
              <Select
                value={filters.productId || '__all__'}
                onValueChange={(v) => setFilters({ ...filters, productId: v === '__all__' ? '' : v })}
              >
                <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All products</SelectItem>
                  {filteredProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => handleSearch(0)} disabled={isPending} className="w-full md:w-auto">
            {isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Searching...</>
              : <><Search className="w-4 h-4 mr-2" />Search</>}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Results</CardTitle>
                <CardDescription>{result.total.toLocaleString()} transactions found</CardDescription>
              </div>
              {result.total > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="shrink-0"
                >
                  {isExporting
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Exporting...</>
                    : <><Download className="w-4 h-4 mr-2" />Export All ({result.total.toLocaleString()})</>}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {/* Desktop table */}
            <div className="rounded-md border overflow-x-auto">
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
                  {isPending ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="text-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : table.getRowModel().rows.length ? (
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
                      <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                        No transactions found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm text-muted-foreground">
                Page {pagination.pageIndex + 1} of {result.pageCount || 1}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  onClick={() => handleSearch(pagination.pageIndex - 1)}
                  disabled={pagination.pageIndex === 0 || isPending}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => handleSearch(pagination.pageIndex + 1)}
                  disabled={pagination.pageIndex + 1 >= result.pageCount || isPending}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Upload Batches Tab ────────────────────────────────────────────────────────

function BatchesTab() {
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [rows, setRows]           = useState<BatchRow[]>([])
  const [isPending, setIsPending] = useState(false)

  async function handleSearch() {
    setIsPending(true)
    try {
      const res = await queryBatchSummaries({ data: { dateFrom, dateTo } })
      setRows(res)
    } finally {
      setIsPending(false)
    }
  }

  function statusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (s === 'SUCCESS') return 'default'
    if (s === 'PARTIAL') return 'secondary'
    if (s === 'FAILED')  return 'destructive'
    return 'outline'
  }

  const columns: ColumnDef<BatchRow>[] = [
    {
      accessorKey: 'filename',
      header: 'Filename',
      cell: ({ row }) => <span className="text-sm font-mono">{row.getValue('filename')}</span>,
    },
    {
      accessorKey: 'transactionType',
      header: 'Type',
      cell: ({ row }) => <Badge variant="outline">{row.getValue('transactionType')}</Badge>,
    },
    {
      id: 'dateRange',
      header: 'Date Range',
      cell: ({ row }) => {
        const b = row.original
        return (
          <span className="text-sm whitespace-nowrap">
            {new Date(b.dateFrom).toLocaleDateString('en-IN')} – {new Date(b.dateTo).toLocaleDateString('en-IN')}
          </span>
        )
      },
    },
    {
      accessorKey: 'rowCount',
      header: 'Rows',
      cell: ({ row }) => <span className="text-sm">{row.getValue('rowCount')}</span>,
    },
    {
      accessorKey: 'successCount',
      header: 'Success',
      cell: ({ row }) => <Badge variant="default">{row.getValue('successCount')}</Badge>,
    },
    {
      accessorKey: 'errorCount',
      header: 'Errors',
      cell: ({ row }) => {
        const c = row.getValue('errorCount') as number
        return <Badge variant={c > 0 ? 'destructive' : 'outline'}>{c}</Badge>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.getValue('status'))}>{row.getValue('status')}</Badge>
      ),
    },
    {
      accessorKey: 'uploadedBy',
      header: 'Uploaded By',
      cell: ({ row }) => <span className="text-sm">{row.getValue('uploadedBy')}</span>,
    },
    {
      accessorKey: 'uploadedAt',
      header: 'Uploaded At',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          {new Date(row.getValue('uploadedAt')).toLocaleString('en-IN')}
        </span>
      ),
    },
  ]

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Button onClick={handleSearch} disabled={isPending}>
              {isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Searching...</>
                : <><Search className="w-4 h-4 mr-2" />Search</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Batches</CardTitle>
            <CardDescription>{rows.length} batches (last 100)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {/* Desktop table */}
            <div className="hidden md:block rounded-md border overflow-x-auto">
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
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-3 md:hidden">
              {table.getRowModel().rows.map((row) => {
                const b = row.original
                return (
                  <div key={b.id} className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-mono truncate">{b.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(b.uploadedAt).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <Badge variant={statusVariant(b.status)} className="shrink-0">{b.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs">{b.transactionType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(b.dateFrom).toLocaleDateString('en-IN')} – {new Date(b.dateTo).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{b.rowCount} rows</span>
                      <Badge variant="default" className="text-xs">{b.successCount} ok</Badge>
                      {b.errorCount > 0 && (
                        <Badge variant="destructive" className="text-xs">{b.errorCount} err</Badge>
                      )}
                      <span className="text-muted-foreground ml-auto">{b.uploadedBy}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-1">
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
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ReportsPage() {
  const loaderData = Route.useLoaderData()
  if ('authorized' in loaderData && !loaderData.authorized) return <Unauthorized />
  const filterData = loaderData as FilterData
  const [tab, setTab] = useState<'transactions' | 'batches'>('transactions')

  return (
    <div className="space-y-2">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">Query transactions and review upload history</p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b">
        {(['transactions', 'batches'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {t === 'transactions' ? 'Transactions' : 'Upload Batches'}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'transactions' && <TransactionsTab filterData={filterData} />}
        {tab === 'batches'      && <BatchesTab />}
      </div>
    </div>
  )
}