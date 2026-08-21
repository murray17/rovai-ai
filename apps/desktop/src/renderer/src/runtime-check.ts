import type { AdapterKind, RuntimeModelCatalogView } from '@contracts'

export type ProductRuntimeCheckResult = {
  scheduled: true
  completed: true
  ready: boolean
  outcome: 'ready' | 'stable_failure' | 'deferred'
  status: 'ready' | 'stable_failure' | 'deferred'
  runtimeKind: AdapterKind
}

export function requestProductRuntimeCheck(runtimeKind: AdapterKind): Promise<ProductRuntimeCheckResult> {
  return window.rovai.request<ProductRuntimeCheckResult>('runtime.product.check', { runtimeKind })
}

export function openRuntimeModelCatalog(runtimeKind: AdapterKind): Promise<RuntimeModelCatalogView> {
  return window.rovai.request<RuntimeModelCatalogView>('runtime.modelCatalog.open', { runtimeKind })
}
