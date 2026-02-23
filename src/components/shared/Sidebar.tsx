import { Link, useLocation } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Building2,
  FolderOpen,
  X,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { UserAccess } from '#/lib/rbac'
import { getIcon } from '@/routes/_layout/pages'

// ── Types ─────────────────────────────────────────────────────────────────────

type PageEntry = {
  resource: string
  label:    string
  path:     string
  icon:     string
  group:    string
}

type SidebarProps = {
  isAdmin:     boolean
  permissions: UserAccess['permissions'] | undefined
  pages:       PageEntry[]
  appName:     string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function canView(
  isAdmin: boolean,
  permissions: UserAccess['permissions'] | undefined,
  resource: string,
): boolean {
  if (isAdmin) return true
  if (!permissions) return false
  return permissions.find((p) => p.resource === resource)?.actions.includes('view') ?? false
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ isAdmin, permissions, pages, appName }: SidebarProps) {
  const [collapsed, setCollapsed]         = useState(false)
  const [openGroups, setOpenGroups]       = useState<Record<string, boolean>>({})
  const [sheetGroup, setSheetGroup]       = useState<string | null>(null)
  const location = useLocation()

  function toggleGroup(name: string) {
    if (collapsed) {
      setCollapsed(false)
      setOpenGroups((prev) => ({ ...prev, [name]: true }))
    } else {
      setOpenGroups((prev) => ({ ...prev, [name]: !prev[name] }))
    }
  }

  // Split pages: no group = top-level, has group = submenu
  // Then filter by permissions
  const visiblePages = useMemo(
    () => pages.filter((p) => canView(isAdmin, permissions, p.resource)),
    [pages, isAdmin, permissions]
  )

  const topLevelPages = visiblePages.filter((p) => !p.group)

  // Collect unique group names preserving order, with their pages
  const groups = useMemo(() => {
    const map = new Map<string, PageEntry[]>()
    for (const p of visiblePages) {
      if (!p.group) continue
      if (!map.has(p.group)) map.set(p.group, [])
      map.get(p.group)!.push(p)
    }
    return Array.from(map.entries()).map(([name, groupPages]) => ({ name, pages: groupPages }))
  }, [visiblePages])

  const linkBase = cn(
    'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium',
    'text-[oklch(0.90_0.01_290)]',
    'hover:bg-[oklch(0.55_0.10_290/0.25)] hover:text-white transition-colors'
  )
  const activeClass = 'bg-[oklch(0.55_0.10_290/0.35)] text-white'

  function NavItem({ page }: { page: PageEntry }) {
    const Icon = getIcon(page.icon)
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            to={page.path as any}
            activeProps={{ className: activeClass }}
            className={cn(linkBase, collapsed && 'justify-center')}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>{page.label}</span>}
          </Link>
        </TooltipTrigger>
        {collapsed && (
          <TooltipContent side="right">{page.label}</TooltipContent>
        )}
      </Tooltip>
    )
  }

  function isGroupActive(groupPages: PageEntry[]) {
    return groupPages.some(
      (p) => p.path !== '/' && location.pathname.startsWith(p.path)
    )
  }

  return (
    <>
      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          'hidden md:flex flex-col h-screen border-r transition-all duration-300 shrink-0',
          'bg-[oklch(0.28_0.08_290/0.65)] backdrop-blur-md',
          'border-[oklch(0.60_0.18_290/0.25)]',
          collapsed ? 'w-12' : 'w-52'
        )}
      >
        {/* Logo */}
        <div className={cn(
          'flex items-center gap-2 h-9 shrink-0',
          collapsed ? 'justify-center px-0' : 'px-3'
        )}>
          <Building2 className="w-5 h-5 text-primary shrink-0" />
          {!collapsed && (
            <span className="font-semibold text-sm tracking-tight text-white truncate">
              {appName}
            </span>
          )}
        </div>

        <Separator className="opacity-30" />

        {/* Nav */}
        <nav className="flex-1 px-1.5 py-2 space-y-0.5 overflow-y-auto">

          {/* Top-level items (no group) */}
          {topLevelPages.map((page) => (
            <NavItem key={page.resource} page={page} />
          ))}

          {/* Dynamic submenu groups */}
          {groups.map(({ name, pages: groupPages }) => {
            const isOpen = !!openGroups[name]
            const active = isGroupActive(groupPages)
            return (
              <div key={name}>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => toggleGroup(name)}
                      className={cn(
                        linkBase,
                        'w-full',
                        active && 'text-white',
                        collapsed && 'justify-center'
                      )}
                    >
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left">{capitalize(name)}</span>
                          <ChevronDown className={cn(
                            'w-3 h-3 transition-transform',
                            isOpen && 'rotate-180'
                          )} />
                        </>
                      )}
                    </button>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">{capitalize(name)} — click to expand</TooltipContent>
                  )}
                </Tooltip>

                {!collapsed && isOpen && (
                  <div className="mt-0.5 space-y-0.5 pl-2.5">
                    {groupPages.map((page) => {
                      const Icon = getIcon(page.icon)
                      return (
                        <Link
                          key={page.resource}
                          to={page.path as any}
                          activeProps={{ className: activeClass }}
                          className={linkBase}
                        >
                          <Icon className="w-3 h-3 shrink-0" />
                          <span>{page.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <Separator className="opacity-30" />

        {/* Collapse toggle */}
        <div className="p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 justify-center text-[oklch(0.90_0.01_290)] hover:bg-[oklch(0.55_0.10_290/0.25)]"
            onClick={() => setCollapsed((c) => {
              if (!c) setOpenGroups({})
              return !c
            })}
          >
            {collapsed
              ? <ChevronRight className="w-3.5 h-3.5" />
              : <ChevronLeft  className="w-3.5 h-3.5" />
            }
          </Button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <nav className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-50',
        'flex items-center justify-around',
        'h-14 px-2 border-t',
        'bg-[oklch(0.28_0.08_290/0.90)] backdrop-blur-md',
        'border-[oklch(0.60_0.18_290/0.3)]'
      )}>
        {topLevelPages.map((page) => {
          const Icon = getIcon(page.icon)
          return (
            <Link
              key={page.resource}
              to={page.path as any}
              activeProps={{ className: 'text-white' }}
              className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-md text-[oklch(0.75_0.01_290)] hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4" />
              <span className="text-[9px] font-medium">{page.label}</span>
            </Link>
          )
        })}

        {groups.map(({ name, pages: groupPages }) => {
          const active = isGroupActive(groupPages)
          return (
            <button
              key={name}
              onClick={() => setSheetGroup(name)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 rounded-md transition-colors',
                active
                  ? 'text-white'
                  : 'text-[oklch(0.75_0.01_290)] hover:text-white'
              )}
            >
              <div className="relative">
                <FolderOpen className="w-4 h-4" />
                <ChevronDown className="absolute -bottom-1.5 -right-2 w-2.5 h-2.5 opacity-60" />
              </div>
              <span className="text-[9px] font-medium mt-0.5">{capitalize(name)}</span>
            </button>
          )
        })}
      </nav>

      {/* ── Mobile sheet for submenu groups ────────────────────────────────── */}
      {sheetGroup && (() => {
        const group = groups.find((g) => g.name === sheetGroup)
        if (!group) return null
        return (
          <>
            <div
              className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setSheetGroup(null)}
            />
            <div className={cn(
              'md:hidden fixed bottom-14 left-0 right-0 z-50',
              'bg-[oklch(0.28_0.08_290/0.96)] backdrop-blur-md',
              'border-t border-[oklch(0.60_0.18_290/0.3)]',
              'rounded-t-xl pb-1',
              'animate-in slide-in-from-bottom-2 duration-200'
            )}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[oklch(0.60_0.18_290/0.2)]">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-[oklch(0.75_0.01_290)]" />
                  <span className="text-xs font-semibold text-white">{capitalize(group.name)}</span>
                </div>
                <button
                  onClick={() => setSheetGroup(null)}
                  className="text-[oklch(0.75_0.01_290)] hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <nav className="px-2.5 pt-1.5 pb-2 space-y-0.5">
                {group.pages.map((page) => {
                  const Icon = getIcon(page.icon)
                  return (
                    <Link
                      key={page.resource}
                      to={page.path as any}
                      onClick={() => setSheetGroup(null)}
                      activeProps={{ className: activeClass }}
                      className={cn(linkBase, 'w-full')}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{page.label}</span>
                    </Link>
                  )
                })}
              </nav>
            </div>
          </>
        )
      })()}
    </>
  )
}
