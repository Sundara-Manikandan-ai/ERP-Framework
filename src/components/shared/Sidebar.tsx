import { Link, useLocation } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Building2,
  FolderOpen,
  FolderClosed,
} from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { UserAccess } from '#/lib/rbac'
import { getIcon } from '@/lib/icons'

type PageEntry = {
  resource: string
  label: string
  path: string
  icon: string
  group: string
}

type SidebarProps = {
  isAdmin: boolean
  permissions: UserAccess['permissions'] | undefined
  pages: PageEntry[]
  appName: string
}

function canView(
  isAdmin: boolean,
  permissions: UserAccess['permissions'] | undefined,
  resource: string,
): boolean {
  if (isAdmin) return true
  if (!permissions) return false
  return (
    permissions.find((p) => p.resource === resource)?.actions.includes('view') ??
    false
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Collapsed tooltip (portal) ────────────────────────────────────────────────

function CollapsedTooltip({ label, anchorEl }: { label: string; anchorEl: HTMLElement | null }) {
  const [top, setTop] = useState(0)

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect()
      setTop(rect.top + rect.height / 2)
    }
  }, [anchorEl])

  if (!anchorEl) return null

  return createPortal(
    <div
      style={{ top, zIndex: 9999, transform: 'translateY(-50%)' }}
      className={cn(
        'fixed left-[58px] pointer-events-none',
        'px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap',
        'bg-[oklch(0.18_0.08_160)] text-white shadow-lg',
        'border border-[oklch(0.55_0.15_160/0.40)]',
      )}
    >
      {label}
    </div>,
    document.body
  )
}

// ── Collapsed group popout (portal) ──────────────────────────────────────────

function CollapsedGroupPopout({
  name,
  pages,
  activeClass,
  linkBase,
  onClose,
  anchorRef,
}: {
  name: string
  pages: PageEntry[]
  activeClass: string
  linkBase: string
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}) {
  const popoutRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setTop(rect.top)
    }
  }, [anchorRef])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        popoutRef.current && !popoutRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  return createPortal(
    <div
      ref={popoutRef}
      style={{ top, zIndex: 9999 }}
      className={cn(
        'fixed left-14 min-w-44',
        'rounded-md shadow-xl border py-1',
        'bg-[oklch(0.22_0.08_160/0.95)] backdrop-blur-md',
        'border-[oklch(0.55_0.15_160/0.40)]',
      )}
    >
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[oklch(0.65_0.08_160)]">
        {capitalize(name)}
      </p>
      {pages.map((page) => {
        const Icon = getIcon(page.icon)
        return (
          <Link
            key={page.resource}
            to={page.path as any}
            onClick={onClose}
            activeProps={{ className: activeClass }}
            className={cn(linkBase, 'rounded-none px-3')}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{page.label}</span>
          </Link>
        )
      })}
    </div>,
    document.body
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({
  isAdmin,
  permissions,
  pages,
  appName,
}: SidebarProps) {
  const [collapsed, setCollapsed]     = useState(false)
  const [openGroups, setOpenGroups]   = useState<Record<string, boolean>>({})
  const [sheetGroup, setSheetGroup]   = useState<string | null>(null)
  const [popoutGroup, setPopoutGroup] = useState<string | null>(null)
  const [hoveredItem, setHoveredItem] = useState<{ label: string; el: HTMLElement } | null>(null)

  const groupRefs = useRef<Record<string, React.RefObject<HTMLButtonElement | null>>>({})
  const location  = useLocation()

  function getGroupRef(name: string) {
    if (!groupRefs.current[name]) {
      groupRefs.current[name] = { current: null } as React.RefObject<HTMLButtonElement | null>
    }
    return groupRefs.current[name]
  }

  function toggleGroup(name: string) {
    if (collapsed) {
      setPopoutGroup((prev) => (prev === name ? null : name))
    } else {
      setOpenGroups((prev) => ({ ...prev, [name]: !prev[name] }))
    }
  }

  useEffect(() => {
    if (!collapsed) {
      setPopoutGroup(null)
      setHoveredItem(null)
    }
  }, [collapsed])

  function isGroupActive(groupPages: PageEntry[]) {
    return groupPages.some(
      (p) => p.path !== '/' && location.pathname.startsWith(p.path)
    )
  }

  const visiblePages = useMemo(
    () => pages.filter((p) => canView(isAdmin, permissions, p.resource)),
    [pages, isAdmin, permissions]
  )

  const topLevelPages = visiblePages.filter((p) => !p.group)

  const groups = useMemo(() => {
    const map = new Map<string, PageEntry[]>()
    for (const p of visiblePages) {
      if (!p.group) continue
      if (!map.has(p.group)) map.set(p.group, [])
      map.get(p.group)!.push(p)
    }
    return Array.from(map.entries()).map(([name, pages]) => ({ name, pages }))
  }, [visiblePages])

  const linkBase =
    'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-[oklch(0.90_0.01_160)] hover:bg-[oklch(0.52_0.12_160/0.30)] hover:text-white transition-colors'

  const activeClass =
    'bg-[oklch(0.52_0.12_160/0.40)] text-white'

  return (
    <>
      {/* ================= DESKTOP ================= */}
      <aside
        className={cn(
          'hidden md:flex flex-col h-screen border-r transition-all duration-300 shrink-0',
          'bg-[oklch(0.22_0.08_160/0.75)] backdrop-blur-md',
          'border-[oklch(0.55_0.15_160/0.30)]',
          collapsed ? 'w-14' : 'w-56'
        )}
      >
        <div className="flex items-center gap-2 h-10 px-4 shrink-0">
          <Building2 className="w-5 h-5 text-primary shrink-0" />
          {!collapsed && (
            <span className="font-semibold text-sm text-white truncate">
              {appName}
            </span>
          )}
        </div>

        <Separator className="opacity-30" />

        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
          {/* Top level */}
          {topLevelPages.map((page) => {
            const Icon = getIcon(page.icon)
            return (
              <Link
                key={page.resource}
                to={page.path as any}
                activeProps={{ className: activeClass }}
                className={cn(linkBase, collapsed && 'justify-center')}
                onMouseEnter={(e) => collapsed && setHoveredItem({ label: page.label, el: e.currentTarget })}
                onMouseLeave={() => collapsed && setHoveredItem(null)}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{page.label}</span>}
              </Link>
            )
          })}

          {/* Groups */}
          {groups.map(({ name, pages: groupPages }) => {
            const isOpen   = !!openGroups[name]
            const active   = isGroupActive(groupPages)
            const isPopout = popoutGroup === name
            const ref      = getGroupRef(name)

            const FolderIcon = (!collapsed && isOpen) || (collapsed && isPopout)
              ? FolderOpen
              : FolderClosed

            return (
              <div key={name} className="relative">
                <button
                  ref={ref}
                  onClick={() => toggleGroup(name)}
                  onMouseEnter={(e) => collapsed && setHoveredItem({ label: capitalize(name), el: e.currentTarget })}
                  onMouseLeave={() => collapsed && setHoveredItem(null)}
                  className={cn(
                    linkBase,
                    'w-full',
                    (active || isPopout) && 'text-white',
                    collapsed && 'justify-center'
                  )}
                >
                  <FolderIcon className="w-4 h-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left">{capitalize(name)}</span>
                      <ChevronDown
                        className={cn(
                          'w-3 h-3 transition-transform',
                          isOpen && 'rotate-180'
                        )}
                      />
                    </>
                  )}
                </button>

                {/* Expanded inline submenu */}
                {!collapsed && isOpen && (
                  <div className="mt-1 space-y-1 pl-4">
                    {groupPages.map((page) => {
                      const Icon = getIcon(page.icon)
                      return (
                        <Link
                          key={page.resource}
                          to={page.path as any}
                          activeProps={{ className: activeClass }}
                          className={linkBase}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span>{page.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}

                {/* Collapsed popout submenu — rendered via portal */}
                {collapsed && isPopout && (
                  <CollapsedGroupPopout
                    name={name}
                    pages={groupPages}
                    activeClass={activeClass}
                    linkBase={linkBase}
                    onClose={() => setPopoutGroup(null)}
                    anchorRef={ref}
                  />
                )}
              </div>
            )
          })}
        </nav>

        <Separator className="opacity-30" />

        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </Button>
        </div>
      </aside>

      {/* Tooltip — also portaled, suppressed when popout is open */}
      {collapsed && hoveredItem && popoutGroup === null && (
        <CollapsedTooltip label={hoveredItem.label} anchorEl={hoveredItem.el} />
      )}

      {/* ================= MOBILE DOCK ================= */}
      <nav
        className={cn(
          'md:hidden fixed bottom-3 left-3 right-3 z-50',
          'flex items-center gap-1',
          'h-14 px-3',
          'overflow-x-auto scroll-smooth',
          'rounded-2xl shadow-2xl border',
          'bg-[oklch(0.22_0.08_160/0.85)] backdrop-blur-2xl',
          'border-[oklch(0.55_0.15_160/0.35)]'
        )}
      >
        {topLevelPages.map((page) => {
          const Icon = getIcon(page.icon)
          return (
            <Link
              key={page.resource}
              to={page.path as any}
              activeProps={{ className: 'text-white' }}
              className="shrink-0 min-w-16 flex flex-col items-center gap-0.5 px-3 py-1 rounded-md text-[oklch(0.78_0.01_160)] hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4" />
              <span className="text-[9px] font-medium">{page.label}</span>
            </Link>
          )
        })}

        {groups.map(({ name, pages: groupPages }) => {
          const active = isGroupActive(groupPages)
          const isOpen = sheetGroup === name
          const FolderIcon = isOpen ? FolderOpen : FolderClosed

          return (
            <button
              key={name}
              onClick={() => setSheetGroup(isOpen ? null : name)}
              className={cn(
                'shrink-0 min-w-16 flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all duration-200',
                'border border-white/10 bg-white/5 backdrop-blur-sm',
                active || isOpen
                  ? 'text-white bg-white/10 border-white/20'
                  : 'text-[oklch(0.78_0.01_160)] hover:text-white hover:bg-white/10'
              )}
            >
              <FolderIcon className="w-4 h-4" />
              <span className="text-[9px] font-medium">{capitalize(name)}</span>
            </button>
          )
        })}
      </nav>

      {/* ================= MOBILE SUBMENU ================= */}
      {sheetGroup && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setSheetGroup(null)}
          />
          <div
            className={cn(
              'md:hidden fixed bottom-20 left-3 right-3 z-50',
              'max-h-[70vh] overflow-y-auto',
              'rounded-2xl shadow-2xl border',
              'bg-[oklch(0.22_0.08_160/0.90)] backdrop-blur-2xl',
              'border-[oklch(0.55_0.15_160/0.35)]',
              'p-3'
            )}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            {groups
              .find((g) => g.name === sheetGroup)
              ?.pages.map((page) => {
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
          </div>
        </>
      )}
    </>
  )
}