import { configureProductRuntime } from './configure-product-runtime.mjs'

export async function configureCodexRuntime(request, _health, agentProfileIds) {
  return configureProductRuntime(request, 'codex-cli', agentProfileIds)
}
