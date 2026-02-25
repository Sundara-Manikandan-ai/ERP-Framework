import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '#/lib/auth'
import { getUserAccess, type UserAccess } from '#/lib/rbac'

// Request-scoped cache so multiple middleware calls within the same
// request (e.g. nested server functions) don't re-query the DB.
const accessCache = new Map<string, UserAccess>()

export const authMiddleware = createMiddleware().server(
  async ({ next }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })

    if (!session) {
      throw redirect({ to: '/login' })
    }

    const userId = session.user.id
    let access = accessCache.get(userId)
    if (!access) {
      access = await getUserAccess(userId)
      accessCache.set(userId, access)
      // Clear after a tick so the cache only lives for this request
      queueMicrotask(() => accessCache.delete(userId))
    }

    return await next({
      context: {
        user:        session.user,
        isAdmin:     access.isAdmin,
        roles:       access.roles,
        branchIds:   access.branchIds,
        permissions: access.permissions,
      },
    })
  },
)

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user