import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Sidebar } from '@/components/shared/Sidebar'
import { CommandPalette } from '@/components/shared/CommandPalette'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { LogOut, User, Shield, Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '#/hooks/useTheme'
import { authMiddleware } from '#/middleware/auth'
import { db } from '#/lib/db'
import { signOut } from '#/lib/auth-client'
import { getInitials } from '@/lib/utils'

const getSessionWithAccess = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    let appName = 'MIS Enterprise'
    let dateFormat = 'dd/MM/yyyy'
    try {
      const settings = await db.appSetting.findMany()
      const map: Record<string, string> = {}
      for (const s of settings) map[s.key] = s.value
      appName    = map['appName']    ?? 'MIS Enterprise'
      dateFormat = map['dateFormat'] ?? 'dd/MM/yyyy'
    } catch (e) {
      console.warn('Failed to load app settings, using defaults:', e)
    }

const pages = await db.page.findMany({
      where:   { isActive: true },
      orderBy: { order: 'asc' },
      include: { navGroup: true },
    })

    return {
      user: {
        id:    context.user.id,
        name:  context.user.name,
        email: context.user.email,
        image: context.user.image,
      },
      isAdmin:     context.isAdmin,
      roles:       context.roles,
      permissions: context.permissions,
      appName,
      dateFormat,
      pages: pages.map((p) => ({
        resource: p.resource,
        label:    p.label,
        path:     p.path,
        icon:     p.icon,
        group:    p.navGroup?.name ?? '',
      })),
    }
  })

export const Route = createFileRoute('/_layout')({
  component: LayoutComponent,
  loader: () => getSessionWithAccess(),
})

function LayoutComponent() {
  const router  = useRouter()
  const session = Route.useLoaderData()
  const user    = session?.user
  const { theme, setTheme } = useTheme()

  async function handleLogout() {
    await signOut()
    await router.navigate({ to: '/login' })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        isAdmin={session?.isAdmin ?? false}
        permissions={session?.permissions ?? []}
        pages={session?.pages ?? []}
        appName={session?.appName ?? 'MIS Enterprise'}
      />

      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        <header className="flex items-center justify-between px-3 h-10 border-b border-border bg-background/70 backdrop-blur-sm shrink-0 z-50 relative">
          {/* App name — mobile only */}
          <span className="md:hidden text-xs font-semibold text-foreground truncate max-w-[60%]">
            {session?.appName ?? 'MIS Enterprise'}
          </span>

          {/* Spacer — desktop */}
          <span className="hidden md:block" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center shrink-0">
                {user?.name ? getInitials(user.name) : '??'}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal py-1.5">
                <div className="flex flex-col space-y-0.5">
                  <span className="font-medium text-xs">{user?.name}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {user?.email}
                  </span>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {session?.roles.map((r) => (
                      <Badge
                        key={`${r.name}-${r.branchId}`}
                        variant="secondary"
                        className="text-[10px] px-1 py-0"
                      >
                        {r.branchName ? `${r.name} · ${r.branchName}` : r.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onClick={() => router.navigate({ to: '/profile' })}
              >
                <User className="w-3.5 h-3.5 mr-2" />
                Profile
              </DropdownMenuItem>
              {session?.isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs"
                    onClick={() => router.navigate({ to: '/users' })}
                  >
                    <Shield className="w-3.5 h-3.5 mr-2" />
                    Admin Panel
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground py-1">Theme</DropdownMenuLabel>
              <DropdownMenuItem className="text-xs" onClick={() => setTheme('light')}>
                <Sun className="w-3.5 h-3.5 mr-2" />
                Light {theme === 'light' && '✓'}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => setTheme('dark')}>
                <Moon className="w-3.5 h-3.5 mr-2" />
                Dark {theme === 'dark' && '✓'}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => setTheme('system')}>
                <Monitor className="w-3.5 h-3.5 mr-2" />
                System {theme === 'system' && '✓'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="w-3.5 h-3.5 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-auto p-3 pb-24 md:pb-3">
          <Outlet />
        </main>
      </div>

      <CommandPalette
        pages={(session?.pages ?? []).filter((p) =>
          session?.isAdmin || session?.permissions?.some((perm) => perm.resource === p.resource && perm.actions.includes('view'))
        )}
      />
    </div>
  )
}