// Real DSH/Core concurrency, crash, shutdown and the production 30-minute idle
// eviction. The long idle check is opt-in; it never changes Fleet configuration.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { startQualificationCore, processTable, descendantsOf, waitForProcessIdentitiesToExit, waitForProcessesToExit } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-dsh-fleet-')))
const project = join(root, 'project'), data = join(root, 'data')
await mkdir(project)
await writeFile(join(project, 'README.md'), '# Isolated DSH Fleet acceptance\n')
execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio:'ignore' })
execFileSync('git', ['-c','user.name=Runtime acceptance','-c','user.email=runtime@rovai.local','commit','--allow-empty','-m','fixture'], { cwd:project, stdio:'ignore' })
let core, events = [], workspace
const evidence = { runtime:'deepseek-harness', version:'0.1.5-rc.2', checks:{} }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const delayedReadCommand = file => process.platform === 'win32'
  ? `Start-Sleep -Seconds 20; Get-Content ${file}`
  : `sleep 20; cat ${file}`
const delayedReadNeedle = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20'
async function start() {
  events = []
  core = startQualificationCore({ coreExecutable:join(repository,'target/debug/rovai-core'),
    dataDirectory:data, workingDirectory:repository, runtimeCacheDirectory:join(root,'cache'),
    mcpConfigPath:join(root,'mcp.json'), onNotification:message=>events.push(message) })
  await core.request('health.check')
  workspace = await core.request('workspaces.inspect', { path:project })
}
async function create(body) {
  const response=await createConfiguredCampAndSend(core.request, { commandId:crypto.randomUUID(),workspace,body,
    address:{mode:'explicit',agentIds:['agent_2']},purpose:'DSH Fleet acceptance' })
  const command=response.commandResult??response
  assert.equal(command.status,'accepted')
  return {threadId:command.payload.threadId,runId:command.payload.agentRunIds[0]}
}
async function send(threadId, body) {
  const draft=await core.request('camp.composerDraft.get',{threadId})
  const saved=await core.request('camp.composerDraft.save',{threadId,expectedRevision:draft.revision,
    content:{version:2,segments:[{kind:'text',text:body}]}})
  const response=await core.request('camp.messages.send',{commandId:crypto.randomUUID(),threadId,draftRevision:saved.revision,
    execution:{taskId:null,purpose:'DSH Fleet continuation',completionRole:'required'}})
  const command=response.commandResult??response
  assert.equal(command.status,'accepted')
  return {threadId,runId:command.payload.agentRunIds[0]}
}
function started(runId) {
  return events.find(event=>event.method==='agent_run.started' && event.params?.agentRunId===runId)
    ?? events.find(event=>event.params?.agentRunId===runId && event.params?.nativeThreadId && event.params?.hostInstanceId)
}
async function wait(item, predicate) {
  const deadline=Date.now()+240_000
  while(Date.now()<deadline) {
    const snapshot=await core.request('camps.snapshot',{threadId:item.threadId})
    const run=snapshot.agentRuns.find(run=>run.id===item.runId)
    if(run && ['failed','cancelled'].includes(run.status)) throw new Error(`DSH Fleet Run ${run.status}: ${JSON.stringify(run.failure)}`)
    if(predicate(snapshot,run)) return {snapshot,run,start:started(item.runId)}
    if(run?.status==='succeeded') throw new Error('DSH Fleet provider completed without the requested native Tool activity')
    await sleep(200)
  }
  throw new Error(`DSH Fleet timeout: ${item.runId}`)
}
const finished=item=>wait(item,(_snapshot,run)=>run?.status==='succeeded')
const runningTool=item=>wait(item,()=>events.some(event=>event.method==='runtime.action'
  && event.params?.agentRunId===item.runId && event.params?.payload?.status==='in_progress'
  && JSON.stringify(event.params.payload.input).includes(delayedReadNeedle)))
async function owned() { return descendantsOf(await processTable(),core.pid) }
async function ownedRows() {
  const table=await processTable(), pids=new Set(descendantsOf(table,core.pid))
  return table.filter(process=>pids.has(process.pid))
}
async function stopAndCheck(label, crash=false) {
  const pids=await owned(), pid=core.pid
  assert(pids.length>0, `${label}: no resident Runtime observed`)
  if(crash) process.kill(pid,'SIGKILL')
  await core.stop(); core=null
  const remaining=await waitForProcessesToExit([pid,...pids],30_000)
  assert.deepEqual(remaining,[], `${label}: process tree survived`)
  evidence.checks[label]={passed:true,descendantsReaped:pids.length}
}
try {
  await writeFile(join(root,'mcp.json'),'{}')
  await start()
  await configureProductRuntime(core.request,'deepseek-harness',['agent_2'])
  const tokenA=`FLEET_A_${crypto.randomUUID()}`, tokenB=`FLEET_B_${crypto.randomUUID()}`
  await writeFile(join(project,'marker-a.txt'),tokenA)
  await writeFile(join(project,'marker-b.txt'),tokenB)
  const first=await create(`You do not know the marker. Use the terminal tool exactly once to execute \`${delayedReadCommand('marker-a.txt')}\`. You must actually read the tool result and remember its exact marker for the next turn. Then reply DONE. Do not simulate the tool or call another tool.`)
  await runningTool(first)
  const second=await create(`You do not know the marker. Use the terminal tool exactly once to execute \`${delayedReadCommand('marker-b.txt')}\`. You must actually read the tool result and remember its exact marker for the next turn. Then reply DONE. Do not simulate the tool or call another tool.`)
  await runningTool(second)
  const firstWhileSecond=await core.request('camps.snapshot',{threadId:first.threadId})
  assert.equal(firstWhileSecond.agentRuns.find(run=>run.id===first.runId)?.status,'running','concurrency did not overlap')
  const [a,b]=await Promise.all([finished(first),finished(second)])
  assert(a.start?.params.hostInstanceId && b.start?.params.hostInstanceId)
  assert.notEqual(a.start.params.hostInstanceId,b.start.params.hostInstanceId)
  assert.notEqual(a.start.params.nativeThreadId,b.start.params.nativeThreadId)
  await rm(join(project,'marker-a.txt')); await rm(join(project,'marker-b.txt'))
  const back=await send(first.threadId,'Return exactly the marker produced by your previous Bash call. Do not call tools or include any other marker.')
  const backResult=await finished(back)
  assert.equal(backResult.start.params.nativeThreadId,a.start.params.nativeThreadId)
  const backText=JSON.stringify(backResult.snapshot.messages.filter(message=>message.sourceAgentRunId===back.runId))
  // Public Camp message shape varies by projection; the authoritative runtime
  // public text also carries the same exact marker.
  const backEvents=JSON.stringify(events.filter(event=>event.params?.agentRunId===back.runId))
  assert(backText.includes(tokenA)||backEvents.includes(tokenA))
  assert(!backText.includes(tokenB))
  evidence.checks.concurrency={passed:true,distinctHosts:true,distinctSessions:true,exactSwitchBack:true}
  console.error('[dsh-fleet] concurrency and exact switch-back passed')
  await stopAndCheck('coreCrash',true)
  await start()
  const restored=await send(first.threadId,'Return exactly the marker produced by your previous Bash call. Do not call tools.')
  const restoredResult=await finished(restored)
  assert.equal(restoredResult.start.params.nativeThreadId,a.start.params.nativeThreadId)
  assert.notEqual(restoredResult.start.params.hostInstanceId,a.start.params.hostInstanceId)
  evidence.checks.crashRecovery={passed:true,exactSession:true}
  console.error('[dsh-fleet] crash process cleanup and exact recovery passed')
  if(process.env.ROVAI_DSH_FLEET_IDLE_CHECK==='1') {
    const beforeIdle=await ownedRows(), since=Date.now()
    assert(beforeIdle.length>0)
    console.error('[dsh-fleet] observing production 30-minute idle eviction')
    const remaining=await waitForProcessIdentitiesToExit(beforeIdle,32*60_000)
    assert.deepEqual(remaining,[],'idle eviction left a Runtime process')
    evidence.checks.idleEviction={passed:true,elapsedMs:Date.now()-since,descendantsReaped:beforeIdle.length}
    const afterIdle=await finished(await send(first.threadId,'Reply exactly AFTER_IDLE. Do not call tools.'))
    assert.equal(afterIdle.start.params.nativeThreadId,a.start.params.nativeThreadId)
    assert.notEqual(afterIdle.start.params.hostInstanceId,restoredResult.start.params.hostInstanceId)
    evidence.checks.idleEviction.exactResume=true
    console.error('[dsh-fleet] idle eviction and exact resume passed')
  }
  await stopAndCheck('plannedShutdown')
} finally {
  if(core)await core.stop()
  await removeEphemeralRuntimeCampFilesRoot(data)
  await writeFile(join(root,'summary.json'),JSON.stringify(evidence,null,2),{mode:0o600})
  console.log(JSON.stringify({...evidence,fixtureRoot:root},null,2))
}
