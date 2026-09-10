import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { startQualificationCore, processTable, descendantsOf, waitForProcessesToExit } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

// Explicit real-model acceptance only. Caller supplies an isolated HOME with
// official .zcode BYOK config; ordinary product checks never invoke this script.
const repo = resolve(import.meta.dirname, '..')
const root = await mkdtemp(join(tmpdir(), 'rovai-zcode-background-smoke-'))
const data = join(root, 'data')
const project = join(root, 'project')
const trace = join(root, 'native-methods.jsonl')
const hook = join(root, 'trace.cjs')
const events = []
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
let core, campId, passed = false
let report = {}
await mkdir(project)
await writeFile(join(project, 'README.md'), '# Isolated background acceptance\n')
for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@rovai.local', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: project, stdio: 'ignore' })
// Observe method names and selected non-secret control fields only. Intercept
// emit instead of consuming stdin early; the official parser owns stream flow.
await writeFile(hook, `if(process.argv.some(a=>a.endsWith('/zcode.cjs'))&&process.argv.includes('app-server')){
const fs=require('node:fs');const file=${JSON.stringify(trace)};
const record=v=>fs.appendFileSync(file,JSON.stringify(v)+'\\n',{mode:0o600});
record({pid:process.pid,cwd:process.cwd(),env:Object.fromEntries(['HOME','USERPROFILE','ZCODE_STORAGE_DIR','ZCODE_SESSION_DB','ZCODE_SESSION_DB_PATH','TMPDIR'].map(k=>[k,process.env[k]??null]))});
const emit=process.stdin.emit;let pending='';process.stdin.emit=function(name,...args){if(name==='data'){
pending+=args[0].toString();let n;while((n=pending.indexOf('\\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);try{const v=JSON.parse(line);if(v.method)record({pid:process.pid,method:v.method,command:v.method==='v4/command'?v.params?.type:undefined,persistence:v.params?.persistence,title:v.params?.titleGenerationEnabled});}catch{}}}return Reflect.apply(emit,this,[name,...args])};
const write=process.stdout.write;let out='';process.stdout.write=function(chunk,...args){out+=chunk.toString();let n;while((n=out.indexOf('\\n'))>=0){const line=out.slice(0,n);out=out.slice(n+1);try{const v=JSON.parse(line);const e=v.method==='session/event'?v.params:null;if(e)record({pid:process.pid,event:e.type,seq:e.seq,turn:e.turnId,inputSource:e.payload?.inputSource,kind:e.payload?.kind,status:e.payload?.status,resultType:e.payload?.resultType,tool:e.payload?.toolCallId});if(v.error)record({pid:process.pid,errorCode:v.error.code});}catch{}}return Reflect.apply(write,this,[chunk,...args])};}
`)
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${hook}`.trim()
console.log(JSON.stringify({ stage: 'fixture', dataDirectory: data, skillLibrary: join(data, 'managed-skill-library'), nativeHome: process.env.HOME }))
try {
  core = startQualificationCore({ coreExecutable: join(repo, 'target/debug/rovai-core'), dataDirectory: data, workingDirectory: repo,
    runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(data, 'mcp.json'), onNotification: (event) => events.push(event) })
  const workspace = await core.request('workspaces.inspect', { path: project })
  const installation = await configureProductRuntime(core.request, 'zcode-app', ['agent_2', 'agent_3'])
  const probe = await traces()
  const probes = probe.filter((v) => v.env)
  assert(probes.length > 0)
  for (const entry of probes) {
    for (const key of ['HOME', 'USERPROFILE', 'ZCODE_STORAGE_DIR', 'ZCODE_SESSION_DB', 'ZCODE_SESSION_DB_PATH']) assert.equal(entry.env[key], process.env[key] ?? null)
    assert.notEqual(entry.env.TMPDIR, process.env.HOME)
    assert(/^(\/private)?\/tmp\/rvzp-/.test(entry.cwd))
  }
  const allowed = new Set(['workspace/readState', 'session/create', 'session/subscribe', 'session/setMode'])
  assert(probe.filter((v) => v.method).every((v) => allowed.has(v.method)), 'Ordinary Probe must only initialize without generation')
  assert(probe.filter((v) => v.method === 'session/create').every((v) => v.persistence === 'deferred' && v.title === false))
  for (const entry of probes) assert.equal(await access(entry.cwd).then(() => true, () => false), false, 'Probe cwd/socket must be removed')
  report.probe = { nativeEnvironmentPreserved: true, calls: [...new Set(probe.map((v) => v.method).filter(Boolean))], temporaryResourcesRemoved: true, adapterSupport: installation.snapshot?.capabilities }
  console.log(JSON.stringify({ stage: 'probe-passed', calls: report.probe.calls }))
  const stop = join(project, 'release-background')
  const pidFile = join(project, 'background.pid')
  const cliTrigger = join(project, 'request-old-cli')
  const cliInitial = join(project, 'cli-initial')
  const cliLate = join(project, 'cli-late')
  const command = `echo $$ > '${pidFile}'; "$ROVAI_AGENT_CLI" camp list > '${cliInitial}.json'; echo $? > '${cliInitial}.status'; while [ ! -f '${stop}' ]; do if [ -f '${cliTrigger}' ] && [ ! -f '${cliLate}.status' ]; then "$ROVAI_AGENT_CLI" camp list > '${cliLate}.json'; echo $? > '${cliLate}.status'; fi; sleep 0.2; done; printf BACKGROUND_EXIT; exit 7`
  const begin = Date.now()
  const sent = await createConfiguredCampAndSend(core.request, { commandId: crypto.randomUUID(), workspace,
    body: `This is an explicit isolated lifecycle test. Call Bash once with run_in_background=true and command exactly: ${command}\nAfter it reports backgrounded, send the final answer BACKGROUND_READY immediately. Do not wait, poll, stop or read the task.`,
    address: { mode: 'explicit', agentIds: ['agent_2'] }, purpose: 'Verify foreground completion while native background service remains managed.' })
  const accepted = sent.commandResult ?? sent
  assert.equal(accepted.status, 'accepted')
  campId = accepted.payload.campId
  const original = accepted.payload.agentRunIds[0]
  await finish(original)
  const foregroundFinishedAt = Date.now()
  const foregroundMs = foregroundFinishedAt - begin
  assert(foregroundMs < 120000)
  const background = events.find((e) => e.method === 'runtime.action' && e.params.agentRunId === original && e.params.payload?.zcodeBackground?.status === 'running')
  assert(background, 'Official structured background task was not observed')
  assert.equal(background.params.payload.status, 'in_progress')
  const pid = Number(await readFile(pidFile, 'utf8')); process.kill(pid, 0)
  console.log(JSON.stringify({ stage: 'foreground-finished', agentRunId: original, foregroundMs, taskId: background.params.payload.zcodeBackground.taskId }))
  const other = await follow('agent_3', 'No tools. Send the final answer OTHER_MEMBER.')
  await finish(other)
  assert.notEqual(start(other).hostInstanceId, start(original).hostInstanceId)
  assert.equal(Number(await readFile(`${cliInitial}.status`, 'utf8')), 0, 'Original active Run must allow its CLI call')
  const cliNext = join(project, 'cli-next')
  const next = await follow('agent_2', `Do not inspect or wait for background tasks. Call Bash in foreground with command: "$ROVAI_AGENT_CLI" camp list > '${cliNext}.json'; echo $? > '${cliNext}.status'; sleep 5. Then send the final answer SAME_SESSION.`)
  await until(async () => { await approve(next); return Boolean(start(next)) }, 90000)
  await writeFile(cliTrigger, 'audit\n')
  await until(() => readFile(`${cliLate}.status`, 'utf8').then(() => true, () => false), 10000)
  assert.notEqual(Number(await readFile(`${cliLate}.status`, 'utf8')), 0, 'Old background child must not acquire the successor Run CLI lease')
  assert.equal(JSON.parse(await readFile(`${cliLate}.json`, 'utf8')).error?.code, 'builtin_tool.cli_error')
  await finish(next)
  assert.equal(Number(await readFile(`${cliNext}.status`, 'utf8')), 0, 'Successor Run must retain its own active CLI lease')
  assert.equal(start(next).hostInstanceId, start(original).hostInstanceId)
  assert.equal(start(next).nativeThreadId, start(original).nativeThreadId)
  process.kill(pid, 0)
  const currentPidFile = join(project, 'cancel-task.pid')
  const cancelled = await follow('agent_2', `Leave existing background tasks alone. First call Bash with run_in_background=true, command: echo $$ > '${currentPidFile}'; sleep 600. Then call Bash in the foreground: sleep 30; printf CANCEL_MUST_NOT_APPEAR. Wait for that foreground command.`)
  await until(async () => {
    await approve(cancelled)
    return events.some((e) => e.method === 'runtime.action' && e.params.agentRunId === cancelled && e.params.payload?.status === 'in_progress' && String(e.params.payload?.input).includes('sleep 30'))
      && events.some((e) => e.params?.agentRunId === cancelled && e.params?.payload?.zcodeBackground?.status === 'running')
      && await readFile(currentPidFile, 'utf8').then((value) => Number(value) > 1, () => false)
  }, 90000)
  assert.equal(start(cancelled).hostInstanceId, start(original).hostInstanceId, 'Active native Session must remain on its background Host')
  const currentPid = Number(await readFile(currentPidFile, 'utf8')); process.kill(currentPid, 0)
  const snapshot = await core.request('camps.snapshot', { campId })
  const run = snapshot.agentRuns.find((r) => r.id === cancelled)
  const turn = snapshot.turns.find((t) => t.id === run.campTurnId)
  const cancellation = await core.request('campTurns.cancel', { commandId: crypto.randomUUID(), command: { campId, campTurnId: turn.id, expectedVersion: turn.version } })
  assert.notEqual(cancellation.status, 'rejected')
  await until(() => events.some((e) => e.method === 'agent_run.runtime_cleanup_completed' && e.params.agentRunId === cancelled), 30000)
  process.kill(pid, 0)
  await until(() => { try { process.kill(currentPid, 0); return false } catch (error) { return error.code === 'ESRCH' } }, 10000)
  console.log(JSON.stringify({ stage: 'cancel-scope-passed', agentRunId: cancelled }))
  // Default exceeds the old 300-second gate; reduced duration is an explicitly
  // partial development pass, and is recorded as such in evidence.
  const retentionMs = Number(process.env.ROVAI_ZCODE_BACKGROUND_RETENTION_MS ?? 310000)
  // Start the retention clock after the answer, where the old 300-second
  // settlement gate began. Model latency must not count toward this proof.
  await until(() => Date.now() - foregroundFinishedAt >= retentionMs, retentionMs + 1000)
  process.kill(pid, 0)
  await writeFile(stop, 'release\n')
  await until(() => events.some((e) => e.method === 'runtime.action' && e.params.agentRunId === original && e.params.payload?.zcodeBackground?.status === 'failed'), 30000)
  const ended = events.findLast((e) => e.params?.payload?.zcodeBackground?.taskId === background.params.payload.zcodeBackground.taskId)
  assert.equal(ended.params.agentRunId, original)
  assert.equal(ended.params.payload.status, 'failed')
  const persisted = query(`select agent_run_id, json_extract(payload_preview_json,'$.zcodeBackground.status') as status from agent_run_execution_evidence where json_extract(payload_preview_json,'$.zcodeBackground.taskId')='${background.params.payload.zcodeBackground.taskId}'`)
  assert(persisted.some((r) => r.agent_run_id === original && r.status === 'failed'))
  assert(persisted.every((r) => r.agent_run_id === original))
  const closing = await follow('agent_2', 'Call Bash once with run_in_background=true and command sleep 600. Send final answer CLOSE_READY immediately after backgrounding; do not wait.')
  await finish(closing)
  assert(events.some((e) => e.params?.agentRunId === closing && e.params?.payload?.zcodeBackground?.status === 'running'))
  const owned = descendantsOf(await processTable(), core.pid)
  const stopped = await core.stop(); core = null
  assert.deepEqual(await waitForProcessesToExit(owned, 10000), [])
  assert(!stopped.stderrTail.includes('cleanup remains unconfirmed'))
  const closedEvidence = query(`select json_extract(payload_preview_json,'$.zcodeBackground.status') as status from agent_run_execution_evidence where agent_run_id='${closing}'`)
  assert(closedEvidence.some((r) => r.status === 'host_closed'), 'Host closure must update the original background task')
  const nativeTrace = await traces()
  const notificationTurns = nativeTrace.filter((v) => v.event === 'turn.started' && v.inputSource === 'background_task').map((v) => v.turn)
  assert(notificationTurns.length > 0)
  assert(notificationTurns.every((turn) => nativeTrace.some((v) => v.turn === turn && v.event === 'turn.completed' && v.resultType === 'cancelled')), 'Exact notification stop must reach a native cancelled terminal')
  assert(!nativeTrace.some((v) => notificationTurns.includes(v.turn) && v.event === 'model.tool_call'), 'Unowned notification Turns must not run new tools')
  const formal = nativeTrace.filter((v) => v.env && !/^(\/private)?\/tmp\/rvzp-/.test(v.cwd))
  assert(formal.length > 0)
  assert(formal.every((v) => v.env.HOME === process.env.HOME && v.env.ZCODE_STORAGE_DIR === process.env.ZCODE_STORAGE_DIR))
  report = { ...report, ok: true, foregroundMs, retentionMs, retentionStartsAt: 'foreground-completed', old300SecondBoundaryCovered: retentionMs > 300000,
    originalRunId: original, taskId: background.params.payload.zcodeBackground.taskId, sameSessionRetained: true,
    crossMemberHostSeparated: true, oldBackgroundCliLeaseRejectedDuringNextRun: true, cancelPreservedOlderTask: true, cancelStoppedCurrentTask: true, hostClosurePersisted: true, nativeNotificationTurnsStopped: notificationTurns.length, lateFailurePersistedOnOriginalRun: true, closeReapedManagedDescendants: true }
  passed = true
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (core) { const stopped = await core.stop(); if (!passed) process.stderr.write(stopped.stderrTail) }
  if (passed) { await removeEphemeralRuntimeCampFilesRoot(data); await rm(root, { recursive: true, force: true }) }
  else {
    console.error(`ZCode background fixture retained: ${root}`)
    console.error(JSON.stringify(events.filter((e) => e.method === 'error' || e.method === 'agent_run.terminal_deferred' || (e.method === 'runtime.host.log' && String(e.params?.text).includes('ZCode'))).map((e) => ({ method: e.method, params: e.params }))))
  }
}
async function traces() { return (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse) }
function query(sql) { return JSON.parse(execFileSync('sqlite3', ['-json', join(data, 'rovai.sqlite'), sql], { encoding: 'utf8' }) || '[]') }
function start(id) { return events.find((e) => e.method === 'agent_run.started' && e.params?.agentRunId === id)?.params }
async function until(check, timeout) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await wait(250) } throw new Error('ZCode background acceptance timed out') }
async function follow(agentId, body) {
  const draft = await core.request('camp.composerDraft.get', { campId })
  const saved = await core.request('camp.composerDraft.save', { campId, expectedRevision: draft.revision, content: composerDocumentForAddress({ mode: 'explicit', agentIds: [agentId] }, body) })
  const result = await core.request('camp.messages.send', { commandId: crypto.randomUUID(), campId, draftRevision: saved.revision,
    execution: { taskId: null, purpose: 'Verify native task ownership across Runs.', completionRole: 'required' } })
  const command = result.commandResult ?? result; assert.equal(command.status, 'accepted'); return command.payload.agentRunIds[0]
}
async function approve(id) {
  const snapshot = await core.request('camps.snapshot', { campId })
  for (const approval of snapshot.approvals.filter((a) => a.status === 'pending' && snapshot.actions.some((v) => v.id === a.actionId && v.agentRunId === id))) {
    const option = approval.options.find((v) => v.kind === 'allow_once'); assert(option)
    const result = await core.request('action.approvals.resolve', { commandId: crypto.randomUUID(), campId, approvalId: approval.id, expectedVersion: approval.version, optionId: option.optionId, reason: 'Isolated native background lifecycle acceptance' })
    assert.notEqual(result.status, 'rejected')
  }
  return snapshot
}
async function finish(id) {
  await until(async () => {
    const snapshot = await approve(id)
    const run = snapshot.agentRuns.find((v) => v.id === id)
    if (!run || !['succeeded', 'failed', 'cancelled'].includes(run.status)) return false
    assert.equal(run.status, 'succeeded', JSON.stringify(run.failure))
    // The Run terminal precedes CampTurn settlement. A follow-up sent between
    // them is legitimately queued and has no agentRunIds in its acceptance.
    return snapshot.turns.find((turn) => turn.id === run.campTurnId)?.status === 'completed'
  }, 120000)
}
