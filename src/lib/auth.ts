import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '#/lib/db'

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required.')
}
if (!process.env.BETTER_AUTH_BASE_URL) {
  throw new Error('BETTER_AUTH_BASE_URL environment variable is required.')
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-assign "Basic User" role to every new user
          const basicRole = await db.role.findUnique({ where: { name: 'Basic User' } })
          if (basicRole) {
            await db.userRole.create({
              data: { userId: user.id, roleId: basicRole.id },
            })
            console.log('[auth] Assigned "Basic User" role to', user.email)
          } else {
            console.warn('[auth] "Basic User" role not found — run seed first')
          }
        },
      },
    },
  },
  plugins: [tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user
