import type { AdapterKind } from '@contracts'

export function requestProductRuntimeCheck(runtimeKind: AdapterKind): Promise<unknown> {
  return window.rovai.request('runtime.product.check', { runtimeKind })
}
