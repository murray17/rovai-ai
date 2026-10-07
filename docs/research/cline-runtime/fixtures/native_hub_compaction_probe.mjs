// Run only after the owned Hub has passed the source/authentication checks.
// Existing native provider/model files must already be privately projected.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { NativeHubClient, readOwnedDiscovery } from './native_hub_client.mjs'

const [rootArgument, variant, roundsArgument = '30'] = process.argv.slice(2)
if (!rootArgument || !['default', 'basic', 'agentic', 'off'].includes(variant)) {
  throw new Error('Usage: node native_hub_compaction_probe.mjs <owned-root> default|basic|agentic|off [rounds]')
}
const root = resolve(rootArgument)
const rounds = Number(roundsArgument)
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 60) throw new Error('Invalid round count')
const caseRoot = join(root, 'cases', variant)
mkdirSync(caseRoot, { recursive: false, mode: 0o700 })
const save = (name, value) => writeFileSync(join(caseRoot, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
const hash = text => createHash('sha256').update(text).digest('hex')
const nativeSettings = join(root, 'persistent/data/settings')
const providers = JSON.parse(readFileSync(join(nativeSettings, 'providers.json'), 'utf8'))
const providerId = providers.lastUsedProvider
const provider = providers.providers[providerId].settings
const modelCatalog = JSON.parse(readFileSync(join(nativeSettings, 'models.json'), 'utf8'))
if (!provider.apiKey || !provider.model || !modelCatalog.providers?.[providerId]?.models?.[provider.model]) {
  throw new Error('Expected native Provider credentials and model metadata are missing')
}
const compaction = variant === 'default' ? undefined
  : variant === 'off' ? { enabled: false } : { enabled: true, strategy: variant }
const systemPrompt = 'You are HUB76_IDENTITY, a native Cline Hub continuity test assistant. Preserve the early memory marker. Follow the requested brief response format. Do not use tools. Do not repeat the data records.'
const memory = 'HUB76_MEMORY_4e1bc952'
const report = {
  variant, startedAt: new Date().toISOString(), providerId, modelId: provider.model,
  configuredWindow: modelCatalog.providers[providerId].models[provider.model].contextWindow,
  knownModelsDelivered: true,
  compaction: compaction ?? null, systemSha256: hash(systemPrompt),
  providerFileSha256: hash(readFileSync(join(nativeSettings, 'providers.json'))),
  modelFileSha256: hash(readFileSync(join(nativeSettings, 'models.json'))),
  turns: [], nativeNotices: [], transportRetries: 0, clientCompactionContributions: 0
}
const discovery = await readOwnedDiscovery(join(root, 'host-temp/hub-owner.json'), root)
report.hub = { hubId: discovery.hubId, pid: discovery.pid, protocolVersion: discovery.protocolVersion, buildId: discovery.buildId }
const client = await NativeHubClient.connect(discovery, event => {
  appendFileSync(join(caseRoot, 'events.private.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 })
  if (JSON.stringify(event.payload?.metadata ?? {}).includes('compaction')
      || String(event.event).includes('compaction')) {
    report.nativeNotices.push({ event: event.event, eventId: event.eventId, sessionId: event.sessionId, timestamp: event.timestamp, metadata: event.payload?.metadata })
  }
})
let sid

function persistedMessages() {
  const path = join(root, 'persistent/data/sessions', sid, `${sid}.messages.json`)
  if (!existsSync(path)) return null
  const bytes = readFileSync(path)
  const value = JSON.parse(bytes.toString('utf8'))
  const messages = value.messages ?? []
  return { sha256: hash(bytes), bytes: bytes.length, count: messages.length,
    ids: messages.map(message => message.id), systemSha256: hash(value.system_prompt ?? '') }
}

async function turn(label, prompt) {
  const before = persistedMessages()
  const response = await client.command('run.start', { prompt, timeoutMs: 180_000 }, { sessionId: sid, timeoutMs: 185_000 })
  const result = response.payload?.result
  const item = { label, promptSha256: hash(prompt), promptBytes: Buffer.byteLength(prompt),
    replyOk: response.ok, errorCode: response.error?.code,
    finishReason: result?.finishReason, text: result?.text,
    usage: result?.usage, model: result?.model, startedAt: result?.startedAt, endedAt: result?.endedAt,
    lastAssistantMetrics: result?.messages?.findLast(message => message.role === 'assistant')?.metrics,
    persistedBefore: before, persistedAfter: persistedMessages()
  }
  report.turns.push(item)
  save('report.json', report)
  console.log(JSON.stringify({ variant, label, finishReason: item.finishReason,
    inputTokens: item.lastAssistantMetrics?.inputTokens,
    persistedMessages: item.persistedAfter?.count, replyMatched: label.startsWith('block-') ? item.text?.includes(label.replace('block-', 'BLOCK_') + '_ACK') : undefined }))
  if (!response.ok || result?.finishReason !== 'completed') {
    throw new Error(`Native turn did not complete: ${label}; no replay`)
  }
}

try {
  const registration = await client.register()
  if (!registration.ok) throw new Error('Client registration failed')
  report.clientId = client.clientId
  client.subscribe()
  const created = await client.command('session.create', {
    workspaceRoot: join(root, 'workspace'),
    sessionConfig: {
      providerId, modelId: provider.model, apiKey: provider.apiKey, baseUrl: provider.baseUrl,
      knownModels: modelCatalog.providers[providerId].models,
      cwd: join(root, 'workspace'), workspaceRoot: join(root, 'workspace'), systemPrompt,
      enableTools: false, enableSpawnAgent: false, enableAgentTeams: false,
      ...(compaction ? { compaction } : {})
    }
  }, { timeoutMs: 60_000 })
  save('create.private.json', created)
  if (!created.ok || !created.payload?.session?.sessionId) throw new Error('Native session creation failed')
  sid = created.payload.session.sessionId
  report.sessionId = sid
  console.log(JSON.stringify({ variant, sessionId: sid, phase: 'created' }))
  await turn('first', `Remember this early memory marker for later: ${memory}. Reply only with your system identity and this memory marker.`)
  for (let index = 1; index <= rounds; index++) {
    const label = String(index).padStart(2, '0')
    const records = Array.from({ length: 350 }, (_, item) => createHash('sha512').update(`rovai-cline-hub76:${index}:${item}`).digest('base64')).join('\n')
    await turn(`block-${label}`, `Context test data block ${index}. Keep the early memory marker. Do not use tools, repeat these records, or request a summary. Reply only BLOCK_${label}_ACK.\n${records}`)
  }
  await turn('continuity', 'Reply with your system identity and the exact early memory marker from our first exchange. Do not guess a missing marker.')
  const finalText = report.turns.at(-1)?.text ?? ''
  report.identityRetained = finalText.includes('HUB76_IDENTITY')
  report.earlyMemoryRetained = finalText.includes(memory)
} catch (error) {
  report.error = error.message.replaceAll(provider.apiKey, '[redacted]').replaceAll(provider.baseUrl ?? '\0', '[endpoint]')
  process.exitCode = 1
  console.log(JSON.stringify({ variant, error: report.error }))
} finally {
  await client.close()
  report.endedAt = new Date().toISOString()
  save('report.json', report)
}
