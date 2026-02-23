import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { authMiddleware } from '#/middleware/auth'
import { can } from '#/lib/rbac'

/**
 * Creates a middleware that guards a server function by resource.
 * Allows access if the user is admin OR has 'view' on the given resource.
 * Redirects to '/' otherwise.
 */
export function resourceMiddleware(resource: string) {
  return createMiddleware()
    .middleware([authMiddleware])
    .server(async ({ next, context }) => {
      if (!context.isAdmin && !can(context.permissions, resource, 'view')) {
        throw redirect({ to: '/' })
      }
      return await next({ context })
    })
}
