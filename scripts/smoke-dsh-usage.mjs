// Compare real provider accounting with Core's persisted canonical buckets,
// including an automatic summary call and exact cold continuation.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { prepareDshSmokeHome } from './lib/dsh-smoke-home.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { querySqliteRows } from './lib/sqlite.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-dsh-usage-')))
const project = join(root, 'project'), data = join(root, 'data')
const audit = join(root, 'native-usage.jsonl'), plugin = join(root, 'usage-audit.mjs')
await mkdir(project)
await writeFile(join(project, 'README.md'), '# Isolated DSH usage acceptance\n')
execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' })
// Independent observer records only public accounting fields. No prompt,
// generated summary, credentials or provider response body is copied.
await writeFile(plugin, `import { appendFileSync } from 'node:fs'
export const name = 'usage-audit'
export function apply(ctx, config) {
  const owners = new Map()
  ctx.on('session/event', (session, event) => {
    if (session.header.parentSession != null) return
    const key = JSON.stringify([session.id, event.data?.compactionId])
    if (event.type === 'compaction/start') { owners.set(key, event.data.turn); return }
    if (event.type === 'compaction/end') { owners.delete(key); return }
    if (!['assistant/message', 'compaction/summary'].includes(event.type) || !event.data?.usage) return
    const turn = event.type === 'compaction/summary' ? owners.get(key) : event.data.turn
    if (!Number.isSafeInteger(turn)) return
    const usage = {}
    for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
      const value = event.data.usage[field]
      if (Number.isSafeInteger(value) && value >= 0) usage[field] = value
    }
    appendFileSync(config.path, JSON.stringify({ sessionId: session.id, seq: event.seq, turn, type: event.type, usage }) + '\\n', { mode: 0o600 })
  })
}
`, { mode: 0o600 })
await prepareDshSmokeHome(join(root, 'home'), [
  { id: 'compaction-basic', config: { retainTokens: 0, thresholdRatio: 0.04, compactionRetries: 0, maxTokens: 2048, auto: true } },
  { insert: [{ id: 'usage-audit', name: plugin, config: { path: audit } }] }
])
process.env.DSH_HOME = join(root, 'home')
process.env.DSH_AGENTS_HOME = join(root, 'agents-home')
await writeFile(join(root, 'mcp.json'), '{}')
let core, workspace, events = [], threadId
const runs = []
async function start() {
  events = []
  core = startQualificationCore({ coreExecutable: join(repository, 'target/debug/rovai-core'),
    dataDirectory: data, workingDirectory: repository, runtimeCacheDirectory: join(root, 'cache'),
    mcpConfigPath: join(root, 'mcp.json'), onNotification: event => events.push(event) })
  await core.request('health.check')
  workspace = await core.request('workspaces.inspect', { path: project })
}
async function send(body) {
  let response
  if (!threadId) {
    response = await createConfiguredCampAndSend(core.request, { commandId: crypto.randomUUID(), workspace, body,
      address: { mode: 'explicit', agentIds: ['agent_2'] }, purpose: 'DSH native usage accounting' })
  } else {
    const draft = await core.request('camp.composerDraft.get', { threadId })
    const saved = await core.request('camp.composerDraft.save', { threadId, expectedRevision: draft.revision,
      content: { version: 2, segments: [{ kind: 'text', text: body }] } })
    response = await core.request('camp.messages.send', { commandId: crypto.randomUUID(), threadId, draftRevision: saved.revision,
      execution: { taskId: null, purpose: 'DSH native usage continuation', completionRole: 'required' } })
  }
  const command = response.commandResult ?? response
  assert.equal(command.status, 'accepted')
  threadId ??= command.payload.threadId
  const runId = command.payload.agentRunIds[0]
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const snapshot = await core.request('camps.snapshot', { threadId })
    const run = snapshot.agentRuns.find(item => item.id === runId)
    if (run?.status === 'succeeded') {
      const event = events.find(event => event.params?.agentRunId === runId && event.params?.nativeThreadId && event.params?.hostInstanceId)
      assert(event, 'missing native identity')
      runs.push({ runId, sessionId: event.params.nativeThreadId, hostId: event.params.hostInstanceId })
      return
    }
    assert(!['failed', 'cancelled'].includes(run?.status), `DSH usage Run ${run?.status}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('DSH usage Run timed out')
}
async function reconcile() {
  const records = (await readFile(audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(new Set(records.map(record => JSON.stringify([record.sessionId, record.seq]))).size, records.length, 'native events replayed')
  const rows = await querySqliteRows(join(data, 'rovai.sqlite'), 'SELECT * FROM runtime_usage_run_summary')
  assert.equal(rows.length, runs.length)
  const mapping = { inputTokens: 'uncached_input_tokens', outputTokens: 'output_tokens',
    cacheReadTokens: 'cache_read_tokens', cacheWriteTokens: 'cache_write_tokens', reasoningTokens: 'reasoning_output_tokens' }
  const turns = [...new Set(records.map(record => record.turn))].sort((a, b) => a - b)
  assert.equal(turns.length, runs.length, 'fixture expected one native turn per AgentRun')
  for (const [index, run] of runs.entries()) {
    const row = rows.find(row => row.agent_run_id === run.runId)
    assert(row, 'missing AgentRun usage')
    const calls = records.filter(record => record.turn === turns[index])
    assert(calls.every(record => record.sessionId === run.sessionId))
    for (const [source, target] of Object.entries(mapping)) {
      const values = calls.map(call => call.usage[source]).filter(value => value !== undefined)
      const expected = values.length ? values.reduce((sum, value) => sum + value, 0) : null
      assert.equal(row[target], expected, `${source} attributed to the wrong AgentRun`)
    }
  }
  const totals = {}
  for (const [source, target] of Object.entries(mapping)) {
    const native = records.map(record => record.usage[source]).filter(value => value !== undefined)
    const persisted = rows.map(row => row[target]).filter(value => value !== null)
    if (native.length) {
      assert(persisted.length, `Core omitted ${source}`)
      totals[target] = native.reduce((sum, value) => sum + value, 0)
      assert.equal(persisted.reduce((sum, value) => sum + value, 0), totals[target], `${source} lost or double-counted`)
    } else assert.equal(persisted.length, 0, `${source} fabricated`)
  }
  assert(rows.every(row => row.cost_amount_decimal === null), 'unreported cost fabricated')
  return { runs: runs.length, nativeCalls: records.length,
    automaticSummaryCalls: records.filter(record => record.type === 'compaction/summary').length,
    totals, bucketsMatch: true, perRunAttributionMatches: true }
}
try {
  await start()
  await configureProductRuntime(core.request, 'deepseek-harness', ['agent_2'])
  // Stay within Core's production input budget; native history plus Bootstrap
  // still exceeds the acceptance-only 4% compaction threshold.
  const filler = Array.from({ length: 700 }, (_, i) => `Disposable usage observation ${i}: item ${i} completed normally.`).join('\n')
  await send(`Read this disposable history, then reply READY only. Do not call tools.\n${filler}`)
  await send('Reply exactly WARM_USAGE_OK. Do not call tools.')
  assert.equal(runs[0].sessionId, runs[1].sessionId)
  assert.equal(runs[0].hostId, runs[1].hostId)
  const warm = await reconcile()
  assert(warm.automaticSummaryCalls > 0, 'automatic compaction not observed')
  console.error('[dsh-usage] warm automatic summary accounting matched')
  await core.stop(); core = null
  await start()
  await send('Reply exactly COLD_USAGE_OK. Do not call tools.')
  assert.equal(runs[2].sessionId, runs[0].sessionId)
  assert.notEqual(runs[2].hostId, runs[0].hostId)
  const cold = await reconcile()
  assert(cold.nativeCalls > warm.nativeCalls)
  console.log(JSON.stringify({ passed: true, warm, cold, exactColdResume: true, noReplay: true, fixtureRoot: root }, null, 2))
} finally {
  if (core) await core.stop()
  await removeEphemeralRuntimeCampFilesRoot(data)
}
