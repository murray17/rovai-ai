// Read-only native Plugin hooks. The probe substitutes only the output path.
// No builder, history projection, contribution or compaction implementation.
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const output = '__ROVAI_HUB_WITNESS_PATH__'
const hash = value => createHash('sha256').update(value).digest('hex')
function emit(kind, snapshot, value) {
  appendFileSync(output, JSON.stringify({ kind,
    agentId: snapshot?.agentId, conversationId: snapshot?.conversationId,
    runId: snapshot?.runId, parentAgentId: snapshot?.parentAgentId,
    ...value, observedAt: new Date().toISOString()
  }) + '\n', { mode: 0o600 })
}
export default {
  name: 'rovai-native-hub-readonly-witness',
  manifest: { capabilities: ['hooks'] },
  setup(_api, context) {
    emit('setup', undefined, { sessionId: context?.session?.sessionId })
  },
  hooks: {
    beforeModel(context) {
      const request = context.request ?? {}
      const system = request.systemPrompt ?? ''
      const messages = request.messages ?? []
      emit('before_model', context.snapshot, {
        requestId: context.requestId, systemSha256: hash(system),
        systemBytes: Buffer.byteLength(system), workingMessageCount: messages.length,
        workingMessageBytes: Buffer.byteLength(JSON.stringify(messages)),
        modelId: request.modelId, providerId: request.providerId,
        contextWindow: request.model?.info?.contextWindow,
        maxInputTokens: request.model?.info?.maxInputTokens
      })
    },
    afterModel(context) {
      const metrics = Object.fromEntries(Object.entries(context.assistantMessage?.metrics ?? {})
        .filter(([key, value]) => ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].includes(key)
          && Number.isSafeInteger(value) && value >= 0))
      emit('after_model', context.snapshot, { messageId: context.assistantMessage?.id, metrics })
    },
    onEvent(event) {
      if (event?.type !== 'status-notice' || !String(event.metadata?.reason ?? '').includes('compaction')) return
      emit('native_notice', event.snapshot, {
        metadata: Object.fromEntries(Object.entries(event.metadata ?? {}).filter(([key]) =>
          ['kind', 'reason', 'phase', 'iteration', 'triggerTokens', 'maxInputTokens', 'tokensBefore', 'tokensAfter', 'messagesBefore', 'messagesAfter'].includes(key)))
      })
    }
  }
}
