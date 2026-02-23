import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '#/lib/auth'
import { getUserAccess } from '#/lib/rbac'

export const authMiddleware = createMiddleware().server(
  async ({ next }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })

    if (!session) {
      throw redirect({ to: '/login' })
    }

    const access = await getUserAccess(session.user.id)

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