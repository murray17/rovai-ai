import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { startQualificationCore, processTable, descendantsOf, waitForProcessesToExit } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

// This supplements the shared output, permissions, Skills, MCP, cold-resume and
// Missing-Send owners with the official resident Host's cross-Session boundary.
// The caller supplies an isolated native HOME containing official BYOK config.
const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-zcode-fleet-')))
const project = join(fixture, 'project')
const data = join(fixture, 'data')
const events = []
let core
let passed = false
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

try {
  await mkdir(project)
  await writeFile(join(project, 'README.md'), '# Official ZCode isolation fixture\n')
  for (const args of [['init', '-b', 'main'], ['add', 'README.md'], ['-c', 'user.name=Rovai Smoke', '-c', 'user.email=smoke@rovai.local', 'commit', '-m', 'fixture']]) {
    execFileSync('git', args, { cwd: project, stdio: 'ignore' })
  }
  core = startQualificationCore({ coreExecutable: join(root, 'target/debug/rovai-core'), dataDirectory: data,
    workingDirectory: root, runtimeCacheDirectory: join(fixture, 'cache'), onNotification: (event) => events.push(event) })
  const workspace = await core.request('workspaces.inspect', { path: project })
  await until(() => events.some((e) => e.method === 'runtime.discovery.completed'), 90_000)
  await configureProductRuntime(core.request, 'zcode-app', ['agent_2', 'agent_3'])
  const send = async (body) => accepted(await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(), workspace, body, address: { mode: 'explicit', agentIds: ['agent_2'] },
    purpose: 'Verify official ZCode Session isolation through the product Runtime.'
  }))
  if (['1', 'native'].includes(process.env.ROVAI_ZCODE_FLEET_CRASH)) {
    const effect = join(project, 'CRASH_MUST_NOT_WRITE.txt')
    const active = await send(`In this temporary test project, execute Bash once: sleep 30; printf SHOULD_NOT_EXIST > '${effect}'. Report when done.`)
    await until(() => events.some((e) => e.method === 'runtime.action' && e.params?.agentRunId === active.agentRunId
      && e.params?.payload?.status === 'in_progress' && String(e.params?.payload?.input ?? '').includes('sleep 30')), 90_000)
    const table = await processTable()
    const owned = descendantsOf(table, core.pid)
    assert(owned.length > 0)
    const nativeCrash = process.env.ROVAI_ZCODE_FLEET_CRASH === 'native'
    // The official kernel may replace process.title. Identify its exact owner
    // through our direct cleanup companion instead of the mutable argv title.
    const nativeOwners = table.filter((p) => p.ppid === core.pid
      && table.some((child) => child.ppid === p.pid && child.command.includes('function watchOwner()')))
    if (nativeCrash) assert.equal(nativeOwners.length, 1, 'Expected one native Host owning a cleanup companion')
    const target = nativeCrash ? nativeOwners[0]?.pid : core.pid
    assert(target, 'Exact native owner process was not observed')
    process.kill(target, 'SIGKILL')
    if (!nativeCrash) { await core.stop(); core = null }
    assert.deepEqual(await waitForProcessesToExit(owned, 15_000), [])
    if (core) { await core.stop(); core = null }
    await delay(35_000)
    assert.equal(await readFile(effect).then(() => true, (e) => { if (e.code === 'ENOENT') return false; throw e }), false)
    passed = true
    console.log(JSON.stringify({ ok: true, crashTarget: nativeCrash ? 'native' : 'core', crashDescendantsReaped: true, delayedEffectAbsent: true,
      agentRunId: active.agentRunId, ...start(active.agentRunId) }, null, 2))
  } else {
  const tokenA = `ZCODE_A_${crypto.randomUUID()}`
  const tokenB = `ZCODE_B_${crypto.randomUUID()}`
  const a = await send(`For this reply only, no tools are needed. The project label assigned to your session is ${tokenA}. Confirm the label.`)
  const first = await finish(a)
  assert.deepEqual(first.output.match(/ZCODE_[AB]_[a-f0-9-]{36}/g), [tokenA])
  // ACP-family compatibility includes the Camp attachment authorization root.
  // Exercise different member Sessions inside that same authorized scope.
  const follow = async (agentId, body) => {
    const draft = await core.request('camp.composerDraft.get', { campId: a.campId })
    const saved = await core.request('camp.composerDraft.save', { campId: a.campId, expectedRevision: draft.revision,
      content: composerDocumentForAddress({ mode: 'explicit', agentIds: Array.isArray(agentId) ? agentId : [agentId] }, body) })
    return accepted(await core.request('camp.messages.send', { commandId: crypto.randomUUID(), campId: a.campId,
      draftRevision: saved.revision, execution: { taskId: null, purpose: 'Verify exact member Session switching.', completionRole: 'required' } }), a.campId)
  }
  const b = await follow('agent_3', `For this reply only, no tools are needed. The project label assigned to your session is ${tokenB}. Confirm the label.`)
  const second = await finish(b)
  assert.deepEqual(second.output.match(/ZCODE_[AB]_[a-f0-9-]{36}/g), [tokenB])
  assert.equal(second.start.hostInstanceId, first.start.hostInstanceId)
  assert.notEqual(second.start.nativeThreadId, first.start.nativeThreadId)
  const returned = await finish(await follow('agent_2', 'Repeat only the project label assigned to your session earlier. This reply needs no tools.'))
  assert.deepEqual(returned.output.match(/ZCODE_[AB]_[a-f0-9-]{36}/g), [tokenA])
  assert.equal(returned.start.hostInstanceId, first.start.hostInstanceId)
  assert.equal(returned.start.nativeThreadId, first.start.nativeThreadId)

  // One addressed Camp message admits both member Runs concurrently. A second
  // user message would correctly enter the Camp's pending-input FIFO instead.
  const parallel = await follow(['agent_2', 'agent_3'], "Please check the shell runner in this temporary Git project: execute Bash once with sleep 10; printf 'SHELL_OK\\n'. Report the stdout.")
  assert.equal(parallel.agentRunIds.length, 2)
  const [third, fourth] = await Promise.all(parallel.agentRunIds.map((agentRunId) => finish({ campId: a.campId, agentRunId })))
  assert.notEqual(third.start.hostInstanceId, fourth.start.hostInstanceId)
  assert.notEqual(third.start.nativeThreadId, fourth.start.nativeThreadId)
  assert(third.output.includes('SHELL_OK'))
  assert(fourth.output.includes('SHELL_OK'))

  await mkdir(join(project, '.zcode'), { recursive: true })
  await writeFile(join(project, '.zcode/config.json'), JSON.stringify({ memory: { use: false } }))
  const changed = await finish(await follow('agent_2', 'Do not use tools. Reply exactly CONFIG_CHANGED.'))
  assert(changed.output.includes('CONFIG_CHANGED'))
  assert(![third, fourth].some((old) => old.start.hostInstanceId === changed.start.hostInstanceId))

  const profile = await core.request('members.get', { agentId: 'agent_2' })
  const permission = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: 'agent_2', expectedVersion: profile.version, adapterKind: 'zcode-app', model: profile.runtimeConfiguration.model,
    permissions: { ...profile.runtimeConfiguration.permissions, values: { permission_mode: 'plan' } }
  } })
  assert.equal(permission.status, 'applied')
  const forbidden = join(project, 'PLAN_MUST_NOT_WRITE.txt')
  await finish(await send(`Try to create ${forbidden} using the native Write tool. Respect the current permission mode and report the result. Do not use other tools.`))
  assert.equal(await readFile(forbidden, 'utf8').then(() => true, (error) => {
    if (error.code === 'ENOENT') return false
    throw error
  }), false)
  const owned = descendantsOf(await processTable(), core.pid)
  await core.stop()
  core = null
  assert.deepEqual(await waitForProcessesToExit(owned, 15_000), [])
  passed = true
  console.log(JSON.stringify({ ok: true, adapterKind: 'zcode-app',
    exactSwitchBack: true, sameHostAcrossSessions: true, concurrentHostsDistinct: true,
    configChangeFenced: true, planWritePrevented: true, shutdownDescendantsReaped: true,
    sessions: [first, second, returned, third, fourth, changed].map((r) => ({
      hostInstanceId: r.start.hostInstanceId, nativeSessionId: r.start.nativeThreadId, agentRunId: r.start.agentRunId
    })) }, null, 2))
  }
} finally {
  if (core) {
    const stopped = await core.stop()
    if (!passed) process.stderr.write(stopped.stderrTail)
  }
  if (passed) {
    await removeEphemeralRuntimeCampFilesRoot(data)
    await rm(fixture, { recursive: true, force: true })
  } else process.stderr.write(`ZCode fleet fixture retained: ${fixture}\n`)
}

function accepted(result, knownCampId) {
  const command = result.commandResult ?? result
  assert.equal(command.status, 'accepted')
  const campId = knownCampId ?? command.payload?.campId
  const agentRunId = command.payload?.agentRunIds?.[0]
  assert(campId && agentRunId)
  return { campId, agentRunId, agentRunIds: command.payload.agentRunIds }
}

function start(agentRunId) {
  return events.find((event) => event.method === 'agent_run.started' && event.params?.agentRunId === agentRunId)?.params
}

async function until(check, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(250)
  }
  throw new Error('ZCode fleet observation timed out')
}

async function finish({ campId, agentRunId }) {
  let snapshot
  let run
  await until(async () => {
    snapshot = await core.request('camps.snapshot', { campId })
    run = snapshot.agentRuns.find((run) => run.id === agentRunId)
    return run && ['succeeded', 'failed', 'cancelled'].includes(run.status)
  }, 300_000)
  assert.equal(run.status, 'succeeded', JSON.stringify(run.failure))
  const output = snapshot.messages.filter((message) => message.sourceAgentRunId === agentRunId && message.authorType === 'agent').map((message) => message.body).join('\n')
  return { start: start(agentRunId), output }
}
