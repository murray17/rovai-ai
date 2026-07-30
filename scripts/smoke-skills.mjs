import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-skills-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const sourceRoot = join(fixtureRoot, 'imports')
const sourceSkill = join(sourceRoot, 'rovai-skill-smoke')
const dataDir = join(fixtureRoot, 'data')
const libraryRoot = join(fixtureRoot, 'rovai-library')
const adapterSelection = process.env.ROVAI_SKILL_SMOKE_ADAPTERS ?? 'codex-cli'
const requestedAdapters = adapterSelection === 'all'
  ? ['codex-cli', 'opencode-cli', 'copilot-cli', 'claude-code-cli', 'antigravity-app']
  : adapterSelection.split(',').map((value) => value.trim()).filter(Boolean)
const supportedAdapters = new Set([
  'codex-cli',
  'opencode-cli',
  'copilot-cli',
  'claude-code-cli',
  'antigravity-app'
])
let core = null

try {
  for (const adapterKind of requestedAdapters) {
    if (!supportedAdapters.has(adapterKind)) throw new Error(`Unknown Skill smoke Adapter: ${adapterKind}`)
  }
  await mkdir(projectRoot)
  await mkdir(sourceRoot)
  const originalGitignore = '# User-owned ignore rules stay byte-for-byte stable.\n*.local\n'
  await writeFile(join(projectRoot, 'README.md'), '# Rovai-ai Skill Smoke\n')
  await writeFile(join(projectRoot, '.gitignore'), originalGitignore)
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Skill Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'skill-smoke@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md', '.gitignore'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = startCore()
  const initialSkills = await core.request('skills.list')
  const bundledSkillNames = initialSkills.map((skill) => skill.name).sort()
  assert(
    JSON.stringify(bundledSkillNames) === JSON.stringify(['grill-me', 'grill-with-docs', 'memory-stewardship'])
      && initialSkills.every((skill) => skill.sourceKind === 'bundled' && skill.enabled),
    `Fresh Core did not install the expected enabled Bundled Skills: ${JSON.stringify(initialSkills)}`
  )

  let marker = markerFor(requestedAdapters[0] ?? 'library')
  await writeSmokeSkill(marker)
  const firstInspection = await core.request('skills.import.inspect', { path: sourceSkill })
  const firstCandidate = onlyCandidate(firstInspection)
  assert(firstCandidate.importAction === 'create', `First import was not a create: ${JSON.stringify(firstCandidate)}`)
  const imported = await commitCandidate(firstInspection, firstCandidate, false)
  assert(imported.status === 'applied' && imported.code === 'skill_imported', `Import failed: ${JSON.stringify(imported)}`)
  let importedSkill = (await core.request('skills.list')).find((skill) => skill.name === 'rovai-skill-smoke')
  assert(importedSkill && !importedSkill.enabled, 'Imported Skill was not created disabled')

  const duplicateInspection = await core.request('skills.import.inspect', { path: sourceSkill })
  const duplicate = await commitCandidate(duplicateInspection, onlyCandidate(duplicateInspection), false)
  assert(duplicate.code === 'skill_import_unchanged', `Same-Digest import was not idempotent: ${JSON.stringify(duplicate)}`)

  await applyCommand('skills.setEnabled', {
    skillId: importedSkill.id,
    expectedVersion: importedSkill.version,
    enabled: true
  })
  importedSkill = await core.request('skills.get', { skillId: importedSkill.id })
  assert(importedSkill.enabled, 'Skill enable did not persist')
  const selectedWorkspace = await core.request('workspaces.inspect', { path: projectRoot })

  const health = await core.request('health.check')
  const runtimeResults = []
  for (let index = 0; index < requestedAdapters.length; index += 1) {
    const adapterKind = requestedAdapters[index]
    if (index > 0) {
      marker = markerFor(adapterKind)
      await writeSmokeSkill(marker)
      const updateInspection = await core.request('skills.import.inspect', { path: sourceSkill })
      const updateCandidate = onlyCandidate(updateInspection)
      assert(updateCandidate.importAction === 'update', `Changed import was not an update: ${JSON.stringify(updateCandidate)}`)
      const updated = await commitCandidate(updateInspection, updateCandidate, true)
      assert(updated.code === 'skill_updated', `Skill update failed: ${JSON.stringify(updated)}`)
      importedSkill = await core.request('skills.get', { skillId: importedSkill.id })
    }

    const runtime = await configureRuntime(core.request, health, 'agent-luoke', adapterKind)
    const result = await runNativeDiscoveryWithRetry(
      core.request,
      selectedWorkspace,
      adapterKind,
      marker
    )
    const nativeRoot = nativeSkillRoot(adapterKind)
    const entry = join(projectRoot, nativeRoot, 'rovai-skill-smoke')
    const entryStat = await lstat(entry)
    assert(entryStat.isSymbolicLink(), `${adapterKind} Skill entry is not a managed symlink: ${entry}`)
    assert(
      (await realpath(entry)).startsWith(await realpath(libraryRoot)),
      `${adapterKind} Skill entry does not resolve into the isolated managed library`
    )
    assert(
      result.exposure?.skills.some((skill) =>
        skill.name === 'rovai-skill-smoke'
          && skill.status === 'ready'
          && skill.revisionId === importedSkill.currentRevision.id
      ),
      `${adapterKind} ContextManifest did not freeze the ready Skill Revision: ${JSON.stringify(result.exposure)}`
    )
    runtimeResults.push({
      adapterKind,
      reportedVersion: runtime.snapshot.reportedVersion,
      marker,
      agentRunId: result.agentRunId,
      conversationId: result.conversationId,
      nativeRoot
    })
  }

  if (requestedAdapters.length > 0) {
    const exclude = await readFile(await gitPath(projectRoot, 'info/exclude'), 'utf8')
    assert(exclude.includes('BEGIN ROVAI MANAGED SKILL PROJECTIONS'), 'Git info/exclude has no Rovai-ai managed block')
    assert(exclude.includes('rovai-skill-smoke'), 'Git info/exclude omits the imported Skill projection')
    assert(await readFile(join(projectRoot, '.gitignore'), 'utf8') === originalGitignore, '.gitignore was modified')
    assert((await run('git', ['status', '--porcelain'], projectRoot)).trim() === '', 'Skill projections dirtied the Git worktree')
  }

  await rm(sourceRoot, { recursive: true, force: true })
  const managedLocation = await core.request('skills.revealLocation', { skillId: importedSkill.id })
  assert(
    (await readFile(join(managedLocation.path, 'SKILL.md'), 'utf8')).includes(marker),
    'Managed Skill content depended on the removed import source'
  )

  await core.stop()
  core = startCore()
  importedSkill = await core.request('skills.get', { skillId: importedSkill.id })
  assert(importedSkill?.enabled, 'Core restart lost the imported enabled Skill')
  await applyCommand('skills.reconcile', {})

  let shadowed = null
  if (requestedAdapters.length > 0) {
    const finalAdapter = requestedAdapters.at(-1)
    const nativeRoot = nativeSkillRoot(finalAdapter)
    const entry = join(projectRoot, nativeRoot, 'rovai-skill-smoke')
    await unlink(entry)
    await mkdir(entry, { recursive: true })
    await writeFile(
      join(entry, 'SKILL.md'),
      '---\nname: rovai-skill-smoke\ndescription: Project-owned conflict\n---\n\nProject content wins.\n'
    )
    await applyCommand('skills.reconcile', {})
    const issues = await core.request('skills.projections.listIssues')
    shadowed = issues.find((issue) =>
      issue.skillId === importedSkill.id
        && issue.nativeRootKind === nativeRootKind(finalAdapter)
        && issue.state === 'shadowed'
    )
    assert(shadowed, `Project-owned same-name Skill was not reported as Shadowed: ${JSON.stringify(issues)}`)
  }

  await applyCommand('skills.delete', {
    skillId: importedSkill.id,
    expectedVersion: importedSkill.version
  })
  await applyCommand('skills.reconcile', {})
  assert(
    !(await core.request('skills.list')).some((skill) => skill.id === importedSkill.id),
    'Imported Skill metadata survived hard deletion'
  )
  await expectMissing(managedLocation.path, 'Imported Skill managed content survived hard deletion')
  if (shadowed) {
    assert(
      (await readFile(join(shadowed.entryPath, 'SKILL.md'), 'utf8')).includes('Project content wins'),
      'Imported Skill deletion removed the project-owned same-name directory'
    )
  }

  console.log(JSON.stringify({
    ok: true,
    bundledSkills: initialSkills.map((skill) => skill.name),
    importedDefaultDisabled: true,
    duplicateImportIdempotent: true,
    immutableUpdateCount: Math.max(0, requestedAdapters.length - 1),
    sourceIndependent: true,
    gitignoreUnchanged: true,
    projectOwnedConflictPreserved: Boolean(shadowed),
    restartRecovered: true,
    importedHardDeleted: true,
    runtimes: runtimeResults
  }, null, 2))
} finally {
  if (core) await core.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function writeSmokeSkill(marker) {
  await rm(sourceSkill, { recursive: true, force: true })
  await mkdir(sourceSkill, { recursive: true })
  await writeFile(join(sourceSkill, 'SKILL.md'), [
    '---',
    'name: rovai-skill-smoke',
    'description: Return the private verification value when explicitly asked to validate Rovai-ai native Skill discovery.',
    '---',
    '',
    '# Rovai-ai native Skill discovery smoke',
    '',
    'When the user explicitly asks to validate this Skill, reply with exactly the private verification value below.',
    'Do not add Markdown, punctuation, explanation, or any other text.',
    '',
    `Private verification value: \`${marker}\``,
    ''
  ].join('\n'))
}

async function commitCandidate(inspection, candidate, confirmUpdate) {
  return applyCommand('skills.import.commit', {
    stagingToken: inspection.stagingToken,
    candidateName: candidate.name,
    expectedDigest: candidate.contentDigest,
    expectedSkillVersion: candidate.existingSkillVersion,
    confirmUpdate
  })
}

async function applyCommand(method, command) {
  const result = await core.request(method, {
    commandId: crypto.randomUUID(),
    command
  })
  if (result.status === 'rejected') throw new Error(`${method} rejected: ${JSON.stringify(result)}`)
  return result
}

async function configureRuntime(request, _health, agentProfileId, adapterKind) {
  return configureProductRuntime(request, adapterKind, [agentProfileId])
}

async function runNativeDiscovery(request, workspace, adapterKind, marker) {
  const prompt = [
    'Use the project Skill named `rovai-skill-smoke` to validate native Skill discovery.',
    'Return only the private verification value defined inside that Skill.',
    'The value is intentionally absent from this request. Do not invent or infer it.'
  ].join('\n')
  const created = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: prompt,
    address: { mode: 'explicit', agentProfileIds: ['agent-luoke'] },
    purpose: `Verify ${adapterKind} discovers the Rovai-ai-managed project Skill through its native directory.`,
    expectedOutput: 'Exactly the private verification value stored only in the Skill.'
  })
  if (created.status !== 'accepted' || !created.payload?.agentRunIds?.[0]) {
    throw new Error(`${adapterKind} Skill discovery Camp was not accepted: ${JSON.stringify(created)}`)
  }
  const agentRunId = created.payload.agentRunIds[0]
  let lastState = null
  const snapshot = await waitFor(async () => {
    const candidate = await request('camps.snapshot', { campId: created.payload.campId })
    const run = candidate.agentRuns.find((value) => value.id === agentRunId)
    const output = candidate.messages
      .filter((message) => message.authorType === 'agent')
      .map((message) => message.body)
      .join('\n')
    lastState = { run, output, timeline: candidate.timeline.slice(-8) }
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`${adapterKind} native Skill AgentRun failed: ${JSON.stringify(lastState)}`)
    }
    return run?.status === 'succeeded' ? candidate : null
  }, `${adapterKind} native Skill discovery`, 360_000)
  const output = snapshot.messages
    .filter((message) => message.authorType === 'agent')
    .map((message) => message.body.trim())
    .join('\n')
  if (!containsOnlyExpectedPrivateMarker(output, marker)) {
    throw new Error(`${adapterKind} did not return the private Skill marker: ${JSON.stringify({ marker, output, lastState })}`)
  }
  const run = snapshot.agentRuns.find((value) => value.id === agentRunId)
  const manifest = snapshot.contextManifests.find((value) => value.agentRunId === agentRunId)
  return {
    agentRunId,
    conversationId: run.conversationId,
    exposure: manifest?.skillExposure
  }
}

async function runNativeDiscoveryWithRetry(request, workspace, adapterKind, marker) {
  let firstError = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await runNativeDiscovery(request, workspace, adapterKind, marker)
    } catch (error) {
      if (attempt === 2) {
        throw new Error(`${adapterKind} native Skill discovery failed twice; first=${firstError?.message}; second=${error.message}`)
      }
      firstError = error
      await wait(3_000)
    }
  }
  throw firstError
}

function startCore() {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDir], {
    cwd: root,
    env: {
      ...process.env,
      ROVAI_SKILL_LIBRARY_ROOT: libraryRoot
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
    const pendingRequest = pending.get(message.id)
    if (!pendingRequest) return
    clearTimeout(pendingRequest.timer)
    pending.delete(message.id)
    if (message.error) pendingRequest.reject(new Error(message.error.message))
    else pendingRequest.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 120_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      wait(4_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

function nativeSkillRoot(adapterKind) {
  if (adapterKind === 'claude-code-cli') return '.claude/skills'
  if (adapterKind === 'antigravity-app') return '.agent/skills'
  return '.agents/skills'
}

function nativeRootKind(adapterKind) {
  if (adapterKind === 'claude-code-cli') return 'claude'
  if (adapterKind === 'antigravity-app') return 'antigravity'
  return 'agents'
}

function markerFor(adapterKind) {
  return `ROVAI_NATIVE_SKILL_${adapterKind.replaceAll('-', '_').toUpperCase()}_${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

function containsOnlyExpectedPrivateMarker(output, marker) {
  const observed = output.match(/ROVAI_NATIVE_SKILL_[A-Z0-9_]+/g) ?? []
  return observed.length === 1 && observed[0] === marker
}

function onlyCandidate(inspection) {
  assert(inspection.candidates.length === 1, `Expected one import candidate: ${JSON.stringify(inspection)}`)
  return inspection.candidates[0]
}

async function gitPath(cwd, value) {
  const path = (await run('git', ['rev-parse', '--git-path', value], cwd)).trim()
  return resolve(cwd, path)
}

async function expectMissing(path, message) {
  try {
    await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  throw new Error(message)
}

async function waitFor(read, label, timeoutMs) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await read()
      if (value) return value
    } catch (error) {
      lastError = error
      if (String(error.message).includes('failed:')) throw error
    }
    await wait(500)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
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
      : rejectRun(new Error(`${basename(command)} failed (${code}): ${stderr.join('')}`)))
  })
}
