import type { AdapterKind, ProductRuntimeAvailability, RuntimeFailureView, RuntimeModelCatalogTarget, RuntimeModelCatalogView, RovaiApi } from '@contracts'
import { desktopThreadClient } from './desktop-camp-client'

export type ProductRuntimeCheckResult = {
  scheduled: true
  completed: true
  ready: boolean
  outcome: 'ready' | 'stable_failure' | 'deferred'
  status: 'ready' | 'stable_failure' | 'deferred'
  runtimeKind: AdapterKind
}

export type RuntimeCheckFeedbackMessage = { kind: 'request_error' | 'check_failed'; message: string }

export function runtimeCheckFeedback(availability: ProductRuntimeAvailability | undefined, feedback?: RuntimeCheckFeedbackMessage): {
  versionFailure: RuntimeFailureView | null
  message: string | undefined
} {
  const failure = availability?.failure
  const isReadFailure = (code: string) => ['runtime_version_failed', 'runtime_version_empty', 'runtime_version_output_truncated'].includes(code)
  const readFailure = failure && isReadFailure(failure.code)
  const versionFailure = failure && (readFailure || availability?.discovery.versionProbeSucceeded === false) ? failure : null
  const versionMessage = versionFailure && availability?.discovery.versionProbeSucceeded !== true
    ? [versionFailure.summary, versionFailure.detail?.trim()]
        .filter((part, index, parts) => part && parts.indexOf(part) === index).join('\n')
    : undefined
  const otherFailure = (failure && !versionFailure) || (availability?.diagnosticCode && !isReadFailure(availability.diagnosticCode))
  const completedFeedback = availability?.discovery.versionProbeSucceeded === true && !otherFailure ? undefined : feedback?.message
  return { versionFailure, message: feedback?.kind === 'request_error' ? feedback.message : versionMessage ?? completedFeedback }
}

export async function requestProductRuntimeCheck(runtimeKind: AdapterKind, request: RovaiApi['request'] = desktopThreadClient.request): Promise<ProductRuntimeCheckResult> {
  // Checks reuse valid discovery inputs; Core refreshes them when the entry is missing.
  return request<ProductRuntimeCheckResult>('runtime.product.check', { runtimeKind })
}

export function openRuntimeModelCatalog(runtimeKind: AdapterKind, request: RovaiApi['request'] = desktopThreadClient.request, waitForRefresh = false, target?: RuntimeModelCatalogTarget): Promise<RuntimeModelCatalogView> {
  return request<RuntimeModelCatalogView>('runtime.modelCatalog.open', {
    runtimeKind,
    ...(waitForRefresh ? { waitForRefresh: true } : {}),
    ...(target?.forceRefresh ? { forceRefresh: true } : {}),
    ...(runtimeKind === 'deepseek-harness' && target ? target : {})
  })
}

// One local read in flight, with one trailing read for invalidations received
// during it. The same rule applies while the trailing read is in progress.
export function createRuntimeRefresh<T>(read: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  let again = false
  return () => {
    again = true
    if (pending) return pending
    pending = Promise.resolve().then(async () => {
      try {
        while (true) {
          again = false
          try {
            const result = await read()
            if (!again) return result
          } catch (error) { if (!again) throw error }
        }
      } finally { pending = null }
    })
    return pending
  }
}
