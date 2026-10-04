#!/usr/bin/env node
// Controlled ACP text stream for the isolated packaged-App metrics acceptance.
// This impersonates a selected ACP executable only through an isolated test override.
import { createInterface } from 'node:readline'

const copilot = process.env.ROVAI_STREAMING_ACP_KIND === 'copilot-cli'
if (process.argv.includes('--version')) {
  process.stdout.write(copilot ? 'GitHub Copilot CLI 1.0.83.\n' : '0.24.5\n')
  process.exit(0)
}

const sessionId = `fixture-stream-${process.pid}`
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const update = (value) => send({ method: 'session/update', params: { sessionId, update: value } })
const privateEvent = (type, data, extra = {}) => send({ method: 'github.com/copilot/sessionEvent',
  params: { sessionId, type, timestamp: new Date().toISOString(), data, ...extra } })
const text = 'steady visible output '.repeat(4)
const thought = 'V3_PRIVATE_REASONING_FIXTURE_かな🙂'
let busy = false

for await (const line of createInterface({ input: process.stdin })) {
  let message
  try { message = JSON.parse(line) } catch { continue }
  if (message.method === 'initialize') {
    send({ id: message.id, result: {
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { resume: {} } }
    } })
  } else if (message.method === 'session/new' || message.method === 'session/resume') {
    send({ id: message.id, result: {
      sessionId,
      models: {
        currentModelId: 'fixture-model',
        availableModels: [{ modelId: 'fixture-model', name: 'Fixture model' }]
      },
      configOptions: []
    } })
  } else if (message.method === 'session/prompt') {
    if (busy) {
      send({ id: message.id, error: { code: -32001, message: 'busy' } })
      continue
    }
    busy = true
    if (JSON.stringify(message.params).includes('ROVAI_STREAM_FAST_SETUP')) {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ROVAI_STREAM_FAST_READY' } })
      send({ id: message.id, result: { stopReason: 'end_turn' } })
      busy = false
      continue
    }
    if (process.env.ROVAI_METRICS_HELD_FINAL === '1') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Context acceptance running' } })
      await pause(4_000)
      update({ sessionUpdate: 'usage_update', used: 12_800, size: 200_000 })
      await pause(9_000)
      update({ sessionUpdate: 'usage_update', used: 15_000 })
      await pause(9_000)
      update({ sessionUpdate: 'usage_update', used: 8_000 })
      await pause(9_000)
      update({ sessionUpdate: 'usage_update', used: 12_800 })
      await pause(9_000)
      send({ id: message.id, result: { stopReason: 'end_turn' } })
      busy = false
      continue
    }
    let thoughtOffset = 0
    for (let index = 0; index < 14; index++) {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
      if (index === 0) {
        update({ sessionUpdate: 'agent_thought_chunk', messageId: 'fixture-root-thought',
          snapshot: true, content: { type: 'text', text: 'Q'.repeat(1000) } })
        if (copilot) {
          privateEvent('assistant.reasoning_delta', { reasoningId: 'child', deltaContent: thought.repeat(100) }, { agentId: 'child' })
          privateEvent('assistant.reasoning_delta', {}, { dataOmitted: 'too-large' })
          privateEvent('assistant.usage', { reasoningSummary: thought })
        }
      }
      if (index % 2 === 0) {
        // Cover both native offsets and standard ACP chunks without an offset.
        const value = { sessionUpdate: 'agent_thought_chunk', messageId: 'fixture-root-thought',
          textOffset: thoughtOffset, content: { type: 'text', text: thought } }
        if (index >= 6) { delete value.messageId; delete value.textOffset }
        update(value)
        if (copilot) privateEvent('assistant.reasoning_delta', { reasoningId: 'fixture-root-thought', deltaContent: thought })
        thoughtOffset += thought.length // ACP offsets use UTF-16 code units.
      }
      await pause(500)
    }
    update({ sessionUpdate: 'tool_call', toolCallId: 'fixture-tool', title: 'Controlled tool pause',
      kind: 'other', status: 'in_progress' })
    await pause(6_000)
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'fixture-tool', status: 'completed' })
    for (let index = 0; index < 10; index++) {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
      await pause(500)
    }
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ROVAI_QWEN_ACP_OK' } })
    send({ id: message.id, result: { stopReason: 'end_turn' } })
    busy = false
  } else if (message.id != null) {
    send({ id: message.id, result: {} })
  }
}
