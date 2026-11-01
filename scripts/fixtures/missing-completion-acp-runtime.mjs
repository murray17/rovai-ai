// Synthetic ACP peer: first prompt produces output but never a completion;
// cancellation is deliberately ignored so Core must clean up the owned process.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

const pi = process.argv.includes('--fixture-pi')
if (process.argv.includes('--version')) {
  process.stdout.write(pi ? '0.84.4\n' : 'GitHub Copilot CLI 1.0.88.\n')
  process.exit(0)
}
const journal = process.argv[process.argv.indexOf('--fixture-journal') + 1]
const textArgument = process.argv.indexOf('--fixture-text')
const unfinishedText = textArgument === -1 ? null : readFileSync(process.argv[textArgument + 1], 'utf8')
let sessionId = pi ? crypto.randomUUID() : `missing-completion-${process.pid}`
const sessionArgument = process.argv.indexOf('--session')
let sessionFile = pi ? (sessionArgument < 0 ? join(dirname(journal), 'pi-sessions', `${sessionId}.jsonl`)
  : process.argv[sessionArgument + 1]) : null
const send = (value) => process.stdout.write(`${JSON.stringify(pi ? value : { jsonrpc: '2.0', ...value })}\n`)
function piSessionState() {
  if (typeof sessionFile !== 'string' || !sessionFile.startsWith(`${dirname(journal)}/`)) {
    throw new Error('Synthetic Pi Session must stay in this acceptance fixture')
  }
  mkdirSync(dirname(sessionFile), { recursive: true })
  writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: sessionId, cwd: process.cwd() }) + '\n')
  const binding = JSON.parse(readFileSync(process.env.ROVAI_PI_HOST_BINDING_FILE, 'utf8'))
  send({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'rovai-managed-session-state',
    statusText: JSON.stringify({ schemaVersion: 3, extensionVersion: 'rovai-pi-host-v8',
      hostInstanceId: binding.hostInstanceId, hostBindingGeneration: binding.hostBindingGeneration,
      sessionId, sessionFile, cwd: process.cwd() }) })
}
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  const respond = (data = {}) => send({ type: 'response', id: message.id, success: true, command: message.type, data })
  if (pi && message.type !== 'prompt') {
    if (message.type === 'switch_session') {
      sessionFile = message.sessionPath
      sessionId = JSON.parse(readFileSync(sessionFile, 'utf8').trim().split('\n')[0]).id
      piSessionState()
      respond({ cancelled: false })
    } else if (message.type === 'new_session') {
      sessionId = crypto.randomUUID()
      sessionFile = join(dirname(sessionFile), `${sessionId}.jsonl`)
      piSessionState()
      respond({ cancelled: false })
    } else if (message.type === 'get_state') {
      piSessionState()
      respond({ sessionId, sessionFile, model: { provider: 'fixture', id: 'fixture-model' }, thinkingLevel: 'off' })
    } else if (message.type === 'get_available_models') {
      respond({ models: [{ provider: 'fixture', id: 'fixture-model', name: 'Fixture' }] })
    } else respond()
  } else if (message.method === 'initialize') {
    if (existsSync(`${journal}.launch-gate`)) {
      writeFileSync(`${journal}.launch-started`, JSON.stringify({ pid: process.pid }))
      while (existsSync(`${journal}.launch-gate`)) await new Promise(resolve => setTimeout(resolve, 20))
    }
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  } else if (['session/new', 'session/load', 'session/resume'].includes(message.method)) {
    send({ id: message.id, result: { sessionId, models: {
      currentModelId: 'fixture-model', availableModels: [{ modelId: 'fixture-model', name: 'Fixture' }]
    }, configOptions: [] } })
  } else if (message.method === 'session/prompt' || (pi && message.type === 'prompt')) {
    let previous = []
    try { previous = readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    appendFileSync(journal, JSON.stringify({ pid: process.pid, sessionId, startedAt: Date.now(), prompt: message.params ?? message.message }) + '\n')
    const complete = previous.length > 0 || existsSync(`${journal}.complete`)
    if (pi) {
      respond()
      send({ type: 'agent_start' })
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Fixture work.' } })
      if (complete) {
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Continuation finished successfully.' }] } })
        send({ type: 'agent_settled' })
      }
      continue
    }
    send({ method: 'session/update', params: { sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: unfinishedText ?? (previous.length
        ? 'Continuation finished successfully.' : 'Work performed; completion response deliberately missing.') }
    } } })
    if (complete && unfinishedText === null) send({ id: message.id, result: { stopReason: 'end_turn' } })
  } else if (message.method !== 'session/cancel' && message.id != null) {
    send({ id: message.id, result: {} })
  }
}
