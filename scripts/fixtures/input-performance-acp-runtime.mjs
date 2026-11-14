// Controlled upstream for full-App performance acceptance. Core, persistence,
// IPC, subscriptions and production Renderer remain real; no model is contacted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

if (process.argv.includes('--version')) { console.log('GitHub Copilot CLI 1.0.88.'); process.exit(0) }
const controlIndex = process.argv.indexOf('--fixture-control')
const controlPath = process.argv[controlIndex + 1]
if (controlIndex < 0 || !controlPath) throw new Error('An isolated fixture control file is required')
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const sessionId = 'input-performance-' + process.pid
let channel = 'current', timer = null, promptId = null, sequence = 0, publishing = false
const invoke = promisify(execFile), publicationAttempts = new Set()
const control = () => { try { return JSON.parse(readFileSync(controlPath, 'utf8')) } catch { return {} } }
function finish(stopReason) {
  clearInterval(timer); timer = null
  if (promptId !== null) { send({ id: promptId, result: { stopReason } }); promptId = null }
}
async function publish(state) {
  publishing = true
  publicationAttempts.add(state.publicationResult)
  let stage = 'scope', result
  try {
    const cli = process.env.ROVAI_AGENT_CLI
    if (!cli || typeof state.publicationThreadId !== 'string') throw new Error('Missing isolated publication scope')
    // Never allow a fixture to inherit the controller's daily Thread binding.
    const scope = await invoke(cli, ['thread', 'read', '--limit', '1'], { env: process.env, maxBuffer: 1024 * 1024 })
    if (JSON.parse(scope.stdout).threadId !== state.publicationThreadId) throw new Error('CLI Thread scope mismatch')
    stage = 'send'
    const sent = await invoke(cli, ['send', '--public-only', '--input-file', state.publishFile], { env: process.env, maxBuffer: 1024 * 1024 })
    stage = 'ack'
    const ack = JSON.parse(sent.stdout)
    if (ack.agentAddressingMode !== 'public_only' || ack.effectiveRecipients?.length !== 0 || ack.deliveryIds?.length !== 0)
      throw new Error('Unexpected publication addressing')
    result = { code: 0, ack }
  } catch {
    result = { code: 1, stage, uncertain: stage !== 'scope' }
  } finally {
    // One attempt per nonce, even if the result file cannot be written.
    publishing = false
  }
  try { writeFileSync(state.publicationResult, JSON.stringify(result)) } catch { /* Preserve the in-memory no-retry fence. */ }
}
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  else if (['session/new', 'session/load', 'session/resume'].includes(message.method)) {
    channel = (message.params.cwd ?? '').includes('project-other') ? 'other' : 'current'
    send({ id: message.id, result: { sessionId, models: { currentModelId: 'fixture-model',
      availableModels: [{ modelId: 'fixture-model', name: 'Performance fixture' }] }, configOptions: [] } })
  } else if (message.method === 'session/prompt') {
    promptId = message.id
    clearInterval(timer)
    timer = setInterval(() => {
      const state = control()
      if (state.finish) return finish('end_turn')
      if (state[channel]) send({ method: 'session/update', params: { sessionId, update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `进展 ${++sequence}。` }
      } } })
      if (channel === 'current' && state.publishFile && typeof state.publicationResult === 'string' && !publishing
        && !publicationAttempts.has(state.publicationResult) && !existsSync(state.publicationResult)) void publish(state)
    }, 32)
  } else if (message.method === 'session/cancel') finish('cancelled')
  else if (message.id != null) send({ id: message.id, result: {} })
}
clearInterval(timer)
