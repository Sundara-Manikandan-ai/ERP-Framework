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

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// ── IP-based rate limiting ───────────────────────────────────────────────────
const IP_MAX_FAILED = 20
const IP_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const ipFailures = new Map<string, { count: number; firstAt: number }>()

export function checkIpRateLimit(ip: string): { blocked: boolean; minutesLeft?: number } {
  const entry = ipFailures.get(ip)
  if (!entry) return { blocked: false }

  // Window expired — clear
  if (Date.now() - entry.firstAt > IP_WINDOW_MS) {
    ipFailures.delete(ip)
    return { blocked: false }
  }

  if (entry.count >= IP_MAX_FAILED) {
    const msLeft = IP_WINDOW_MS - (Date.now() - entry.firstAt)
    return { blocked: true, minutesLeft: Math.ceil(msLeft / 60000) }
  }

  return { blocked: false }
}

export function recordIpFailure(ip: string): void {
  const entry = ipFailures.get(ip)
  if (!entry || Date.now() - entry.firstAt > IP_WINDOW_MS) {
    ipFailures.set(ip, { count: 1, firstAt: Date.now() })
  } else {
    entry.count++
  }
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
    expiresIn: 60 * 60 * 8, // 8 hours — daily re-login for ERP security
    updateAge: 60 * 60,     // refresh session token every hour
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
    session: {
      create: {
        after: async (session) => {
          // Successful login — reset lockout, update lastLoginAt, log event
          try {
            const user = await db.user.findUnique({ where: { id: session.userId } })
            if (!user) return

            await db.user.update({
              where: { id: session.userId },
              data: {
                lastLoginAt:    new Date(),
                failedAttempts: 0,
                lockedUntil:    null,
              },
            })

            await db.loginEvent.create({
              data: {
                userId:    session.userId,
                userEmail: user.email,
                ip:        session.ipAddress ?? null,
                userAgent: session.userAgent ?? null,
                success:   true,
              },
            })
          } catch (err) {
            console.error('[auth] Failed to record login event:', err)
          }
        },
      },
    },
  },
  plugins: [tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user

// ── Lockout helpers — called from the sign-in server function ─────────────────

export async function checkLockout(email: string): Promise<{ locked: boolean; minutesLeft?: number }> {
  const user = await db.user.findUnique({ where: { email } })
  if (!user) return { locked: false } // Don't reveal user existence

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const msLeft = user.lockedUntil.getTime() - Date.now()
    const minutesLeft = Math.ceil(msLeft / 60000)
    return { locked: true, minutesLeft }
  }

  return { locked: false }
}

export async function recordFailedAttempt(email: string, ip?: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email } })
  if (!user) return

  const newCount = user.failedAttempts + 1
  const shouldLock = newCount >= MAX_FAILED_ATTEMPTS

  await db.user.update({
    where: { email },
    data: {
      failedAttempts: newCount,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : undefined,
    },
  })

  await db.loginEvent.create({
    data: {
      userId:    user.id,
      userEmail: user.email,
      ip:        ip ?? null,
      success:   false,
      reason:    shouldLock ? 'account_locked' : 'invalid_password',
    },
  })
}