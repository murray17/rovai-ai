import type { CoreMethod } from '@contracts'

export const RUNTIME_RENDERER_CORE_METHODS = [
  'runtime.discovery.rescan',
  'runtime.product.check',
  'runtime.pendingExecution.cancel'
] as const satisfies readonly CoreMethod[]
