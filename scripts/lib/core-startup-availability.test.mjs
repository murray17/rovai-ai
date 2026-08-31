import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { lstat, mkdtemp, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
const binary = process.env.ROVAI_CORE_BIN
  ?? join(repository, 'target', 'debug', process.platform === 'win32' ? 'rovai-core.exe' : 'rovai-core')

// This owns the real run_core -> ready -> RPC seam: an initializer-only unit test
// cannot prove that a healthy authority remains reachable after a filesystem error.
test('optional startup failures preserve authority RPC and can recover without restarting Core', async (t) => {
  for (const scenario of [
    { id: 'mcp', path: 'mcp.json', kind: 'directory', method: 'mcp.config.get' },
    { id: 'skills', path: 'managed-skill-library/.staging', kind: 'file', method: 'skills.list' },
    { id: 'runtime.claude-code-cli', path: 'runtime-private', kind: 'file' },
    { id: 'maintenance', path: 'runtime/mcp', kind: 'file' }
  ]) {
    await t.test(scenario.id, async () => {
      const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-startup-availability-')))
      const dataDir = process.platform === 'win32'
        ? JSON.parse(execFileSync(binary, ['--prepare-windows-data-root', join(fixture, 'formal')], { encoding: 'utf8' })).core
        : join(fixture, 'data')
      const skillRoot = join(dataDir, 'managed-skill-library')
      const mcpPath = join(dataDir, 'mcp.json')
      if (process.platform === 'win32') {
        // Only native Core creates private managed directories on Windows.
        const seed = startCore(dataDir, skillRoot, mcpPath)
        try { await seed.ready; await seed.settled() } finally { await seed.close() }
      } else {
        await mkdir(skillRoot, { recursive: true, mode: 0o700 })
      }
      const faultPath = join(dataDir, scenario.path)
      if (await lstat(faultPath).catch(() => null)) await rename(faultPath, `${faultPath}.before-fault`)
      await mkdir(dirname(faultPath), { recursive: true, mode: 0o700 })
      if (scenario.kind === 'directory') await mkdir(faultPath)
      else await writeFile(faultPath, 'preserve this non-authority fixture')
      const core = startCore(dataDir, skillRoot, mcpPath)
      try {
        const frame = await core.ready
        assert.ok(frame.subsystems.some((entry) => entry.state === 'initializing'), 'authority ready precedes optional initialization')
        const statuses = await core.settled()
        assert.equal(statuses.find((entry) => entry.id === scenario.id)?.state, 'degraded')
        assert.ok((await core.request('members.list')).length > 0)
        assert.ok(await core.request('navigation.snapshot'))
        if (scenario.method) {
          await assert.rejects(core.request(scenario.method), (error) =>
            error.code === 'subsystem_unavailable'
            && error.kind === 'infrastructure_failure'
            && error.retryable === true
            && error.details.subsystem === scenario.id
          )
        }
        assert.equal(core.process.exitCode, null, 'a local initializer failure must not kill Core')
        await rename(faultPath, `${faultPath}.retained`)
        const recovered = await core.request('runtime.subsystems.retry')
        assert.equal(recovered.find((entry) => entry.id === scenario.id)?.state, 'ready')
        assert.ok((await core.request('members.list')).length > 0)
        assert.equal(core.process.exitCode, null, 'retry must repair the feature in the same Core')
      } finally {
        await core.close()
        await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
        await rm(fixture, { recursive: true, force: true })
      }
    })
  }
})

// This owns the Core RPC -> transaction -> private notification seam. Queue
// ordering/edit semantics remain in pending_camp_input.rs; no Runtime is invoked.
test('queued input commits notify Desktop without exposing private bodies in public history', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-queue-events-')))
  const dataDir = process.platform === 'win32'
    ? JSON.parse(execFileSync(binary, ['--prepare-windows-data-root', join(fixture, 'formal')], { encoding: 'utf8' })).core
    : join(fixture, 'data')
  const skillRoot = join(dataDir, 'managed-skill-library')
  const mcpPath = join(dataDir, 'mcp.json')
  let core = startCore(dataDir, skillRoot, mcpPath)
  let database
  try {
    await core.ready
    await core.settled()
    const agent = (await core.request('members.list')).find(profile => profile.presence === 'present')
    const created = await core.request('camps.create', {
      commandId: randomUUID(), name: 'Private queue notification fixture', workspace: null,
      memberAgentIds: [agent.agentId], defaultLeadAgentId: agent.agentId, collaborationMode: 'peer'
    })
    assert.equal(created.status, 'applied')
    const campId = created.payload.campId
    await core.close()
    database = new DatabaseSync(join(dataDir, 'rovai.sqlite'))
    const now = new Date().toISOString()
    database.prepare(`INSERT INTO pending_camp_input(
      id, camp_id, enqueue_sequence, state, structured_content_json, execution_json, user_id,
      last_attempt_error_code, created_at, updated_at
    ) VALUES ('held-head', ?, 1, 'needs_repair', ?, 'null', 'local_user', 'fixture.hold', ?, ?)`)
      .run(campId, JSON.stringify([{ kind: 'text', text: 'Private held head' }]), now, now)
    // A publication transaction must fail before it can create a Run or execute a
    // model. The scheduler still has to announce the committed needs_repair state.
    database.exec(`CREATE TRIGGER refuse_fixture_publication BEFORE INSERT ON camp_message
      BEGIN SELECT RAISE(ABORT, 'fixture publication refusal'); END;`)
    database.close()
    database = null
    core = startCore(dataDir, skillRoot, mcpPath)
    await core.ready
    const draft = await core.request('camp.composerDraft.save', {
      campId, expectedRevision: 0, content: [{ kind: 'text', text: 'Private queued body' }]
    })
    const result = await core.request('camp.messages.send', {
      commandId: randomUUID(), campId, draftRevision: draft.revision,
      execution: { taskId: null, purpose: 'private queue fixture', completionRole: 'required' }
    })
    assert.equal(result.commandResult.code, 'pending_input.queued')
    const item = (await core.request('camp.pendingInputs.get', { campId })).items[1]
    const edit = async (action, editToken = null, target = item) => core.request('camp.pendingInputs.edit', {
      commandId: randomUUID(), command: { campId, pendingInputId: target.id,
        expectedRevision: target.revision, editToken, action }
    })
    const begun = await edit({ type: 'begin' })
    assert.equal(begun.status, 'applied')
    const editing = await core.request('camp.pendingInputs.get', { campId })
    assert.equal(editing.editSession.editToken, begun.payload.editToken)
    assert.equal((await edit({ type: 'cancel' }, begun.payload.editToken)).status, 'applied')
    assert.equal((await edit({ type: 'delete' }, null, editing.items[0])).status, 'applied')
    const deadline = Date.now() + 10_000
    while (!core.notifications.some(event => event.method === 'camp.pendingInputs.changed' && event.params.reason === 'publication_failed')) {
      assert.ok(Date.now() < deadline, 'A failed publication must notify the private queue')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const failed = await core.request('camp.pendingInputs.get', { campId })
    assert.equal(failed.items.length, 1)
    assert.equal(failed.items[0].state, 'needs_repair')
    const invalidations = core.notifications.filter(event => event.method === 'camp.pendingInputs.changed')
    assert.deepEqual(invalidations.map(event => event.params.reason), ['enqueued', 'edited', 'edited', 'edited', 'publication_failed'])
    assert.ok(invalidations.every(event => event.params.campId === campId && Object.keys(event.params).length === 2))
    await core.close()
    database = new DatabaseSync(join(dataDir, 'rovai.sqlite'), { readOnly: true })
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_run').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM camp_message').get().count, 0)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM event_log WHERE payload_json LIKE '%Private queued body%'").get().count, 0)
  } finally {
    database?.close()
    await core.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

test('authority recovery errors produce a retryable refusal rather than a crash or false ready', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-authority-recovery-')))
  const dataDir = process.platform === 'win32'
    ? JSON.parse(execFileSync(binary, ['--prepare-windows-data-root', join(fixture, 'formal')], { encoding: 'utf8' })).core
    : join(fixture, 'data')
  const skillRoot = join(dataDir, 'managed-skill-library')
  const mcpPath = join(dataDir, 'mcp.json')
  const seed = startCore(dataDir, skillRoot, mcpPath)
  let writer
  let refused
  let recovered
  try {
    await seed.ready
    await seed.settled()
    const before = await seed.request('members.list')
    await seed.close()
    writer = new DatabaseSync(join(dataDir, 'rovai.sqlite'))
    // Valid pending authority, with a fixture-only failure at its settlement
    // boundary. A generic SQLite writer lock fails earlier during DB open/seed
    // and cannot exercise run_core's post-database_ready recovery refusal.
    writer.exec(`
      INSERT INTO planned_shutdown_cycle(core_generation, protocol_version, requested_at)
      VALUES ('acceptance-refused-settlement', 3, '2026-08-30T00:00:00Z');
      CREATE TRIGGER acceptance_refuse_settlement BEFORE UPDATE ON planned_shutdown_cycle
      WHEN OLD.core_generation = 'acceptance-refused-settlement'
      BEGIN SELECT RAISE(ABORT, 'injected controlled shutdown recovery failure'); END;
    `)
    writer.close()
    writer = null
    refused = startCore(dataDir, skillRoot, mcpPath)
    await assert.rejects(refused.ready, (error) =>
      error.code === 'authority_recovery_failed' && error.phase === 'recovering_authority'
      && error.startupStatus === 'failed' && error.retryable === true
    )
    await refused.close()
    assert.equal(refused.process.exitCode, 0, 'deterministic refusal must not be an unexpected Core crash')
    writer = new DatabaseSync(join(dataDir, 'rovai.sqlite'))
    assert.equal(writer.prepare("SELECT settled_at FROM planned_shutdown_cycle WHERE core_generation = 'acceptance-refused-settlement'").get().settled_at, null)
    writer.exec('DROP TRIGGER acceptance_refuse_settlement')
    writer.close()
    writer = null
    recovered = startCore(dataDir, skillRoot, mcpPath)
    await recovered.ready
    assert.deepEqual(await recovered.request('members.list'), before)
  } finally {
    writer?.close()
    await seed.close()
    if (refused) await refused.close()
    if (recovered) await recovered.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

function startCore(dataDir, skillRoot, mcpPath) {
  const child = spawn(binary, [
    ...coreDataDirectoryArguments(dataDir),
    '--skill-library-root', skillRoot,
    '--mcp-config-path', mcpPath
  ], { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let nextId = 0
  let stderr = ''
  const notifications = []
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const startupTimeout = setTimeout(() => rejectReady(new Error(`Core ready timeout: ${stderr}`)), 15000)
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.stdin.on('error', () => {})
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000) })
  child.on('error', rejectReady)
  child.once('exit', (code) => {
    clearTimeout(startupTimeout)
    const error = new Error(`Core exited before usable ready/RPC (code=${code}): ${stderr}`)
    rejectReady(error)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) notifications.push(message)
    if (message.kind === 'core_startup' && message.status === 'ready') {
      clearTimeout(startupTimeout)
      resolveReady(message)
    }
    if (message.kind === 'core_startup' && ['failed', 'blocked'].includes(message.status)) {
      clearTimeout(startupTimeout)
      rejectReady(Object.assign(new Error(message.error?.message ?? 'Startup refused'), message.error, {
        phase: message.phase, startupStatus: message.status
      }))
    }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(message.error)
      else request.resolve(message.result)
    }
  })
  async function request(method, params = {}) {
    await ready
    const id = String(++nextId)
    let timeout
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject })
          child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
        }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 10000) })
      ])
    } finally {
      clearTimeout(timeout)
      pending.delete(id)
    }
  }
  return {
    process: child,
    ready,
    request,
    notifications,
    async settled() {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const states = await request('runtime.subsystems.get')
        if (states.every((entry) => entry.state !== 'initializing')) return states
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error('Optional initialization did not settle')
    },
    async close() {
      child.stdin.end()
      const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
      await closed
      clearTimeout(timeout)
      clearTimeout(startupTimeout)
      lines.close()
    }
  }
}
