import { type Table as TanStackTable } from '@tanstack/react-table'
import { ExportButton } from '@/components/shared/ExportButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SlidersHorizontal } from 'lucide-react'

interface TableToolbarProps<T> {
  table: TanStackTable<T>
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
  searchPlaceholder: string
  exportFilename?: string
  exportSheetName?: string
  exportData?: Record<string, unknown>[]
  showColumnVisibility?: boolean
}

export function TableToolbar<T>({
  table,
  globalFilter,
  onGlobalFilterChange,
  searchPlaceholder,
  exportFilename,
  exportSheetName,
  exportData,
  showColumnVisibility = true,
}: TableToolbarProps<T>) {
  return (
    <div className="flex items-center gap-3">
      <Input
        placeholder={searchPlaceholder}
        value={globalFilter}
        onChange={(e) => onGlobalFilterChange(e.target.value)}
        className="flex-1 md:max-w-sm"
      />
      {exportFilename && exportData && (
        <ExportButton
          filename={exportFilename}
          sheetName={exportSheetName}
          data={exportData}
        />
      )}
      {showColumnVisibility && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="hidden md:flex shrink-0">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((c) => c.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(v) => column.toggleVisibility(!!v)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
