import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(join(tmpdir(), 'rovai-memory-v3-smoke-'))
let core = null

try {
  core = startCore(dataDir)
  const empty = await core.request('memory.list')
  assert(empty.memories.length === 0, 'Fresh database inferred Memory from unrelated state')
  assert((await core.request('memory.hearthProposals.list')).length === 0,
    'Fresh Hearth proposal queue is not empty')

  const settings = await core.request('memory.settings.get')
  assert(settings.agentMemoryWritesEnabled === true,
    `Agent Memory writes are not default-on: ${JSON.stringify(settings)}`)
  const disabled = await core.request('memory.settings.set', {
    commandId: crypto.randomUUID(),
    command: {
      expectedVersion: settings.version,
      agentMemoryWritesEnabled: false
    }
  })
  assert(disabled.status === 'applied', `Disabling Agent Memory writes failed: ${JSON.stringify(disabled)}`)
  const enabled = await core.request('memory.settings.set', {
    commandId: crypto.randomUUID(),
    command: {
      expectedVersion: disabled.payload.version,
      agentMemoryWritesEnabled: true
    }
  })
  assert(enabled.status === 'applied', `Re-enabling Agent Memory writes failed: ${JSON.stringify(enabled)}`)

  let secretRejected = false
  try {
    await createMemory(core, {
      scope: 'hearth',
      kind: 'agreement',
      body: 'Authorization: Bearer definitely-not-a-memory',
      retrievalKeys: ['secret rejection'],
      companionAgentProfileId: null,
      relationshipAgentProfileIds: [],
      direction: null,
      directedActorAgentProfileId: null,
      reviewAfter: null
    })
  } catch (error) {
    secretRejected = error.message.includes('memory.secret_rejected')
  }
  assert(secretRejected, 'Secret filter did not fail closed')

  const firstCommandId = crypto.randomUUID()
  const firstCandidate = {
    scope: 'hearth',
    kind: 'preference',
    body: 'Prefer deterministic, audit-friendly changes.',
    retrievalKeys: ['deterministic changes', 'audit friendly'],
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
  assert(firstView.creationOrigin === 'user'
    && firstView.revisions[0].actorKind === 'user'
    && firstView.currentRetrievalKeys.includes('deterministic changes'),
  'Direct user Memory did not retain origin, actor, and Retrieval Keys')

  const hearthCapacity = (await core.request('memory.list')).capacities
    .find((capacity) => capacity.scope === 'hearth')
  assert(hearthCapacity?.maxCount === 32,
    `Hearth capacity is not 32: ${JSON.stringify(hearthCapacity)}`)

  const revised = await core.request('memory.revise', {
    commandId: crypto.randomUUID(),
    command: {
      memoryId: firstId,
      expectedVersion: 1,
      baseRevisionId: firstRevisionId,
      body: 'Prefer deterministic, auditable, and reversible changes.',
      retrievalKeys: ['deterministic changes', 'reversible work'],
      reviewAfter: null
    }
  })
  assert(revised.status === 'applied', `Memory revise failed: ${JSON.stringify(revised)}`)
  const revisedView = await core.request('memory.get', { memoryId: firstId })
  assert(revisedView.version === 2
    && revisedView.revisions.length === 2
    && revisedView.currentRetrievalKeys.includes('reversible work'),
  'Effective revision state did not advance')

  const companion = await createMemory(core, {
    scope: 'companion',
    kind: 'lesson',
    body: 'Companion lessons are effective immediately.',
    retrievalKeys: ['companion lesson'],
    companionAgentProfileId: 'agent-luoke',
    relationshipAgentProfileIds: [],
    direction: null,
    directedActorAgentProfileId: null,
    reviewAfter: null
  })
  assert(companion.status === 'applied', `Companion create failed: ${JSON.stringify(companion)}`)
  const companionView = await core.request('memory.get', { memoryId: companion.payload.memoryId })
  assert(companionView.lifecycle === 'active' && companionView.creationOrigin === 'user',
    'Companion Memory was not immediately effective')

  const forgetBody = 'Forgotten Memory body must disappear from every read side.'
  const forgetCandidate = await createMemory(core, {
    ...firstCandidate,
    body: forgetBody,
    retrievalKeys: ['forget smoke']
  })
  const forgotten = await core.request('memory.forget', {
    commandId: crypto.randomUUID(),
    command: { memoryId: forgetCandidate.payload.memoryId, expectedVersion: 1 }
  })
  assert(forgotten.status === 'applied', `Forget failed: ${JSON.stringify(forgotten)}`)
  const tombstone = await core.request('memory.get', { memoryId: forgetCandidate.payload.memoryId })
  assert(tombstone.lifecycle === 'forgotten'
    && tombstone.currentBody === null
    && tombstone.currentRetrievalKeys.length === 0
    && tombstone.revisions.every((revision) => revision.body === null),
  'Forget left readable Memory content or Retrieval Keys')

  const exported = await core.request('memory.export')
  assert(exported.format === 'rovai-memory-export-v3'
    && Array.isArray(exported.hearthProposals),
  'Memory export v3 format is unstable')
  assert(!JSON.stringify(exported).includes(forgetBody), 'Forgotten body leaked into export')
  assert(!exported.memories.some((memory) => memory.id === forgetCandidate.payload.memoryId),
    'Forgotten tombstone leaked into export')

  await core.stop()
  core = startCore(dataDir)
  const restored = await core.request('memory.get', { memoryId: firstId })
  assert(restored.currentBody === revisedView.currentBody
    && restored.currentRevisionId === revisedView.currentRevisionId,
  'Authoritative Memory changed across Core restart')
  const diagnostics = await core.request('diagnostics.export')
  const diagnosticText = JSON.stringify(diagnostics)
  assert(diagnostics.format === 'rovai-diagnostics-v4' && diagnostics.memory.counts.active >= 2,
    'Diagnostics omitted body-free Memory health')
  assert(!diagnosticText.includes(firstCandidate.body) && !diagnosticText.includes(forgetBody),
    'Diagnostics leaked Memory body text')

  console.log(JSON.stringify({
    ok: true,
    schema: 'memory-v2',
    hearthCapacity: 32,
    singleEffectiveState: true,
    agentMemoryWriteSetting: true,
    originAndRevisionActor: true,
    retrievalKeys: true,
    idempotency: true,
    secretFilter: true,
    forgetAndExportBoundary: true,
    restartStable: true,
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
  child.once('error', rejectAll)
  child.once('exit', (code) => rejectAll(new Error(`Core exited with code ${code}`)))

  function rejectAll(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  return {
    request(method, params = {}) {
      const id = nextId++
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`Timed out waiting for ${method}`))
        }, 30_000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise((resolveStop) => child.once('exit', resolveStop))
    }
  }
}
