import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ExportButton } from '@/components/shared/ExportButton'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { db } from '#/lib/db'
import { authMiddleware } from '#/middleware/auth'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Eye, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
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

  const [sorting, setSorting]           = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

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

  const filtered = useMemo(() => {
    if (!globalFilter) return data
    const q = globalFilter.toLowerCase()
    return data.filter((r) =>
      r.userEmail.toLowerCase().includes(q) ||
      r.action.toLowerCase().includes(q) ||
      r.resource.toLowerCase().includes(q)
    )
  }, [data, globalFilter])

  const columns: ColumnDef<AuditLogRow>[] = useMemo(() => [
    {
      accessorKey: 'action',
      header: 'Action',
      cell: ({ row }) => <ActionBadge action={row.getValue('action') as string} />,
    },
    {
      accessorKey: 'resource',
      header: 'Resource',
      cell: ({ row }) => (
        <span className="text-sm font-mono">{row.getValue('resource') as string}</span>
      ),
    },
    {
      accessorKey: 'userEmail',
      header: 'User',
      cell: ({ row }) => <span className="text-sm">{row.getValue('userEmail') as string}</span>,
    },
    {
      accessorKey: 'ip',
      header: 'IP',
      cell: ({ row }) => {
        const ip = row.getValue('ip') as string | null
        return ip
          ? <span className="text-xs text-muted-foreground font-mono">{ip}</span>
          : <span className="text-xs text-muted-foreground italic">—</span>
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Time',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {new Date(row.getValue('createdAt') as Date).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Details</div>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DiffDialog log={row.original} />
        </div>
      ),
    },
  ], [])

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
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
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
          <CardDescription>{filtered.length} of {data.length} entries (last 1,000)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Filter by user, action, or resource..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="max-w-sm"
            />
            <ExportButton
              filename="audit-logs"
              sheetName="Audit Logs"
              data={filtered.map((r) => ({
                User: r.userEmail,
                Action: r.action,
                Resource: r.resource,
                'Resource ID': r.resourceId ?? '',
                IP: r.ip ?? '',
                Date: new Date(r.createdAt).toLocaleString('en-IN'),
              }))}
            />
          </div>

          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-8 text-center">No audit entries yet.</p>
          ) : (
            <>
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
                        <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                          No matching entries.
                        </TableCell>
                      </TableRow>
                    )}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
