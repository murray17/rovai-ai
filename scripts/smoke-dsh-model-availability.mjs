// Real isolated Core/DSH with loopback Responses and Messages endpoints.
// Owns selection provenance across refresh and prepared-Host reuse, which the
// pure Provider preparation tests cannot prove. No paid model requests.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(process.env.ROVAI_DSH_SMOKE_ROOT ?? await mkdtemp(join(tmpdir(), 'rovai-dsh-availability-')))
assert(root.startsWith((await realpath(tmpdir())) + sep), 'Smoke root must be under the system temporary directory')
assert.equal((await readdir(root)).length, 0, 'Use an empty isolated smoke root')
const data = join(root, 'data'), home = join(root, 'home'), project = join(root, 'project')
const webPath = join(home, 'profiles/web/cordis.patch.yml')
const acpPath = join(home, 'profiles/acp/cordis.patch.yml')
const wirePath = join(root, 'acp-wire.jsonl')
const requests = [], events = [], results = []
let core, installation, workspace, wireFailure
const server = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    assert.equal(request.method, 'POST')
    assert(['same-model', 'effort-a', 'effort-b', 'effort-none'].includes(body.model))
    assert(['/native/responses', '/web/responses', '/fallback/responses', '/other/v1/messages'].includes(request.url), request.url)
    const key = request.headers.authorization ?? request.headers['x-api-key']
    assert(String(key).includes(request.url.startsWith('/web') ? 'web-synthetic' : 'native-synthetic'))
    requests.push({ path: request.url, model: body.model, key, effort: body.reasoning?.effort })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const text = 'LOCAL_AVAILABILITY_OK', id = 'fixture-' + requests.length
    if (request.url === '/other/v1/messages') {
      const emit = value => response.write('event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n')
      emit({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: body.model,
        content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
      emit({ type: 'message_stop' })
    } else {
      let sequence = 0
      const emit = value => response.write('data: ' + JSON.stringify({ ...value, sequence_number: sequence++ }) + '\n\n')
      const item = { id: 'msg-' + id, type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }] }
      emit({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
      emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
      emit({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text })
      emit({ type: 'response.output_item.done', output_index: 0, item })
      emit({ type: 'response.completed', response: { id, status: 'completed', output: [item],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } })
    }
    response.end()
  } catch (error) {
    wireFailure ??= error
    response.writeHead(400).end('controlled fixture assertion failed')
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const endpoint = 'http://127.0.0.1:' + server.address().port
const route = path => ({ api: 'openai-responses', baseURL: endpoint + '/' + path,
  apiKeyEnv: path === 'web' ? 'WEB_FIXTURE_KEY' : 'NATIVE_FIXTURE_KEY',
  models: [{ id: 'same-model', contextWindow: 200000, maxTokens: 4096, reasoningEfforts: { high: 'high' } }] })
const json = (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600 })
const modelId = (provider, model = 'same-model') => JSON.stringify([provider, model])
const wire = async () => (await readFile(wirePath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
async function refresh() {
  const checked = await core.request('runtime.product.check', { runtimeKind: 'deepseek-harness' })
  if (!checked.ready) {
    const failed = (await core.request('runtime.installations.list')).find(row => row.adapterKind === 'deepseek-harness')
    console.error(JSON.stringify({ check: checked, attempt: failed?.lastProbeAttempt, snapshot: failed?.snapshot }))
  }
  assert.equal(checked.ready, true, JSON.stringify(checked))
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    installation = (await core.request('runtime.installations.list')).find(row => row.adapterKind === 'deepseek-harness')
    if (installation?.snapshot?.probeStatus === 'ready') return installation.snapshot.models
    await new Promise(done => setTimeout(done, 100))
  }
  assert.fail('DSH probe did not become ready')
}
async function select(provider, source, model = 'same-model', options = { reasoning_effort: 'high' }) {
  const profile = await core.request('members.get', { agentId: 'agent_2' })
  const response = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: 'agent_2', expectedVersion: profile.version, adapterKind: 'deepseek-harness',
    // Missing source also exercises the CLI/server path: infer only at explicit save.
    model: { mode: 'explicit', modelId: modelId(provider, model), options,
      ...(source ? { dshSource: source } : {}) },
    permissions: { ...installation.memberRuntimeDefaults.permissions,
      values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
  } })
  assert.equal(response.status, 'applied')
  return (await core.request('members.get', { agentId: 'agent_2' })).runtimeConfiguration.model
}
async function run(threadId, expected = 'succeeded', errorCode = 'runtime_model_unavailable') {
  const wireStart = (await wire()).length
  const body = 'Reply with the local fixture marker.'
  const input = { commandId: crypto.randomUUID(), workspace, body, memberAgentIds: ['agent_2'],
    defaultLeadAgentId: 'agent_2', address: { mode: 'explicit', agentIds: ['agent_2'] }, purpose: 'DSH model availability regression' }
  const sent = threadId
    ? await core.request('thread.messages.send', { commandId: input.commandId, threadId,
      content: composerDocumentForAddress(input.address, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
      execution: { taskId: null, purpose: input.purpose, completionRole: 'required' } })
    : await createConfiguredCampAndSend(core.request, input)
  const command = sent.commandResult ?? sent
  assert.equal(command.status, 'accepted')
  threadId ??= command.payload.threadId
  const messageId = command.payload.threadMessageId
  let record
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (wireFailure) throw wireFailure
    const snapshot = await core.request('camps.snapshot', { threadId })
    record = snapshot.agentRuns.find(row => row.inputMessageIds?.includes(messageId) || row.anchorMessageId === messageId)
    if (['succeeded', 'failed', 'cancelled'].includes(record?.status)) break
    await new Promise(done => setTimeout(done, 100))
  }
  const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  let failure
  try { failure = db.prepare('SELECT last_error_code, public_runtime_failure_json, effective_config_json FROM agent_run WHERE id = ?').get(record?.id) }
  finally { db.close() }
  assert.equal(record?.status, expected, JSON.stringify(failure))
  if (expected === 'failed') assert.equal(failure.last_error_code, errorCode, failure.public_runtime_failure_json)
  const start = events.find(event => event.params?.agentRunId === record.id && event.params?.hostInstanceId && event.params?.nativeThreadId)
  const messages = (await wire()).slice(wireStart)
  const prompt = messages.find(message => message.method === 'session/prompt')
  return { threadId, host: start?.params.hostInstanceId, session: prompt?.sessionId, pid: prompt?.pid,
    frozen: JSON.parse(failure.effective_config_json).runtime,
    wire: messages, failure }
}
try {
  await mkdir(project)
  for (const profile of ['web', 'acp']) {
    await mkdir(join(home, 'profiles', profile), { recursive: true })
    await json(join(home, 'profiles', profile, 'package.json'), { private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-' + profile + '-app'] } } })
  }
  const acp = [{ id: 'llm-pi-ai', config: { providers: { relay: route('native'), disabled: null } } },
    { id: 'acp', config: { provider: 'thinking', model: 'effort-a' } },
    { id: 'llm-deepseek', config: { baseURL: endpoint + '/other', models: [{ id: 'same-model', contextWindow: 200000 }] } }]
  const web = [{ id: 'llm-pi-ai', config: { providers: {
    relay: { __jsExpr: 'unresolvedWebRoute' }, disabled: route('web'), extra: route('web'),
    thinking: { ...route('web'), models: [
      { id: 'effort-a', contextWindow: 200000, maxTokens: 4096, reasoningEfforts: { max: 'high' } },
      { id: 'effort-b', contextWindow: 200000, maxTokens: 4096, reasoningEfforts: { high: 'high', xhigh: 'xhigh' } },
      { id: 'effort-none', contextWindow: 200000, maxTokens: 4096 }
    ] }
  } } }]
  await json(acpPath, acp)
  await json(webPath, web)
  await json(join(root, 'mcp.json'), {})
  // Transparent protocol recorder: store only method/selection identity, never
  // prompt text, native config, environment, or credentials.
  const dshPackage = process.argv[2]
  assert(dshPackage, 'Pass the installed DSH package path')
  const executable = join(root, 'recording-dsh.mjs')
  await writeFile(wirePath, '')
  await writeFile(executable, `#!${process.execPath}
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { Transform } from 'node:stream'
const child = spawn(process.execPath, [${JSON.stringify(join(resolve(dshPackage), 'lib/bin.js'))}, ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'] })
let pending = ''
process.stdin.pipe(new Transform({ transform(chunk, encoding, done) {
  pending += chunk.toString()
  let newline
  while ((newline = pending.indexOf('\\n')) >= 0) {
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
    try { const message = JSON.parse(line)
      if (message.method?.startsWith('session/')) {
        const { sessionId, configId, value } = message.params ?? {}
        appendFileSync(${JSON.stringify(wirePath)}, JSON.stringify({ pid: process.pid, method: message.method, sessionId, configId, value }) + '\\n')
      }
    } catch {}
  }
  done(null, chunk)
}})).pipe(child.stdin)
child.stdout.pipe(process.stdout)
child.stdin.on('error', () => {})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
child.on('close', code => process.exit(code ?? 1))
`)
  await chmod(executable, 0o700)
  Object.assign(process.env, { DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'),
    DSH_TELEMETRY_DISABLED: '1', NATIVE_FIXTURE_KEY: 'native-synthetic', WEB_FIXTURE_KEY: 'web-synthetic',
    DEEPSEEK_API_KEY: 'native-synthetic' })
  core = startQualificationCore({ coreExecutable: join(repository, 'target/debug/rovai-core'),
    dataDirectory: data, workingDirectory: repository, runtimeCacheDirectory: join(root, 'cache'),
    mcpConfigPath: join(root, 'mcp.json'), onNotification: message => events.push(message) })
  await core.request('health.check')
  await core.request('runtime.startup.save', { runtimeKind: 'deepseek-harness', expectedRevision: 0,
    configuration: { programPath: executable, environment: [] } })
  const models = await refresh()
  assert(models.some(model => model.id === modelId('relay')))
  assert(!models.some(model => model.id === modelId('disabled')))
  assert(models.some(model => model.id === modelId('extra') && model.runtimeMetadata?.dshSource === 'web'))
  workspace = await core.request('workspaces.inspect', { path: project })
  const initial = models.find(model => model.id === modelId('thinking', 'effort-a'))
  assert(initial.runtimeMetadata.dshOptionsResolved && initial.isDefault)
  assert(initial.options[0].values.some(choice => choice.value === 'max'))
  assert.deepEqual(models.find(model => model.id === modelId('thinking', 'effort-b')).options, [])
  const target = async model => {
    const read = await core.request('runtime.modelCatalog.open', { runtimeKind: 'deepseek-harness',
      modelId: modelId('thinking', model), dshSource: 'web' })
    assert(['completed', 'not_required'].includes(read.refreshStatus), JSON.stringify(read))
    assert.equal(read.selectedModelId, modelId('thinking', model))
    const selected = read.models.find(row => row.id === read.selectedModelId)
    assert(selected.runtimeMetadata.dshOptionsResolved && selected.runtimeMetadata.dshSource === 'web')
    assert.equal(read.models.find(row => row.isDefault)?.id, initial.id, 'A targeted read must not change the catalog default')
    return selected.options.find(option => option.key === 'reasoning_effort')?.values.map(choice => choice.value) ?? []
  }
  assert.deepEqual(await target('effort-b'), ['high', 'xhigh'])
  assert.deepEqual(await target('effort-none'), [])
  assert.equal(requests.length, 0, 'Capability discovery must never submit a business prompt')
  await select('thinking', 'web', 'effort-a', { reasoning_effort: 'max' })
  const a = await run()
  await select('thinking', 'web', 'effort-b', {})
  const b = await run(a.threadId)
  assert.deepEqual(b.frozen.model.options, {})
  assert.equal(b.pid, a.pid, 'A reasoning choice must not force a new Host')
  assert(!b.wire.some(message => message.configId === 'reasoning_effort'))
  const bDefault = requests.at(-1).effort
  // Saving a changed member configuration can invalidate its existing binding.
  // An unchanged default run must reuse the same Session without extra overrides.
  const unchanged = await run(a.threadId)
  assert.equal(unchanged.session, b.session)
  assert(!unchanged.wire.some(message => message.configId === 'reasoning_effort'))
  await select('thinking', 'web', 'effort-b', { reasoning_effort: 'xhigh' })
  const explicit = await run(a.threadId)
  assert.equal(requests.at(-1).effort, 'xhigh', 'Select target before validating its native options')
  const sequence = explicit.wire.filter(message => message.sessionId === explicit.session)
  assert(sequence.findIndex(message => message.configId === 'model') < sequence.findIndex(message => message.configId === 'reasoning_effort'))
  assert(sequence.findIndex(message => message.configId === 'reasoning_effort') < sequence.findIndex(message => message.method === 'session/prompt'))
  await select('thinking', 'web', 'effort-b', {})
  const reused = await run(a.threadId)
  assert.equal(reused.pid, a.pid)
  assert.equal(requests.at(-1).effort, bDefault, 'Omitted effort must use the target native default')
  assert(!reused.wire.some(message => message.configId === 'reasoning_effort'))
  await select('thinking', 'web', 'effort-none', {})
  const plain = await run(a.threadId)
  assert.deepEqual(plain.frozen.model.options, {})
  assert(!plain.wire.some(message => message.configId === 'reasoning_effort'))
  await select('thinking', 'web', 'effort-b', { reasoning_effort: 'max' })
  const count = requests.length
  const invalid = await run(a.threadId, 'failed', 'runtime_model_option_invalid')
  assert.equal(requests.length, count, 'Invalid explicit max must submit zero business requests')
  assert(!invalid.wire.some(message => message.method === 'session/prompt' || message.configId === 'reasoning_effort'))
  assert.equal(invalid.wire.filter(message => message.configId === 'model').length, 1, 'No Session or route retry after invalid effort')
  assert.deepEqual(invalid.frozen.model.options, { reasoning_effort: 'max' })
  assert.match(invalid.failure.public_runtime_failure_json, /max/)
  assert.match(invalid.failure.public_runtime_failure_json, /xhigh/)
  web[0].config.providers.thinking.models[1].reasoningEfforts = { low: 'low' }
  await json(webPath, web)
  await refresh()
  assert.deepEqual(await target('effort-b'), ['low'])
  assert.equal((await core.request('members.get', { agentId: 'agent_2' })).runtimeConfiguration.model.options.reasoning_effort, 'max')
  results.push('per-model native options; default freeze/Session reuse; explicit validation before prompt; Web option refresh preserves saved intent')

  // Restore a native default before the existing unavailable-Web scenarios.
  acp[1].config = { provider: 'relay', model: 'same-model' }
  await json(acpPath, acp)
  await refresh()
  assert.equal((await select('relay')).dshSource, 'native')
  const first = await run()
  assert.equal(requests.at(-1).path, '/native/responses')
  results.push('native same-ID opaque Web preserved; explicit disable preserved')

  const selection = (await core.request('members.get', { agentId: 'agent_2' })).runtimeConfiguration.model
  await json(webPath, [...web, { id: 'web-ui', config: { theme: 'dark' } }])
  const second = await run(first.threadId)
  assert(first.host && first.host === second.host, 'Non-model Web edit must reuse the prepared Host')
  assert.deepEqual((await core.request('members.get', { agentId: 'agent_2' })).runtimeConfiguration.model, selection)
  results.push('non-model edit reuses Host without reselecting')

  assert.equal((await select('extra')).dshSource, 'web')
  const webRun = await run()
  assert.equal(requests.at(-1).path, '/web/responses')
  acp[0].config.providers.extra = route('fallback')
  await json(acpPath, acp)
  await writeFile(webPath, ': invalid: [')
  await refresh()
  const before = requests.length
  await run(webRun.threadId, 'failed')
  assert.equal(requests.length, before, 'Failed Web choice must send zero requests to the same-ID native route')
  assert.equal((await core.request('members.get', { agentId: 'agent_2' })).runtimeConfiguration.model.dshSource, 'web')
  assert.equal((await select('extra')).dshSource, 'web', 'An unmarked option/permission edit retains the previous Web choice')
  results.push('failed Web selection stays Web; same-ID native receives zero requests')

  await select('relay', 'native')
  await run()
  assert.equal(requests.at(-1).path, '/native/responses')
  const nativeOther = installation.snapshot.models.find(model => JSON.parse(model.id)[0] !== 'relay'
    && JSON.parse(model.id)[0] !== 'extra' && JSON.parse(model.id)[1] === 'same-model')
  assert(nativeOther, 'Non-pi native model must remain visible')
  await select(JSON.parse(nativeOther.id)[0], 'native')
  await run()
  assert.equal(requests.at(-1).path, '/other/v1/messages')
  results.push('broken Web preserves pi and non-pi native routes')

  console.log(JSON.stringify({ passed: true, isolated: true, paidRequests: 0, results,
    requestPaths: requests.map(request => request.path) }, null, 2))
} finally {
  if (core) await core.stop()
  await new Promise(done => server.close(done))
  await removeEphemeralRuntimeCampFilesRoot(data)
  await rm(root, { recursive: true, force: true })
}
