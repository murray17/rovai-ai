// Research only: restart a previously verified, privately owned Hub and test
// the native attach path. Never retry the prompt or recreate its Session.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { NativeHubClient, readOwnedDiscovery } from './native_hub_client.mjs'

const root = resolve(process.argv[2])
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'))
const selected = read('discovery.json').inspection.executablePath
const expectedDaemon = read('stage-a.json').daemonExecutable
const previous = await readOwnedDiscovery(join(root, 'host-temp/hub-owner.json'), root)
function verifyProcess(record) {
  if (execFileSync('/bin/ps', ['-p', String(record.pid), '-o', 'comm='], { encoding: 'utf8' }).trim() !== expectedDaemon) {
    throw new Error('Hub process no longer matches the verified installation')
  }
}
verifyProcess(previous)
const endpoint = new URL(previous.url)
endpoint.protocol = 'http:'
endpoint.pathname = '/shutdown'
const stopped = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${previous.authToken}` } })
if (stopped.status !== 202) throw new Error('Owned Hub did not accept shutdown')
let exited = false
for (let attempt = 0; attempt < 100; attempt++) {
  try { process.kill(previous.pid, 0) } catch { exited = true; break }
  await new Promise(resolve => setTimeout(resolve, 100))
}
if (!exited) throw new Error('Owned Hub still alive; refusing replacement')
const environment = {}
for (const key of ['PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
  if (process.env[key]) environment[key] = process.env[key]
}
Object.assign(environment, {
  HOME: join(root, 'native-home'), CLINE_DIR: join(root, 'persistent/config'),
  CLINE_DATA_DIR: join(root, 'persistent/data'),
  CLINE_PROVIDER_SETTINGS_PATH: join(root, 'persistent/data/settings/providers.json'),
  CLINE_GLOBAL_SETTINGS_PATH: join(root, 'persistent/data/settings/global-settings.json'),
  CLINE_MCP_SETTINGS_PATH: join(root, 'mcp.json'),
  CLINE_HUB_DISCOVERY_PATH: join(root, 'host-temp/hub-owner.json'),
  TMPDIR: join(root, 'host-temp'), DO_NOT_TRACK: '1'
})
const started = spawnSync(selected, ['hub', '--host', '127.0.0.1', '--port', '0', '--cwd', join(root, 'workspace'), 'start'], {
  env: environment, cwd: join(root, 'workspace'), encoding: 'utf8', timeout: 25_000
})
if (started.status !== 0) throw new Error('Owned Hub restart failed')
const current = await readOwnedDiscovery(join(root, 'host-temp/hub-owner.json'), root)
verifyProcess(current)
const report = {
  startedAt: new Date().toISOString(), oldProcessExited: exited,
  tokenRotated: previous.authToken !== current.authToken,
  previous: { hubId: previous.hubId, pid: previous.pid },
  current: { hubId: current.hubId, pid: current.pid },
  events: [], promptSubmissions: 0, retries: 0
}
const original = read('cases/basic/report.json')
const sessionId = original.sessionId
report.sessionId = sessionId
const client = await NativeHubClient.connect(current, event => {
  report.events.push({ event: event.event, eventId: event.eventId, sessionId: event.sessionId,
    timestamp: event.timestamp, envelopeKeys: Object.keys(event), payloadKeys: Object.keys(event.payload ?? {}) })
})
try {
  await client.register()
  client.subscribe(sessionId)
  const attached = await client.command('session.attach', {}, { sessionId })
  report.attach = { ok: attached.ok, sessionId: attached.payload?.session?.sessionId, error: attached.error }
  const messages = await client.command('session.messages', {}, { sessionId })
  report.messages = { ok: messages.ok, count: messages.payload?.messages?.length }
  if (!attached.ok || !messages.ok) throw new Error('Native attach or persisted history read failed')
  report.promptSubmissions++
  const response = await client.command('run.start', {
    prompt: 'Reply with your system identity and the exact early memory marker from our first exchange. Do not guess a missing marker.',
    timeoutMs: 90_000
  }, { sessionId, timeoutMs: 95_000 })
  const result = response.payload?.result
  report.run = { ok: response.ok, error: response.error, finishReason: result?.finishReason,
    text: result?.text, model: result?.model,
    inputTokens: result?.messages?.findLast(message => message.role === 'assistant')?.metrics?.inputTokens }
  report.identityRetained = result?.text?.includes('HUB76_IDENTITY') ?? false
  report.memoryRetained = result?.text?.includes('HUB76_MEMORY_4e1bc952') ?? false
} catch (error) {
  report.error = error.message
} finally {
  await client.close()
  report.endedAt = new Date().toISOString()
  writeFileSync(join(root, 'cold.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
}
