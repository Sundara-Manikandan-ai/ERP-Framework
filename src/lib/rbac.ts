import { db } from '#/lib/db'

export type UserAccess = {
  isAdmin: boolean
  roles: {
    name: string
    type: string
    branchId: string | null
    branchName: string | null
  }[]
  branchIds: string[]
  permissions: {
    resource: string
    actions: string[]
  }[]
}

export async function getUserAccess(userId: string): Promise<UserAccess> {
  const userRoles = await db.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: { pagePermissions: true },
      },
      branch: true,
    },
  })

  const isAdmin = userRoles.some((ur) => ur.role.type === 'ADMIN')

  // Union of actions per resource across all roles
  const permMap = new Map<string, Set<string>>()
  for (const ur of userRoles) {
    for (const pp of ur.role.pagePermissions) {
      if (!permMap.has(pp.resource)) permMap.set(pp.resource, new Set())
      for (const action of pp.actions) permMap.get(pp.resource)!.add(action)
    }
  }

  const branchIds = [
    ...new Set(
      userRoles.map((ur) => ur.branchId).filter((id): id is string => id !== null)
    ),
  ]

  return {
    isAdmin,
    roles: userRoles.map((ur) => ({
      name: ur.role.name,
      type: ur.role.type,
      branchId: ur.branchId,
      branchName: ur.branch?.name ?? null,
    })),
    branchIds,
    permissions: Array.from(permMap.entries()).map(([resource, actions]) => ({
      resource,
      actions: Array.from(actions),
    })),
  }
}

// Extracts the access shape returned by getPageData server handlers
export function extractAccess(context: { isAdmin: boolean; roles: UserAccess['roles']; permissions: UserAccess['permissions'] }) {
  return {
    isAdmin:     context.isAdmin,
    roles:       context.roles,
    permissions: context.permissions,
  }
}

// Point-use helper for server handlers
export function can(
  permissions: UserAccess['permissions'],
  resource: string,
  action: string,
): boolean {
  return permissions.find((p) => p.resource === resource)?.actions.includes(action) ?? false
}