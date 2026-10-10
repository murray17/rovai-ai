// Opt-in real Codex acceptance. Never part of deterministic pnpm test.
// A missing, fixture-owned native session file injects an actual resume error;
// no fake Runtime, protocol response or model output is used.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-continuation-real-')))
const data = join(root, 'data')
const workspace = join(root, 'workspace')
const skillLibraryRoot = join(data, 'managed-skill-library')
const mcpConfigPath = join(data, 'mcp.json')
const executable = resolve(process.env.ROVAI_CONTINUATION_CORE ?? join(repository, 'target/debug/rovai-core'))
const executableHash = createHash('sha256')
for await (const chunk of createReadStream(executable)) executableHash.update(chunk)
for (const directory of [data, workspace, skillLibraryRoot]) await mkdir(directory, { recursive: true, mode: 0o700 })
const report = {
  schemaVersion: 1, channel: 'automatic_acceptance', realRuntime: true, mockTransport: false,
  startedAt: new Date().toISOString(), root, data, workspace, skillLibraryRoot, mcpConfigPath, executable,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  sourceDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { cwd: repository })).digest('hex'),
  scriptSha256: createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),
  executableSha256: executableHash.digest('hex'),
  checks: [], runs: [], notVerified: ['Other Runtime adapters/platforms', 'Generic 12-case semantic Judge Gate']
}
console.log(JSON.stringify({ stage: 'isolation', root, data, workspace, skillLibraryRoot, mcpConfigPath, executable }))
let core, threadId, withheld
const terminal = new Set(['succeeded', 'failed', 'cancelled'])
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms))
const sql = (query, ...params) => {
  const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  try { return db.prepare(query).all(...params) } finally { db.close() }
}
const one = (query, ...params) => sql(query, ...params)[0]
const run = id => one('SELECT id,status,version,execution_epoch,terminal_resolution_source,last_error_code,cancel_requested_at,cancel_acknowledged_at,ended_at FROM agent_run WHERE id=?', id)
const session = () => one('SELECT id,native_session_id,native_binding_id,native_binding_generation FROM conversation WHERE camp_id=? AND agent_id=? AND kind=?', threadId, 'agent_1', 'camp_member')
async function waitFor(read, label, timeout = 150_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await pause(20) }
  throw Error(`Timed out: ${label}`)
}
async function start() {
  core = startQualificationCore({ coreExecutable: executable, dataDirectory: data, workingDirectory: workspace,
    runtimeCacheDirectory: join(root, 'runtime-cache'), mcpConfigPath })
  await core.request('health.check')
}
async function stop() {
  if (!core) return
  const stopped = await core.stop()
  await writeFile(join(root, `core-${Date.now()}.log`), stopped.stderrTail, { mode: 0o600 })
  core = null
}
async function request(method, params) { return core.request(method, params) }
async function send(body) {
  const result = await request('thread.messages.send', {
    commandId: randomUUID(), threadId, content: composerDocumentForAddress({ mode: 'default' }, body),
    sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Real continuation acceptance', completionRole: 'required' }
  })
  const receipt = result.commandResult ?? result
  assert.ok(['accepted', 'applied'].includes(receipt.status), JSON.stringify(receipt))
  const deliveryId = receipt.payload.deliveryIds[0]
  return waitFor(() => one('SELECT claimed_agent_run_id AS id FROM camp_message_delivery WHERE id=?', deliveryId)?.id, 'new input claim')
}
async function finish(id, expected = 'succeeded') {
  const result = await waitFor(() => { const value = run(id); return terminal.has(value?.status) && (!value.cancel_requested_at || value.cancel_acknowledged_at) ? value : null }, `terminal and cleanup: ${id}`)
  report.runs.push(result)
  assert.equal(result.status, expected, JSON.stringify(result))
  return result
}
async function continueRun(source) {
  const before = one('SELECT last_message_sequence FROM camp WHERE id=?', threadId)
  const commandId = randomUUID()
  const receipt = await request('agentRuns.continue', { commandId, command: { threadId, agentRunId: source } })
  assert.equal(receipt.status, 'applied', JSON.stringify(receipt))
  assert.equal(receipt.payload.messageId, undefined)
  const delivery = one('SELECT source_kind,message_id FROM camp_message_delivery WHERE id=?', receipt.payload.deliveryId)
  assert.equal(delivery.source_kind, 'continuation')
  assert.equal(delivery.message_id, null)
  assert.equal(one("SELECT count(*) AS n FROM camp_message WHERE camp_id=? AND author_type='system' AND author_id='run-continuation'", threadId).n, 0)
  assert.equal(one('SELECT last_message_sequence FROM camp WHERE id=?', threadId).last_message_sequence, before.last_message_sequence)
  assert.equal(one("SELECT count(*) AS n FROM event_log WHERE command_id=? AND entity_type='camp_message'", commandId).n, 0)
  await check('continuation_has_no_message_record', { deliveryId: receipt.payload.deliveryId })
  return receipt
}
async function cancel(id) {
  const before = run(id)
  assert.equal(before.status, 'running')
  const receipt = await request('agentRuns.cancel', { commandId: randomUUID(), command: {
    threadId, agentRunId: id, expectedVersion: before.version } })
  assert.equal(receipt.status, 'applied', JSON.stringify(receipt))
  await finish(id, 'cancelled')
  // Stop owns an asynchronous ending Git observation after cleanup ACK. Capture
  // the immutable source baseline only after that independent write has settled.
  await waitFor(() => one('SELECT ending_git_observation_json IS NOT NULL AS ready FROM agent_run WHERE id=?', id)?.ready,
    'Stop ending Git observation')
  const settled = run(id)
  report.runs[report.runs.length - 1] = settled
  return settled
}
async function claimed(receipt) {
  assert.equal(receipt.status, 'applied', JSON.stringify(receipt))
  return waitFor(() => one('SELECT claimed_agent_run_id AS id FROM camp_message_delivery WHERE id=?', receipt.payload.deliveryId)?.id, 'continuation claim')
}
async function payload(id) {
  const blob = one('SELECT b.storage_relative_path FROM context_manifest m JOIN managed_blob b ON b.id=m.rendered_payload_blob_id WHERE m.agent_run_id=? ORDER BY m.created_at DESC LIMIT 1', id)
  assert.ok(blob, 'Run must have its own materialized context')
  return readFile(join(data, 'managed-blobs', blob.storage_relative_path), 'utf8')
}
async function addTask(title) {
  const result = await request('tasks.create', { commandId: randomUUID(), threadId, title,
    description: 'Read this current title from the supplied dynamic context; do not change task state.', assigneeAgentId: 'agent_1' })
  assert.equal(result.status, 'applied', JSON.stringify(result))
}
async function check(name, evidence) {
  report.checks.push({ name, passed: true, ...evidence })
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ stage: 'passed', name, ...evidence }))
}
async function hideSessionFile(id) {
  assert.ok(!core && !withheld, 'stop the fixture Core before withholding its native session')
  const sessionRoot = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const paths = execFileSync('rg', ['--files', '--hidden', sessionRoot, '-g', `*${id}*.jsonl`], { encoding: 'utf8' }).trim().split('\n')
  assert.equal(paths.length, 1)
  const original = paths[0]
  assert.ok(basename(original).includes(id))
  const first = JSON.parse((await readFile(original, 'utf8')).split('\n')[0])
  assert.equal(first.payload.id, id)
  assert.equal(await realpath(first.payload.cwd), workspace, 'only a session created by this fixture may be withheld')
  const held = `${original}.rovai-continuation-withheld`
  withheld = { original, held }
  await writeFile(join(root, 'native-file-restore.json'), JSON.stringify(withheld), { mode: 0o600 })
  await rename(original, held)
}
async function restoreSessionFile() {
  if (!withheld) return
  await rename(withheld.held, withheld.original)
  withheld = null
}

try {
  await writeFile(join(workspace, 'README.md'), '# Isolated real continuation acceptance\n')
  await start()
  await request('runtime.product.check', { runtimeKind: 'codex-cli' })
  const installation = await waitFor(async () => (await request('runtime.installations.list')).find(item =>
    item.adapterKind === 'codex-cli' && item.installationClass === 'managed_default'), 'installed Codex CLI')
  const profile = await request('members.get', { agentId: 'agent_1' })
  const configuration = { agentId: 'agent_1', expectedVersion: profile.version, adapterKind: 'codex-cli',
    model: { mode: 'runtime_default' },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } } }
  const configured = await request('members.runtime.set', { commandId: randomUUID(), command: configuration })
  assert.equal(configured.status, 'applied', JSON.stringify(configured))
  report.runtime = { adapter: 'codex-cli', installationId: installation.id,
    version: installation.snapshot?.reportedVersion ?? null, configuration }
  const created = await request('threads.create', { commandId: randomUUID(), name: 'Real continuation acceptance',
    workspace: { projectPath: workspace }, memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
  assert.equal(created.status, 'applied', JSON.stringify(created))
  threadId = created.payload.threadId
  report.threadId = threadId
  console.log(JSON.stringify({ stage: 'configured', threadId, runtime: report.runtime }))
  const seed = await send('This is an isolated acceptance workspace. Write exactly PRESERVED_CHECKPOINT into checkpoint.txt, then reply with NATIVE_SESSION_READY. Do not delegate work.')
  await finish(seed)
  report.runtime.observedModels = sql("SELECT DISTINCT json_extract(payload_json,'$.modelId') AS model FROM event_log WHERE event_type='agent_run.runtime_model_observed'").map(row => row.model)
  const nativeSession = session().native_session_id
  assert.ok(nativeSession)
  report.nativeSession = nativeSession
  const taskBody = [
    'In this isolated workspace, if checkpoint.txt does not exist, write exactly PRESERVED_CHECKPOINT to it, then run sleep 45.',
    'If checkpoint.txt already exists, keep it unchanged and skip the sleep.',
    'Write result.json containing checkpoint (the file content), taskTitles (all your current active task titles from SELF_ACTIVE_TASKS),',
    'and duties (your professionalResponsibilities from your supplied identity/context). Use the context supplied to this execution; do not query platform state.',
    'Do not modify tasks, contact other members or operate outside this workspace. Then publish the short result GATE_DONE.'
  ].join('\n')
  // Cold host startup gives the real cancellation command a window
  // before dispatch. An accepted turn without terminal proof is tested separately
  // below and must automatically select a fresh session after cleanup.
  await stop()
  await start()
  const source = await send(taskBody)
  report.sourceRun = source
  const stopped = await cancel(source)
  assert.equal(one("SELECT count(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND (status IN ('accepted','delivery_unknown') OR dispatch_started_at IS NOT NULL)", source).n, 0,
    'same-session case requires cancellation before input dispatch')
  await addTask('CURRENT_TASK_AFTER_STOP')
  const resumed = await claimed(await continueRun(source))
  await finish(resumed)
  assert.equal(session().native_session_id, nativeSession)
  assert.ok((await payload(resumed)).includes('CURRENT_TASK_AFTER_STOP'))
  const firstResult = JSON.parse(await readFile(join(workspace, 'result.json'), 'utf8'))
  assert.ok(firstResult.taskTitles.includes('CURRENT_TASK_AFTER_STOP'))
  assert.equal(firstResult.checkpoint, 'PRESERVED_CHECKPOINT')
  assert.deepEqual(run(source), stopped)
  await check('stop_before_dispatch_then_continue_in_same_native_session', { source, resumed, nativeSession })

  await addTask('CURRENT_TASK_FOR_NEW_SESSION')
  const currentProfile = await request('members.get', { agentId: 'agent_1' })
  const changed = await request('members.update', { commandId: randomUUID(), command: {
    agentId: 'agent_1', expectedVersion: currentProfile.version, displayName: currentProfile.displayName,
    teamRole: currentProfile.teamRole, professionalResponsibilities: 'CURRENT_DUTIES_FOR_NEW_SESSION',
    personalityTraits: currentProfile.personalityTraits, workingPrinciples: currentProfile.workingPrinciples,
    growthTopic: currentProfile.growthTopic
  } })
  assert.equal(changed.status, 'applied', JSON.stringify(changed))
  const checkpointDigest = createHash('sha256').update(await readFile(join(workspace, 'checkpoint.txt'))).digest('hex')
  await stop()
  await hideSessionFile(nativeSession)
  await start()
  const replacement = await claimed(await continueRun(source))
  await finish(replacement)
  assert.notEqual(session().native_session_id, nativeSession)
  assert.equal(createHash('sha256').update(await readFile(join(workspace, 'checkpoint.txt'))).digest('hex'), checkpointDigest)
  const rebuilt = await payload(replacement)
  assert.ok(rebuilt.includes('CURRENT_TASK_FOR_NEW_SESSION'))
  assert.ok(!rebuilt.includes('continuation.sourceAgentRunId'))
  assert.ok(!rebuilt.includes(source))
  const finalResult = JSON.parse(await readFile(join(workspace, 'result.json'), 'utf8'))
  assert.ok(finalResult.taskTitles.includes('CURRENT_TASK_FOR_NEW_SESSION'))
  assert.equal(finalResult.duties, 'CURRENT_DUTIES_FOR_NEW_SESSION')
  assert.equal(finalResult.checkpoint, 'PRESERVED_CHECKPOINT')
  assert.deepEqual(run(source), stopped)
  assert.equal(one('SELECT count(*) AS n FROM camp_turn WHERE camp_id=?', threadId).n, 0)
  assert.equal(one('SELECT count(*) AS n FROM event_log WHERE event_type=? AND entity_id=?',
    'agent_run.native_session_continuity_lost', replacement).n, 1)
  assert.equal(one('SELECT count(*) AS n FROM runtime_input_delivery WHERE agent_run_id=?', replacement).n, 1,
    'resume fallback must prepare and dispatch the new business input only once')
  const replacementSession = session().native_session_id
  await check('actual_resume_failure_automatically_replaces_session_before_single_dispatch', {
    replacement, replacementSession, checkpointDigest, originalSession: nativeSession
  })
  await stop()
  await restoreSessionFile()
  await start()
  const ordinary = await send('Reply with ORDINARY_SESSION_RECOVERED. Keep the workspace and active tasks unchanged.')
  await finish(ordinary)
  const repeated = await claimed(await continueRun(source))
  await finish(repeated)
  assert.equal(session().native_session_id, replacementSession)
  assert.deepEqual(run(source), stopped)
  await check('ordinary_and_repeated_continuation_reuse_current_session', { ordinary, repeated, replacementSession })

  const acceptedStop = await send('In this isolated workspace, if accepted-stop.txt does not exist, write ACCEPTED into it and then run sleep 45. If it exists, skip the sleep and reply ACCEPTED_CONTINUATION_DONE. Keep checkpoint.txt and tasks unchanged; do not delegate work.')
  await waitFor(async () => { try { return (await readFile(join(workspace, 'accepted-stop.txt'), 'utf8')) === 'ACCEPTED' } catch { return false } }, 'accepted input checkpoint before stop')
  const acceptedStopped = await cancel(acceptedStop)
  assert.equal(one("SELECT count(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND status='accepted'", acceptedStop).n, 1)
  const acceptedReplacement = await claimed(await continueRun(acceptedStop))
  await finish(acceptedReplacement)
  assert.notEqual(session().native_session_id, replacementSession)
  assert.deepEqual(run(acceptedStop), acceptedStopped)
  assert.equal(await readFile(join(workspace, 'checkpoint.txt'), 'utf8'), 'PRESERVED_CHECKPOINT')
  await check('accepted_stop_without_native_terminal_automatically_selects_new_session', {
    acceptedStop, acceptedReplacement, replacementSession: session().native_session_id
  })
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = String(error.stack ?? error)
  console.error(JSON.stringify({ stage: 'failed', root, error: report.error }))
  process.exitCode = 1
} finally {
  await stop()
  await restoreSessionFile()
  report.finishedAt = new Date().toISOString()
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ stage: 'complete', passed: report.passed, report: join(root, 'report.json') }))
}
