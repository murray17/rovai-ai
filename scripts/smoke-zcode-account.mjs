import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

// Explicit acceptance only. The caller supplies an isolated native HOME/storage
// and authorized official credentials. Default mode requires actual generation;
// --expect-auth-failure is separately reported rejection evidence, never success.
const expectAuthFailure = process.argv.includes('--expect-auth-failure')
assert(process.argv.slice(2).every(arg => arg === '--expect-auth-failure'))
const repo = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rvza-smoke-')))
const data = join(root, 'data'), project = join(root, 'project')
const trace = join(root, 'methods.jsonl'), hook = join(root, 'trace.cjs')
await mkdir(project)
await writeFile(trace, '', { mode: 0o600 })
// Observe only method names/booleans. No Prompt, config, headers or native errors.
await writeFile(hook, `if(process.argv.some(a=>a.endsWith('/zcode.cjs'))&&process.argv.includes('app-server')){
const fs=require('node:fs'),pending=new Set();const save=v=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(v)+'\\n');
const emit=process.stdin.emit;let input='';process.stdin.emit=function(name,...args){if(name==='data'){input+=args[0].toString();let n;while((n=input.indexOf('\\n'))>=0){const line=input.slice(0,n);input=input.slice(n+1);try{const v=JSON.parse(line);if(v.method)save({method:v.method,command:v.params?.type});if(pending.delete(v.id))save({headersApplied:v.result?.headersApplied===true});}catch{}}}return Reflect.apply(emit,this,[name,...args])};
const write=process.stdout.write;let output='';process.stdout.write=function(chunk,...args){output+=chunk.toString();let n;while((n=output.indexOf('\\n'))>=0){const line=output.slice(0,n);output=output.slice(n+1);try{const v=JSON.parse(line);if(v.method==='interaction/requestProviderRuntimeHeaders'){pending.add(v.id);save({headerRequestReason:v.params?.reason});}}catch{}}return Reflect.apply(write,this,[chunk,...args])};}`, { mode: 0o600 })
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${hook}`.trim()
let core, passed = false
const methods = async () => (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
try {
  core = startQualificationCore({ coreExecutable: join(repo, 'target/debug/rovai-core'),
    dataDirectory: data, workingDirectory: project, runtimeCacheDirectory: join(root, 'cache'),
    mcpConfigPath: join(data, 'mcp.json') })
  const workspace = await core.request('workspaces.inspect', { path: project })
  const installation = await configureProductRuntime(core.request, 'zcode-app', ['agent_2'])
  const probe = await methods()
  assert(probe.length > 0)
  assert(probe.every(v => ['workspace/updateProviderRegistry', 'workspace/readState', 'session/create',
    'session/subscribe', 'session/setMode'].includes(v.method)), 'Ordinary Probe must not generate')
  console.log(JSON.stringify({ stage: 'basic-connection-passed', models: installation.snapshot.models.map(m => m.id), noProbePrompt: true }))
  const nonce = `ACCOUNT_${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const sent = await createConfiguredCampAndSend(core.request, { commandId: randomUUID(), workspace,
    body: `Reply with exactly ${nonce}. Do not call tools.`, address: { mode: 'explicit', agentIds: ['agent_2'] },
    purpose: 'Verify official account execution in an isolated acceptance Camp.' })
  const accepted = sent.commandResult ?? sent
  const campId = sent.campId ?? accepted.payload?.campId, runId = accepted.payload?.agentRunIds?.[0]
  assert(campId && runId)
  const deadline = Date.now() + 120_000
  let snapshot, run
  while (Date.now() < deadline) {
    snapshot = await core.request('camps.snapshot', { campId })
    run = snapshot.agentRuns.find(r => r.id === runId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      if (run.status !== 'succeeded' || snapshot.turns.find(t => t.id === run.campTurnId)?.status === 'completed') break
    }
    assert(!run || run.status !== 'waiting', `Account execution entered recovery: ${run?.waitReason}`)
    await new Promise(done => setTimeout(done, 250))
  }
  console.log(JSON.stringify({ stage: 'execution', status: run?.status, failureCode: run?.failure?.code,
    failurePhase: run?.failure?.phase, retryable: run?.failure?.retryable }))
  if (expectAuthFailure) {
    assert.equal(run?.status, 'failed')
    assert.equal(run.failure?.code, 'runtime_authentication_required')
    assert.equal(run.failure?.retryable, false)
    assert(!snapshot.messages.some(m => m.sourceAgentRunId === runId), 'Auth rejection must not publish Final')
    assert((await methods()).some(v => v.headersApplied === false))
  } else {
    assert.equal(run?.status, 'succeeded', 'Account must generate, not merely initialize')
    assert(snapshot.messages.find(m => m.sourceAgentRunId === runId)?.body.includes(nonce))
  }
  passed = true
  console.log(JSON.stringify({ stage: 'passed', evidence: expectAuthFailure ? 'account-rejection' : 'account-generation',
    actualAccountGeneration: !expectAuthFailure, noProbePrompt: true }))
} finally {
  if (core) {
    const stopped = await core.stop()
    console.log(JSON.stringify({ coreExitCode: stopped.code }))
    assert.equal(stopped.code, 0)
  }
  await removeEphemeralRuntimeCampFilesRoot(data)
  await rm(root, { recursive: true, force: true })
  if (!passed) console.log(JSON.stringify({ actualAccountGeneration: false }))
}
