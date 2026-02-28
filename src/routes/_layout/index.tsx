import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { db } from '#/lib/db'
import { authMiddleware } from '#/middleware/auth'
import { Unauthorized } from '@/components/shared/Unauthorized'
import { LayoutDashboard, Users, Shield, Activity, Upload, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const getDashboardStats = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const hasDashboard =
      context.isAdmin ||
      context.permissions.some(
        (p) => p.resource === 'dashboard' && p.actions.includes('view')
      )

    if (!hasDashboard) {
      return { authorized: false as const }
    }

    const [totalUsers, totalRoles, totalBranches, totalProducts, totalUploads, roleCounts, recentActivity] = await Promise.all([
      db.user.count(),
      db.role.count(),
      db.branch.count(),
      db.product.count(),
      db.uploadBatch.count(),
      db.userRole.groupBy({
        by: ['roleId'],
        _count: { roleId: true },
        where: { role: { name: { in: ['Admin', 'MIS'] } } },
      }),
      db.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, userEmail: true, action: true, resource: true, createdAt: true },
      }),
    ])

    const roles = await db.role.findMany({
      where: { name: { in: ['Admin', 'MIS'] } },
      select: { id: true, name: true },
    })

    const countFor = (name: string) => {
      const role = roles.find((r) => r.name === name)
      return role ? (roleCounts.find((rc) => rc.roleId === role.id)?._count.roleId ?? 0) : 0
    }

    return {
      authorized: true as const,
      totalUsers,
      totalRoles,
      totalBranches,
      totalProducts,
      totalUploads,
      admins:   countFor('Admin'),
      managers: countFor('MIS'),
      recentActivity,
    }
  })

export const Route = createFileRoute('/_layout/')({
  loader: () => getDashboardStats(),
  component: DashboardPage,
})

function DashboardPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) return <Unauthorized />

  const { totalUsers, admins, managers, totalBranches, totalProducts, totalUploads, recentActivity } = data

  const stats = [
    { title: 'Total Users',  value: totalUsers,     icon: Users,           description: 'Registered accounts'    },
    { title: 'Admins',       value: admins,          icon: Shield,          description: 'Administrator accounts' },
    { title: 'MIS Users',    value: managers,        icon: Activity,        description: 'MIS accounts'           },
    { title: 'Branches',     value: totalBranches,   icon: LayoutDashboard, description: 'Active branches'        },
    { title: 'Products',     value: totalProducts,   icon: Package,         description: 'Product catalog'        },
    { title: 'Uploads',      value: totalUploads,    icon: Upload,          description: 'Upload batches'         },
  ]

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to MIS Enterprise</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Last 10 actions across the system</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentActivity.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs shrink-0 capitalize">{a.action}</Badge>
                    <span className="truncate">
                      <span className="text-muted-foreground">{a.userEmail}</span>
                      {' — '}
                      <span className="capitalize">{a.resource}</span>
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(a.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
