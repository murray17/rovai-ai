import type { AdapterKind, RuntimeModelCatalogTarget, RuntimeModelCatalogView, RovaiApi } from '@contracts'
import { desktopThreadClient } from './desktop-camp-client'

export type ProductRuntimeCheckResult = {
  scheduled: true
  completed: true
  ready: boolean
  outcome: 'ready' | 'stable_failure' | 'deferred'
  status: 'ready' | 'stable_failure' | 'deferred'
  runtimeKind: AdapterKind
}

export async function requestProductRuntimeCheck(runtimeKind: AdapterKind, request: RovaiApi['request'] = desktopThreadClient.request): Promise<ProductRuntimeCheckResult> {
  // Core refreshes discovery inputs for every explicit check, including guides.
  return request<ProductRuntimeCheckResult>('runtime.product.check', { runtimeKind })
}

export function openRuntimeModelCatalog(runtimeKind: AdapterKind, request: RovaiApi['request'] = desktopThreadClient.request, waitForRefresh = false, target?: RuntimeModelCatalogTarget): Promise<RuntimeModelCatalogView> {
  return request<RuntimeModelCatalogView>('runtime.modelCatalog.open', {
    runtimeKind,
    ...(waitForRefresh ? { waitForRefresh: true } : {}),
    ...(runtimeKind === 'deepseek-harness' && target ? target : {})
  })
}
