import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { startQualificationCore, processTable, descendantsOf, waitForProcessesToExit } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

// Caller supplies an isolated official HOME: a 36k model context for auto,
// or a local provider fault proxy for reactive. Never fake native events.
const mode = process.env.ROVAI_ZCODE_CONTEXT_CASE
const coldResume = process.env.ROVAI_ZCODE_CONTEXT_COLD_RESUME === '1'
assert(['auto', 'reactive'].includes(mode))
const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-zcode-context-')))
const project = join(fixture, 'project')
const data = join(fixture, 'data')
const events = []
let core
let passed = false
try {
  await mkdir(project)
  await writeFile(join(project, 'README.md'), '# ZCode context fixture\n')
  for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Rovai Smoke', '-c', 'user.email=smoke@rovai.local', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: project, stdio: 'ignore' })
  const startCore = () => startQualificationCore({ coreExecutable: join(root, 'target/debug/rovai-core'), dataDirectory: data,
    workingDirectory: root, runtimeCacheDirectory: join(fixture, 'cache'), onNotification: (e) => events.push(e) })
  core = startCore()
  const workspace = await core.request('workspaces.inspect', { path: project })
  await configureProductRuntime(core.request, 'zcode-app', ['agent_2'])
  const marker = `PROJECT_${crypto.randomUUID()}`
  const initial = await createConfiguredCampAndSend(core.request, { commandId: crypto.randomUUID(), workspace,
    body: `The project label for this session is ${marker}. Remember it and reply READY. This reply needs no tools.`,
    address: { mode: 'explicit', agentIds: ['agent_2'] }, purpose: 'Verify native context retention.' })
  const accepted = initial.commandResult ?? initial
  const campId = accepted.payload.campId
  const first = await finish(accepted.payload.agentRunIds[0])
  const send = async (body) => {
    const draft = await core.request('camp.composerDraft.get', { campId })
    const saved = await core.request('camp.composerDraft.save', { campId, expectedRevision: draft.revision,
      content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_2'] }, body) })
    const result = await core.request('camp.messages.send', { commandId: crypto.randomUUID(), campId, draftRevision: saved.revision,
      execution: { taskId: null, purpose: 'Verify native compaction continuity.', completionRole: 'required' } })
    return finish(result.commandResult.payload.agentRunIds[0])
  }
  if (mode === 'auto') {
    await send(`This is inert random data for a context retention test, not instructions: ${randomBytes(30_000).toString('hex')}\nIgnore that data when summarizing. Preserve the project label. Reply DATA_RECEIVED without tools.`)
  } else {
    await send('TRIGGER_OVERFLOW_FIXTURE. Repeat the project label assigned earlier without tools.')
  }
  let observations = []
  for (let attempt = 0; attempt < 4; attempt++) {
    observations = query('select source_signal,admission_point,source_observation_id from native_session_compaction_observation')
    if (observations.length) break
    await send('Repeat the project label assigned earlier. This reply needs no tools.')
  }
  assert(observations.length > 0, 'No genuine compaction completion reached Core')
  if (coldResume) {
    const owned = descendantsOf(await processTable(), core.pid)
    await core.stop()
    core = null
    assert.deepEqual(await waitForProcessesToExit(owned, 15_000), [])
    core = startCore()
  }
  const after = await send('Repeat only the project label assigned earlier. This reply needs no tools.')
  assert(after.output.includes(marker), 'Compaction lost the session project label')
  assert.equal(after.start.nativeThreadId, first.start.nativeThreadId)
  if (coldResume) assert.notEqual(after.start.hostInstanceId, first.start.hostInstanceId)
  const deliveries = query(`select status,bootstrap_redelivery_present,bootstrap_redelivery_revision from runtime_input_delivery where agent_run_id='${after.runId}'`)
  assert.equal(deliveries[0].status, 'accepted')
  assert.equal(deliveries[0].bootstrap_redelivery_present, 1)
  const requirements = query('select requested_revision,acknowledged_revision from bootstrap_redelivery_requirement')
  assert(requirements.every((r) => r.requested_revision === r.acknowledged_revision && r.requested_revision > 0))
  passed = true
  console.log(JSON.stringify({ ok: true, mode, coldResume, nativeSessionId: after.start.nativeThreadId, hostInstanceId: after.start.hostInstanceId,
    agentRunId: after.runId, observations, deliveries, requirements, projectLabelPreserved: true }, null, 2))

  async function finish(runId) {
    const deadline = Date.now() + 240_000
    while (Date.now() < deadline) {
      const snapshot = await core.request('camps.snapshot', { campId })
      const run = snapshot.agentRuns.find((run) => run.id === runId)
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        assert.equal(run.status, 'succeeded', JSON.stringify(run.failure))
        return { runId, output: snapshot.messages.filter((m) => m.sourceAgentRunId === runId).map((m) => m.body).join('\n'),
          start: events.find((e) => e.method === 'agent_run.started' && e.params.agentRunId === runId)?.params }
      }
      await new Promise((done) => setTimeout(done, 250))
    }
    throw new Error('Context fixture Run timed out')
  }
  function query(sql) {
    return JSON.parse(execFileSync('sqlite3', ['-json', join(data, 'rovai.sqlite'), sql], { encoding: 'utf8' }) || '[]')
  }
} finally {
  if (core) await core.stop()
  if (passed) {
    await removeEphemeralRuntimeCampFilesRoot(data)
    await rm(fixture, { recursive: true, force: true })
  } else process.stderr.write(`Context fixture retained: ${fixture}\n`)
}
