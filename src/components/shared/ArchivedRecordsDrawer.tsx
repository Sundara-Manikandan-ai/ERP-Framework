import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DeleteDialog } from '@/components/shared/DeleteDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Archive, RotateCcw } from 'lucide-react'

export type ArchivedRecord = {
  id: string
  name: string
  deletedAt: Date
  deletedBy?: string | null
  extra?: string | null
}

interface ArchivedRecordsDrawerProps {
  title: string
  records: ArchivedRecord[]
  onRestore: (id: string) => Promise<void>
  onPermanentDelete: (id: string) => Promise<void>
  onOpenChange?: (open: boolean) => void
}

export function ArchivedRecordsDrawer({
  title,
  records,
  onRestore,
  onPermanentDelete,
  onOpenChange,
}: ArchivedRecordsDrawerProps) {
  const [open, setOpen]           = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  function handleOpenChange(val: boolean) {
    setOpen(val)
    setError(null)
    onOpenChange?.(val)
  }

  async function handleRestore(id: string) {
    setError(null)
    setLoadingId(id)
    try {
      await onRestore(id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to restore record.')
    } finally {
      setLoadingId(null)
    }
  }

  async function handlePermanentDelete(id: string) {
    setError(null)
    setLoadingId(id)
    try {
      await onPermanentDelete(id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to permanently delete record.')
    } finally {
      setLoadingId(null)
    }
  }

  function formatDate(date: Date) {
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Archive className="w-4 h-4 mr-2" />
          Archived
          {records.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {records.length}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader className="mb-4 shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Archive className="w-5 h-5" />
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Archive className="w-10 h-10 opacity-30" />
              <p className="text-sm">No archived records</p>
            </div>
          ) : (
            <>
              {/* ── Desktop — table ───────────────────────────────────── */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Deleted On</TableHead>
                      <TableHead>Deleted By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          <p className="font-medium">{record.name}</p>
                          {record.extra && (
                            <p className="text-xs text-muted-foreground">{record.extra}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(record.deletedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {record.deletedBy ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={loadingId === record.id}
                              onClick={() => handleRestore(record.id)}
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              Restore
                            </Button>
                            <DeleteDialog
                              title="Permanently Delete"
                              description={
                                <>
                                  Permanently delete <strong>{record.name}</strong>? This
                                  cannot be undone and all associated data will be lost.
                                </>
                              }
                              onConfirm={() => handlePermanentDelete(record.id)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile — cards ────────────────────────────────────── */}
              <div className="flex flex-col gap-3 md:hidden">
                {records.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-lg border bg-card p-4 space-y-3"
                  >
                    <div>
                      <p className="font-medium">{record.name}</p>
                      {record.extra && (
                        <p className="text-xs text-muted-foreground mt-0.5">{record.extra}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Deleted {formatDate(record.deletedAt)}</span>
                      {record.deletedBy && <span>by {record.deletedBy}</span>}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={loadingId === record.id}
                        onClick={() => handleRestore(record.id)}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                        Restore
                      </Button>
                      <DeleteDialog
                        title="Permanently Delete"
                        description={
                          <>
                            Permanently delete <strong>{record.name}</strong>? This
                            cannot be undone and all associated data will be lost.
                          </>
                        }
                        onConfirm={() => handlePermanentDelete(record.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}