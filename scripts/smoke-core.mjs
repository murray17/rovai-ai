import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-core-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core = null

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Rovai-ai Core Smoke\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'smoke@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = startCore(dataDir)
  const health = await core.request('health.check')
  const profiles = await core.request('agents.list')
  const initialNavigation = await core.request('navigation.snapshot')
  if (!health.core.ok || !health.database.ok || !health.git.installed) {
    throw new Error(`Core dependencies are not healthy: ${JSON.stringify(health)}`)
  }
  if (profiles.length !== 4) {
    throw new Error(`Fresh Core did not seed the four durable profiles: ${JSON.stringify(profiles)}`)
  }
  assertEmptyNavigation(initialNavigation, 'fresh install')

  const preflight = await core.request('camps.creationPreflight')
  if (!preflight.admissible
      || !preflight.initialLeadAgentProfileId
      || preflight.presentMembers.length !== profiles.length
      || preflight.presentMembers.some((member) => member.runtimeConfigured)) {
    throw new Error(`Structural Camp preflight rejected present members: ${JSON.stringify(preflight)}`)
  }

  const inspected = await core.request('repositories.inspect', { path: projectRoot })
  if (await realpath(inspected.projectPath) !== await realpath(projectRoot)) {
    throw new Error(`Repository inspection returned the wrong root: ${JSON.stringify(inspected)}`)
  }
  const afterInspection = await core.request('navigation.snapshot')
  assertEmptyNavigation(afterInspection, 'repository inspection')

  await core.stop()
  core = startCore(dataDir)
  const restoredNavigation = await core.request('navigation.snapshot')
  assertEmptyNavigation(restoredNavigation, 'Core restart')

  console.log(JSON.stringify({
    ok: true,
    profileCount: profiles.length,
    projectSelectionIsTransient: true,
    freshCampCount: restoredNavigation.lobby.totalCount,
    freshProjectGroupCount: restoredNavigation.projects.length,
    coreVersion: health.core.version
  }, null, 2))
} finally {
  if (core) await core.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

function assertEmptyNavigation(navigation, phase) {
  if (navigation.lobby.totalCount !== 0 || navigation.projects.length !== 0) {
    throw new Error(`${phase} materialized a Project or compatibility Camp: ${JSON.stringify(navigation)}`)
  }
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
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 30_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

async function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun(stdout.join(''))
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}
