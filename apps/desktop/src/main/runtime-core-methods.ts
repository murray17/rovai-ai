import type { CoreMethod } from '@contracts'

export const RUNTIME_RENDERER_CORE_METHODS = [
  'runtime.discovery.rescan',
  'runtime.product.ensure',
  'runtime.product.check',
  'runtime.startup.get',
  'runtime.startup.inspect',
  'runtime.startup.check',
  'runtime.startup.save',
  'runtime.networkRecovery.wake',
  'runtime.modelCatalog.open',
  'runtime.pendingExecution.cancel'
] as const satisfies readonly CoreMethod[]
