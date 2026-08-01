import type { CoreMethod } from '@contracts'

export const RUNTIME_RENDERER_CORE_METHODS = [
  'runtime.discovery.rescan',
  'runtime.product.ensure',
  'runtime.product.check',
  'runtime.antigravityTeam.status',
  'runtime.antigravityTeam.grantPermission',
  'runtime.pendingExecution.cancel'
] as const satisfies readonly CoreMethod[]
