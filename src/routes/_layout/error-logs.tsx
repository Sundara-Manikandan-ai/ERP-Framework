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
import { Unauthorized } from '@/components/shared/Unauthorized'
import { DataTable } from '@/components/shared/DataTable'
import { TableToolbar } from '@/components/shared/TableToolbar'
import { SortableHeader } from '@/components/shared/SortableHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Trash2, Eye, RefreshCw, AlertTriangle } from 'lucide-react'
import { getErrorMessage } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type ErrorLogRow = {
  id: string
  message: string
  stack: string | null
  url: string | null
  userId: string | null
  userEmail: string | null
  source: string
  context: unknown
  createdAt: Date
}

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'errorLogs' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const logs = await db.errorLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return { authorized: true as const, logs }
  })

const clearErrorLogs = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .handler(async () => {
    await db.errorLog.deleteMany({})
    return { success: true }
  })

const deleteErrorLog = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await db.errorLog.delete({ where: { id: data.id } })
    return { success: true }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/error-logs')({
  loader: () => getPageData(),
  component: ErrorLogsPage,
})

// ── Detail Dialog ─────────────────────────────────────────────────────────────

function DetailDialog({ log }: { log: ErrorLogRow }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-mono break-all">{log.message}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={log.source === 'client' ? 'secondary' : 'default'}>{log.source}</Badge>
            {log.userEmail && <Badge variant="outline">{log.userEmail}</Badge>}
            {log.url && <span className="text-xs text-muted-foreground break-all">{log.url}</span>}
          </div>
          {log.stack && (
            <div>
              <p className="text-xs font-medium mb-1 text-muted-foreground">Stack Trace</p>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64 whitespace-pre-wrap break-all">
                {log.stack}
              </pre>
            </div>
          )}
          {log.context != null && (
            <div>
              <p className="text-xs font-medium mb-1 text-muted-foreground">Context</p>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-32">
                {JSON.stringify(log.context as object, null, 2)}
              </pre>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {new Date(log.createdAt).toLocaleString('en-IN')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ErrorLogsPage() {
  const loaderData = Route.useLoaderData()
  const router = useRouter()

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  if (!loaderData.authorized) return <Unauthorized />
  const { logs } = loaderData

  function refresh() { router.invalidate() }

  async function handleClearAll() {
    if (!confirm('Delete all error logs? This cannot be undone.')) return
    setClearError(null)
    setClearing(true)
    try {
      await clearErrorLogs()
      refresh()
    } catch (e: unknown) {
      setClearError(getErrorMessage(e, 'Failed to clear logs.'))
    } finally {
      setClearing(false)
    }
  }

  const data: ErrorLogRow[] = useMemo(() => logs.map((l) => ({
    id:        l.id,
    message:   l.message,
    stack:     l.stack,
    url:       l.url,
    userId:    l.userId,
    userEmail: l.userEmail,
    source:    l.source,
    context:   l.context,
    createdAt: l.createdAt,
  })), [logs])

  const columns: ColumnDef<ErrorLogRow>[] = useMemo(() => [
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => {
        const source = row.getValue('source') as string
        return (
          <Badge variant={source === 'client' ? 'secondary' : 'default'}>
            {source}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'message',
      header: ({ column }) => <SortableHeader column={column} label="Message" />,
      cell: ({ row }) => (
        <span className="font-mono line-clamp-2 max-w-xs block">
          {row.getValue('message') as string}
        </span>
      ),
    },
    {
      accessorKey: 'userEmail',
      header: ({ column }) => <SortableHeader column={column} label="User" />,
      cell: ({ row }) => {
        const email = row.getValue('userEmail') as string | null
        return email
          ? <span>{email}</span>
          : <span className="text-muted-foreground italic">anonymous</span>
      },
    },
    {
      accessorKey: 'url',
      header: 'URL',
      cell: ({ row }) => {
        const url = row.getValue('url') as string | null
        return url
          ? <span className="text-muted-foreground truncate max-w-32 block">{url}</span>
          : <span className="text-muted-foreground italic">—</span>
      },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <SortableHeader column={column} label="Time" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {new Date(row.getValue('createdAt') as Date).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Actions</div>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const log = row.original
        return (
          <div className="flex items-center justify-end gap-1">
            <DetailDialog log={log} />
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await deleteErrorLog({ data: { id: log.id } })
                refresh()
              }}
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        )
      },
    },
  ], [])

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
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Error Logs</h1>
          <p className="text-muted-foreground">Server and client errors captured automatically</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4 mr-2" />Refresh
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClearAll} disabled={clearing || data.length === 0}>
            {clearing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Clear All
          </Button>
        </div>
      </div>

      {clearError && (
        <Alert variant="destructive">
          <AlertDescription>{clearError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-2 pt-4">
          <TableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            searchPlaceholder="Search by message, user, source..."
          />

          <DataTable
            table={table}
            columns={columns}
            emptyMessage="No errors logged."
            mobileCard={(log) => (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Badge variant={log.source === 'client' ? 'secondary' : 'default'}>
                      {log.source}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <DetailDialog log={log} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await deleteErrorLog({ data: { id: log.id } })
                        refresh()
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm font-mono line-clamp-2 break-all">{log.message}</p>
                {log.userEmail && (
                  <p className="text-xs text-muted-foreground">{log.userEmail}</p>
                )}
                <div className="flex items-center justify-between">
                  {log.url ? (
                    <span className="text-xs text-muted-foreground truncate max-w-[60%]">{log.url}</span>
                  ) : <span />}
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
