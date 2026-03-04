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
import { Eye, RefreshCw, ClipboardList } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditLogRow = {
  id: string
  userId: string
  userEmail: string
  action: string
  resource: string
  resourceId: string | null
  oldValue: unknown
  newValue: unknown
  ip: string | null
  createdAt: Date
}

// ── Server Functions ──────────────────────────────────────────────────────────

const getPageData = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasAccess =
      context.isAdmin ||
      context.permissions.some((p) => p.resource === 'auditLogs' && p.actions.includes('view'))

    if (!hasAccess) return { authorized: false as const }

    const logs = await db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    return { authorized: true as const, logs }
  })

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_layout/audit-logs')({
  loader: () => getPageData(),
  component: AuditLogsPage,
})

// ── Action Badge ──────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const variant =
    action === 'create' ? 'default' :
    action === 'delete' ? 'destructive' :
    'secondary'
  return <Badge variant={variant}>{action}</Badge>
}

// ── Diff Dialog ───────────────────────────────────────────────────────────────

function DiffDialog({ log }: { log: AuditLogRow }) {
  const hasValues = log.oldValue || log.newValue
  if (!hasValues) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <ActionBadge action={log.action} />
            <span className="ml-2 font-mono text-sm">{log.resource}</span>
            {log.resourceId && <span className="ml-1 text-xs text-muted-foreground">#{log.resourceId.slice(-8)}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            By <strong>{log.userEmail}</strong> · {new Date(log.createdAt).toLocaleString('en-IN')}
            {log.ip && ` · ${log.ip}`}
          </p>
          {log.oldValue != null && (
            <div>
              <p className="text-xs font-medium mb-1 text-muted-foreground">Before</p>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">
                {JSON.stringify(log.oldValue as object, null, 2)}
              </pre>
            </div>
          )}
          {log.newValue != null && (
            <div>
              <p className="text-xs font-medium mb-1 text-muted-foreground">After</p>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">
                {JSON.stringify(log.newValue as object, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function AuditLogsPage() {
  const loaderData = Route.useLoaderData()
  const router = useRouter()

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  if (!loaderData.authorized) return <Unauthorized />
  const { logs } = loaderData

  function refresh() { router.invalidate() }

  const data: AuditLogRow[] = useMemo(() => logs.map((l) => ({
    id:         l.id,
    userId:     l.userId,
    userEmail:  l.userEmail,
    action:     l.action,
    resource:   l.resource,
    resourceId: l.resourceId,
    oldValue:   l.oldValue,
    newValue:   l.newValue,
    ip:         l.ip,
    createdAt:  l.createdAt,
  })), [logs])

  const exportData = useMemo(() => data.map((r) => ({
    User: r.userEmail,
    Action: r.action,
    Resource: r.resource,
    'Resource ID': r.resourceId ?? '',
    IP: r.ip ?? '',
    Date: new Date(r.createdAt).toLocaleString('en-IN'),
  })), [data])

  const columns: ColumnDef<AuditLogRow>[] = useMemo(() => [
    {
      accessorKey: 'action',
      header: 'Action',
      cell: ({ row }) => <ActionBadge action={row.getValue('action') as string} />,
    },
    {
      accessorKey: 'resource',
      header: ({ column }) => <SortableHeader column={column} label="Resource" />,
      cell: ({ row }) => (
        <span className="font-mono">{row.getValue('resource') as string}</span>
      ),
    },
    {
      accessorKey: 'userEmail',
      header: ({ column }) => <SortableHeader column={column} label="User" />,
      cell: ({ row }) => <span>{row.getValue('userEmail') as string}</span>,
    },
    {
      accessorKey: 'ip',
      header: 'IP',
      cell: ({ row }) => {
        const ip = row.getValue('ip') as string | null
        return ip
          ? <span className="text-muted-foreground font-mono">{ip}</span>
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
      header: () => <div className="text-right">Details</div>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DiffDialog log={row.original} />
        </div>
      ),
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
    initialState: { pagination: { pageSize: 25 } },
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground">All create, update, and delete actions by users</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <TableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            searchPlaceholder="Filter by user, action, or resource..."
            exportFilename="audit-logs"
            exportSheetName="Audit Logs"
            exportData={exportData}
          />

          <DataTable
            table={table}
            columns={columns}
            emptyMessage="No audit entries yet."
            mobileCard={(log) => (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
                    <ActionBadge action={log.action} />
                    <span className="font-mono text-sm truncate">{log.resource}</span>
                  </div>
                  <div className="shrink-0">
                    <DiffDialog log={log} />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm">{log.userEmail}</p>
                  {log.ip && (
                    <p className="text-xs text-muted-foreground font-mono">{log.ip}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  {new Date(log.createdAt).toLocaleString('en-IN')}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
