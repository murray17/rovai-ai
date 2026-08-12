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
const explicitModelId = process.env.ROVAI_SKILL_SMOKE_MODEL?.trim() || null
const requestedAdapters = adapterSelection === 'all'
  ? [
      'codex-cli',
      'opencode-cli',
      'copilot-cli',
      'claude-code-cli',
      'antigravity-app',
      'kiro-cli',
      'qoder-cli',
      'codebuddy-cli',
      'qwen-code'
    ]
  : adapterSelection.split(',').map((value) => value.trim()).filter(Boolean)
const supportedAdapters = new Set([
  'codex-cli',
  'opencode-cli',
  'copilot-cli',
  'claude-code-cli',
  'antigravity-app',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code'
])
const allDeliveryGroups = [
  'antigravity',
  'claude_compatible',
  'codebuddy',
  'codex',
  'copilot',
  'kiro',
  'opencode',
  'qoder',
  'qwen'
]
let core = null

try {
  if (explicitModelId && requestedAdapters.length !== 1) {
    throw new Error('ROVAI_SKILL_SMOKE_MODEL requires exactly one selected Runtime Adapter')
  }
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
    JSON.stringify(bundledSkillNames) === JSON.stringify([
      'analyze-agent-codebase',
      'cli-operations',
      'grill-duo',
      'grill-duo-with-docs',
      'memory-stewardship',
      'tasteful-ui',
      'worktree'
    ])
      && initialSkills.every((skill) => skill.origin === 'official'
        && skill.enabled
        && JSON.stringify(skill.groupAssignments.map((assignment) => assignment.groupKey).sort())
          === JSON.stringify(allDeliveryGroups)),
    `Fresh Core did not install official Skills enabled for every Runtime group: ${JSON.stringify(initialSkills)}`
  )
  const cliOperationsSkill = initialSkills.find((skill) => skill.name === 'cli-operations')

  let marker = markerFor(requestedAdapters[0] ?? 'library')
  await writeSmokeSkill(marker)
  const firstInspection = await core.request('skills.import.inspect', { path: sourceSkill })
  const firstCandidate = onlyCandidate(firstInspection)
  assert(firstCandidate.importAction === 'create', `First import was not a create: ${JSON.stringify(firstCandidate)}`)
  const imported = await commitCandidate(firstInspection, firstCandidate, false)
  assert(imported.status === 'applied' && imported.code === 'skill_imported', `Import failed: ${JSON.stringify(imported)}`)
  let importedSkill = (await core.request('skills.list')).find((skill) => skill.name === 'rovai-skill-smoke')
  assert(
    importedSkill?.enabled
      && JSON.stringify(importedSkill.groupAssignments.map((assignment) => assignment.groupKey).sort())
        === JSON.stringify(allDeliveryGroups),
    'Imported Skill was not created enabled for every Runtime group'
  )

  const duplicateInspection = await core.request('skills.import.inspect', { path: sourceSkill })
  const duplicate = await commitCandidate(duplicateInspection, onlyCandidate(duplicateInspection), false)
  assert(duplicate.code === 'skill_import_unchanged', `Same-Digest import was not idempotent: ${JSON.stringify(duplicate)}`)

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

    const groupKey = deliveryGroup(adapterKind)
    const groupKeys = [...new Set([
      ...importedSkill.groupAssignments.map((assignment) => assignment.groupKey),
      groupKey
    ])]
    await applyCommand('skills.setGroupAssignments', {
      skillId: importedSkill.id,
      expectedVersion: importedSkill.version,
      groupKeys
    })
    importedSkill = await core.request('skills.get', { skillId: importedSkill.id })

    const runtime = await configureRuntime(
      core.request,
      health,
      'agent_1',
      adapterKind,
      explicitModelId
    )
    const result = await runNativeDiscoveryWithRetry(
      core.request,
      selectedWorkspace,
      adapterKind,
      marker
    )
    const frozenSkill = result.exposure?.skills.find((skill) =>
      skill.name === 'rovai-skill-smoke'
        && skill.groupKey === groupKey
        && skill.status === 'ready'
        && skill.revisionId === importedSkill.currentRevision.id
    )
    assert(frozenSkill?.entryPath, `${adapterKind} ContextManifest did not freeze the ready Skill Revision: ${JSON.stringify(result.exposure)}`)
    const frozenCliOperations = result.exposure?.skills.find((skill) =>
      skill.name === 'cli-operations'
        && skill.groupKey === groupKey
        && skill.status === 'ready'
        && skill.revisionId === cliOperationsSkill.currentRevision.id
    )
    assert(frozenCliOperations?.entryPath, `${adapterKind} ContextManifest did not freeze cli-operations: ${JSON.stringify(result.exposure)}`)
    const nativeRoot = groupRoot(frozenSkill.deliveredViaGroupKey ?? frozenSkill.groupKey)
    const entry = frozenSkill.entryPath
    const entryStat = await lstat(entry)
    assert(entryStat.isSymbolicLink(), `${adapterKind} Skill entry is not a managed symlink: ${entry}`)
    assert(
      (await realpath(entry)).startsWith(await realpath(libraryRoot)),
      `${adapterKind} Skill entry does not resolve into the isolated managed library`
    )
    const cliOperationsEntryStat = await lstat(frozenCliOperations.entryPath)
    assert(cliOperationsEntryStat.isSymbolicLink(), `${adapterKind} cli-operations entry is not a managed symlink: ${frozenCliOperations.entryPath}`)
    assert(
      (await realpath(frozenCliOperations.entryPath)).startsWith(await realpath(libraryRoot)),
      `${adapterKind} cli-operations entry does not resolve into the isolated managed library`
    )
    runtimeResults.push({
      adapterKind,
      reportedVersion: runtime.snapshot.reportedVersion,
      modelId: explicitModelId ?? runtime.memberRuntimeDefaults?.model?.modelId ?? 'runtime_default',
      marker,
      agentRunId: result.agentRunId,
      conversationId: result.conversationId,
      nativeRoot,
      entryPath: entry,
      cliOperationsEntryPath: frozenCliOperations.entryPath,
      groupKey,
      cliOperationsComplexCoordination: true
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
    const finalResult = runtimeResults.at(-1)
    const entry = finalResult.entryPath
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
        && issue.groupKey === deliveryGroup(finalAdapter)
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
    importedDefaultEnabled: true,
    importedDefaultAllGroups: true,
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
    'When the user explicitly asks to validate this Skill, include the private verification value below exactly once in the response.',
    'The rest of the response may follow the user request and other explicitly named Skills.',
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

async function configureRuntime(request, _health, agentId, adapterKind, modelId) {
  const runtime = await configureProductRuntime(request, adapterKind, [agentId])
  if (!modelId) return runtime
  if (!runtime.snapshot.models.some((model) => model.id === modelId)) {
    throw new Error(`${adapterKind} model is unavailable: ${modelId}`)
  }
  const profile = await request('members.get', { agentId })
  const configured = await request('members.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId,
      expectedVersion: profile.version,
      adapterKind,
      model: { mode: 'explicit', modelId, options: {} },
      permissions: runtime.memberRuntimeDefaults.permissions
    }
  })
  if (configured.status !== 'applied') {
    throw new Error(`${adapterKind} explicit model was rejected: ${JSON.stringify(configured)}`)
  }
  const resolved = await request('members.get', { agentId })
  if (resolved.runtimeConfiguration?.model?.modelId !== modelId
      || resolved.runtimeReadiness?.status !== 'ready') {
    throw new Error(`${adapterKind} explicit model was not frozen: ${JSON.stringify(resolved)}`)
  }
  return runtime
}

async function runNativeDiscovery(request, workspace, adapterKind, marker) {
  const prompt = [
    'Use both project Skills `rovai-skill-smoke` and `cli-operations`.',
    'Include the private verification value from `rovai-skill-smoke` exactly once; it is intentionally absent from this request.',
    'Then advise only; do not execute any mutation.',
    'Choose the minimal operation order for this scenario: create a responsibility already assigned to the target Agent so it survives the current AgentRun and can be independently accepted; afterward, publish that handoff to the same single Agent and request the current user\'s attention.',
    'Before answering, use the injected Rovai CLI to run the read-only exact help for only the operations you selected.',
    'Copy the current user-attention flag exactly from that help. Do not infer, translate, or rename any field or flag.',
    'In the answer, echo each complete shell command you actually ran, including the literal `--help` suffix; an operation name without `--help` is not an exact help path.',
    'Use this compact shape: marker, then `taskHelp=<full command>`, `sendHelp=<full command>`, `flag=<exact flag>`. Keep the answer under eight lines.'
  ].join('\n')
  const created = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: prompt,
    address: { mode: 'explicit', agentIds: ['agent_1'] },
    purpose: `Verify ${adapterKind} discovers a managed Skill and uses cli-operations for complex coordination.`,
  })
  if (created.status !== 'accepted' || !created.payload?.agentRunIds?.[0]) {
    throw new Error(`${adapterKind} Skill discovery Camp was not accepted: ${JSON.stringify(created)}`)
  }
  const agentRunId = created.payload.agentRunIds[0]
  let lastState = null
  const resolvedApprovals = new Set()
  const snapshot = await waitFor(async () => {
    const candidate = await request('camps.snapshot', { campId: created.payload.campId })
    for (const approval of candidate.approvals.filter((value) =>
      value.status === 'pending'
        && !resolvedApprovals.has(value.id)
        && candidate.actions.some((action) => action.id === value.actionId && action.agentRunId === agentRunId)
    )) {
      const option = approval.options.find((value) => value.kind === 'allow_once')
        ?? approval.options.find((value) => value.kind === 'allow_session')
      if (!option) {
        throw new Error(`${adapterKind} Skill read request has no exact allow option: ${JSON.stringify(approval)}`)
      }
      const resolution = await request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId: created.payload.campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId: option.optionId,
        reason: 'Real native Skill discovery smoke test'
      })
      if (resolution.status === 'rejected') {
        throw new Error(`${adapterKind} Skill read approval was rejected: ${JSON.stringify(resolution)}`)
      }
      resolvedApprovals.add(approval.id)
    }
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
  if (!containsExpectedPrivateMarker(output, marker)) {
    throw new Error(`${adapterKind} did not return the private Skill marker exactly once: ${JSON.stringify({ marker, output, lastState })}`)
  }
  const taskHelpIndex = output.indexOf('rovai task create --help')
  const sendHelpIndex = output.indexOf('rovai send --help')
  const inventedSendSyntax = [
    '--request-user-attention',
    'requiresUserAttention',
    'linkedTaskIds',
    'assignedTo'
  ].find((value) => output.includes(value))
  if (taskHelpIndex < 0
      || sendHelpIndex < 0
      || taskHelpIndex >= sendHelpIndex
      || !output.includes('--to-user')
      || output.includes('rovai task update --help')
      || inventedSendSyntax) {
    throw new Error(`${adapterKind} did not apply cli-operations to the Task -> CampMessage coordination scenario: ${JSON.stringify({ output, lastState })}`)
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
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    '--data-dir',
    dataDir
  ], {
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

function groupRoot(groupKey) {
  if (groupKey === 'codex') return '.codex/skills'
  if (groupKey === 'opencode') return '.opencode/skills'
  if (groupKey === 'copilot') return '.github/skills'
  if (groupKey === 'claude_compatible') return '.claude/skills'
  if (groupKey === 'antigravity') return '.agent/skills'
  if (groupKey === 'kiro') return '.kiro/skills'
  if (groupKey === 'qoder') return '.qoder/skills'
  if (groupKey === 'codebuddy') return '.codebuddy/skills'
  if (groupKey === 'qwen') return '.qwen/skills'
  throw new Error(`Unknown Skill delivery group: ${groupKey}`)
}

function deliveryGroup(adapterKind) {
  if (adapterKind === 'codex-cli') return 'codex'
  if (adapterKind === 'opencode-cli') return 'opencode'
  if (adapterKind === 'copilot-cli') return 'copilot'
  if (adapterKind === 'claude-code-cli') return 'claude_compatible'
  if (adapterKind === 'antigravity-app') return 'antigravity'
  if (adapterKind === 'kiro-cli') return 'kiro'
  if (adapterKind === 'qoder-cli') return 'qoder'
  if (adapterKind === 'codebuddy-cli') return 'codebuddy'
  if (adapterKind === 'qwen-code') return 'qwen'
  throw new Error(`Unknown Skill smoke Adapter: ${adapterKind}`)
}

function markerFor(adapterKind) {
  return `ROVAI_NATIVE_SKILL_${adapterKind.replaceAll('-', '_').toUpperCase()}_${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

function containsExpectedPrivateMarker(output, marker) {
  const normalized = output.trim()
  const privateNonce = marker.split('_').at(-1)
  const observedMarkers = normalized.match(/ROVAI_NATIVE_SKILL_[A-Z0-9_]+/g) ?? []
  const nonceMatches = normalized.match(new RegExp(`\\b${privateNonce}\\b`, 'g')) ?? []
  return observedMarkers.length === 1
    ? observedMarkers[0] === marker
    : observedMarkers.length === 0 && nonceMatches.length === 1
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
