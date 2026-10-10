// Private Core API acceptance. Uses only a synthetic CLI, credentials and isolated Host data.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'

if (process.platform === 'win32') throw new Error('This shell fixture requires macOS or Linux')
const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-member-environment-smoke-')))
const data = join(fixture, 'core'), home = join(fixture, 'home')
const executable = join(fixture, 'claude-fixture')
const kind = 'claude-code-cli', memberId = 'agent_1'
const secret = 'fixture-member-environment-key'
await mkdir(data); await mkdir(home)
await writeFile(executable, '#!/bin/sh\nprintf \'2.1.287 (Claude Code)\\n\'\n')
await chmod(executable, 0o700)
console.error(`Isolated acceptance: data=${data}; skills=${join(data, 'managed-skill-library')}; MCP=${join(data, 'mcp.json')}`)
let core
try {
  core = startCore()
  await core.request('health.check')
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  const installations = await core.request('runtime.installations.list')
  assert.ok(installations.some(i => i.adapterKind === kind), 'Synthetic Claude installation discovered')
  const initial = await core.request('members.get', { agentId: memberId })
  const payload = (version, revision, values, confirmTargetChange = false) => ({
    commandId: crypto.randomUUID(), command: {
      agentId: memberId, expectedVersion: version, adapterKind: kind,
      model: { mode: 'runtime_default' },
      permissions: { adapterKind: kind, schemaVersion: 1, values: { permission_mode: 'acceptEdits' } },
      environment: { expectedRevision: revision, json: JSON.stringify(values), confirmTargetChange }
    }
  })
  const get = (extra = {}) => core.request('member.runtimeEnvironment.get', { memberId, adapterKind: kind, ...extra })
  const first = payload(initial.version, 0, { ANTHROPIC_BASE_URL: 'https://a.example', ANTHROPIC_API_KEY: secret, LITERAL: "'$HOME'\n~ $(false)" })
  const applied = await core.request('members.runtime.set', first)
  assert.equal(applied.status, 'applied')
  assert.deepEqual(await core.request('members.runtime.set', first), applied, 'Exact command replay remains idempotent')
  assert.equal((await get()).environment.ANTHROPIC_API_KEY, '<saved>')
  assert.equal((await get({ reveal: true })).environment.ANTHROPIC_API_KEY, secret)
  assert.equal((await core.request('member.runtimeEnvironment.get', { memberId: 'agent_2', adapterKind: kind })).revision, 0)
  assert.equal((await core.request('member.runtimeEnvironment.get', { memberId, adapterKind: 'pi' })).revision, 0)
  const profile = await core.request('members.get', { agentId: memberId })
  assert.ok(!JSON.stringify({ profile, applied, events: core.events }).includes(secret))
  const rejected = await core.request('members.runtime.set', payload(initial.version, 1, { X: 'not-committed' }))
  assert.equal(rejected.status, 'rejected')
  assert.equal((await get()).revision, 1, 'Profile CAS failure cannot commit environment')
  await assert.rejects(core.request('members.runtime.set', payload(profile.version, 0, {})), /environment changed/)
  await assert.rejects(core.request('members.runtime.set', payload(profile.version, 1,
    { ANTHROPIC_BASE_URL: 'https://b.example', ANTHROPIC_API_KEY: '<saved>' })), /Confirm/)
  assert.equal((await core.request('members.runtime.set', payload(profile.version, 1,
    { ANTHROPIC_BASE_URL: 'https://b.example', ANTHROPIC_API_KEY: '<saved>', ANTHROPIC_MODEL: 'provider-model' }, true))).status, 'applied')
  const updated = await core.request('members.get', { agentId: memberId })
  const modelOnly = payload(updated.version, 2, {})
  delete modelOnly.command.environment
  modelOnly.command.model = { mode: 'explicit', modelId: 'sonnet', options: {} }
  await assert.rejects(core.request('members.runtime.set', modelOnly), /ANTHROPIC_MODEL/)
  assert.equal((await get()).revision, 2)
  for (const method of ['runtime.startup.save', 'runtime.startup.check', 'runtime.startup.inspect']) {
    await assert.rejects(core.request(method, { runtimeKind: kind,
      ...(method.endsWith('save') ? { expectedRevision: 0 } : {}),
      configuration: { environment: [{ name: 'ANTHROPIC_API_KEY', value: secret }] }
    }), /moved to Teammates/)
  }
  assert.deepEqual((await core.request('runtime.startup.get', { runtimeKind: kind })).configuration.environment, [])
  await core.stop()
  core = startCore()
  await core.request('health.check')
  assert.equal((await get()).revision, 2)
  assert.equal((await get({ reveal: true })).environment.ANTHROPIC_API_KEY, secret)
  const persisted = await core.request('members.get', { agentId: memberId })
  assert.equal((await core.request('members.runtime.set', payload(persisted.version, 2, {}))).status, 'applied')
  assert.deepEqual((await get()).environment, {})
  assert.ok(!core.events.some(event => JSON.stringify(event).includes(secret)))
  await core.stop()
  const database = await readFile(join(data, 'rovai.sqlite'))
  assert.ok(!database.includes(Buffer.from(secret)), 'Credentials are encrypted in persisted SQLite')
  // The Core is stopped. Convert only this disposable fixture to the exact prior schema.
  const legacy = new DatabaseSync(join(data, 'rovai.sqlite'))
  legacy.exec(`BEGIN;
    DROP TABLE member_runtime_environment; DROP TABLE runtime_environment_plan; DROP TABLE runtime_environment_legacy;
    DELETE FROM schema_migration WHERE version=191;
    UPDATE rovai_data_contract SET projection_schema_version=140 WHERE singleton=1;`)
  legacy.prepare('INSERT INTO runtime_startup_setting(runtime_kind,revision,configuration_json,updated_at) VALUES(?,1,?,datetime(\'now\'))').run(kind,
    JSON.stringify({ programPath: null, environment: [{ name: 'ANTHROPIC_API_KEY', value: secret }] }))
  legacy.exec('COMMIT'); legacy.close()
  core = startCore()
  await core.request('health.check')
  const report = await core.request('diagnostics.check')
  const issue = report.checks.find(check => check.subjectKind === 'legacy_runtime_environment')
  assert.equal(issue?.subjectId, kind, 'The real diagnostic identifies the private archive to read')
  assert.equal(issue.status, 'attention')
  assert.ok(!JSON.stringify(report).includes(secret))
  const archived = (await core.request('runtime.environmentLegacy.list'))[0]
  assert.equal((await core.request('runtime.environmentLegacy.get', { runtimeKind: kind })).ANTHROPIC_API_KEY, '<saved>')
  await core.request('runtime.environmentLegacy.acknowledge', { runtimeKind: kind, identity: archived.identity })
  assert.deepEqual((await core.request('runtime.startup.get', { runtimeKind: kind })).configuration.environment, [])
  await core.stop()
  core = startCore()
  await core.request('health.check')
  assert.equal((await core.request('runtime.environmentLegacy.list'))[0].handled, true)
  assert.equal((await core.request('runtime.environmentLegacy.get', { runtimeKind: kind, reveal: true })).ANTHROPIC_API_KEY, secret)
  assert.equal((await core.request('diagnostics.check')).checks.find(check => check.subjectKind === 'legacy_runtime_environment').status, 'ok')
  console.log(JSON.stringify({ ok: true, checks: ['private-read', 'masked-read', 'member-and-runtime-scope', 'command-replay', 'atomic-CAS', 'target-confirmation', 'model-conflict', 'retired-runtime-input', 'restart', 'clear-overlay', 'encrypted-storage', 'public-redaction', 'legacy-migration', 'legacy-diagnostic', 'legacy-acknowledgment-restart'] }))
} finally {
  await core?.stop()
  await rm(fixture, { recursive: true, force: true })
}

function startCore() {
  const child = spawn(join(root, 'target/debug/rovai-core'), [
    ...coreDataDirectoryArguments(data, { homeDirectory: home }),
    '--skill-library-root', join(data, 'managed-skill-library'),
    '--mcp-config-path', join(data, 'mcp.json')
  ], { cwd: fixture, stdio: ['pipe', 'pipe', 'pipe'], env: {
    HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/sh', TMPDIR: fixture,
    ROVAI_CLAUDE_CODE_BIN: executable, CLAUDE_CONFIG_DIR: join(home, '.claude')
  } })
  const closed = once(child, 'close')
  const events = [], pending = new Map()
  let nextId = 0, stderr = ''
  child.stderr.on('data', data => { stderr += data })
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line)
    if (message.method) { events.push(message); return }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  child.on('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Core exited: ${stderr}`)) }
    pending.clear()
  })
  return {
    events,
    request(method, params = {}) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 30_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.stdin.end()
      const timer = setTimeout(() => child.kill('SIGTERM'), 3000)
      try { await closed } finally { clearTimeout(timer) }
    }
  }
}
