// Official Kilo CLI/ACP metadata parity probe. No session/prompt is submitted.
// ROVAI_KILO_MODELS_PROBE_ROOT=<empty owned directory> \
// ROVAI_KILO_MODELS_NATIVE_CONFIG=<optional native kilo.json/jsonc> \
// ROVAI_KILO_MODELS_NATIVE_AUTH=<optional native auth.json> \
// node scripts/probe-kilo-models-bulk.mjs /absolute/path/to/kilo
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { isolatedKiloEnvironment } from './lib/isolated-kilo-environment.mjs'

const executable = process.argv[2]
assert(executable && isAbsolute(executable), 'Select an absolute official Kilo CLI')
const root = await realpath(process.env.ROVAI_KILO_MODELS_PROBE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-kilo-models-')))
assert.equal((await readdir(root)).length, 0, 'Use a fresh empty probe directory')
const nativeConfig = process.env.ROVAI_KILO_MODELS_NATIVE_CONFIG
const nativeAuth = process.env.ROVAI_KILO_MODELS_NATIVE_AUTH
const report = { platform: `${process.platform}-${process.arch}`, status: 'running', cases: [] }
const live = new Set()

function terminate(child) {
  try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}

async function command(args, env, cwd) {
  const started = performance.now()
  const child = spawn(executable, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  live.add(child)
  const chunks = []; let bytes = 0, firstByteMs, lastByteMs
  const deadline = setTimeout(() => terminate(child), 45000)
  child.stderr.resume() // Native output can contain private configuration; do not persist it.
  child.stdout.on('data', chunk => {
    firstByteMs ??= Math.round(performance.now() - started)
    lastByteMs = Math.round(performance.now() - started)
    bytes += chunk.length
    if (bytes > 32 * 1024 * 1024) terminate(child)
    else chunks.push(chunk)
  })
  try {
    const code = await new Promise((accept, reject) => {
      child.once('error', () => reject(new Error('Native command could not start')))
      child.once('close', accept)
    })
    assert.equal(code, 0, `Native command failed: ${args[0]}`)
    return { output: Buffer.concat(chunks).toString('utf8'), elapsedMs: Math.round(performance.now() - started), bytes, firstByteMs, lastByteMs }
  } finally { clearTimeout(deadline); live.delete(child) }
}

function modelRows(output) {
  const lines = output.trimEnd().split(/\r?\n/), rows = []
  let index = 0
  while (index < lines.length) {
    const id = lines[index++]
    if (!id) continue
    assert(id.includes('/'), 'Expected a native provider/model ID line')
    const start = index
    assert.equal(lines[index], '{', 'Expected formatted native model JSON')
    while (index < lines.length && lines[index] !== '}') index += 1
    assert(index < lines.length, 'Unterminated native model metadata')
    let model
    try { model = JSON.parse(lines.slice(start, ++index).join('\n')) }
    catch { throw new Error('Invalid native model JSON') }
    assert(!model.variants || (typeof model.variants === 'object' && !Array.isArray(model.variants)), 'Invalid variants object')
    rows.push({ id, variants: Object.keys(model.variants ?? {}) })
  }
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Native CLI repeated a model ID')
  return rows
}

function option(state, id) { return state.configOptions?.find(item => item.id === id) }
function choices(options) {
  return (options ?? []).flatMap(item => typeof item.value === 'string' ? [item.value] : choices(item.options))
}
function current(state) { return option(state, 'model')?.currentValue ?? state.models?.currentModelId }
function efforts(state) { return choices(option(state, 'effort')?.options) }

async function acp(env, cwd) {
  const child = spawn(executable, ['acp', '--cwd', cwd, '--log-level', 'ERROR'], {
    cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
  })
  live.add(child); child.stderr.resume()
  const pending = new Map(), methods = {}; let next = 0, closed = false
  const close = new Promise(accept => child.once('close', () => { closed = true; accept() }))
  const rejectAll = () => { for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error('ACP disconnected')) } pending.clear() }
  child.once('error', rejectAll); child.once('exit', rejectAll)
  createInterface({ input: child.stdout }).on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { rejectAll(); return }
    if (message.method && message.id !== undefined) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Metadata probe provides no client tools' } }) + '\n')
      return
    }
    const request = !message.method && pending.get(message.id)
    if (!request) return
    pending.delete(message.id); clearTimeout(request.timer)
    if (message.error) request.reject(Object.assign(new Error('Native ACP rejected metadata request'), { rpcCode: message.error.code }))
    else request.accept(message.result)
  })
  return {
    methods,
    rpc(method, params) {
      methods[method] = (methods[method] ?? 0) + 1
      return new Promise((accept, reject) => {
        const id = ++next
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`ACP metadata deadline: ${method}`)) }, 20000)
        pending.set(id, { accept, reject, timer })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    },
    async close() {
      child.stdin.end()
      await Promise.race([close, delay(1500)])
      if (!closed) { terminate(child); await close }
      rejectAll(); live.delete(child)
    }
  }
}

async function scenario(name, config, overlay = {}) {
  const directory = join(root, name)
  for (const part of ['home', 'workspace', 'config/kilo', 'data/kilo', 'cache', 'state']) await mkdir(join(directory, part), { recursive: true })
  const env = { ...isolatedKiloEnvironment(directory), KILO_CLIENT: 'acp', KILO_ENABLE_QUESTION_TOOL: 'false',
    KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'false', KILO_DISABLE_AUTOUPDATE: '1', NO_COLOR: '1' }
  if (config) {
    env.KILO_CONFIG_CONTENT = JSON.stringify(config)
    env.KILO_DISABLE_MODELS_FETCH = '1'
  } else {
    await writeFile(join(directory, 'config/kilo/kilo.jsonc'), await readFile(nativeConfig), { mode: 0o600 })
    if (nativeAuth) await writeFile(join(directory, 'data/kilo/auth.json'), await readFile(nativeAuth), { mode: 0o600 })
    if (Object.keys(overlay).length) env.KILO_CONFIG_CONTENT = JSON.stringify(overlay)
  }
  const cwd = join(directory, 'workspace'), result = { name }
  execFileSync('git', ['init', '--quiet', cwd], { env, stdio: 'ignore' })
  let host
  try {
    const cold = await command(['models', '--verbose'], env, cwd)
    const first = modelRows(cold.output)
    const warm = await command(['models', '--verbose'], env, cwd)
    const rows = modelRows(warm.output), byId = new Map(rows.map(row => [row.id, row]))
    result.cli = { modelCount: rows.length, coldMs: cold.elapsedMs, warmMs: warm.elapsedMs, warmFirstByteMs: warm.firstByteMs, warmLastByteMs: warm.lastByteMs, outputBytes: warm.bytes,
      repeatStable: JSON.stringify(first) === JSON.stringify(rows) }
    host = await acp(env, cwd)
    let started = performance.now()
    const initialized = await host.rpc('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'rovai-models-probe', version: '1' } })
    assert.equal(initialized.protocolVersion, 1)
    result.acpInitializeMs = Math.round(performance.now() - started)
    started = performance.now()
    const session = await host.rpc('session/new', { cwd, mcpServers: [] })
    result.acpNewSessionMs = Math.round(performance.now() - started)
    const ids = choices(option(session, 'model')?.options), original = current(session)
    assert(ids.length && original, 'ACP must advertise its model directory/current model')
    result.acpModelCount = ids.length
    result.cliOnlyIds = rows.map(row => row.id).filter(id => !ids.includes(id))
    result.acpOnlyIds = ids.filter(id => !byId.has(id))
    const observed = new Map(), rejected = []
    const select = value => host.rpc('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value })
    started = performance.now(); let modelRequests = 0
    for (const id of ids) {
      try {
        const state = id === original ? session : (modelRequests += 1, await select(id))
        assert.equal(current(state), id)
        observed.set(id, efforts(state))
      } catch (error) { rejected.push({ id, rpcCode: error.rpcCode ?? null }) }
    }
    if (modelRequests) { modelRequests += 1; await select(original) }
    result.acpFullEffortScan = { elapsedMs: Math.round(performance.now() - started), modelSelectionRequests: modelRequests, rejected }
    result.rows = ids.map(id => ({ id, cliVariants: byId.get(id)?.variants ?? null, acpVariants: observed.get(id) ?? null }))
    result.mismatchedEfforts = result.rows.filter(row => row.cliVariants && row.acpVariants
      && JSON.stringify(row.cliVariants) !== JSON.stringify(row.acpVariants))
    result.effortSetterFailures = []; let accepted = 0
    started = performance.now()
    for (const row of result.rows) {
      if (!row.cliVariants?.length || !observed.has(row.id)) continue
      await select(row.id)
      for (const value of row.cliVariants) {
        try {
          const state = await host.rpc('session/set_config_option', { sessionId: session.sessionId, configId: 'effort', value })
          assert.equal(current(state), row.id); assert.equal(option(state, 'effort')?.currentValue, value)
          accepted += 1
        } catch (error) { result.effortSetterFailures.push({ id: row.id, value, rpcCode: error.rpcCode ?? null }) }
      }
    }
    result.effortValidation = { acceptedValues: accepted, elapsedMs: Math.round(performance.now() - started) }
    const restored = await select(original)
    const initialEffort = option(session, 'effort')?.currentValue
    if (initialEffort !== undefined) {
      const state = await host.rpc('session/set_config_option', { sessionId: session.sessionId, configId: 'effort', value: initialEffort })
      assert.equal(option(state, 'effort')?.currentValue, initialEffort)
    }
    assert.equal(current(restored), original)
    result.originalSelectionRestored = true
    result.acpMethods = host.methods
    assert.equal(host.methods['session/prompt'] ?? 0, 0)
    result.allAdvertisedEffortsMatch = !result.acpOnlyIds.length && !rejected.length && !result.mismatchedEfforts.length && !result.effortSetterFailures.length
    result.rawModelListsEqual = !result.cliOnlyIds.length && !result.acpOnlyIds.length
    if (config) assert(result.allAdvertisedEffortsMatch && result.rawModelListsEqual, 'Controlled CLI/ACP metadata must match')
    return result
  } finally {
    if (host) await host.close()
    if (!config) {
      await rm(join(directory, 'config/kilo/kilo.jsonc'), { force: true })
      await rm(join(directory, 'data/kilo/auth.json'), { force: true })
    }
  }
}

const providerRequests = []
const provider = createServer(async (request, response) => {
  providerRequests.push(request.method)
  for await (const _ of request) { /* Drain without retaining bodies or headers. */ }
  response.writeHead(404); response.end()
})
await new Promise(accept => provider.listen(0, '127.0.0.1', accept))
function fixtureModels(count) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = index === 1 ? 'nested/模型' : index === count - 1 ? 'plain' : `model-${index}`
    return [id, { name: `Model ${index}: { "quoted" }`, tool_call: true, limit: { context: 200000, output: 2048 },
      ...(index === count - 1 ? {} : { variants: index % 2 ? { medium: {}, max: {} } : { low: {}, high: {}, disabled: { disabled: true } } }) }]
  }))
}
try {
  report.version = (await command(['--version'], isolatedKiloEnvironment(root), root)).output.trim()
  for (const [name, count] of [['controlled', 3], ['scaled', 64]]) {
    const config = { autoupdate: false, enabled_providers: ['local'], model: 'local/model-0', provider: {
      local: { name: 'Metadata fixture', npm: '@ai-sdk/openai-compatible', env: [],
        options: { apiKey: 'fixture-key', baseURL: `http://127.0.0.1:${provider.address().port}/v1` }, models: fixtureModels(count) }
    } }
    report.cases.push(await scenario(name, config))
  }
  if (nativeConfig) {
    report.cases.push(await scenario('native', null))
    report.cases.push(await scenario('native-filtered', null, { hide_prompt_training_models: true }))
  }
  assert.equal(providerRequests.filter(method => method === 'POST').length, 0, 'Metadata discovery must not generate model calls')
  report.controlledProviderRequests = providerRequests.length
  report.status = 'completed'
} catch (error) {
  report.status = 'failed'
  report.error = { name: error.name, message: error.message }
  process.exitCode = 1
} finally {
  for (const child of live) terminate(child)
  provider.closeAllConnections(); await new Promise(accept => provider.close(accept))
  await writeFile(join(root, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, root, cases: report.cases.map(c => ({ name: c.name, modelCount: c.acpModelCount,
    rawModelListsEqual: c.rawModelListsEqual, allAdvertisedEffortsMatch: c.allAdvertisedEffortsMatch, cli: c.cli, scan: c.acpFullEffortScan,
    acceptedEfforts: c.effortValidation.acceptedValues })), error: report.error }, null, 2))
}
