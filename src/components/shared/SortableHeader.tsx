import { type Column } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

interface SortableHeaderProps<T> {
  column: Column<T, unknown>
  label: string
}

export function SortableHeader<T>({ column, label }: SortableHeaderProps<T>) {
  return (
    <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
      {label}
      {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 w-3 h-3" />
        : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 w-3 h-3" />
        : <ArrowUpDown className="ml-2 w-3 h-3" />}
    </Button>
  )
}
