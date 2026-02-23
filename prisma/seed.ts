import 'dotenv/config'
import { db } from '../src/lib/db.js'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD environment variable is required for seeding.')
  process.exit(1)
}

const ALL_RESOURCES = ['dashboard', 'profile', 'settings', 'users', 'branches', 'roles', 'pages', 'upload'] as const
type Resource = typeof ALL_RESOURCES[number]

function viewOnly(...resources: Resource[]) {
  return resources.map((resource) => ({ resource, actions: ['view'] as string[] }))
}

function fullAccess(...resources: Resource[]) {
  return resources.map((resource) => ({
    resource,
    actions: ['view', 'create', 'edit', 'delete'] as string[],
  }))
}

function withActions(resource: Resource, actions: string[]) {
  return [{ resource, actions }]
}

async function main() {
  console.log('Seeding MIS Enterprise...')

  // ─────────────────────────────────────────────────────────────
  // 1. BRANCHES
  // ─────────────────────────────────────────────────────────────
  const branchNames = ['Aranmanai', 'Kenikarai', 'Bharathinagar 1']
  const branchMap: Record<string, any> = {}
  await Promise.all(
    branchNames.map(async (name) => {
      branchMap[name] = await db.branch.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    })
  )
  console.log(`  ${branchNames.length} branches`)

  // ─────────────────────────────────────────────────────────────
  // 2. FACTORY
  // ─────────────────────────────────────────────────────────────
  await db.factory.upsert({
    where: { name: 'Main Factory' },
    update: {},
    create: { name: 'Main Factory' },
  })
  console.log('  Factory')

  // ─────────────────────────────────────────────────────────────
  // 3. PRODUCT CATEGORIES
  // ─────────────────────────────────────────────────────────────
  const categoryNames = ['Cake', 'Pastry', 'Mithai', 'Savoury', 'Bread', 'Biscuit', 'Chocolate', 'Seasonal']
  await Promise.all(
    categoryNames.map((name) =>
      db.productCategory.upsert({ where: { name }, update: {}, create: { name } })
    )
  )
  console.log(`  ${categoryNames.length} product categories`)

  // ─────────────────────────────────────────────────────────────
  // 4. TRANSACTION TYPES
  // ─────────────────────────────────────────────────────────────
  const transactionTypes = [
    { name: 'Sales',           description: 'Retail sales at branch',                             pairedWith: null },
    { name: 'Stock',           description: 'Opening or closing stock at branch',                  pairedWith: null },
    { name: 'Wastage',         description: 'Expired or damaged goods written off at branch',      pairedWith: null },
    { name: 'Dispatch',        description: 'Goods dispatched from factory to branch',             pairedWith: 'Received' },
    { name: 'Received',        description: 'Goods received at branch from factory',               pairedWith: 'Dispatch' },
    { name: 'Return Dispatch', description: 'Unsold goods dispatched from branch back to factory', pairedWith: 'Return Received' },
    { name: 'Return Received', description: 'Returned goods received at factory from branch',      pairedWith: 'Return Dispatch' },
    { name: 'Production',      description: 'Goods produced at factory',                           pairedWith: null },
    { name: 'Purchase',        description: 'Raw material or finished goods purchased',            pairedWith: null },
  ]
  await Promise.all(
    transactionTypes.map((t) =>
      db.transactionType.upsert({
        where: { name: t.name },
        update: { description: t.description, pairedWith: t.pairedWith },
        create: t,
      })
    )
  )
  console.log(`  ${transactionTypes.length} transaction types`)

  // ─────────────────────────────────────────────────────────────
  // 5. ROLES + PAGE PERMISSIONS
  // ─────────────────────────────────────────────────────────────
  const roleDefs: Array<{
    name: string
    type: 'ADMIN' | 'AREA_MANAGER' | 'BRANCH_MANAGER' | 'CUSTOM'
    description?: string
    pagePermissions: Array<{ resource: string; actions: string[] }>
  }> = [
    {
      name: 'Admin',
      type: 'ADMIN',
      description: 'Full system access — bypasses all permission checks',
      pagePermissions: fullAccess(...ALL_RESOURCES),
    },
    {
      name: 'Area Manager',
      type: 'AREA_MANAGER',
      description: 'Multi-branch access with aggregated reporting',
      pagePermissions: [...viewOnly('dashboard', 'profile', 'branches', 'upload')],
    },
    {
      name: 'Branch Manager',
      type: 'BRANCH_MANAGER',
      description: 'Single-branch access, scoped to assigned branch',
      pagePermissions: [...viewOnly('dashboard', 'profile', 'upload')],
    },
    {
      name: 'MIS',
      type: 'CUSTOM',
      description: 'MIS team — uploads and full reporting',
      pagePermissions: [
        ...viewOnly('dashboard', 'profile'),
        ...withActions('upload', ['view', 'create', 'edit', 'delete']),
      ],
    },
    {
      name: 'Sales',
      type: 'CUSTOM',
      description: 'Sales team — view sales data',
      pagePermissions: [...viewOnly('dashboard', 'profile')],
    },
    {
      name: 'Purchases',
      type: 'CUSTOM',
      description: 'Purchases team — view purchase data',
      pagePermissions: [...viewOnly('dashboard', 'profile')],
    },
    {
      name: 'Store',
      type: 'CUSTOM',
      description: 'Store team — view stock and dispatch',
      pagePermissions: [...viewOnly('dashboard', 'profile')],
    },
    {
      name: 'CRM',
      type: 'CUSTOM',
      description: 'CRM team — view CRM data',
      pagePermissions: [...viewOnly('dashboard', 'profile')],
    },
    {
      name: 'Basic User',
      type: 'CUSTOM',
      description: 'Default role for new users — dashboard and profile only',
      pagePermissions: [...viewOnly('dashboard', 'profile')],
    },
  ]

  const roleMap: Record<string, any> = {}

  for (const def of roleDefs) {
    const role = await db.role.upsert({
      where: { name: def.name },
      update: { type: def.type, description: def.description ?? null },
      create: { name: def.name, type: def.type, description: def.description ?? null },
    })
    roleMap[def.name] = role

    await db.pagePermission.deleteMany({ where: { roleId: role.id } })
    await db.pagePermission.createMany({
      data: def.pagePermissions.map((pp) => ({
        roleId:   role.id,
        resource: pp.resource,
        actions:  pp.actions,
      })),
    })
  }

  console.log(`  ${roleDefs.length} roles with page permissions`)

  // ─────────────────────────────────────────────────────────────
  // 6a. NAV GROUPS
  // ─────────────────────────────────────────────────────────────
  const navGroupDefs = [
    { name: 'top',    order: 0 },
    { name: 'admin',  order: 1 },
    { name: 'bottom', order: 2 },
  ]
  const navGroupMap: Record<string, { id: string }> = {}
  for (const ng of navGroupDefs) {
    navGroupMap[ng.name] = await db.navGroup.upsert({
      where:  { name: ng.name },
      update: { order: ng.order },
      create: ng,
    })
  }
  console.log(`  ${navGroupDefs.length} nav groups`)

  // ─────────────────────────────────────────────────────────────
  // 6b. PAGES
  // ─────────────────────────────────────────────────────────────
  const pageDefs = [
    { resource: 'dashboard', label: 'Dashboard', path: '/',         icon: 'LayoutDashboard', navGroupId: navGroupMap['top'].id,    order: 0 },
    { resource: 'profile',   label: 'Profile',   path: '/profile',  icon: 'UserCircle',      navGroupId: navGroupMap['bottom'].id, order: 1 },
    { resource: 'users',     label: 'Users',     path: '/users',    icon: 'Users',           navGroupId: navGroupMap['admin'].id,  order: 2 },
    { resource: 'branches',  label: 'Branches',  path: '/branches', icon: 'Building2',       navGroupId: navGroupMap['admin'].id,  order: 3 },
    { resource: 'roles',     label: 'Roles',     path: '/roles',    icon: 'Shield',          navGroupId: navGroupMap['admin'].id,  order: 4 },
    { resource: 'pages',     label: 'Pages',     path: '/pages',    icon: 'Layout',          navGroupId: navGroupMap['admin'].id,  order: 5 },
    { resource: 'upload',    label: 'Upload',    path: '/upload',   icon: 'Upload',          navGroupId: navGroupMap['admin'].id,  order: 6 },
    { resource: 'settings',  label: 'Settings',  path: '/settings', icon: 'Settings',        navGroupId: navGroupMap['bottom'].id, order: 7 },
  ]

  for (const page of pageDefs) {
    await db.page.upsert({
      where:  { resource: page.resource },
      update: { label: page.label, path: page.path, icon: page.icon, navGroupId: page.navGroupId, order: page.order },
      create: { ...page, isActive: true },
    })
  }

  console.log(`  ${pageDefs.length} pages`)

  // ─────────────────────────────────────────────────────────────
  // 7. APP SETTINGS
  // ─────────────────────────────────────────────────────────────
  await Promise.all([
    db.appSetting.upsert({ where: { key: 'appName' },  update: {}, create: { key: 'appName',  value: 'MIS Enterprise' } }),
    db.appSetting.upsert({ where: { key: 'timezone' }, update: {}, create: { key: 'timezone', value: 'Asia/Kolkata'   } }),
  ])
  console.log('  App settings')

  // ─────────────────────────────────────────────────────────────
  // 8. ADMIN USER (via Better Auth)
  // ─────────────────────────────────────────────────────────────
  const { auth } = await import('../src/lib/auth.js')

  const existing = await db.user.findUnique({ where: { email: 'admin@mis.com' } })
  if (existing) {
    await db.user.delete({ where: { email: 'admin@mis.com' } })
    console.log('  Deleted old admin user, recreating...')
  }

  await auth.api.signUpEmail({
    body: { name: 'System Admin', email: 'admin@mis.com', password: ADMIN_PASSWORD! },
  })

  const adminUser = await db.user.findUnique({ where: { email: 'admin@mis.com' } })
  if (!adminUser) throw new Error('Failed to create admin user via Better Auth.')

  const existingUserRole = await db.userRole.findFirst({
    where: { userId: adminUser.id, roleId: roleMap['Admin'].id, branchId: null },
  })
  if (!existingUserRole) {
    await db.userRole.create({
      data: { userId: adminUser.id, roleId: roleMap['Admin'].id },
    })
  }

  console.log('  Admin user: admin@mis.com')
  console.log('')
  console.log('Seeding complete.')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())