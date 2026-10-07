// Read-only native hook contribution probe. Responses contain no control,
// messages, builder, or compaction contribution. Never replay uncertain input.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { NativeHubClient, readOwnedDiscovery } from './native_hub_client.mjs'

const root = resolve(process.argv[2])
const providers = JSON.parse(readFileSync(join(root, 'persistent/data/settings/providers.json'), 'utf8'))
const providerId = providers.lastUsedProvider
const provider = providers.providers[providerId].settings
const catalog = JSON.parse(readFileSync(join(root, 'persistent/data/settings/models.json'), 'utf8'))
const discovery = await readOwnedDiscovery(join(root, 'host-temp/hub-owner.json'), root)
const report = { hookCalls: [], events: [], responseErrors: [], retries: 0, clientCompactionContributions: 0 }
const names = ['beforeRun', 'afterRun', 'beforeModel', 'afterModel', 'onEvent']
const systemPrompt = 'You are HUB76_HOOK_IDENTITY. Follow the requested short response format.'
const hash = value => createHash('sha256').update(value).digest('hex')
const client = await NativeHubClient.connect(discovery, event => {
  report.events.push({ event: event.event, sessionId: event.sessionId, envelopeKeys: Object.keys(event) })
  if (event.event !== 'capability.requested' || event.payload?.targetClientId !== client.clientId) return
  const name = event.payload.capabilityName
  if (!names.some(item => name === `rovai.research.${item}`)) return
  const context = event.payload.payload?.context ?? {}
  const request = context.request ?? {}
  const system = request.systemPrompt ?? ''
  report.hookCalls.push({ name, sessionId: event.sessionId, requestId: event.payload.requestId,
    contextKeys: Object.keys(context), requestKeys: Object.keys(request),
    snapshot: context.snapshot ? Object.fromEntries(Object.entries(context.snapshot)
      .filter(([key]) => ['agentId', 'conversationId', 'runId', 'parentAgentId', 'iteration'].includes(key))) : undefined,
    modelId: request.modelId, providerId: request.providerId,
    systemBytes: Buffer.byteLength(system), systemSha256: hash(system),
    workingMessageCount: request.messages?.length, nativeEventType: context.type,
    modelInfo: request.model?.info ? Object.fromEntries(Object.entries(request.model.info)
      .filter(([key]) => ['contextWindow', 'maxInputTokens'].includes(key))) : undefined
  })
  client.command('capability.respond', { requestId: event.payload.requestId, ok: true, payload: {} }, { sessionId: event.sessionId })
    .then(reply => { if (!reply.ok) report.responseErrors.push(reply.error?.code) })
    .catch(() => report.responseErrors.push('transport_uncertainty'))
})
try {
  await client.register()
  client.subscribe()
  const created = await client.command('session.create', {
    workspaceRoot: join(root, 'workspace'),
    runtimeOptions: { clientContributions: names.map(name => ({ kind: 'hook', name, capabilityName: `rovai.research.${name}` })) },
    sessionConfig: {
      providerId, modelId: provider.model, apiKey: provider.apiKey, baseUrl: provider.baseUrl,
      knownModels: catalog.providers[providerId].models,
      cwd: join(root, 'workspace'), workspaceRoot: join(root, 'workspace'), systemPrompt,
      enableTools: false, enableSpawnAgent: false, enableAgentTeams: false,
      compaction: { enabled: true, strategy: 'basic' }
    }
  }, { timeoutMs: 60_000 })
  report.createOk = created.ok
  report.sessionId = created.payload?.session?.sessionId
  if (!created.ok || !report.sessionId) throw new Error('Native hook Session creation failed')
  const reply = await client.command('run.start', { prompt: 'Reply only with your system identity.', timeoutMs: 90_000 }, {
    sessionId: report.sessionId, timeoutMs: 95_000
  })
  report.run = { ok: reply.ok, error: reply.error, finishReason: reply.payload?.result?.finishReason, text: reply.payload?.result?.text }
  report.expectedSystemSha256 = hash(systemPrompt)
} catch (error) {
  report.error = error.message.replaceAll(provider.apiKey, '[redacted]')
} finally {
  await client.close()
  writeFileSync(join(root, 'hooks.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ sessionId: report.sessionId, run: report.run,
    hookCalls: report.hookCalls.length, responseErrors: report.responseErrors,
    nativeRunIds: [...new Set(report.hookCalls.map(call => call.snapshot?.runId).filter(Boolean))],
    beforeModel: report.hookCalls.filter(call => call.name === 'rovai.research.beforeModel')
  }, null, 2))
}
