// Isolated native DSH + loopback HTTP; no real credentials, Web UI, or paid calls.
// Usage: node scripts/smoke-dsh-model-configuration.mjs <installed-dsh-package>
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const pkg = resolve(process.argv[2])
const { version } = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'))
const require = createRequire(join(pkg, 'package.json'))
const { parse } = require('yaml')
const root = await mkdtemp(join(tmpdir(), 'rovai-dsh-model-config-'))
const workspace = join(root, 'workspace')
await mkdir(workspace)
const plugin = resolve(import.meta.dirname, '../crates/rovai-core/src/dsh/models.mjs')
const requests = [], results = []
let wireFailure, sequence = 0
const server = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    assert.equal(request.method, 'POST')
    assert(request.url.endsWith('/responses'))
    requests.push({ path: request.url, key: request.headers.authorization, model: body.model,
      strict: body.tools.find(tool => tool.name === 'bash' || tool.name === 'pwsh')?.strict })
    const id = `fixture-${requests.length}`, text = 'LOCAL_FIXTURE_OK'
    const item = { id: `msg-${id}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    let seq = 0
    const emit = event => response.write(`data: ${JSON.stringify({ ...event, sequence_number: seq++ })}\n\n`)
    emit({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
    emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
    emit({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text })
    emit({ type: 'response.output_item.done', output_index: 0, item })
    emit({ type: 'response.completed', response: { id, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } })
    response.end()
  } catch (error) {
    wireFailure = error
    response.writeHead(400).end('fixture assertion failed')
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const route = (path, key = 'NATIVE_FIXTURE_KEY', compat) => ({ api: 'openai-responses',
  baseURL: `http://127.0.0.1:${server.address().port}/${path}`, apiKeyEnv: key,
  ...(compat ? { compat } : {}), models: [
    { id: 'same-model', contextWindow: 32768, maxTokens: 4096 },
    { id: 'model-off', contextWindow: 32768, maxTokens: 4096, compat: { supportsStrictMode: false } },
  ] })
const nativeProviders = { relay: route('native'), 'provider-off': route('native-off', undefined, { supportsStrictMode: false }) }
const webProviders = { relay: route('wrong', 'WEB_FIXTURE_KEY'), extra: route('web', 'WEB_FIXTURE_KEY') }
const json = (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600 })
async function fixture(name, shared = true) {
  const home = join(root, name)
  await mkdir(join(home, 'profiles/web'), { recursive: true })
  if (shared) await json(join(home, 'settings.yaml'), { 'llm-pi-ai': { providers: nativeProviders } })
  await json(join(home, 'profiles/web/package.json'), { private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } })
  await json(join(home, 'profiles/web/cordis.patch.yml'), [{ id: 'llm-pi-ai', config: { providers: webProviders } }])
  return home
}
async function start(home) {
  const resultPath = join(root, `result-${++sequence}.json`), patch = `${resultPath}.patch`
  await json(patch, [{ insert: [{ id: 'rovai-model-configuration', name: plugin, config: { resultPath } }] }])
  const child = spawn(process.execPath, [join(pkg, 'lib/bin.js'), '--profile', 'acp', '--patch', patch], {
    cwd: workspace, env: { PATH: process.env.PATH, HOME: join(root, 'isolated-home'), DSH_HOME: home,
      DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1',
      NATIVE_FIXTURE_KEY: 'native-synthetic', WEB_FIXTURE_KEY: 'web-synthetic' }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let exited = false, output = '', id = 0
  const pending = new Map()
  child.stderr.on('data', bytes => { output = (output + bytes).slice(-12000) })
  const closed = new Promise(done => child.on('exit', (code, signal) => {
    exited = true
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`DSH exited ${code}/${signal}: ${output}`)) }
    pending.clear(); done()
  }))
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const item = pending.get(message.id)
    if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result) }
  })
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out: ${output}`)) }, 20000)
    pending.set(requestId, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
  })
  const stop = async () => {
    if (!exited) child.kill('SIGTERM')
    const killer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 3000)
    await closed; clearTimeout(killer); lines.close()
  }
  try {
    const deadline = Date.now() + 25000
    let prepared
    while (!prepared && Date.now() < deadline) {
      try { prepared = JSON.parse(await readFile(resultPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (exited) throw new Error(`DSH preparation exited: ${output}`)
      if (!prepared) await new Promise(done => setTimeout(done, 50))
    }
    assert.equal(prepared?.status, 'ready', JSON.stringify(prepared))
    await rpc('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'isolated-model-config-smoke', version: '1' } })
    const session = await rpc('session/new', { cwd: workspace, mcpServers: [] })
    const models = session.configOptions.find(option => option.id === 'model').options.flatMap(group => group.options ?? [group]).map(model => model.value)
    return { prepared, models, stop, async prompt(provider, model = 'same-model') {
      const before = requests.length
      await rpc('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: JSON.stringify([provider, model]) })
      await rpc('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply with the fixture marker.' }] })
      if (wireFailure) throw wireFailure
      assert.equal(requests.length, before + 1, 'No silent retry or route switch')
      return requests.at(-1)
    } }
  } catch (error) { await stop(); throw error }
}
async function check(home, label, run) {
  const runtime = await start(home)
  try { await run(runtime); results.push({ scenario: label, passed: true, diagnostics: runtime.prepared.diagnostics.map(item => item.code) }) }
  finally { await runtime.stop() }
}
async function nativeWebImport(home) {
  const child = spawn(process.execPath, [join(pkg, 'lib/bin.js'), '--profile', 'web', '--port', '0', '--no-open'], {
    cwd: workspace, env: { PATH: process.env.PATH, HOME: join(root, 'isolated-home'), DSH_HOME: home,
      DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'ignore', 'ignore'],
  })
  let exited = false
  const closed = new Promise(done => child.on('exit', () => { exited = true; done() }))
  try {
    const deadline = Date.now() + 25000
    let migrated = false
    while (!migrated && Date.now() < deadline && !exited) {
      const rows = parse(await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8'))
      const providers = rows.find(row => row.id === 'llm-pi-ai')?.config?.providers
      migrated = providers?.relay?.baseURL === nativeProviders.relay.baseURL && !!providers['provider-off']
      if (!migrated) await new Promise(done => setTimeout(done, 50))
    }
    assert(migrated, 'Native Web must finish writing the model section, not merely rename it')
    assert.deepEqual(JSON.parse(await readFile(join(home, 'settings.yaml.imported'), 'utf8')), { 'llm-pi-ai': { providers: nativeProviders } })
  } finally {
    if (!exited) child.kill('SIGTERM')
    const timer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 3000)
    await closed; clearTimeout(timer)
  }
}
try {
  const home = await fixture('legacy-and-web')
  let supplements = false
  await check(home, 'legacy-and-web', async runtime => {
    supplements = runtime.prepared.webProviders.includes('extra')
    assert.deepEqual(await runtime.prompt('relay'), { path: '/native/responses', key: 'Bearer native-synthetic', model: 'same-model', strict: false })
    assert.equal((await runtime.prompt('relay', 'model-off')).strict, undefined)
    assert.equal((await runtime.prompt('provider-off')).strict, undefined)
    if (supplements) assert.deepEqual(await runtime.prompt('extra'), { path: '/web/responses', key: 'Bearer web-synthetic', model: 'same-model', strict: false })
    const nativePatch = parse(await readFile(join(home, 'profiles/acp/cordis.patch.yml'), 'utf8').catch(() => '[]'))
    assert(!nativePatch.some(row => Object.hasOwn(row.config?.providers ?? {}, 'extra')), 'Temporary Web route persisted in ACP')
  })
  if (supplements) {
    assert((await readdir(join(home, 'backups'))).some(name => name.startsWith('rovai-settings-')))
    await json(join(home, 'profiles/web/cordis.patch.yml'), [])
    await check(home, 'delete-web-route-after-native-migration', async runtime => {
      assert(!runtime.models.includes(JSON.stringify(['extra', 'same-model'])))
      assert.equal((await runtime.prompt('relay')).path, '/native/responses')
    })
    await writeFile(join(home, 'profiles/web/cordis.patch.yml'), 'config: [invalid')
    await check(home, 'malformed-web-preserves-native', async runtime => {
      assert(runtime.prepared.diagnostics.some(item => item.code === 'web_configuration_unavailable'))
      assert.equal((await runtime.prompt('relay')).path, '/native/responses')
    })
    const manifestPath = join(home, 'profiles/web/package.json')
    const manifest = await readFile(manifestPath, 'utf8')
    const customManifest = JSON.parse(manifest)
    customManifest.dsh.profile.bundles.push('@fixture/custom-web-bundle')
    await json(manifestPath, customManifest)
    await check(home, 'unsupported-web-bundle-preserves-native-and-manifest', async runtime => {
      assert(runtime.prepared.diagnostics.some(item => item.code === 'web_plugin_configuration_unavailable'))
      assert.equal((await runtime.prompt('relay')).path, '/native/responses')
      assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), customManifest)
    })
    await writeFile(manifestPath, manifest)
    await json(join(home, 'profiles/web/cordis.patch.yml'), [{ id: 'llm-pi-ai', config: { providers: { broken: { api: 'invalid-protocol', models: [{ id: 'broken' }] } } } }])
    await check(home, 'rejected-web-preserves-native-compatibility', async runtime => {
      assert.deepEqual(runtime.prepared.rejectedProviders, ['broken'])
      const request = await runtime.prompt('relay')
      assert.equal(request.path, '/native/responses'); assert.equal(request.strict, false)
    })
    const webOnly = await fixture('web-only', false)
    await check(webOnly, 'web-only-with-default-acp', async runtime => {
      assert.equal((await runtime.prompt('extra')).path, '/web/responses')
      assert.equal((await runtime.prompt('relay')).path, '/wrong/responses')
    })
    const webFirst = await fixture('web-first')
    await nativeWebImport(webFirst)
    await check(webFirst, 'native-web-first-then-acp', async runtime => {
      assert(runtime.prepared.webProviders.includes('relay'))
      assert.equal((await runtime.prompt('relay')).path, '/native/responses')
      assert(!(await readFile(join(webFirst, 'profiles/acp/cordis.patch.yml'), 'utf8')).includes('extra'))
    })
  }
  console.log(JSON.stringify({ passed: true, version, platform: `${process.platform}-${process.arch}`, controlledEndpoint: true, requests: requests.length, webSupplementation: supplements, results }, null, 2))
} finally {
  await new Promise(done => server.close(done))
  await rm(root, { recursive: true, force: true })
}
