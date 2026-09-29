import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, lstat, chmod, readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pause } from './lib/host-web-browser.mjs'

// Native package/upgrade boundary, not a second business HTTP test. Only local
// records are created; no model, daily App or installed service is started.
const args = process.argv.slice(2)
if (process.platform !== 'darwin' || args.length !== 2) throw Error('Usage on macOS: node scripts/smoke-server-package.mjs <package> <baseline-package>')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-package-')))
const product = join(fixture, 'product'), baseline = join(fixture, 'baseline')
await cp(resolve(args[0]), product, { recursive: true }); await cp(resolve(args[1]), baseline, { recursive: true })
async function verify(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.target, `macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}`)
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.ok(!name.split('/').some(part=>part==='..' || !part) && !name.startsWith('/'))
    const path = join(directory, name)
    assert.equal((await lstat(path)).isFile(), true)
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), expected, name)
  }
  return { commit: manifest.commit, dirty: manifest.dirty, profile: manifest.profile, target: manifest.target, manifestSha256: createHash('sha256').update(await readFile(join(directory, 'manifest.json'))).digest('hex') }
}
const current = await verify(product), previous = await verify(baseline)
const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
const binary = directory => join(directory, 'rovai-host')
const prepared = JSON.parse(execFileSync(binary(product), ['prepare', '--data-dir', join(fixture, 'data')], { cwd: product, env, encoding: 'utf8' }))
console.log(JSON.stringify({ channel: 'automatic_acceptance', fixture, ...prepared, product, baseline, runtime: false, hostPathExcludesNode: true }))
assert.match(execFileSync(binary(product), ['--version'], { env, encoding: 'utf8' }), /rovai-host/)
execFileSync(join(product, 'rovai'), ['--help'], { env, encoding: 'utf8' })
const workspace = join(fixture, 'workspace'); await mkdir(workspace)
const report = { current, previous, fixture, realRuntime: false, checks: {} }
let active
try {
  active = launchPipe(baseline)
  const profiles = await active.request('members.list')
  const created = await active.request('camps.create', { commandId: randomUUID(), name: 'Package upgrade fixture', workspace: { projectPath: workspace, name: 'workspace' }, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' })
  assert.equal(created.status, 'applied')
  const campId = created.payload.campId
  const sent = await active.request('camp.messages.send', { commandId: randomUUID(), campId, content: { version: 2, segments: [{ kind: 'text', text: 'PRESERVED_PACKAGE_MESSAGE' }] }, replyToCampMessageId: null, execution: null })
  assert.equal(sent.commandResult.status, 'applied')
  const before = await active.request('camps.snapshot', { campId })
  assert.ok(before.messages.some(message=>message.body==='PRESERVED_PACKAGE_MESSAGE'))
  await active.stop(); active = null
  await cp(prepared.dataDir, join(fixture, 'backup-data'), { recursive: true })
  const hasRuntimeFiles = await lstat(prepared.runtimeCampFilesRoot).then(()=>true, ()=>false)
  if (hasRuntimeFiles) await copyStoppedFixtureTree(prepared.runtimeCampFilesRoot, join(fixture, 'backup-runtime-files'))
  const beforeDatabase = createHash('sha256').update(await readFile(join(prepared.dataDir, 'rovai.sqlite'))).digest('hex')
  console.log(JSON.stringify({ stage: 'closed-baseline-backed-up', campId }))

  const administrator = randomBytes(32).toString('hex')
  active = launchHeadless(administrator)
  const origin = await active.origin()
  const login = await fetch(`${origin}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: administrator }), redirect: 'error' })
  assert.equal(login.status, 200)
  const token = (await login.json()).token
  const opened = await fetch(`${origin}/api/v1/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ operation: 'camps.open', params: { campId, traceId: randomUUID() } }), redirect: 'error' }).then(response=>response.json())
  assert.equal(opened.error, null)
  assert.equal(opened.result.messages.filter(message=>message.body==='PRESERVED_PACKAGE_MESSAGE').length, 1)
  assert.equal((await fetch(origin, { redirect: 'error' })).status, 200)
  await active.stop(); active = null
  report.checks = { manifestHashes: true, relocatedPackage: true, hostRunsWithoutNodeOnPath: true, bundledCliStarts: true, baselineDataUpgraded: true, authorizedWebReadsPreservedMessageOnce: true, headlessSignalSettled: true }

  // Roll back only by restoring the complete stopped baseline, never by opening
  // an upgraded database with an old executable or trying to reverse migrations.
  // Keep both admitted root directories in place: their native identities are
  // part of the Runtime root marker. Replacing the directory invalidates it.
  await cp(prepared.dataDir, join(fixture, 'upgraded-data'), { recursive: true })
  await cp(join(fixture, 'backup-data'), prepared.dataDir, { recursive: true })
  if (hasRuntimeFiles) {
    await copyStoppedFixtureTree(prepared.runtimeCampFilesRoot, join(fixture, 'upgraded-runtime-files'))
    await copyStoppedFixtureTree(join(fixture, 'backup-runtime-files'), prepared.runtimeCampFilesRoot)
  }
  assert.equal(createHash('sha256').update(await readFile(join(prepared.dataDir, 'rovai.sqlite'))).digest('hex'), beforeDatabase)
  active = launchPipe(baseline)
  const restored = await active.request('camps.snapshot', { campId })
  assert.equal(restored.messages.filter(message=>message.body==='PRESERVED_PACKAGE_MESSAGE').length, 1)
  await active.stop(); active = null
  report.checks.stoppedBackupRollback = true
  report.status = 'passed'
  console.log(JSON.stringify({ stage: 'passed', ...report }))
} catch (error) { report.status = 'failed'; report.error = error.message; throw error }
finally {
  if (active) await active.stop().catch(()=>undefined)
  await writeFile(join(fixture, 'package-acceptance.json'), JSON.stringify(report, null, 2)+'\n', { mode: 0o600 })
  console.log(JSON.stringify({ stage: 'fixture-retained', fixture }))
}

function processHost(directory, extra) {
  const child = spawn(binary(directory), extra, { cwd: directory, env, stdio: ['pipe','pipe','pipe'] })
  let stderr = '', stdout = ''
  child.stderr.on('data', value=>{ stderr=(stderr+value).slice(-8192) })
  child.stdout.on('data', value=>{ stdout=(stdout+value).slice(-8192) })
  const closed = new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))
  async function stop(signal) {
    if (child.exitCode===null && child.signalCode===null) { if(signal) child.kill(signal); else child.stdin.end() }
    const timer=setTimeout(()=>child.kill('SIGKILL'),15000)
    try { assert.deepEqual(await closed,{code:0,signal:null},'Host must settle before exit') } finally { clearTimeout(timer) }
  }
  return { child, stop, closed, output:()=>stdout+'\n'+stderr }
}
function launchPipe(directory) {
  const host=processHost(directory, prepared.runArguments)
  const pending=new Map();let next=0
  createInterface({input:host.child.stdout}).on('line',line=>{
    const message=JSON.parse(line), request=pending.get(message.id)
    if(!request) return
    pending.delete(message.id);clearTimeout(request.timer)
    message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result)
  })
  host.closed.then(()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Host exited before response: '+host.output().slice(-4000)))}pending.clear()})
  return { ...host, request:(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Host request timed out: ${method}`))},30000)
    pending.set(id,{resolve,reject,timer});host.child.stdin.write(JSON.stringify({id,method,params})+'\n')
  }) }
}
function launchHeadless(administrator) {
  const host=processHost(product,['run',...prepared.runArguments,'--web-listen','127.0.0.1:0','--web-ui',join(product,'web-ui'),'--web-token-stdin'])
  host.child.stdin.end(administrator+'\n')
  return { ...host, stop:()=>host.stop('SIGTERM'), origin:async()=>{
    for(let attempt=0;attempt<300;attempt++) {
      if(host.child.exitCode!==null) throw Error('Upgraded Host refused startup: '+host.output().replaceAll(administrator,'[administrator]'))
      if(host.output().includes('Host Core is ready')) {const origin=host.output().match(/origin="(http:\/\/127\.0\.0\.1:\d+)"/)?.[1];if(origin)return origin}
      await pause(100)
    }
    throw Error('Upgraded Host readiness timeout')
  } }
}

async function copyStoppedFixtureTree(source, destination) {
  // Legacy Runtime views deliberately use execute-only directories. This smoke
  // owns these exact stopped, model-free fixture trees. Temporarily add owner
  // directory read permission for copying, then restore source and backup modes.
  const directories = []
  async function visit(relative = '') {
    const path = join(source, relative), info = await lstat(path)
    if (!info.isDirectory()) return
    directories.push({ relative, mode: info.mode & 0o777 })
    await chmod(path, (info.mode & 0o777) | 0o500)
    for (const name of await readdir(path)) await visit(join(relative, name))
  }
  try {
    await visit()
    await cp(source, destination, { recursive: true })
  } finally {
    for (const { relative, mode } of directories.reverse()) {
      await chmod(join(source, relative), mode)
      if (await lstat(join(destination, relative)).then(()=>true,()=>false)) await chmod(join(destination, relative), mode)
    }
  }
}
