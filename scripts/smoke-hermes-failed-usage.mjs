// Isolated production Core + unmodified native Hermes + controlled Responses.
// First model call has usage and a real tool; the next fails. Official ACP does
// not expose that prompt delta: preserve failure and leave consumption unknown.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

assert(process.env.ROVAI_HERMES_BIN)
const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermes-failed-usage-')))
const home = join(root, 'home'), project = join(root, 'project'), data = join(root, 'data')
await mkdir(home, { mode: 0o700 }); await mkdir(project)
await writeFile(join(root, 'mcp.json'), '{}')
await writeFile(join(project, 'read-me.txt'), 'Controlled tool evidence.\n')
if (process.env.ROVAI_HERMES_DEPENDENCY_HOME) await symlink(join(process.env.ROVAI_HERMES_DEPENDENCY_HOME, 'installs'), join(home, 'installs'), 'dir')
let requests = 0, wireError, core, database
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] })); return
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!Array.isArray(body.input)) {
      // Hermes asks local endpoints for Ollama model context metadata too.
      assert.equal(request.url, '/api/show')
      assert.deepEqual(Object.keys(body), ['name'])
      response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); return
    }
    requests++
    if (requests > 1) {
      assert(body.input.some(item => item.type === 'function_call_output'), 'Failure must follow a real tool result')
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Controlled second-call failure', type: 'authentication_error', code: 'invalid_api_key' } })); return
    }
    const item = { id: 'call-item', type: 'function_call', call_id: 'read-proof', name: 'read_file',
      arguments: JSON.stringify({ path: join(project, 'read-me.txt') }), status: 'completed' }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    const emit = event => response.write('data: ' + JSON.stringify({ ...event, sequence_number: sequence++ }) + '\n\n')
    emit({ type: 'response.created', response: { id: 'known-usage', status: 'in_progress', output: [] } })
    emit({ type: 'response.output_item.added', output_index: 0, item })
    emit({ type: 'response.output_item.done', output_index: 0, item })
    emit({ type: 'response.completed', response: { id: 'known-usage', status: 'completed', output: [item],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 2 } } } })
    response.end()
  } catch (error) { wireError = error; response.writeHead(500); response.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
await writeFile(join(home, 'config.yaml'), JSON.stringify({ model: { provider: 'fixture', default: 'fixture-model' },
  providers: { fixture: { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key_env: 'ROVAI_HERMES_FIXTURE_KEY', transport: 'codex_responses', models: ['fixture-model'] } },
  platform_toolsets: { acp: ['file', 'no_mcp'] }, session_title: { enabled: false }, agent: { max_turns: 5 } }), { mode: 0o600 })
console.log('Automatic acceptance:', JSON.stringify({ root, data, skillLibrary: join(data, 'managed-skill-library'), home }))
try {
  core = startQualificationCore({ coreExecutable: join(repository, 'target/debug/rovai-core'), dataDirectory: data,
    workingDirectory: repository, runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(root, 'mcp.json'),
    environmentOverrides: { HERMES_HOME: home, HERMES_EPHEMERAL_SYSTEM_PROMPT: '', ROVAI_HERMES_FIXTURE_KEY: 'controlled-fixture' } })
  await core.request('health.check')
  const discovery = Date.now() + 45000
  while (Date.now() < discovery) {
    const status = await core.request('runtime.status.get')
    if (status.runtimeAvailability.some(row => row.runtimeKind === 'hermes-cli' && row.discovery.discoveryStatus !== 'detecting')) break
    await new Promise(done => setTimeout(done, 100))
  }
  console.log('Hermes check:', JSON.stringify(await core.request('runtime.product.check', { runtimeKind: 'hermes-cli' })))
  let installation
  const ready = Date.now() + 120000
  while (Date.now() < ready) {
    installation = (await core.request('runtime.installations.list')).find(row => row.adapterKind === 'hermes-cli' && row.installationClass === 'managed_default')
    if (['ready', 'probe_failed', 'missing_capabilities'].includes(installation?.snapshot?.probeStatus)) break
    await new Promise(done => setTimeout(done, 250))
  }
  console.log('Hermes probe:', installation?.snapshot?.probeStatus, installation?.snapshot?.lastError)
  assert.equal(installation?.snapshot?.probeStatus, 'ready', installation?.snapshot?.lastError ?? 'No ready Hermes installation')
  const member = await core.request('members.get', { agentId: 'agent_2' })
  const selected = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: 'agent_2', expectedVersion: member.version, adapterKind: 'hermes-cli',
    model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions } })
  assert.equal(selected.status, 'applied')
  const sent = await createConfiguredCampAndSend(core.request, { commandId: crypto.randomUUID(), name: 'Failed usage acceptance',
    purpose: 'Controlled Hermes failed-turn accounting', body: 'Read read-me.txt using read_file, then finish.',
    memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', workspace: { projectPath: project } })
  const thread = sent.payload.threadId ?? sent.payload.campId
  database = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  let run, usage
  const finished = Date.now() + 120000
  while (Date.now() < finished) {
    run = database.prepare('SELECT id,status FROM agent_run WHERE camp_id=? ORDER BY created_at DESC LIMIT 1').get(thread)
    usage = run && database.prepare('SELECT * FROM runtime_usage_run_summary WHERE agent_run_id=?').get(run.id)
    if (run?.status === 'failed') break
    if (run && ['succeeded', 'cancelled'].includes(run.status)) break
    await new Promise(done => setTimeout(done, 100))
  }
  if (wireError) throw wireError
  assert.equal(requests, 2)
  assert.equal(run?.status, 'failed')
  for (const field of ['prompt_input_total_tokens', 'output_tokens', 'cache_read_tokens',
    'reasoning_output_tokens', 'cache_write_tokens', 'cost_amount_decimal']) {
    assert.equal(usage?.[field] ?? null, null, `Unreported prompt consumption was fabricated: ${field}`)
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?').get(thread).n, 1)
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM runtime_usage_checkpoint WHERE agent_run_id=? AND source_kind LIKE '%hermes%'").get(run.id).n, 0)
  const result = { failed: true, usageUnknown: true, noReplay: true, requests }
  await writeFile(join(root, 'summary.json'), JSON.stringify(result, null, 2))
  console.log('Native failure preserved with unknown prompt consumption:', JSON.stringify(result))
} finally {
  database?.close()
  if (core) {
    const stopped = await core.stop()
    if (wireError) console.error(stopped.stderrTail)
  }
  server.closeAllConnections(); await new Promise(done => server.close(done))
}
