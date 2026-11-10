// Real CLI, isolated native configuration, no business Prompt or remote model call.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { parse, stringify } from 'yaml'
import { startQualificationCore } from './lib/qualification-core.mjs'

const native = process.argv[2]
const coreIndex = process.argv.indexOf('--core')
const coreExecutable = coreIndex < 0 ? null : process.argv[coreIndex + 1]
if (coreIndex >= 0) assert.ok(coreExecutable && isAbsolute(coreExecutable), 'Pass an absolute Core executable')
assert.ok(native && isAbsolute(native), 'Pass the absolute installed mcode path')
const root = await mkdtemp(join(tmpdir(), 'rovai-minimax-options-'))
const nativeData = join(root, 'native'), cwd = join(root, 'project')
await mkdir(nativeData); await mkdir(cwd)
const env = { ...process.env, MINIMAX_DATA_DIR: nativeData, MAVIS_DATA_DIR: nativeData,
  ROVAI_MINIMAX_PROBE_KEY: 'synthetic-no-network-key' }
console.error(JSON.stringify({ channel: 'automatic acceptance', root, nativeData, cwd, core: Boolean(coreExecutable), prompts: 0 }))
const child = spawn(native, ['provider', 'add', '--name', 'options-fixture', '--base-url', 'http://127.0.0.1:9/v1',
  '--api-format', 'openai-completions', '--model', 'fixture-a', '--model', 'fixture-b', '--api-key-env', 'ROVAI_MINIMAX_PROBE_KEY'],
  { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output += part })
assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }), 0, output)
const configPath = join(nativeData, 'config.yaml'), config = parse(await readFile(configPath, 'utf8'))
const providerId = Object.keys(config.custom_provider ?? config.provider ?? {})[0]
assert.ok(providerId, 'Synthetic provider was not recorded')
config.defaultModel = `${providerId}/fixture-a`
await writeFile(configPath, stringify(config))
const configuredDefault = config.defaultModel
async function probe(select) {
  const process = spawn(native, ['acp'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''; process.stderr.on('data', part => { stderr = (stderr + part).slice(-4000) })
  const pending = new Map(), methods = []; let next = 0
  const closed = new Promise(resolve => process.once('close', resolve))
  createInterface({ input: process.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line) } catch { return }
    if (message.method && message.id !== undefined) process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'No probe client tools' } }) + '\n')
    const callback = pending.get(message.id)
    if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result) }
  })
  const request = (method, params) => { methods.push(method); const id = ++next; return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject }); process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  }) }
  const timer = setTimeout(() => { process.kill('SIGKILL'); for (const callback of pending.values()) callback.reject(new Error('Native probe timeout: ' + stderr)) }, 30000)
  try {
    const initialized = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'rovai-options-probe', version: '1' } })
    assert.equal(initialized.protocolVersion, 1)
    const initial = await request('session/new', { cwd, mcpServers: [] })
    const model = initial.configOptions.find(option => option.id === 'model')
    assert.ok(model?.currentValue)
    if (select) {
      const target = model.options.find(option => option.value !== model.currentValue && option.value.includes('fixture-b'))?.value
      assert.ok(target)
      const selected = await request('session/set_config_option', { sessionId: initial.sessionId, configId: 'model', value: target })
      assert.equal(selected.configOptions.find(option => option.id === 'model')?.currentValue, target)
    }
    return { current: model.currentValue, methods, version: initialized.agentInfo?.version }
  } finally {
    process.stdin.end()
    const kill = setTimeout(() => process.kill('SIGKILL'), 5000)
    await closed; clearTimeout(kill); clearTimeout(timer)
  }
}
// Native first-start initialization may add its own built-in catalog/state.
await probe(false)
assert.equal(parse(await readFile(configPath, 'utf8')).defaultModel, configuredDefault)
const before = await readFile(configPath, 'utf8')
const selected = await probe(true)
assert.ok(await readFile(configPath, 'utf8') === before, 'Session selection changed persistent native configuration')
const reopened = await probe(false)
assert.equal(reopened.current, selected.current, 'A new native Session inherited the probe target')
assert.equal(await readFile(configPath, 'utf8'), before)
const report = { ok: true, root, nativeVersion: selected.version, persistentConfigUnchanged: true, newSessionDefaultUnchanged: true,
  selectedSessionMethods: selected.methods, reopenedSessionMethods: reopened.methods, prompts: 0 }
if (coreExecutable) {
  const data = join(root, 'core')
  await mkdir(data)
  console.error(JSON.stringify({ channel: 'automatic acceptance', data,
    skillLibrary: join(data, 'managed-skill-library'), mcp: join(data, 'mcp.json') }))
  const core = startQualificationCore({ coreExecutable, dataDirectory: data, workingDirectory: cwd,
    runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(data, 'mcp.json'), environmentOverrides: env })
  try {
    await core.request('runtime.startup.save', { runtimeKind: 'minimax-code-cli', expectedRevision: 0,
      configuration: { programPath: native, environment: [] } })
    const directory = await core.request('runtime.modelCatalog.open', { runtimeKind: 'minimax-code-cli', waitForRefresh: true, forceRefresh: true })
    assert.equal(directory.refreshStatus, 'completed')
    const defaultId = directory.models.find(model => model.isDefault)?.id
    const targetId = directory.models.find(model => model.id.includes('fixture-b'))?.id
    assert.ok(defaultId && targetId)
    const initialAt = directory.models.find(model => model.id === defaultId).runtimeMetadata.modelOptionsObservedAt
    const target = await core.request('runtime.modelCatalog.open', { runtimeKind: 'minimax-code-cli', modelId: targetId })
    assert.equal(target.selectedModelId, targetId)
    assert.equal(target.models.find(model => model.id === targetId).runtimeMetadata.modelOptionsResolved, true)
    assert.equal(target.models.find(model => model.isDefault).id, defaultId)
    assert.equal(target.models.find(model => model.id === defaultId).runtimeMetadata.modelOptionsObservedAt, initialAt)
    const cached = await core.request('runtime.modelCatalog.open', { runtimeKind: 'minimax-code-cli', modelId: targetId, cacheOnly: true })
    assert.equal(cached.refreshStatus, 'not_required')
    const refreshed = await core.request('runtime.modelCatalog.open', { runtimeKind: 'minimax-code-cli', forceRefresh: true, waitForRefresh: true })
    assert.equal(refreshed.models.find(model => model.id === targetId).runtimeMetadata.modelOptionsObservedAt,
      target.models.find(model => model.id === targetId).runtimeMetadata.modelOptionsObservedAt)
    assert.ok(await readFile(configPath, 'utf8') === before, 'Core target read changed persistent native configuration')
    report.productionCore = { binarySha256: createHash('sha256').update(await readFile(coreExecutable)).digest('hex'), catalog: 'completed', target: 'completed', cache: cached.refreshStatus,
      defaultPreserved: true, otherModelTimestampPreserved: true, directoryRefreshRetainedTarget: true }
  } finally { await core.stop() }
}
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
