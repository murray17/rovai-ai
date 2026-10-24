// Real Core and Hermes. Caller supplies a dedicated, already configured native
// Hermes Home; never copy daily Rovai data or resolve another runtime's secrets.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore, descendantsOf, processTable, waitForProcessesToExit } from './lib/qualification-core.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'

assert(process.env.ROVAI_HERMES_SMOKE_HOME, 'Set ROVAI_HERMES_SMOKE_HOME to a private acceptance Home')
assert(process.env.ROVAI_HERMES_BIN, 'Select an official Hermes >= 0.22.4 launcher')
const forceUnknown = process.argv.includes('--force-unknown')
const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermes-core-')))
const data = join(root, 'data'), project = join(root, 'project')
await mkdir(project)
await writeFile(join(root, 'mcp.json'), '{}')
const coreOptions = { coreExecutable: join(repository, 'target/debug/rovai-core'),
  dataDirectory: data, workingDirectory: repository, runtimeCacheDirectory: join(root, 'cache'),
  mcpConfigPath: join(root, 'mcp.json'), environmentOverrides: { HERMES_HOME: process.env.ROVAI_HERMES_SMOKE_HOME } }
let core = startQualificationCore(coreOptions)
console.log('Isolated fixture:', root)
let descendants = []
try {
  await core.request('health.check')
  const discoveryDeadline = Date.now() + 45000
  while (Date.now() < discoveryDeadline) {
    const status = await core.request('runtime.status.get')
    if (status.runtimeAvailability.some(row => row.runtimeKind === 'hermes-cli' && row.discovery.discoveryStatus !== 'detecting')) break
    await new Promise(done => setTimeout(done, 100))
  }
  console.log('Discovery complete')
  await core.request('runtime.product.check', { runtimeKind: 'hermes-cli' })
  let installation
  const until = Date.now() + 120000
  while (Date.now() < until) {
    installation = (await core.request('runtime.installations.list')).find(row => row.adapterKind === 'hermes-cli' && row.installationClass === 'managed_default')
    if (installation?.snapshot?.probeStatus === 'ready') break
    if (['probe_failed','missing_capabilities'].includes(installation?.snapshot?.probeStatus)) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  console.log('Hermes probe:', installation?.snapshot?.probeStatus, installation?.snapshot?.lastError)
  assert.equal(installation?.snapshot?.probeStatus, 'ready')
  const member = await core.request('members.get', { agentId: 'agent_2' })
  const selected = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: 'agent_2', expectedVersion: member.version, adapterKind: 'hermes-cli',
    model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions } })
  assert.equal(selected.status, 'applied')
  const sent = await createConfiguredCampAndSend(core.request, { commandId: crypto.randomUUID(), name: 'Hermes acceptance', purpose:'Hermes real Core acceptance',
    body: 'This is an isolated integration acceptance. First call terminal in the foreground with `echo ready > steer.ready; sleep 20` so the harness can deliver an active-turn correction. Then use terminal to run `rovai --help` and confirm the built-in CLI works. Use write_file to create hermes-proof.txt containing alpha followed by a newline. Read it, then use patch to change alpha to beta. Finally use `rovai send --public-only` to publish HERMES_CORE_ACCEPTED, the verification summary and your member name. Do not send to any other agent.',
    memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', workspace: { projectPath: project } })
  const thread = sent.payload.threadId ?? sent.payload.campId
  // Native redirect alone is insufficient: Core must first acknowledge its
  // initial input or the same UI action silently becomes a queued successor.
  let steerRunId
  const steerDb = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  try {
    const deadline = Date.now() + 60000
    let active, ready = false
    while (Date.now() < deadline) {
      active = steerDb.prepare('SELECT id,status,execution_epoch FROM agent_run WHERE camp_id=? ORDER BY created_at DESC LIMIT 1').get(thread)
      const held = await readFile(join(project, 'steer.ready'), 'utf8').then(() => true).catch(() => false)
      const accepted = active && steerDb.prepare("SELECT COUNT(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND input_kind='start' AND status='accepted'").get(active.id).n > 0
      if (held && active?.status === 'running' && accepted) { ready = true; break }
      assert(!active || !['succeeded', 'failed', 'cancelled'].includes(active.status), 'Run ended before active input was acknowledged')
      await new Promise(done => setTimeout(done, 100))
    }
    assert(ready, 'No active acknowledged input for Steer')
    steerRunId = active.id
    const correction = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: thread,
      content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_2'] },
        'Active-turn correction: keep all file and CLI verification tasks. Change only the final public marker to HERMES_CORE_STEER_ACCEPTED. Never publish the previous marker. Complete this within the current turn.'),
      sourceAttachments: [], quotes: [], replyToThreadMessageId: null, deliveryMode: 'steer',
      steerTargets: [{ agentRunId: active.id, executionEpoch: active.execution_epoch }],
      execution: { taskId: null, purpose: 'Hermes active-turn acceptance', completionRole: 'required' } })
    assert.equal((correction.commandResult ?? correction).status, 'accepted')
  } finally { steerDb.close() }
  let run
  const runUntil = Date.now() + 240000
  while (Date.now() < runUntil) {
    const snapshot = await core.request('camps.snapshot', { threadId: thread })
    for (const approval of snapshot.approvals.filter(row => row.status === 'pending')) {
      // Native command approval remains real. Reject discretionary scripts and
      // let the model finish with the explicitly requested file/CLI tools.
      const denied = await core.request('action.approvals.resolve', { commandId: crypto.randomUUID(),
        threadId: thread, approvalId: approval.id, expectedVersion: approval.version,
        optionId: 'deny', reason: 'Use only the requested acceptance commands; extra scripts are unnecessary.' })
      assert.notEqual((denied.commandResult ?? denied).status, 'rejected', JSON.stringify(denied))
    }
    run = snapshot.agentRuns.find(item => item.inputMessageIds?.includes(sent.payload.threadMessageId) || item.anchorMessageId === sent.payload.threadMessageId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  console.log('Run:', run?.id, run?.status)
  assert.equal(run?.status, 'succeeded')
  assert.equal(await readFile(join(project, 'hermes-proof.txt'), 'utf8'), 'beta\n')
  const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  try {
    assert.equal(run.id, steerRunId, 'Steer moved to a different Run')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?').get(thread).n, 1, 'Steer created a successor')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND input_kind='steer' AND status='accepted'").get(run.id).n, 1, 'Core did not acknowledge targeted Steer')
    const evidence = db.prepare('SELECT kind, result_preview_json FROM agent_run_execution_evidence WHERE agent_run_id = ?').all(run.id ?? run.agentRunId)
    assert(!evidence.some(row => row.result_preview_json?.includes('hermes_file_states')), 'Official display evidence was misclassified as full states')
    let context
    const contextDeadline = Date.now() + 5000
    while (Date.now() < contextDeadline) {
      context = db.prepare('SELECT context_used_tokens,context_window_tokens FROM runtime_session_context_latest WHERE source_agent_run_id = ?').get(run.id)
      if (context?.context_used_tokens > 0) break
      await new Promise(done => setTimeout(done, 100))
    }
    assert(context?.context_used_tokens > 0 && context.context_window_tokens > context.context_used_tokens, 'Native context gauge missing')
    assert(db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE author_type='agent' AND body LIKE '%HERMES_CORE_STEER_ACCEPTED%'").get().n > 0, 'Steered built-in CLI public Send missing')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE author_type='agent' AND body LIKE '%HERMES_CORE_ACCEPTED%'").get().n, 0, 'Superseded marker was published')
    await writeFile(join(root, 'summary.json'), JSON.stringify({ runtime: 'hermes-cli', version: installation.snapshot.reportedVersion,
      thread, run: run.id ?? run.agentRunId, evidenceCount: evidence.length, enhancedDiffAvailable: false, sameRunSteer: true }, null, 2))
  } finally { db.close() }
  // A second real Run cold-loads the same native Session with a fresh lease,
  // followed by cancellation while its actual native terminal is still running.
  const sentCancel = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: thread,
    content: composerDocumentForAddress({ mode:'explicit', agentIds:['agent_2'] },
      'Cancellation acceptance: call terminal exactly once, in the foreground, with command `echo $$ > cancel.pid; sleep 120`. The harness will cancel you. Do not call any other tool or send a message.'),
    sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose:'Hermes cancellation acceptance', completionRole:'required' } })
  const cancelledMessage = (sentCancel.commandResult ?? sentCancel).payload.threadMessageId
  let cancelRun, terminalPid
  const cancelDeadline = Date.now() + 90000
  while (Date.now() < cancelDeadline) {
    const snapshot = await core.request('camps.snapshot', { threadId:thread })
    cancelRun = snapshot.agentRuns.find(item => item.inputMessageIds?.includes(cancelledMessage) || item.anchorMessageId === cancelledMessage)
    terminalPid = await readFile(join(project, 'cancel.pid'), 'utf8').then(Number).catch(() => null)
    if (terminalPid && cancelRun) break
    await new Promise(done => setTimeout(done, 100))
  }
  assert(terminalPid && cancelRun, 'Native foreground terminal did not start')
  descendants = descendantsOf(await processTable(), core.pid)
  const cancelled = await core.request('agentRuns.cancel', { commandId:crypto.randomUUID(),
    command:{ threadId:thread, agentRunId:cancelRun.id, expectedVersion:cancelRun.version } })
  assert.notEqual(cancelled.status, 'rejected', JSON.stringify(cancelled))
  const settleDeadline = Date.now() + 30000
  while (Date.now() < settleDeadline) {
    cancelRun = (await core.request('camps.snapshot',{threadId:thread})).agentRuns.find(row=>row.id===cancelRun.id)
    if(cancelRun.status==='cancelled') break
    await new Promise(done=>setTimeout(done,100))
  }
  assert.equal(cancelRun.status,'cancelled')
  assert.deepEqual(await waitForProcessesToExit([terminalPid], 10000), [], 'Cancelled native terminal survived')
  console.log('Cold continuation cancellation passed:', cancelRun.id)
  const query = (sql, ...args) => {
    const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
    try { return db.prepare(sql).get(...args) } finally { db.close() }
  }
  const nativeId = query('SELECT native_session_id FROM conversation WHERE camp_id=? AND agent_id=?', thread, 'agent_2').native_session_id
  assert(nativeId)
  const send = async body => {
    const sent = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: thread,
      content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_2'] }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
      execution: { taskId: null, purpose: 'Hermes recovery acceptance', completionRole: 'required' } })
    const result = sent.commandResult ?? sent
    assert(['applied', 'accepted'].includes(result.status), JSON.stringify(result))
    return result
  }
  await send('Crash recovery acceptance: call terminal once in the foreground with command `echo $$ > crash.pid; sleep 120`. Do not send a message or call another tool. The harness will terminate its isolated Core.')
  let crashPid
  const crashDeadline = Date.now() + 90000
  while (Date.now() < crashDeadline && !crashPid) {
    crashPid = await readFile(join(project, 'crash.pid'), 'utf8').then(Number).catch(() => null)
    if (!crashPid) await new Promise(done => setTimeout(done, 100))
  }
  assert(crashPid, 'Crash worker did not start')
  const crashRun = query('SELECT id,status FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', thread)
  assert.equal(crashRun.status, 'running')
  const crashTree = await processTable()
  const crashDescendants = descendantsOf(crashTree, core.pid)
  descendants = [...new Set([...descendants, ...crashDescendants, crashPid])]
  if (forceUnknown) {
    // Remove the owner's chance to commit an interrupted receipt after Core
    // EOF. This explicitly tests lost native settlement, not a graceful stop.
    const gateway = crashTree.find(row => crashDescendants.includes(row.pid)
      && row.command.includes('gateway run --force --no-supervise --external-supervisor'))
    assert(gateway, 'Dedicated native Gateway not found in the owned tree')
    process.kill(gateway.pid,'SIGKILL')
  }
  process.kill(core.pid, 'SIGKILL')
  await core.stop(1000)
  core = startQualificationCore(coreOptions)
  await core.request('health.check')
  assert.deepEqual(await waitForProcessesToExit(descendants, 30000), [], 'Crash recovery left an owned Gateway or terminal alive')
  assert.equal(query('SELECT status FROM agent_run WHERE id=?', crashRun.id).status, 'failed')
  assert.equal(query('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?', thread).n, 3, 'Accepted crash input was replayed automatically')
  const inspection = await core.request('agentRuns.hermesRecovery.inspect', {agentRunId:crashRun.id})
  assert(['unknown','idle'].includes(inspection.state))
  if(forceUnknown)assert.equal(inspection.state,'unknown')
  assert.equal(inspection.scope.nativeSessionId,nativeId)
  if(inspection.state==='unknown'){
    assert(inspection.confirmation)
    const resolution = await core.request('agentRuns.hermesRecovery.resolve', {
      commandId:crypto.randomUUID(),confirmation:inspection.confirmation,acknowledgeEffects:true
    })
    assert.equal(resolution.status,'applied')
    assert.equal(resolution.payload.nativeReceipt.outcome,'interrupted')
  }
  assert.equal(query('SELECT status FROM agent_run WHERE id=?',crashRun.id).status,'failed')
  await send('The isolated Core has restarted. Do not repeat prior cancelled or interrupted commands. Read hermes-proof.txt, then use `rovai send --public-only` to publish HERMES_CORE_RESTART_ACCEPTED and the verified file contents. Send exactly once, without addressing another agent.')
  const restartDeadline = Date.now() + 180000
  let resumed
  while (Date.now() < restartDeadline) {
    resumed = query('SELECT id,status,last_error_code FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', thread)
    if (resumed.id !== crashRun.id && ['succeeded', 'failed', 'cancelled'].includes(resumed.status)) break
    await new Promise(done => setTimeout(done, 200))
  }
  assert.equal(resumed.status, 'succeeded', JSON.stringify(resumed))
  assert.equal(query('SELECT native_session_id FROM conversation WHERE camp_id=? AND agent_id=?', thread, 'agent_2').native_session_id, nativeId, 'Core restart replaced the native Session')
  assert.equal(query("SELECT COUNT(*) AS n FROM camp_message WHERE camp_id=? AND author_type='agent' AND body LIKE '%HERMES_CORE_RESTART_ACCEPTED%'", thread).n, 1)
  assert.equal(query("SELECT COUNT(*) AS n FROM camp_message WHERE camp_id=? AND author_type='agent' AND body LIKE '%HERMES_CORE_STEER_ACCEPTED%'", thread).n, 1)
  await writeFile(join(root, 'recovery-summary.json'), JSON.stringify({ nativeId, sameSession: true, forceUnknown,
    nativeStateAfterCrash:inspection.state,explicitNativeResolution:inspection.state==='unknown',originalRunStillFailed:true,
    acceptedCrashInputReplayed: false, duplicateSend: false, crashRun: crashRun.id, resumedRun: resumed.id, remainingPids: [] }, null, 2))
  console.log('Core crash, owned-tree recovery, exact Session and renewed CLI lease passed')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  const stopped = await core.stop()
  if (process.exitCode) console.error(stopped.stderrTail)
  assert.deepEqual(await waitForProcessesToExit(descendants, 10000), [], 'Hermes descendants survived Core cleanup')
}
