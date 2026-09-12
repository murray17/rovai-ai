import type { AdapterKind, RuntimeModelCatalogView, RovaiApi } from '@contracts'
import { desktopCampClient } from './desktop-camp-client'

export type ProductRuntimeCheckResult = {
  scheduled: true
  completed: true
  ready: boolean
  outcome: 'ready' | 'stable_failure' | 'deferred'
  status: 'ready' | 'stable_failure' | 'deferred'
  runtimeKind: AdapterKind
}

export async function requestProductRuntimeCheck(runtimeKind: AdapterKind, rediscover = false, request: RovaiApi['request'] = desktopCampClient.request): Promise<ProductRuntimeCheckResult> {
  if (rediscover) {
    await request('runtime.discovery.rescan', { interactiveShell: true })
  }
  return request<ProductRuntimeCheckResult>('runtime.product.check', { runtimeKind })
}

export function openRuntimeModelCatalog(runtimeKind: AdapterKind, request: RovaiApi['request'] = desktopCampClient.request): Promise<RuntimeModelCatalogView> {
  return request<RuntimeModelCatalogView>('runtime.modelCatalog.open', { runtimeKind })
}
