import { 
  createContext, 
  useContext, 
  type ReactNode,  // ← Type-only import fixes verbatimModuleSyntax
  useMemo 
} from 'react'
import { createServerFn } from '@tanstack/react-start'
import { db } from '#/lib/db'

// Server function to fetch app settings
export const getAppSettingsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const settings = await db.appSetting.findMany({
      orderBy: { key: 'asc' }
    })
    return {
      appName:    settings.find(s => s.key === 'appName')?.value    || 'MIS Enterprise',
      dateFormat: settings.find(s => s.key === 'dateFormat')?.value || 'dd/MM/yyyy',
      settings:   Object.fromEntries(settings.map(s => [s.key, s.value])),
    }
  })

// Context type
interface AppSettingsContextType {
  appName: string
  dateFormat: string
  settings: Record<string, string>
}

// Create context
const AppSettingsContext = createContext<AppSettingsContextType | null>(null)

// Provider component - FIXED
export function AppSettingsProvider({
  children,
  appName: propAppName,
  dateFormat: propDateFormat,
  settings: propSettings,
}: {
  children: ReactNode
  appName?: string
  dateFormat?: string
  settings?: Record<string, string>
}) {
  const value = useMemo(() => ({
    appName:    propAppName    || 'MIS Enterprise',
    dateFormat: propDateFormat || 'dd/MM/yyyy',
    settings:   propSettings   || {},
  }), [propAppName, propDateFormat, propSettings])

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  )
}

// Custom hook to use app settings
export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return context
}
