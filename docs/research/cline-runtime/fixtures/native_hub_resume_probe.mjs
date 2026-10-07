// Follow the selected native CLI's actual resume sequence, verified read-only
// in its installed interactive session manager: readMessages(id), then
// start({config: {...config, sessionId: id}, initialMessages}). This is same-Hub
// backend rehydration, not ACP migration, a replacement ID, or prompt replay.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { NativeHubClient, readOwnedDiscovery } from './native_hub_client.mjs'

if (process.argv.length !== 3) throw new Error('Usage: node native_hub_resume_probe.mjs <owned-root>')
const root = resolve(process.argv[2])
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const source = read('cases/basic/report.json')
const sessionId = source.sessionId
const providers = read('persistent/data/settings/providers.json')
const providerId = providers.lastUsedProvider
const provider = providers.providers[providerId].settings
const catalog = read('persistent/data/settings/models.json')
const hash = value => createHash('sha256').update(value).digest('hex')
const canonicalHash = value => hash(JSON.stringify(value))
const discovery = await readOwnedDiscovery(join(root, 'host-temp/hub-owner.json'), root)
const report = { sessionId, hubId: discovery.hubId, pid: discovery.pid, promptSubmissions: 0, retries: 0, events: [] }
const client = await NativeHubClient.connect(discovery, event => report.events.push({
  event: event.event, sessionId: event.sessionId, eventId: event.eventId
}))
const saved = () => read(`persistent/data/sessions/${sessionId}/${sessionId}.messages.json`)
try {
  await client.register()
  client.subscribe(sessionId)
  const fetched = await client.command('session.get', {}, { sessionId })
  const nativeSession = fetched.payload?.session
  const history = await client.command('session.messages', {}, { sessionId })
  const systemPrompt = nativeSession?.metadata?.systemPrompt
  if (!fetched.ok || nativeSession?.sessionId !== sessionId || !history.ok
      || !Array.isArray(history.payload?.messages) || history.payload.messages.length === 0
      || typeof systemPrompt !== 'string' || hash(systemPrompt) !== source.systemSha256
      || providerId !== source.providerId || provider.model !== source.modelId) {
    throw new Error('Exact native Session/configuration evidence missing; refusing rehydration')
  }
  const before = saved()
  report.messagesBefore = before.messages.length
  report.messagesBeforeSha256 = canonicalHash(before.messages)
  report.protocolHistoryMatchesDisk = canonicalHash(history.payload.messages) === report.messagesBeforeSha256
  // This installed CLI's native reader removes its own mode wrapper. Validate
  // that observed difference for evidence only; never transform the messages
  // delivered back to the native API.
  const comparable = structuredClone(before.messages)
  for (const message of comparable) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'text' && block.text.startsWith('<user_input mode="act">') && block.text.endsWith('</user_input>')) {
        block.text = block.text.slice('<user_input mode="act">'.length, -'</user_input>'.length)
      }
    }
  }
  report.protocolHistoryDiffOnlyNativeModeWrapper = canonicalHash(comparable) === canonicalHash(history.payload.messages)
  if (!report.protocolHistoryDiffOnlyNativeModeWrapper) throw new Error('Unexplained difference between native protocol and persisted history')
  const started = await client.command('session.create', {
    workspaceRoot: nativeSession.workspaceRoot,
    initialMessages: history.payload.messages,
    sessionConfig: {
      sessionId, providerId, modelId: provider.model, apiKey: provider.apiKey, baseUrl: provider.baseUrl,
      knownModels: catalog.providers[providerId].models, cwd: nativeSession.cwd,
      workspaceRoot: nativeSession.workspaceRoot, systemPrompt,
      enableTools: false, enableSpawnAgent: false, enableAgentTeams: false,
      compaction: source.compaction
    }
  }, { timeoutMs: 60_000 })
  report.resume = { ok: started.ok, sessionId: started.payload?.session?.sessionId, error: started.error }
  if (!started.ok || started.payload?.session?.sessionId !== sessionId) throw new Error('Native rehydration changed Session identity or failed')
  const rehydrated = saved()
  const reread = await client.command('session.messages', {}, { sessionId })
  report.persistedBytesUnchangedBeforePrompt = canonicalHash(rehydrated.messages) === report.messagesBeforeSha256
  report.messagesUnchangedBeforePrompt = reread.ok && canonicalHash(reread.payload?.messages) === canonicalHash(history.payload.messages)
  report.systemUnchangedBeforePrompt = hash(rehydrated.system_prompt) === source.systemSha256
  if (!report.messagesUnchangedBeforePrompt || !report.systemUnchangedBeforePrompt) throw new Error('Native rehydration changed persisted history or System')
  report.promptSubmissions++
  const response = await client.command('run.start', {
    prompt: 'After this cold restart, reply with your system identity and the exact early memory marker from our first exchange. Do not guess a missing marker.',
    timeoutMs: 90_000
  }, { sessionId, timeoutMs: 95_000 })
  const result = response.payload?.result
  report.run = { ok: response.ok, error: response.error, finishReason: result?.finishReason,
    text: result?.text, model: result?.model,
    inputTokens: result?.messages?.findLast(message => message.role === 'assistant')?.metrics?.inputTokens }
  report.identityRetained = result?.text?.includes('HUB76_IDENTITY') ?? false
  report.memoryRetained = result?.text?.includes('HUB76_MEMORY_4e1bc952') ?? false
  report.messagesAfter = saved().messages.length
} catch (error) { report.error = error.message.replaceAll(provider.apiKey, '[redacted]') }
finally {
  await client.close()
  report.endedAt = new Date().toISOString()
  writeFileSync(join(root, 'native-resume.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ ...report, events: report.events.length }, null, 2))
}
