import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { adminMiddleware } from '#/middleware/admin'
import { db } from '#/lib/db'
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
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Unauthorized } from '@/components/shared/Unauthorized'

// ── Types ──────────────────────────────────────────────────────────

type PreviewRow = {
  sl: number | null
  date: string
  branch: string
  category: string
  product: string
  unit: string
  quantity: number
  price: number
  _rowIndex: number
  _error?: string
}

type UploadBatchRow = {
  id: string
  filename: string
  uploadedAt: Date
  status: string
  rowCount: number
  successCount: number
  errorCount: number
  dateFrom: Date
  dateTo: Date
  transactionType: string
  uploadedBy: string
  errorLog: string | null
}

// ── Server Functions ───────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    const [branches, factories, transactionTypes, recentBatches] = await Promise.all([
      db.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      db.factory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      db.transactionType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      db.uploadBatch.findMany({
        orderBy: { uploadedAt: 'desc' },
        take: 50,
        include: {
          transactionType: true,
          user: { select: { name: true } },
        },
      }),
    ])

    return {
      branches,
      factories,
      transactionTypes,
      recentBatches: recentBatches.map((b) => ({
        id: b.id,
        filename: b.filename,
        uploadedAt: b.uploadedAt,
        status: b.status,
        rowCount: b.rowCount,
        successCount: b.successCount,
        errorCount: b.errorCount,
        dateFrom: b.dateFrom,
        dateTo: b.dateTo,
        transactionType: b.transactionType.name,
        uploadedBy: b.user.name,
        errorLog: b.errorLog,
      })),
    }
  })

const processUpload = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator(
    (data: {
      filename: string
      transactionTypeId: string
      branchId: string | null
      factoryId: string | null
      dateFrom: string
      dateTo: string
      rows: {
        sl: number | null
        date: string
        branchName: string
        categoryName: string
        productName: string
        unit: string
        quantity: number
        price: number
      }[]
      replaceExisting: boolean
    }) => data
  )
  .handler(async ({ data, context }) => {
    return await db.$transaction(async (tx) => {
      // ── If replacing, delete existing batches for this exact scope ──
      if (data.replaceExisting) {
        await tx.uploadBatch.deleteMany({
          where: {
            transactionTypeId: data.transactionTypeId,
            branchId: data.branchId ?? null,
            dateFrom: new Date(data.dateFrom),
            dateTo: new Date(data.dateTo),
          },
        })
      }

      // ── Create UploadBatch ──
      const batch = await tx.uploadBatch.create({
        data: {
          filename: data.filename,
          uploadedBy: context.user.id,
          rowCount: data.rows.length,
          status: 'PROCESSING',
          dateFrom: new Date(data.dateFrom),
          dateTo: new Date(data.dateTo),
          transactionTypeId: data.transactionTypeId,
          branchId: data.branchId ?? null,
        },
      })

      // ── Pre-fetch lookups in bulk ──
      const uniqueCategoryNames = [...new Set(data.rows.map((r) => r.categoryName))]
      const uniqueBranchNames   = [...new Set(data.rows.map((r) => r.branchName).filter(Boolean))]

      const [existingCategories, existingBranches] = await Promise.all([
        tx.productCategory.findMany({ where: { name: { in: uniqueCategoryNames } } }),
        uniqueBranchNames.length > 0
          ? tx.branch.findMany({ where: { name: { in: uniqueBranchNames } } })
          : Promise.resolve([]),
      ])

      const categoryMap = new Map(existingCategories.map((c) => [c.name, c]))
      const branchMap   = new Map(existingBranches.map((b) => [b.name, b]))

      // ── Bulk-create missing categories (one query) ──
      const missingCategoryNames = uniqueCategoryNames.filter((n) => !categoryMap.has(n))
      if (missingCategoryNames.length > 0) {
        await tx.productCategory.createMany({
          data: missingCategoryNames.map((name) => ({ name })),
          skipDuplicates: true,
        })
        const newCategories = await tx.productCategory.findMany({
          where: { name: { in: missingCategoryNames } },
        })
        for (const c of newCategories) categoryMap.set(c.name, c)
      }

      // ── Bulk-create missing products (one query) ──
      // Collect all unique products needed across all rows
      const categoryIds = [...categoryMap.values()].map((c) => c.id)

      const existingProducts = await tx.product.findMany({
        where: { categoryId: { in: categoryIds } },
      })
      const productMap = new Map(existingProducts.map((p) => [`${p.name}::${p.categoryId}`, p]))

      // Identify products that don't exist yet
      const missingProducts: { name: string; categoryId: string; unit: string }[] = []
      for (const row of data.rows) {
        const category = categoryMap.get(row.categoryName)
        if (!category) continue
        const key = `${row.productName}::${category.id}`
        if (!productMap.has(key)) {
          missingProducts.push({ name: row.productName, categoryId: category.id, unit: row.unit || 'pcs' })
        }
      }

      if (missingProducts.length > 0) {
        await tx.product.createMany({ data: missingProducts, skipDuplicates: true })
        // Re-fetch so productMap has the new ids
        const newProducts = await tx.product.findMany({
          where: { categoryId: { in: categoryIds } },
        })
        for (const p of newProducts) productMap.set(`${p.name}::${p.categoryId}`, p)
      }

      // ── Process each row — transaction creates only, no more per-row product creates ──
      const errors: { row: number; error: string }[] = []
      let successCount = 0

      for (const row of data.rows) {
        try {
          const category = categoryMap.get(row.categoryName)
          if (!category) throw new Error(`Category not found: ${row.categoryName}`)

          const product = productMap.get(`${row.productName}::${category.id}`)
          if (!product) throw new Error(`Product not found: ${row.productName}`)

          // Resolve branch/factory
          let branchId:  string | null = null
          let factoryId: string | null = null

          if (data.branchId) {
            branchId = data.branchId
          } else if (data.factoryId) {
            factoryId = data.factoryId
          } else if (row.branchName) {
            const branch = branchMap.get(row.branchName)
            if (branch) branchId = branch.id
          }

          await tx.transaction.create({
            data: {
              sl: row.sl,
              date: new Date(row.date),
              branchId,
              factoryId,
              productId: product.id,
              transactionTypeId: data.transactionTypeId,
              quantity: row.quantity,
              price: row.price,
              uploadId: batch.id,
            },
          })

          successCount++
        } catch (e: any) {
          errors.push({ row: row.sl ?? 0, error: e.message })
        }
      }

      // ── Update batch status ──
      const status =
        errors.length === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL'

      await tx.uploadBatch.update({
        where: { id: batch.id },
        data: {
          status,
          successCount,
          errorCount: errors.length,
          errorLog: errors.length > 0 ? JSON.stringify(errors) : null,
        },
      })

      return { batchId: batch.id, status, successCount, errorCount: errors.length, errors }
    })
  })

const deleteBatch = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { batchId: string }) => data)
  .handler(async ({ data }) => {
    await db.uploadBatch.delete({ where: { id: data.batchId } })
    return { success: true }
  })

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/upload')({
  loader: () => getPageData(),
  errorComponent: () => <Unauthorized />,
  component: UploadPage,
})

// ── Helper ─────────────────────────────────────────────────────────

function parseExcelDate(value: any): string {
  if (!value) return ''
  // Excel serial date
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    if (date) {
      const y = date.y
      const m = String(date.m).padStart(2, '0')
      const d = String(date.d).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  }
  if (typeof value === 'string') {
    const parts = value.split(/[\/\-]/)
    if (parts.length === 3) {
      let y: string, m: string, d: string
      if (parts[0].length === 4) {
        // yyyy-mm-dd or yyyy/mm/dd
        ;[y, m, d] = parts
      } else if (parts[2].length === 4) {
        // dd/mm/yyyy (Indian format expected by this app)
        ;[d, m, y] = parts
      } else {
        return String(value)
      }
      const month = parseInt(m, 10)
      const day = parseInt(d, 10)
      if (month < 1 || month > 12 || day < 1 || day > 31) return String(value)
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
  }
  return String(value)
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    SUCCESS: { label: 'Success', className: 'bg-green-500/15 text-green-600 border-green-500/30' },
    PARTIAL: { label: 'Partial', className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
    FAILED:  { label: 'Failed',  className: 'bg-red-500/15 text-red-600 border-red-500/30' },
    PROCESSING: { label: 'Processing', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
    PENDING: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  }
  const s = map[status] ?? map.PENDING
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', s.className)}>
      {s.label}
    </Badge>
  )
}

// ── Main Page ──────────────────────────────────────────────────────

function UploadPage() {
  const router = useRouter()
  const { branches, factories, transactionTypes, recentBatches } = Route.useLoaderData()

  // ── Upload scope state ──
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [sourceType, setSourceType] = useState<'branch' | 'factory'>('branch')
  const [branchId, setBranchId] = useState('')
  const [factoryId, setFactoryId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // ── File + preview state ──
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [previewPage, setPreviewPage] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Upload state ──
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    status: string
    successCount: number
    errorCount: number
    errors: { row: number; error: string }[]
  } | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [replaceExisting, setReplaceExisting] = useState(false)

  // ── History page state ──
  const [historyPage, setHistoryPage] = useState(0)
  const HISTORY_PAGE_SIZE = 10
  const PREVIEW_PAGE_SIZE = 20

  const refresh = () => router.invalidate()

  // ── Parse Excel file ──
  const parseFile = useCallback((f: File) => {
    setParseError(null)
    setPreview([])
    setUploadResult(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: false })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        if (raw.length < 2) {
          setParseError('File appears empty or has no data rows.')
          return
        }

        // Detect header row — first row with content
        const headers = (raw[0] as any[]).map((h) => String(h).trim().toLowerCase())

        // Map expected columns flexibly
        const col = (names: string[]) => {
          for (const n of names) {
            const i = headers.findIndex((h) => h.includes(n))
            if (i !== -1) return i
          }
          return -1
        }

        const colSl       = col(['sl', 's.no', 'sno', 'serial'])
        const colDate     = col(['date'])
        const colBranch   = col(['branch'])
        const colCategory = col(['category', 'cat'])
        const colProduct  = col(['product', 'item', 'name'])
        const colUnit     = col(['unit', 'uom'])
        const colQty      = col(['qty', 'quantity', 'units'])
        const colPrice    = col(['price', 'rate', 'value', 'amount'])

        if (colProduct === -1) {
          setParseError('Could not find a "Product" or "Item" column in the file.')
          return
        }

        const rows: PreviewRow[] = []
        for (let i = 1; i < raw.length; i++) {
          const r = raw[i] as any[]
          const productVal = String(r[colProduct] ?? '').trim()
          if (!productVal) continue // skip blank rows

          const qty = colQty !== -1 ? parseFloat(r[colQty]) : 0
          const price = colPrice !== -1 ? parseFloat(r[colPrice]) : 0

          rows.push({
            sl: colSl !== -1 ? Number(r[colSl]) || null : null,
            date: colDate !== -1 ? parseExcelDate(r[colDate]) : '',
            branch: colBranch !== -1 ? String(r[colBranch] ?? '').trim() : '',
            category: colCategory !== -1 ? String(r[colCategory] ?? '').trim() : 'General',
            product: productVal,
            unit: colUnit !== -1 ? String(r[colUnit] ?? '').trim() : 'pcs',
            quantity: isNaN(qty) ? 0 : qty,
            price: isNaN(price) ? 0 : price,
            _rowIndex: i + 1,
            _error: (!productVal ? 'Missing product name' : undefined),
          })
        }

        if (rows.length === 0) {
          setParseError('No valid data rows found in the file.')
          return
        }

        setPreview(rows)
        setPreviewPage(0)

        // Auto-fill dates from data if not set
        const dates = rows.map((r) => r.date).filter(Boolean).sort()
        if (dates.length > 0) {
          if (!dateFrom) setDateFrom(dates[0])
          if (!dateTo) setDateTo(dates[dates.length - 1])
        }
      } catch (err: any) {
        setParseError(`Failed to parse file: ${err.message}`)
      }
    }
    reader.readAsArrayBuffer(f)
  }, [dateFrom, dateTo])

  const handleFileSelect = useCallback((f: File) => {
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      setParseError('Please upload an Excel (.xlsx, .xls) or CSV file.')
      return
    }
    setFile(f)
    parseFile(f)
  }, [parseFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }, [handleFileSelect])

  const clearFile = () => {
    setFile(null)
    setPreview([])
    setParseError(null)
    setUploadResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Submit upload ──
  async function handleUpload() {
    if (!file || preview.length === 0 || !transactionTypeId || !dateFrom || !dateTo) return

    setUploading(true)
    setUploadResult(null)

    try {
      const result = await processUpload({
        data: {
          filename: file.name,
          transactionTypeId,
          branchId: sourceType === 'branch' && branchId ? branchId : null,
          factoryId: sourceType === 'factory' && factoryId ? factoryId : null,
          dateFrom,
          dateTo,
          rows: preview.map((r) => ({
            sl: r.sl,
            date: r.date,
            branchName: r.branch,
            categoryName: r.category || 'General',
            productName: r.product,
            unit: r.unit,
            quantity: r.quantity,
            price: r.price,
          })),
          replaceExisting,
        },
      })

      setUploadResult(result)
      refresh()
      if (result.status === 'SUCCESS') clearFile()
    } catch (e: any) {
      setUploadResult({
        status: 'FAILED',
        successCount: 0,
        errorCount: preview.length,
        errors: [{ row: 0, error: e.message ?? 'Unknown error' }],
      })
    } finally {
      setUploading(false)
    }
  }

  const scopeValid =
    transactionTypeId &&
    dateFrom &&
    dateTo &&
    (sourceType === 'branch' ? !!branchId : !!factoryId)

  const canUpload = scopeValid && file && preview.length > 0 && !uploading

  // Paginated preview
  const previewRows = preview.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE
  )
  const previewPageCount = Math.ceil(preview.length / PREVIEW_PAGE_SIZE)

  // Paginated history
  const historyRows = recentBatches.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE
  )
  const historyPageCount = Math.ceil(recentBatches.length / HISTORY_PAGE_SIZE)

  const selectedTypeName = transactionTypes.find((t) => t.id === transactionTypeId)?.name ?? ''

  return (
    <div className="space-y-2">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Upload Data</h1>
        <p className="text-muted-foreground">
          Import Excel files to load transaction data into the system
        </p>
        <a href="/MIS_Upload_Template.xlsx" download>
          <Button variant="outline">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Download Template
          </Button>
        </a>
      </div>

      {/* ── Step 1: Scope ── */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </span>
            Define Upload Scope
          </CardTitle>
          <CardDescription>
            Select what this file contains — this determines how data is stored and how
            re-uploads replace existing data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 p-4">
          {/* Row 1: Transaction Type · Source · Branch/Factory */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {/* Transaction Type */}
            <div className="space-y-1.5">
              <Label>Transaction Type</Label>
              <Select value={transactionTypeId} onValueChange={setTransactionTypeId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} className="w-[--radix-select-trigger-width]">
                  {transactionTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex flex-col">
                        <span>{t.name}</span>
                        {t.description && (
                          <span className="text-xs text-muted-foreground">{t.description}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Source Type */}
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select
                value={sourceType}
                onValueChange={(v) => setSourceType(v as 'branch' | 'factory')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} className="w-[--radix-select-trigger-width]">
                  <SelectItem value="branch">Branch</SelectItem>
                  <SelectItem value="factory">Factory</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Branch or Factory selector */}
            {sourceType === 'branch' ? (
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select branch..." />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4} className="w-[--radix-select-trigger-width]">
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Factory</Label>
                <Select value={factoryId} onValueChange={setFactoryId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select factory..." />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4} className="w-[--radix-select-trigger-width]">
                    {factories.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Row 2: Date From · Date To */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {/* Replace existing toggle */}
          <div className="flex items-start gap-2 pt-1 p-3 rounded-lg border bg-muted/40">
            <input
              type="checkbox"
              id="replaceExisting"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <div>
              <label htmlFor="replaceExisting" className="text-sm font-medium cursor-pointer">
                Replace existing data for this scope
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                If checked, any previously uploaded data matching this transaction type,
                source, and date range will be deleted before inserting new data.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2: File Upload ── */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              2
            </span>
            Select File
          </CardTitle>
          <CardDescription>
            Upload an Excel (.xlsx, .xls) or CSV file. Expected columns: SL, Date, Branch,
            Category, Product, Unit, Quantity, Price
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 p-4">
          {!file ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'relative flex flex-col items-center justify-center gap-2',
                'h-40 rounded-xl border-2 border-dashed cursor-pointer',
                'transition-all duration-200',
                isDragging
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : 'border-border hover:border-primary/50 hover:bg-muted/40'
              )}
            >
              <FileSpreadsheet className={cn(
                'w-10 h-10 transition-colors',
                isDragging ? 'text-primary' : 'text-muted-foreground'
              )} />
              <div className="text-center">
                <p className="text-sm font-medium">
                  Drop your Excel file here, or{' '}
                  <span className="text-primary underline underline-offset-2">browse</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv supported</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFileSelect(f)
                }}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/40">
              <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                  {preview.length > 0 && ` · ${preview.length} rows parsed`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={clearFile}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {parseError && (
            <Alert variant="destructive">
              <XCircle className="w-4 h-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Step 3: Preview ── */}
      {preview.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    3
                  </span>
                  Preview — {preview.length} rows
                </CardTitle>
                <CardDescription>
                  Review parsed data before confirming upload
                  {selectedTypeName && ` · ${selectedTypeName}`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {preview.filter((r) => r._error).length > 0 && (
                  <Badge variant="outline" className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {preview.filter((r) => r._error).length} warnings
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 p-4">
            {/* Desktop table */}
            <div className="hidden md:block rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">SL</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row) => (
                    <TableRow
                      key={row._rowIndex}
                      className={row._error ? 'bg-yellow-500/5' : ''}
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {row.sl ?? row._rowIndex}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.date
                          ? new Date(row.date).toLocaleDateString('en-IN')
                          : <span className="text-destructive text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">{row.branch || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {row.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{row.product}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.unit}</TableCell>
                      <TableCell className="text-right text-sm">
                        {row.quantity.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        ₹{row.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-2 md:hidden">
              {previewRows.map((row) => (
                <div
                  key={row._rowIndex}
                  className={cn(
                    'rounded-lg border p-3 space-y-1.5',
                    row._error ? 'border-yellow-500/30 bg-yellow-500/5' : 'bg-card'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm">{row.product}</p>
                    <Badge variant="secondary" className="text-xs shrink-0">{row.category}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Date: {row.date ? new Date(row.date).toLocaleDateString('en-IN') : '—'}</span>
                    <span>Branch: {row.branch || '—'}</span>
                    <span>Qty: {row.quantity} {row.unit}</span>
                    <span>Price: ₹{row.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Preview pagination */}
            {previewPageCount > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {previewPage * PREVIEW_PAGE_SIZE + 1}–
                  {Math.min((previewPage + 1) * PREVIEW_PAGE_SIZE, preview.length)} of{' '}
                  {preview.length} rows
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewPage((p) => p - 1)}
                    disabled={previewPage === 0}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewPage((p) => p + 1)}
                    disabled={previewPage >= previewPageCount - 1}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Upload result */}
            {uploadResult && (
              <Alert
                variant={uploadResult.status === 'SUCCESS' ? 'default' : 'destructive'}
                className={uploadResult.status === 'SUCCESS'
                  ? 'border-green-500/30 bg-green-500/10 text-green-700'
                  : uploadResult.status === 'PARTIAL'
                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700'
                  : ''}
              >
                {uploadResult.status === 'SUCCESS' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span>
                    {uploadResult.status === 'SUCCESS' &&
                      `All ${uploadResult.successCount} rows uploaded successfully.`}
                    {uploadResult.status === 'PARTIAL' &&
                      `${uploadResult.successCount} rows succeeded, ${uploadResult.errorCount} failed.`}
                    {uploadResult.status === 'FAILED' &&
                      `Upload failed: ${uploadResult.errors[0]?.error}`}
                  </span>
                  {uploadResult.errorCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs shrink-0"
                      onClick={() => setShowErrors((s) => !s)}
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      {showErrors ? 'Hide' : 'Show'} errors
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {showErrors && uploadResult?.errors && (
              <div className="rounded-lg border bg-destructive/5 p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {uploadResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive">
                    Row {e.row}: {e.error}
                  </p>
                ))}
              </div>
            )}

            {/* Confirm upload button */}
            <div className="flex items-center gap-3 pt-1">
              {!scopeValid && (
                <p className="text-xs text-muted-foreground">
                  Complete the scope settings above before uploading
                </p>
              )}
              <div className="flex-1" />
              <Button
                onClick={handleUpload}
                disabled={!canUpload}
                className="min-w-32"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    {replaceExisting ? 'Replace & Upload' : 'Confirm Upload'}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Upload History ── */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Upload History</CardTitle>
              <CardDescription>
                {recentBatches.length} recent upload{recentBatches.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 p-4">
          {recentBatches.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No uploads yet.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date Range</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead>Uploaded At</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyRows.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="max-w-48">
                          <p className="text-sm font-medium truncate">{b.filename}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{b.transactionType}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(b.dateFrom).toLocaleDateString('en-IN')} –{' '}
                          {new Date(b.dateTo).toLocaleDateString('en-IN')}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <span className="text-green-600 font-medium">{b.successCount}</span>
                            {b.errorCount > 0 && (
                              <span className="text-destructive"> / {b.errorCount} err</span>
                            )}
                            <span className="text-muted-foreground"> of {b.rowCount}</span>
                          </div>
                        </TableCell>
                        <TableCell>{statusBadge(b.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.uploadedBy}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(b.uploadedAt).toLocaleDateString('en-IN')}{' '}
                          {new Date(b.uploadedAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-7 w-7 p-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Upload Batch</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete{' '}
                                  <strong>{b.rowCount} transactions</strong> from{' '}
                                  <strong>{b.filename}</strong>. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  onClick={async () => {
                                    await deleteBatch({ data: { batchId: b.id } })
                                    refresh()
                                  }}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {historyRows.map((b) => (
                  <div key={b.id} className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{b.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(b.uploadedAt).toLocaleDateString('en-IN')}{' '}
                          {new Date(b.uploadedAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                      {statusBadge(b.status)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs">{b.transactionType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(b.dateFrom).toLocaleDateString('en-IN')} –{' '}
                        {new Date(b.dateTo).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        <span className="text-green-600 font-medium">{b.successCount}</span>
                        {b.errorCount > 0 && (
                          <span className="text-destructive"> / {b.errorCount} err</span>
                        )}{' '}
                        of {b.rowCount} rows · {b.uploadedBy}
                      </p>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 w-7 p-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Upload Batch</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete{' '}
                              <strong>{b.rowCount} transactions</strong> from{' '}
                              <strong>{b.filename}</strong>. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-white hover:bg-destructive/90"
                              onClick={async () => {
                                await deleteBatch({ data: { batchId: b.id } })
                                refresh()
                              }}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>

              {/* History pagination */}
              {historyPageCount > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {historyPage + 1} of {historyPageCount}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((p) => p - 1)}
                      disabled={historyPage === 0}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((p) => p + 1)}
                      disabled={historyPage >= historyPageCount - 1}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
