import { chmod, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(join(tmpdir(), 'rovai-memory-smoke-'))
const hearthPath = join(dataDir, 'memory', 'projections', 'v1', 'hearth', 'current.md')
let core = null

try {
  core = startCore(dataDir)
  const empty = await core.request('memory.list')
  assert(empty.memories.length === 0, 'Fresh database inferred Memory from unrelated state')
  assert((await core.request('memory.proposals.list')).length === 0, 'Fresh Proposal queue is not empty')
  const freshPolicy = await core.request('memory.autoPolicy.get')
  assert(freshPolicy.automaticPartnerMemoryEnabled === true,
    `Fresh automatic partner Memory policy is not default-on: ${JSON.stringify(freshPolicy)}`)
  const disabledPolicy = await core.request('memory.autoPolicy.set', {
    commandId: crypto.randomUUID(),
    command: {
      expectedVersion: freshPolicy.version,
      automaticPartnerMemoryEnabled: false
    }
  })
  assert(disabledPolicy.status === 'applied',
    `Disabling automatic partner Memory failed: ${JSON.stringify(disabledPolicy)}`)
  const enabledPolicy = await core.request('memory.autoPolicy.set', {
    commandId: crypto.randomUUID(),
    command: {
      expectedVersion: disabledPolicy.payload.version,
      automaticPartnerMemoryEnabled: true
    }
  })
  assert(enabledPolicy.status === 'applied',
    `Re-enabling automatic partner Memory failed: ${JSON.stringify(enabledPolicy)}`)

  const rejectedSecret = await createMemory(core, {
    scope: 'hearth',
    kind: 'agreement',
    body: 'Authorization: Bearer definitely-not-a-memory',
    companionAgentProfileId: null,
    relationshipAgentProfileIds: [],
    direction: null,
    directedActorAgentProfileId: null,
    reviewAfter: null
  })
  assert(rejectedSecret.status === 'rejected' && rejectedSecret.code === 'memory.secret_rejected',
    `Secret filter did not fail closed: ${JSON.stringify(rejectedSecret)}`)

  const firstCommandId = crypto.randomUUID()
  const firstCandidate = {
    scope: 'hearth',
    kind: 'preference',
    body: 'Prefer deterministic, audit-friendly changes.',
    companionAgentProfileId: null,
    relationshipAgentProfileIds: [],
    direction: null,
    directedActorAgentProfileId: null,
    reviewAfter: null
  }
  const first = await createMemory(core, firstCandidate, firstCommandId)
  const replay = await createMemory(core, firstCandidate, firstCommandId)
  assert(first.status === 'applied' && replay.resultEntity?.entityId === first.resultEntity?.entityId,
    'Memory create did not replay idempotently')
  const firstId = first.payload.memoryId
  const firstRevisionId = first.payload.revisionId
  const firstView = await core.request('memory.get', { memoryId: firstId })
  assert(firstView.currentAuthority === 'user_confirmed'
    && firstView.revisions[0].authority === 'user_confirmed',
  'Direct user Memory did not receive user_confirmed Revision authority')
  const firstProjection = await readFile(hearthPath, 'utf8')
  assert(firstProjection.includes(firstCandidate.body)
    && firstProjection.includes('rovai-memory-projection:v2')
    && firstProjection.includes('authority: `user_confirmed`'),
    'Authoritative create did not publish the Hearth projection')
  assert(((await stat(hearthPath)).mode & 0o777) === 0o600, 'Projection file is not mode 0600')

  await writeFile(hearthPath, 'EXTERNAL_MEMORY_POLLUTION\n', { mode: 0o600 })
  const reconciled = await core.request('memory.reconcile', {
    commandId: crypto.randomUUID(),
    command: {}
  })
  assert(reconciled.status === 'applied', `Reconcile failed: ${JSON.stringify(reconciled)}`)
  assert(!(await readFile(hearthPath, 'utf8')).includes('EXTERNAL_MEMORY_POLLUTION'),
    'External Markdown pollution survived reconciliation')

  const revised = await core.request('memory.revise', {
    commandId: crypto.randomUUID(),
    command: {
      memoryId: firstId,
      expectedVersion: 1,
      baseRevisionId: firstRevisionId,
      body: 'Prefer deterministic, auditable, and reversible changes.',
      reviewAfter: null
    }
  })
  assert(revised.status === 'applied', `Memory revise failed: ${JSON.stringify(revised)}`)
  assert((await readFile(hearthPath, 'utf8')).includes('reversible changes'),
    'Live projection did not publish the current Revision')

  const successor = await createMemory(core, {
    ...firstCandidate,
    body: 'Prefer changes with deterministic output and explicit verification.'
  })
  assert(successor.status === 'applied', `Successor create failed: ${JSON.stringify(successor)}`)
  const superseded = await core.request('memory.supersede', {
    commandId: crypto.randomUUID(),
    command: {
      predecessors: [{ memoryId: firstId, expectedVersion: 2 }],
      successor: {
        mode: 'existing',
        memoryId: successor.payload.memoryId,
        expectedVersion: 1
      }
    }
  })
  assert(superseded.status === 'applied', `Supersession failed: ${JSON.stringify(superseded)}`)
  const cannotReactivate = await core.request('memory.reactivate', {
    commandId: crypto.randomUUID(),
    command: { memoryId: firstId, expectedVersion: 3 }
  })
  assert(cannotReactivate.status === 'rejected' && cannotReactivate.code === 'memory.lifecycle_conflict',
    'Superseded predecessor was incorrectly reactivated')

  const forgetBody = 'Forget smoke body must disappear from every Memory read side.'
  const forgetCandidate = await createMemory(core, {
    scope: 'companion',
    kind: 'lesson',
    body: forgetBody,
    companionAgentProfileId: 'agent-luoke',
    relationshipAgentProfileIds: [],
    direction: null,
    directedActorAgentProfileId: null,
    reviewAfter: null
  })
  const forgotten = await core.request('memory.forget', {
    commandId: crypto.randomUUID(),
    command: { memoryId: forgetCandidate.payload.memoryId, expectedVersion: 1 }
  })
  assert(forgotten.status === 'applied', `Forget failed: ${JSON.stringify(forgotten)}`)
  const tombstone = await core.request('memory.get', { memoryId: forgetCandidate.payload.memoryId })
  assert(tombstone.lifecycle === 'forgotten' && tombstone.currentBody === null
    && tombstone.revisions.every((revision) => revision.body === null),
  'Forget left a readable Revision body')
  const exported = await core.request('memory.export')
  assert(exported.format === 'rovai-memory-export-v2' && Array.isArray(exported.proposals),
    'Memory export v2 authority/proposal format is unstable')
  assert(!JSON.stringify(exported).includes(forgetBody), 'Forgotten body leaked into export')
  assert(!exported.memories.some((memory) => memory.id === forgetCandidate.payload.memoryId),
    'Forgotten tombstone leaked into export')

  await unlink(hearthPath)
  await core.stop()
  core = startCore(dataDir)
  const restored = await core.request('memory.list')
  assert(restored.memories.some((memory) => memory.id === successor.payload.memoryId),
    'Memory Library did not survive Core restart')
  assert((await readFile(hearthPath, 'utf8')).includes('explicit verification'),
    'Startup reconciliation did not restore a missing projection')
  const issues = await core.request('memory.projections.listIssues')
  assert(issues.length === 0, `Healthy Memory projection reported issues: ${JSON.stringify(issues)}`)
  const diagnostics = await core.request('diagnostics.export')
  const diagnosticText = JSON.stringify(diagnostics)
  assert(diagnostics.format === 'rovai-diagnostics-v4' && diagnostics.memory.counts.active >= 1,
    'Diagnostics omitted body-free Memory health')
  assert(!diagnosticText.includes(firstCandidate.body) && !diagnosticText.includes(forgetBody),
    'Diagnostics leaked Memory body text')

  await chmod(hearthPath, 0o600)
  console.log(JSON.stringify({
    ok: true,
    migrationAndRestart: true,
    automaticPartnerMemoryDefaultsOnAndCanBeToggled: true,
    directGovernance: true,
    idempotency: true,
    secretFilter: true,
    revisionAndSupersession: true,
    forgetAndExportBoundary: true,
    projectionPollutionRecovery: true,
    projectionPermissions: '0600',
    diagnosticsAreBodyFree: true
  }, null, 2))
} finally {
  await core?.stop()
  await rm(dataDir, { recursive: true, force: true })
}

function createMemory(client, command, commandId = crypto.randomUUID()) {
  return client.request('memory.create', { commandId, command })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  child.once('error', (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  })
  return {
    request(method, params = {}) {
      const id = nextId++
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`Timed out waiting for ${method}`))
        }, 30_000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop() {
      if (child.exitCode !== null) return
      child.stdin.end()
      await Promise.race([
        new Promise((resolveClose) => child.once('close', resolveClose)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
      ])
      if (child.exitCode === null) child.kill('SIGTERM')
    }
  }
}
