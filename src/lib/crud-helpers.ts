import { logAudit } from '#/lib/logger'

type CrudContext = { userId: string; userEmail: string }

// ── checkUniqueName ──────────────────────────────────────────────────────────

interface CheckUniqueOpts {
  excludeId?: string
  field?: string
  errorMessage?: string
}

export async function checkUniqueName(
  model: any,
  name: string,
  opts: CheckUniqueOpts = {},
) {
  const field = opts.field ?? 'name'
  const where: any = {
    [field]: field === 'email' ? name : { equals: name, mode: 'insensitive' },
    deletedAt: null,
  }
  if (opts.excludeId) {
    where.NOT = { id: opts.excludeId }
  }

  const existing = await model.findFirst({ where })
  if (existing) {
    throw new Error(opts.errorMessage ?? `Unable to save. The ${field} may already be in use.`)
  }
}

// ── softDeleteRecord ─────────────────────────────────────────────────────────

interface Dependency {
  model: any
  where: Record<string, any>
  errorTemplate: string // e.g. "Cannot archive — {count} user(s) are assigned."
}

export async function softDeleteRecord(
  model: any,
  id: string,
  dependencies: Dependency[],
  context: CrudContext,
  resource: string,
) {
  const [record, ...counts] = await Promise.all([
    model.findUnique({ where: { id } }),
    ...dependencies.map((d) => d.model.count({ where: d.where })),
  ])

  if (!record) throw new Error('Record not found.')

  for (let i = 0; i < dependencies.length; i++) {
    if (counts[i] > 0) {
      throw new Error(dependencies[i].errorTemplate.replace('{count}', String(counts[i])))
    }
  }

  await model.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: context.userEmail },
  })

  logAudit({
    userId: context.userId,
    userEmail: context.userEmail,
    action: 'delete',
    resource,
    resourceId: id,
    oldValue: { name: record.name },
  }).catch(() => {})
}

// ── restoreRecord ────────────────────────────────────────────────────────────

export async function restoreRecord(
  model: any,
  id: string,
  context: CrudContext,
  resource: string,
  opts?: { field?: string },
) {
  const field = opts?.field ?? 'name'

  const record = await model.findUnique({ where: { id } })

  if (!record) throw new Error('Record not found.')

  const conflictWhere: any = { deletedAt: null }
  if (field === 'email') {
    conflictWhere[field] = record[field]
  } else {
    conflictWhere[field] = { equals: record[field], mode: 'insensitive' }
  }

  const existing = await model.findFirst({ where: conflictWhere })
  if (existing) {
    throw new Error(`Unable to restore. The ${field} may conflict with an active record.`)
  }

  await model.update({
    where: { id },
    data: { deletedAt: null, deletedBy: null },
  })

  logAudit({
    userId: context.userId,
    userEmail: context.userEmail,
    action: 'update',
    resource,
    resourceId: id,
    newValue: { restored: true },
  }).catch(() => {})
}

// ── permanentDeleteRecord ────────────────────────────────────────────────────

export async function permanentDeleteRecord(
  model: any,
  id: string,
  context: CrudContext,
  resource: string,
) {
  const old = await model.findUnique({ where: { id } })
  await model.delete({ where: { id } })

  logAudit({
    userId: context.userId,
    userEmail: context.userEmail,
    action: 'delete',
    resource,
    resourceId: id,
    oldValue: old ? { name: old.name, permanentDelete: true } : undefined,
  }).catch(() => {})
}
