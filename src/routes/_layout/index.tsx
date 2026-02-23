import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { db } from '#/lib/db'
import { authMiddleware } from '#/middleware/auth'
import { LayoutDashboard, Users, Shield, Activity } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const getDashboardStats = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    // Fetch counts + both roles in one round-trip
    const [totalUsers, totalRoles, totalBranches, roles] = await Promise.all([
      db.user.count(),
      db.role.count(),
      db.branch.count(),
      db.role.findMany({
        where: { name: { in: ['Admin', 'MIS'] } },
        select: { id: true, name: true },
      }),
    ])

    const adminRole   = roles.find((r) => r.name === 'Admin')
    const managerRole = roles.find((r) => r.name === 'MIS')

    // Fetch user-role counts in parallel
    const [admins, managers] = await Promise.all([
      adminRole   ? db.userRole.count({ where: { roleId: adminRole.id } })   : Promise.resolve(0),
      managerRole ? db.userRole.count({ where: { roleId: managerRole.id } }) : Promise.resolve(0),
    ])

    return { totalUsers, admins, managers, totalRoles, totalBranches }
  })

export const Route = createFileRoute('/_layout/')({
  loader: () => getDashboardStats(),
  component: DashboardPage,
})

function DashboardPage() {
  const { totalUsers, admins, managers, totalRoles, totalBranches } =
    Route.useLoaderData()

  const stats = [
    {
      title: 'Total Users',
      value: totalUsers,
      icon: Users,
      description: 'Registered accounts',
    },
    {
      title: 'Admins',
      value: admins,
      icon: Shield,
      description: 'Administrator accounts',
    },
    {
      title: 'MIS Users',
      value: managers,
      icon: Activity,
      description: 'MIS accounts',
    },
    {
      title: 'Branches',
      value: totalBranches,
      icon: LayoutDashboard,
      description: 'Active branches',
    },
    {
      title: 'Roles',
      value: totalRoles,
      icon: Shield,
      description: 'Defined roles',
    },
  ]

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to MIS Enterprise</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
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
    </div>
  )
}
