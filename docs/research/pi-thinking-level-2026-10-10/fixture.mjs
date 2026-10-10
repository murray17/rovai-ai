import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

// Native interoperability only: synthetic history, fixture credential, no Prompt.
// Production Host behavior is separately exercised by the Rust regression owner.
const executable = process.env.ROVAI_REAL_PI_EXECUTABLE ?? '/opt/homebrew/bin/pi'
const packageRoot = resolve(dirname(await realpath(executable)), '../..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-pi-thinking-native-')))
const profile = join(root, 'pi-agent'), cwd = join(root, 'workspace'), sessions = join(root, 'sessions')
for (const path of [profile, cwd, sessions]) await mkdir(path, { recursive: true, mode: 0o700 })
process.env.PI_CODING_AGENT_DIR = profile
const { getSupportedThinkingLevels } = await import(pathToFileURL(join(packageRoot, 'node_modules/@earendil-works/pi-ai/dist/index.js')))
const { anthropicProvider } = await import(pathToFileURL(join(packageRoot, 'node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js')))
const { SessionManager } = await import(pathToFileURL(join(packageRoot, 'dist/core/session-manager.js')))
const candidates = anthropicProvider().getModels().filter(model => {
  const levels = getSupportedThinkingLevels(model)
  return levels.includes('high') && levels.includes('medium') && !levels.includes('max')
})
assert(candidates.length >= 2)
const [modelA, modelB] = candidates
await writeFile(join(profile, 'settings.json'), JSON.stringify({ defaultProvider: modelA.provider,
  defaultModel: modelA.id, defaultThinkingLevel: 'medium', packages: [] }))
const beforeSettings = await readFile(join(profile, 'settings.json'), 'utf8')
const env = { PATH: process.env.PATH, TMPDIR: tmpdir(), PI_CODING_AGENT_DIR: profile,
  ANTHROPIC_API_KEY: 'fixture-only-key-no-generation', PI_TELEMETRY_ENABLED: '0' }
function seedHigh() {
  const session = SessionManager.create(cwd, sessions)
  session.appendModelChange(modelA.provider, modelA.id)
  session.appendThinkingLevelChange('high')
  session.appendMessage({ role: 'user', content: 'Synthetic no-network fixture', timestamp: Date.now() })
  session.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic fixture history' }],
    api: modelA.api, provider: modelA.provider, model: modelA.id, timestamp: Date.now(), stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
  return { id: session.getSessionId(), file: session.getSessionFile() }
}
const baseline = seedHigh(), restored = seedHigh(), trace = [], scenarios = []
let starts = 0
async function start(session) {
  starts++
  const begin = performance.now()
  const child = spawn(executable, ['--mode', 'rpc', '--no-themes', '--approve', '--session', session.file,
    '--session-dir', sessions], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const closed = once(child, 'close'), pending = new Map()
  let stderr = '', counter = 0
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000) })
  createInterface({ input: child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line) } catch { return }
    if (message.type !== 'response') return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id); clearTimeout(waiter.timer)
    if (!message.success) waiter.reject(new Error(`${message.command}: ${message.error}`))
    else waiter.resolve(message.data)
  })
  async function command(type, fields = {}) {
    assert(['get_state', 'get_available_models', 'set_model', 'set_thinking_level', 'new_session', 'switch_session'].includes(type))
    const id = `probe-${++counter}`
    trace.push({ host: starts, command: type, ...fields })
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} timed out: ${stderr}`)) }, 15000)
      pending.set(id, { resolve, reject, timer })
    })
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n')
    return result
  }
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return
    process.kill(-child.pid, 'SIGTERM')
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 5000)
    try { await closed } finally { clearTimeout(timer) }
  }
  try {
    const state = await command('get_state')
    assert.equal(state.sessionId, session.id)
    return { command, stop, state, startupMs: Math.round(performance.now() - begin) }
  } catch (error) { await stop(); throw error }
}
async function apply(host, model, override) {
  const before = await host.command('get_state'), offset = trace.length
  if (before.model?.provider !== model.provider || before.model?.id !== model.id)
    await host.command('set_model', { provider: model.provider, modelId: model.id })
  if (override !== undefined) await host.command('set_thinking_level', { level: override })
  const after = await host.command('get_state')
  assert.equal(after.sessionId, before.sessionId)
  assert.equal(after.model.provider, model.provider); assert.equal(after.model.id, model.id)
  return { thinking: after.thinkingLevel, requested: override ?? null,
    exact: override === undefined || after.thinkingLevel === override,
    commands: trace.slice(offset).map(row => row.command) }
}
let host
try {
  host = await start(baseline)
  const coldStartupMs = host.startupMs
  assert.equal(host.state.thinkingLevel, 'high')
  const catalogStart = performance.now(), catalog = await host.command('get_available_models')
  const catalogMs = Math.round(performance.now() - catalogStart)
  assert(catalog.models.some(model => model.provider === modelA.provider && model.id === modelA.id))
  await host.command('set_model', { provider: modelA.provider, modelId: modelA.id })
  assert.equal((await host.command('get_state')).thinkingLevel, 'medium')
  scenarios.push({ case: 'native repeated same-model selection', before: 'high', after: 'medium' })
  await host.command('switch_session', { sessionPath: restored.file })
  for (const [name, model, override, expected] of [
    ['exact resume, same model, unspecified', modelA, undefined, 'high'],
    ['same model, explicit off', modelA, 'off', 'off'],
    ['clear override, same model', modelA, undefined, 'off'],
    ['same model, explicit low', modelA, 'low', 'low'],
    ['different model, unspecified', modelB, undefined, 'medium'],
    ['different model, explicit high', modelA, 'high', 'high'],
  ]) {
    const result = await apply(host, model, override)
    assert.equal(result.thinking, expected, name); assert(result.exact)
    scenarios.push({ case: name, ...result })
  }
  const narrowed = await apply(host, modelA, 'max')
  assert.equal(narrowed.exact, false)
  scenarios.push({ case: 'native clamp must be rejected by Rovai', ...narrowed })
  await apply(host, modelA, 'high')
  await host.command('new_session')
  const newSession = await host.command('get_state')
  const fresh = await apply(host, newSession.model, undefined)
  assert.equal(fresh.thinking, newSession.thinkingLevel)
  assert(!fresh.commands.includes('set_model'))
  scenarios.push({ case: 'new Session, unspecified', ...fresh })
  await host.command('switch_session', { sessionPath: restored.file })
  const warm = await apply(host, modelA, undefined)
  assert.equal(warm.thinking, 'high')
  scenarios.push({ case: 'warm Host, exact restored Session', ...warm })
  await host.stop(); host = await start(restored)
  const cold = await apply(host, modelA, undefined)
  assert.equal(cold.thinking, 'high')
  scenarios.push({ case: 'cold Host, exact restored Session', ...cold })
  const evidence = { version: execFileSync(executable, ['--version'], { cwd, env, encoding: 'utf8' }).trim(),
    root, profile, modelA: { provider: modelA.provider, id: modelA.id }, modelB: { provider: modelB.provider, id: modelB.id },
    coldStartupMs, catalogMs, catalogEntries: catalog.models.length, rpcHostStarts: starts, generationRequests: 0,
    nativeSettingsChanged: beforeSettings !== await readFile(join(profile, 'settings.json'), 'utf8'), scenarios, trace }
  await writeFile(process.env.ROVAI_PI_THINKING_EVIDENCE ?? join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, ...evidence, trace: undefined }))
} finally { if (host) await host.stop() }
