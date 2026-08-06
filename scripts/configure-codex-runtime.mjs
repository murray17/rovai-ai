import { configureProductRuntime } from './configure-product-runtime.mjs'

export async function configureCodexRuntime(request, _health, agentIds) {
  return configureProductRuntime(request, 'codex-cli', agentIds)
}
