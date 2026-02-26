import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
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
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterData = {
  branches: { id: string; name: string }[]
  factories: { id: string; name: string }[]
  transactionTypes: { id: string; name: string }[]
  categories: {
    id: string
    name: string
    subcategories: {
      id: string
      name: string
      products: { id: string; name: string }[]
    }[]
  }[]
}

type TransactionRow = {
  id: string
  date: Date
  branchName: string | null
  factoryName: string | null
  category: string
  subcategory: string
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
  categoryId: string
  subcategoryId: string
  productId: string
  page: number
  pageSize: number
}

// ── Server Functions ──────────────────────────────────────────────────────────

const getFilterData = createServerFn({ method: 'GET' })
  .middleware([resourceMiddleware('reports')])
  .handler(async (): Promise<FilterData> => {
    const [branches, factories, transactionTypes, categories] = await Promise.all([
      db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.factory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.transactionType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.productCategory.findMany({
        orderBy: { name: 'asc' },
        include: {
          subcategories: {
            orderBy: { name: 'asc' },
            include: { products: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } } },
          },
        },
      }),
    ])
    return { branches, factories, transactionTypes, categories }
  })

const queryTransactions = createServerFn({ method: 'POST' })
  .middleware([resourceMiddleware('reports')])
  .inputValidator((data: TxFilters) => data)
  .handler(async ({ data }) => {
    const where: Record<string, unknown> = {}
    if (data.dateFrom) where.date = { gte: new Date(data.dateFrom) }
    if (data.dateTo) {
      const existing = (where.date as Record<string, unknown>) ?? {}
      where.date = { ...existing, lte: new Date(data.dateTo) }
    }
    if (data.branchId)          where.branchId = data.branchId
    if (data.factoryId)         where.factoryId = data.factoryId
    if (data.transactionTypeId) where.transactionTypeId = data.transactionTypeId
    if (data.productId) {
      where.productId = data.productId
    } else if (data.subcategoryId) {
      where.product = { subcategoryId: data.subcategoryId }
    } else if (data.categoryId) {
      where.product = { subcategory: { categoryId: data.categoryId } }
    }

    const [total, rows] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: data.page * data.pageSize,
        take: data.pageSize,
        include: {
          branch: { select: { name: true } },
          factory: { select: { name: true } },
          product: {
            include: {
              subcategory: { include: { category: true } },
            },
          },
          transactionType: { select: { name: true } },
        },
      }),
    ])

    return {
      total,
      pageCount: Math.ceil(total / data.pageSize),
      rows: rows.map((r) => ({
        id:              r.id,
        date:            r.date,
        branchName:      r.branch?.name ?? null,
        factoryName:     r.factory?.name ?? null,
        category:        r.product.subcategory.category.name,
        subcategory:     r.product.subcategory.name,
        product:         r.product.name,
        transactionType: r.transactionType.name,
        quantity:        r.quantity.toString(),
        value:           r.value.toString(),
      })),
    }
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

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/reports')({
  loader: () => getFilterData(),
  errorComponent: () => <Unauthorized />,
  component: ReportsPage,
})

// ── Transactions Tab ──────────────────────────────────────────────────────────

function TransactionsTab({ filterData }: { filterData: FilterData }) {
  const [filters, setFilters] = useState({
    dateFrom: '', dateTo: '', branchId: '', factoryId: '',
    transactionTypeId: '', categoryId: '', subcategoryId: '', productId: '',
  })
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [result, setResult]         = useState<{ rows: TransactionRow[]; total: number; pageCount: number } | null>(null)
  const [isPending, setIsPending]   = useState(false)

  const subcategories = useMemo(
    () => filterData.categories.find((c) => c.id === filters.categoryId)?.subcategories ?? [],
    [filterData.categories, filters.categoryId]
  )
  const products = useMemo(
    () => subcategories.find((s) => s.id === filters.subcategoryId)?.products ?? [],
    [subcategories, filters.subcategoryId]
  )

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
        const name = r.branchName ?? r.factoryName ?? '—'
        return <span className="text-sm">{name}</span>
      },
    },
    { accessorKey: 'category',    header: 'Category',    cell: ({ row }) => <span className="text-sm">{row.getValue('category')}</span> },
    { accessorKey: 'subcategory', header: 'Subcategory', cell: ({ row }) => <span className="text-sm">{row.getValue('subcategory')}</span> },
    { accessorKey: 'product',     header: 'Product',     cell: ({ row }) => <span className="text-sm">{row.getValue('product')}</span> },
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
              <Select
                value={filters.categoryId || '__all__'}
                onValueChange={(v) => setFilters({ ...filters, categoryId: v === '__all__' ? '' : v, subcategoryId: '', productId: '' })}
              >
                <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {filterData.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subcategory</Label>
              <Select
                value={filters.subcategoryId || '__all__'}
                onValueChange={(v) => setFilters({ ...filters, subcategoryId: v === '__all__' ? '' : v, productId: '' })}
                disabled={!filters.categoryId}
              >
                <SelectTrigger><SelectValue placeholder="All subcategories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All subcategories</SelectItem>
                  {subcategories.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Product</Label>
              <Select
                value={filters.productId || '__all__'}
                onValueChange={(v) => setFilters({ ...filters, productId: v === '__all__' ? '' : v })}
                disabled={!filters.subcategoryId}
              >
                <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All products</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => handleSearch(0)} disabled={isPending} className="w-full md:w-auto">
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Searching...</> : <><Search className="w-4 h-4 mr-2" />Search</>}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>{result.total.toLocaleString()} transactions found</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
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
    { accessorKey: 'filename',        header: 'Filename',     cell: ({ row }) => <span className="text-sm font-mono">{row.getValue('filename')}</span> },
    { accessorKey: 'transactionType', header: 'Type',         cell: ({ row }) => <Badge variant="outline">{row.getValue('transactionType')}</Badge> },
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
    { accessorKey: 'rowCount',     header: 'Rows',    cell: ({ row }) => <span className="text-sm">{row.getValue('rowCount')}</span> },
    { accessorKey: 'successCount', header: 'Success', cell: ({ row }) => <Badge variant="default">{row.getValue('successCount')}</Badge> },
    { accessorKey: 'errorCount',   header: 'Errors',  cell: ({ row }) => { const c = row.getValue('errorCount') as number; return <Badge variant={c > 0 ? 'destructive' : 'outline'}>{c}</Badge> } },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <Badge variant={statusVariant(row.getValue('status'))}>{row.getValue('status')}</Badge>,
    },
    { accessorKey: 'uploadedBy',  header: 'Uploaded By', cell: ({ row }) => <span className="text-sm">{row.getValue('uploadedBy')}</span> },
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
              {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Searching...</> : <><Search className="w-4 h-4 mr-2" />Search</>}
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
  const filterData = Route.useLoaderData()
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
