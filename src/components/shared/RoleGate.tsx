import type { UserAccess } from '#/lib/rbac'

type RoleGateProps = {
  isAdmin: boolean
  permissions: UserAccess['permissions']
  children: React.ReactNode
  fallback?: React.ReactNode
} & (
  | { requireAdmin: true; resource?: never; action?: never }
  | { requireAdmin?: false; resource: string; action?: string }
)

/**
 * Renders children only if the current user has the required access.
 *
 * Modes:
 *   requireAdmin              — admin users only
 *   resource                  — user has ANY action on this resource (or isAdmin)
 *   resource + action         — user has this specific action (or isAdmin)
 *
 * Usage:
 *   <RoleGate isAdmin={access.isAdmin} permissions={access.permissions} requireAdmin>
 *   <RoleGate isAdmin={access.isAdmin} permissions={access.permissions} resource="upload">
 *   <RoleGate isAdmin={access.isAdmin} permissions={access.permissions} resource="upload" action="create">
 *
 *   // spread shorthand (access contains isAdmin + permissions):
 *   <RoleGate {...access} requireAdmin>
 *   <RoleGate {...access} resource="upload" action="create">
 */
export function RoleGate({
  isAdmin,
  permissions,
  requireAdmin,
  resource,
  action,
  children,
  fallback = null,
}: RoleGateProps) {
  // Admin bypasses everything
  if (isAdmin) return <>{children}</>

  // requireAdmin mode — non-admins never pass
  if (requireAdmin) return <>{fallback}</>

  // Resource / action mode
  const perm = permissions.find((p) => p.resource === resource)
  if (!perm) return <>{fallback}</>
  if (action && !perm.actions.includes(action)) return <>{fallback}</>

  return <>{children}</>
}