import { db } from '#/lib/db'

// ── Error Logger ──────────────────────────────────────────────────────────────

export async function logError(params: {
  message: string
  stack?: string
  url?: string
  userId?: string
  userEmail?: string
  context?: Record<string, unknown>
  source?: 'server' | 'client'
}) {
  try {
    await db.errorLog.create({
      data: {
        message:   params.message,
        stack:     params.stack ?? null,
        url:       params.url ?? null,
        userId:    params.userId ?? null,
        userEmail: params.userEmail ?? null,
        context:   params.context !== undefined ? (params.context as object) : undefined,
        source:    params.source ?? 'server',
      },
    })
  } catch {
    // Never throw from logger — silently fail to avoid infinite loops
    console.error('[logError] Failed to write error log:', params.message)
  }
}

// ── Audit Logger ──────────────────────────────────────────────────────────────

export async function logAudit(params: {
  userId: string
  userEmail: string
  action: 'create' | 'update' | 'delete'
  resource: string
  resourceId?: string
  oldValue?: unknown
  newValue?: unknown
  ip?: string
}) {
  try {
    await db.auditLog.create({
      data: {
        userId:     params.userId,
        userEmail:  params.userEmail,
        action:     params.action,
        resource:   params.resource,
        resourceId: params.resourceId ?? null,
        oldValue:   params.oldValue !== undefined ? (params.oldValue as object) : undefined,
        newValue:   params.newValue !== undefined ? (params.newValue as object) : undefined,
        ip:         params.ip ?? null,
      },
    })
  } catch {
    console.error('[logAudit] Failed to write audit log:', params.action, params.resource)
  }
}
