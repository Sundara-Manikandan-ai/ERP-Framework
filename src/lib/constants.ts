export const ALL_RESOURCES = [
  'dashboard',
  'profile',
  'settings',
  'users',
  'branches',
  'roles',
  'pages',
  'upload',
  'products',
  'factories',
  'transactionTypes',
  'reports',
  'errorLogs',
  'auditLogs',
] as const

export type Resource = (typeof ALL_RESOURCES)[number]

export const ALL_ACTIONS = ['view', 'create', 'edit', 'delete'] as const
export type Action = (typeof ALL_ACTIONS)[number]
