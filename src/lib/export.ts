import * as XLSX from 'xlsx'

type ExportFormat = 'xlsx' | 'csv'

interface ExportOptions {
  filename: string
  sheetName?: string
  format?: ExportFormat
}

/**
 * Export an array of objects to Excel or CSV and trigger a download.
 * Works in the browser only.
 */
export function exportToFile(
  data: Record<string, unknown>[],
  { filename, sheetName = 'Sheet1', format = 'xlsx' }: ExportOptions,
) {
  if (data.length === 0) return

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  const extension = format === 'csv' ? 'csv' : 'xlsx'
  const bookType = format === 'csv' ? 'csv' : 'xlsx'

  XLSX.writeFile(wb, `${filename}.${extension}`, { bookType })
}
