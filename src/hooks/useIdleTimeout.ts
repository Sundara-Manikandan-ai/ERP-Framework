import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { signOut } from '#/lib/auth-client'

const IDLE_TIMEOUT_MS  = 30 * 60 * 1000  // 30 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000  // warn 2 minutes before
const THROTTLE_MS       = 1000            // throttle activity events to 1/sec

export type IdleTimeoutState = 'active' | 'warning' | 'timedout'

interface UseIdleTimeoutOptions {
  onWarning?: () => void   // called when warning threshold is hit
  onTimeout?: () => void   // called just before sign out
  enabled?: boolean        // set false on login/register pages
}

export function useIdleTimeout({
  onWarning,
  onTimeout,
  enabled = true,
}: UseIdleTimeoutOptions = {}) {
  const router        = useRouter()
  const warningTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivity  = useRef<number>(0)

  const clearTimers = useCallback(() => {
    if (warningTimer.current) clearTimeout(warningTimer.current)
    if (logoutTimer.current)  clearTimeout(logoutTimer.current)
  }, [])

  const handleTimeout = useCallback(async () => {
    onTimeout?.()
    await signOut()
    await router.navigate({ to: '/login' })
  }, [onTimeout, router])

  const resetTimers = useCallback(() => {
    if (!enabled) return
    clearTimers()

    warningTimer.current = setTimeout(() => {
      onWarning?.()
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS)

    logoutTimer.current = setTimeout(() => {
      handleTimeout()
    }, IDLE_TIMEOUT_MS)
  }, [enabled, clearTimers, onWarning, handleTimeout])

  // Throttled wrapper — resets timers at most once per THROTTLE_MS
  const throttledReset = useCallback(() => {
    const now = Date.now()
    if (now - lastActivity.current < THROTTLE_MS) return
    lastActivity.current = now
    resetTimers()
  }, [resetTimers])

  useEffect(() => {
    if (!enabled) return

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

    events.forEach((e) => window.addEventListener(e, throttledReset, { passive: true }))
    resetTimers() // start timers on mount

    return () => {
      events.forEach((e) => window.removeEventListener(e, throttledReset))
      clearTimers()
    }
  }, [enabled, throttledReset, resetTimers, clearTimers])

  return { resetTimers }
}
