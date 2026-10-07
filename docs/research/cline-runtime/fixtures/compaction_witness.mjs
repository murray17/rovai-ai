// Read-only witness. No message builder, prompt mutation, or compaction API.
import { appendFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.env.ROVAI_CLINE_OBSERVER_ROOT
const hash = value => createHash('sha256').update(value).digest('hex')
const destination = process.env.CLINE_ACP_EXPERIMENT_WITNESS_LOG ?? (root && join(root, 'request-witness.jsonl'))
let sessionId
function emit(kind, snapshot, payload) {
  if (!root || !destination || snapshot?.parentAgentId != null) return
  const binding = JSON.parse(readFileSync(join(root, 'bindings', `${hash(sessionId)}.json`), 'utf8'))
  appendFileSync(destination, JSON.stringify({ kind, sessionId, leaseId: binding.leaseId,
    runId: snapshot.runId, ...payload, observedAt: new Date().toISOString() }) + '\n', { mode: 0o600 })
}
export default {
  name: 'rovai-shim72-readonly-witness',
  manifest: { capabilities: ['hooks'] },
  setup(_api, context) { sessionId = context.session.sessionId },
  hooks: {
    beforeModel(context) {
      if (!root || context?.snapshot?.parentAgentId != null) return
      const system = context.request?.systemPrompt ?? ''
      const messages = context.request?.messages ?? []
      const tools = context.request?.tools
      const toolNames = Array.isArray(tools)
        ? tools.map(tool => tool.name ?? tool.function?.name).filter(Boolean).sort()
        : tools && typeof tools === 'object' ? Object.keys(tools).sort() : []
      const userText = JSON.stringify(messages.filter(message => message.role === 'user'))
      emit('readonly_before_model', context.snapshot, { requestId: context.requestId ?? null,
        systemMarkerCount: system.split('SHIM72_SYSTEM_ALPHA').length - 1,
        userSystemMarkerCount: userText.split('SHIM72_SYSTEM_ALPHA').length - 1,
        systemSha256: hash(system), systemBytes: Buffer.byteLength(system),
        workingMessageCount: messages.length, workingMessageBytes: Buffer.byteLength(JSON.stringify(messages)),
        toolNames,
      })
    },
    afterModel(context) {
      const metrics = Object.fromEntries(Object.entries(context.assistantMessage?.metrics ?? {})
        .filter(([key, value]) => ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokenCount'].includes(key)
          && Number.isSafeInteger(value) && value >= 0))
      emit('readonly_after_model', context.snapshot, { messageId: context.assistantMessage?.id, metrics })
    },
    onEvent(event) {
      if (event?.type !== 'status-notice' || !['manual_compaction', 'auto_compaction', 'overflow_recovery_compaction'].includes(event.metadata?.kind)) return
      const nativeMetadata = Object.fromEntries(Object.entries(event.metadata).filter(([key]) =>
        ['kind', 'phase', 'tokensBefore', 'tokensAfter', 'messagesBefore', 'messagesAfter'].includes(key)))
      emit('readonly_native_compaction', event.snapshot, { nativeMetadata })
    },
  },
}
