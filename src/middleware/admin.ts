import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { authMiddleware } from '#/middleware/auth'

export const adminMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    if (!context.isAdmin) {
      throw redirect({ to: '/' })
    }

    return await next({ context:{user: context.user} })
  })
