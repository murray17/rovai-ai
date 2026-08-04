import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import {
  QUALIFICATION_CASE_SCHEMA_VERSION,
  QUALIFICATION_CASE_SCHEMA_V2,
  SUPPORTED_QUALIFICATION_CASE_SCHEMA_VERSIONS,
  validateEvaluationContract,
  validateVerifierObservation
} from './qualification-evaluation.mjs'
import { validateV036Schema } from './qualification-v036-schema-validation.mjs'

export const QUALIFICATION_SCHEMA_VERSION = 2
export const QUALIFICATION_RUNNER_VERSION = '0.36.0'
export const HERMETIC_VERIFICATION_PROFILE = Object.freeze({
  schemaVersion: 1,
  runtime: 'node',
  environment: { timezone: 'UTC', locale: 'C', inherited: [] },
  permissions: {
    deliveredWorkspace: 'read_only',
    perCheckTemporaryDirectory: 'read_write',
    network: 'denied',
    childProcess: 'denied',
    worker: 'denied',
    addon: 'denied',
    ffi: 'denied',
    wasi: 'denied',
    inspector: 'denied'
  },
  publicTestConcurrency: 1,
  publicCheckTimeoutMs: 30_000,
  verifierTimeoutMs: 60_000,
  maxOutputBytes: 1024 * 1024
})

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function digestJson(value) {
  return sha256(canonicalJson(value))
}

export async function digestFile(path) {
  return sha256(await readFile(path))
}

export async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
  return realpath(path)
}

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

export async function writePrivateJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
  } finally {
    await handle.close()
  }
  await chmod(path, 0o600)
}

export async function treeManifest(root, { excludeGit = true, excludeTopLevel = [] } = {}) {
  const absoluteRoot = resolve(root)
  const excluded = new Set(excludeTopLevel)
  const entries = []
  await walk(absoluteRoot, '')
  const digest = digestJson(entries)
  return { schemaVersion: 1, digest, entries }

  async function walk(directory, relativeDirectory) {
    const names = await readdir(directory)
    names.sort()
    for (const name of names) {
      if (relativeDirectory === '' && ((excludeGit && name === '.git') || excluded.has(name))) continue
      const absolutePath = join(directory, name)
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name
      const metadata = await lstat(absolutePath)
      const mode = metadata.mode & 0o777
      if (metadata.isDirectory()) {
        entries.push({ path: relativePath, type: 'directory', mode })
        await walk(absolutePath, relativePath)
      } else if (metadata.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          type: 'symlink',
          mode,
          target: await readlink(absolutePath)
        })
      } else if (metadata.isFile()) {
        entries.push({
          path: relativePath,
          type: 'file',
          mode,
          bytes: metadata.size,
          digest: await digestFile(absolutePath)
        })
      } else {
        entries.push({ path: relativePath, type: 'other', mode })
      }
    }
  }
}

export function treeDiff(before, after) {
  const beforeByPath = new Map(before.entries.map((entry) => [entry.path, entry]))
  const afterByPath = new Map(after.entries.map((entry) => [entry.path, entry]))
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort()
  const changed = []
  for (const path of paths) {
    const previous = beforeByPath.get(path) ?? null
    const current = afterByPath.get(path) ?? null
    if (canonicalJson(previous) !== canonicalJson(current)) changed.push({ path, before: previous, after: current })
  }
  return { schemaVersion: 1, digest: digestJson(changed), changed }
}

export async function runCaptured(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let timedOut = false
    let outputOverflow = false
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk])
      if (next.length <= maxOutputBytes) return next
      outputOverflow = true
      return next.subarray(next.length - maxOutputBytes)
    }
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2_000).unref()
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolveRun({
        command: [command, ...args],
        code,
        signal,
        timedOut,
        outputOverflow,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8')
      })
    })
  })
}

export async function copyFixture(source, destination) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true })
  await chmod(destination, 0o700)
}

export async function dispatchQualificationPrompt(request, {
  commandId,
  campId,
  prompt,
  execution
}) {
  const currentDraft = await request('camp.composerDraft.get', { campId })
  if (!Number.isInteger(currentDraft?.revision) || currentDraft.revision < 0) {
    throw new Error('Qualification Camp composer draft has no valid Core Revision')
  }
  const savedDraft = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: currentDraft.revision,
    content: [{ kind: 'text', text: prompt }]
  })
  if (!Number.isInteger(savedDraft?.revision) || savedDraft.revision <= currentDraft.revision) {
    throw new Error('Qualification Camp composer draft did not advance its Core Revision')
  }
  return request('camp.messages.send', {
    commandId,
    campId,
    draftRevision: savedDraft.revision,
    replyToCampMessageId: null,
    execution
  })
}

export async function createQualificationExecutionEnvironment(workspacePath, overrides = {}) {
  const absoluteWorkspace = resolve(workspacePath)
  const environmentRoot = join(
    dirname(absoluteWorkspace),
    `.qualification-environment-${safeLabel(basename(absoluteWorkspace))}-${sha256(absoluteWorkspace).slice(0, 12)}`
  )
  const temporaryDirectory = join(environmentRoot, 'tmp')
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
  const environment = {
    HOME: environmentRoot,
    USERPROFILE: environmentRoot,
    XDG_CONFIG_HOME: join(environmentRoot, 'config'),
    XDG_CACHE_HOME: join(environmentRoot, 'cache'),
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    CI: '1',
    NO_COLOR: '1',
    ROVAI_QUALIFICATION_VERIFIER_OFFLINE: '1',
    GIT_CONFIG_GLOBAL: join(environmentRoot, '.gitconfig'),
    NPM_CONFIG_USERCONFIG: join(environmentRoot, '.npmrc')
  }
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR']) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key]
  }
  return { ...environment, ...overrides }
}

export function hermeticVerificationProfileDigest() {
  return digestJson(HERMETIC_VERIFICATION_PROFILE)
}

export async function runHermeticNode(logicalCommand, {
  workspacePath,
  readPaths = [],
  timeoutMs = HERMETIC_VERIFICATION_PROFILE.verifierTimeoutMs,
  maxOutputBytes = HERMETIC_VERIFICATION_PROFILE.maxOutputBytes
}) {
  if (!Array.isArray(logicalCommand) || logicalCommand[0] !== 'node' || logicalCommand.length < 2) {
    throw new Error('Hermetic verification requires a direct logical Node command')
  }
  const absoluteWorkspace = await realpath(resolve(workspacePath))
  const environmentRoot = await mkdtemp(join(dirname(absoluteWorkspace), '.qualification-hermetic-'))
  const temporaryDirectory = join(environmentRoot, 'tmp')
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
  const allowedReads = [...new Set([
    absoluteWorkspace,
    environmentRoot,
    ...readPaths.map((path) => resolve(path))
  ])]
  const permissionArguments = [
    '--permission',
    ...allowedReads.map((path) => `--allow-fs-read=${path}`),
    `--allow-fs-write=${temporaryDirectory}`
  ]
  const commandArguments = [...logicalCommand.slice(1)]
  if (commandArguments.includes('--test') && !commandArguments.some((part) => part.startsWith('--test-isolation='))) {
    const testIndex = commandArguments.indexOf('--test')
    commandArguments.splice(testIndex + 1, 0, '--test-isolation=none')
  }
  const environment = {
    HOME: environmentRoot,
    USERPROFILE: environmentRoot,
    XDG_CONFIG_HOME: join(environmentRoot, 'config'),
    XDG_CACHE_HOME: join(environmentRoot, 'cache'),
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    PATH: dirname(process.execPath),
    CI: '1',
    NO_COLOR: '1',
    TZ: 'UTC',
    LANG: 'C',
    LC_ALL: 'C',
    ROVAI_QUALIFICATION_VERIFIER_OFFLINE: '1'
  }
  const before = await treeManifest(absoluteWorkspace)
  try {
    const run = await runCaptured(process.execPath, [...permissionArguments, ...commandArguments], {
      cwd: absoluteWorkspace,
      env: environment,
      timeoutMs,
      maxOutputBytes
    })
    const after = await treeManifest(absoluteWorkspace)
    return {
      ...run,
      logicalCommand: [...logicalCommand],
      executable: process.execPath,
      workspaceMutated: before.digest !== after.digest,
      workspaceMutationDigest: before.digest === after.digest ? null : treeDiff(before, after).digest,
      verificationProfileDigest: hermeticVerificationProfileDigest()
    }
  } finally {
    await rm(environmentRoot, { recursive: true, force: true })
  }
}

export const MANAGED_RUNTIME_TOP_LEVEL = Object.freeze([
  '.agent',
  '.agents',
  '.claude',
  '.gemini'
])

export async function captureDeliveredWorkspaceSnapshot(source, evidenceDirectory) {
  const absoluteSource = resolve(source)
  const temporaryDestination = join(evidenceDirectory, `.delivered-workspace-${randomUUID()}.tmp`)
  const excluded = new Set(['.git', ...MANAGED_RUNTIME_TOP_LEVEL])
  const capturedAt = new Date().toISOString()
  try {
    await cp(absoluteSource, temporaryDestination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter(sourcePath) {
        const locator = relative(absoluteSource, sourcePath)
        if (locator === '') return true
        return !excluded.has(locator.split(sep)[0])
      }
    })
    const manifest = await treeManifest(temporaryDestination)
    await assertNoEscapingSymlinks(temporaryDestination, manifest)
    const destination = join(evidenceDirectory, `delivered-workspace-${manifest.digest}`)
    if (await exists(destination)) {
      const retained = await treeManifest(destination)
      if (retained.digest !== manifest.digest) {
        throw new Error('retained Delivered Workspace Snapshot does not match its content address')
      }
      await rm(temporaryDestination, { recursive: true, force: true })
      return { path: destination, manifest: retained, capturedAt }
    }
    await rename(temporaryDestination, destination)
    return { path: destination, manifest, capturedAt }
  } catch (error) {
    await rm(temporaryDestination, { recursive: true, force: true })
    throw error
  }
}

export function validateRelativeLocator(locator, label) {
  if (typeof locator !== 'string' || locator === '' || isAbsolute(locator)) {
    throw new Error(`${label} must be a non-empty relative path`)
  }
  const normalized = locator.split('/').filter((part) => part !== '' && part !== '.')
  if (normalized.includes('..') || normalized.length === 0) {
    throw new Error(`${label} escapes the case directory`)
  }
  return normalized.join('/')
}

function resolveInside(root, locator, label) {
  const normalized = validateRelativeLocator(locator, label)
  const target = resolve(root, normalized)
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`${label} escapes the case directory`)
  return target
}

export async function readCaseContract(caseDirectory) {
  const requestedRoot = resolve(caseDirectory)
  const root = await realpath(requestedRoot)
  const manifestPath = join(root, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  validateCaseManifest(manifest)
  if (manifest.schemaVersion === QUALIFICATION_CASE_SCHEMA_VERSION && requestedRoot !== root) {
    throw new Error('Case v3 private Pack locator must not traverse a symlink')
  }
  const evaluationContract = validateEvaluationContract(manifest)
  const fixturePath = resolveInside(root, manifest.fixtureDirectory, 'fixtureDirectory')
  await assertNoGitMetadata(fixturePath)
  await assertNoAbsolutePathLeak(fixturePath)
  const promptPath = resolveInside(root, manifest.promptFile, 'promptFile')
  const verifierPath = resolveInside(root, manifest.verifierFile, 'verifierFile')
  const challengeManifestPath = manifest.schemaVersion === QUALIFICATION_CASE_SCHEMA_VERSION
    ? resolveInside(root, manifest.challengeManifestFile, 'challengeManifestFile')
    : null
  const fixture = await treeManifest(fixturePath)
  await assertNoEscapingSymlinks(fixturePath, fixture)
  const prompt = await readFile(promptPath, 'utf8')
  const components = {
    manifestDigest: digestJson(manifest),
    fixtureTreeDigest: fixture.digest,
    promptDigest: sha256(prompt),
    verifierDigest: await digestFile(verifierPath),
    requirementsDigest: digestJson(evaluationContract.requirements),
    verificationCatalogDigest: digestJson(evaluationContract.verificationCatalog),
    publicCheckContractDigest: digestJson(manifest.publicChecks),
    allowedBoundaryDigest: digestJson({
      allowedPaths: manifest.allowedPaths,
      forbiddenPaths: manifest.forbiddenPaths
    }),
    ...(challengeManifestPath
      ? { challengeManifestDigest: await digestFile(challengeManifestPath) }
      : {})
  }
  return {
    root,
    manifest,
    evaluationContract,
    fixturePath,
    promptPath,
    verifierPath,
    challengeManifestPath,
    prompt,
    fixture,
    components
  }
}

export function validateCaseManifest(manifest) {
  if (!SUPPORTED_QUALIFICATION_CASE_SCHEMA_VERSIONS.includes(manifest?.schemaVersion)) {
    throw new Error('qualification case manifest schemaVersion must be 2 or 3')
  }
  if (manifest.schemaVersion === QUALIFICATION_CASE_SCHEMA_VERSION) {
    validateV036Schema('qualification-case-manifest-v3.schema.json', manifest)
    validateEvaluationContract(manifest)
    return
  }
  if (!/^(?:(?:CAL|DEMO)-[0-9]{3}|TQ[0-9]{3})$/.test(manifest.id ?? '')) throw new Error('qualification case id is invalid')
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) throw new Error('qualification case version is invalid')
  if (!['demo', 'formal'].includes(manifest.visibility)) throw new Error('qualification case visibility is invalid')
  for (const field of ['fixtureDirectory', 'promptFile', 'verifierFile']) validateRelativeLocator(manifest[field], field)
  if (!Array.isArray(manifest.tags) || manifest.tags.length === 0) throw new Error('qualification case tags are required')
  if (!Array.isArray(manifest.publicChecks)) throw new Error('qualification case publicChecks must be an array')
  for (const check of manifest.publicChecks) {
    if (typeof check?.checkId !== 'string' || !Array.isArray(check.command) || check.command.length === 0) {
      throw new Error('qualification public check is invalid')
    }
  }
  if (!Array.isArray(manifest.allowedPaths) || !Array.isArray(manifest.forbiddenPaths)) {
    throw new Error('qualification change boundaries are required')
  }
  const budget = manifest.budget
  if (!Number.isInteger(budget?.elapsedSeconds) || budget.elapsedSeconds < 1
      || !Number.isInteger(budget?.maxAgentRuns) || budget.maxAgentRuns < 1
      || !Number.isInteger(budget?.maxAcceptedA2a) || budget.maxAcceptedA2a < 0
      || budget.maxAcceptedA2a > budget.maxAgentRuns - 1) {
    throw new Error('qualification case budget is invalid')
  }
  if (manifest.collaboration !== undefined) validateCollaborationContract(manifest.collaboration, budget)
  validateEvaluationContract(manifest)
}

function validateCollaborationContract(contract, budget) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('qualification collaboration contract must be an object')
  }
  const members = contract.requiredMemberIds
  if (!Array.isArray(members) || members.length < 2
      || new Set(members).size !== members.length
      || members.some((member) => typeof member !== 'string' || !/^agent-[a-z0-9-]+$/.test(member))) {
    throw new Error('qualification collaboration requiredMemberIds are invalid')
  }
  for (const field of [
    'minAcceptedMemberCalls',
    'minCompletedTasks'
  ]) {
    if (!Number.isInteger(contract[field]) || contract[field] < 0) {
      throw new Error(`qualification collaboration ${field} is invalid`)
    }
  }
  if (contract.minAcceptedMemberCalls > budget.maxAcceptedA2a) {
    throw new Error('qualification collaboration contract exceeds the case budget')
  }
  for (const field of [
    'requireAllMemberCallsSettled',
    'requireAllTasksCompleted',
    'forbidPolling'
  ]) {
    if (typeof contract[field] !== 'boolean') {
      throw new Error(`qualification collaboration ${field} must be boolean`)
    }
  }
}

export function computeCaseSeal(contract, referenceEvidenceDigest) {
  if (contract.manifest.schemaVersion !== QUALIFICATION_CASE_SCHEMA_V2) {
    throw new Error('legacy Case Seal computation only supports schemaVersion 2')
  }
  const sealInput = {
    schemaVersion: QUALIFICATION_SCHEMA_VERSION,
    caseId: contract.manifest.id,
    caseVersion: contract.manifest.version,
    tags: contract.manifest.tags,
    budget: contract.manifest.budget,
    toolchain: contract.manifest.toolchain,
    expectedInitialFailureCheckIds: contract.evaluationContract.expectedInitialFailureCheckIds,
    ...contract.components,
    referenceEvidenceDigest
  }
  return { seal: digestJson(sealInput), sealInput }
}

export function evaluateChangeBoundary(manifest, diff) {
  if (!diff) {
    return {
      passed: false,
      violations: [{ path: null, reason: 'final_workspace_unavailable' }]
    }
  }
  const violations = []
  for (const change of diff.changed) {
    const path = change.path
    if (matchesAny(path, manifest.forbiddenPaths)) {
      violations.push({ path, reason: 'forbidden_path' })
    } else if (change.after?.type !== 'directory' && !matchesAny(path, manifest.allowedPaths)) {
      violations.push({ path, reason: 'outside_allowed_paths' })
    }
  }
  return { passed: violations.length === 0, violations }
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/**')) {
      return path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2))
    }
    return path === pattern
  })
}

export async function verifyStoredCaseSeal(caseDirectory, expectedSeal = null) {
  const contract = await readCaseContract(caseDirectory)
  if (contract.manifest.schemaVersion === QUALIFICATION_CASE_SCHEMA_VERSION) {
    const { verifyStoredV3CaseSeal } = await import('./qualification-case-v3.mjs')
    return verifyStoredV3CaseSeal(contract, expectedSeal)
  }
  const sealRecord = JSON.parse(await readFile(join(contract.root, 'case-seal.json'), 'utf8'))
  const admission = JSON.parse(await readFile(join(contract.root, 'admission.json'), 'utf8'))
  const computed = computeCaseSeal(contract, admission.referenceEvidenceDigest)
  if (sealRecord.schemaVersion !== QUALIFICATION_SCHEMA_VERSION
      || sealRecord.caseId !== contract.manifest.id
      || sealRecord.caseVersion !== contract.manifest.version
      || sealRecord.seal !== computed.seal
      || canonicalJson(sealRecord.sealInput) !== canonicalJson(computed.sealInput)
      || admission.schemaVersion !== QUALIFICATION_SCHEMA_VERSION
      || admission.caseId !== contract.manifest.id
      || admission.caseVersion !== contract.manifest.version
      || admission.caseSeal !== computed.seal
      || admission.referenceEvidence?.schemaVersion !== QUALIFICATION_SCHEMA_VERSION
      || admission.referenceEvidenceDigest !== digestJson(admission.referenceEvidence)
      || (expectedSeal && expectedSeal !== computed.seal)
      || admission.admissionDigest !== digestJson(Object.fromEntries(
        Object.entries(admission).filter(([key]) => key !== 'admissionDigest')
      ))) {
    throw new Error(`qualification case seal mismatch for ${contract.manifest.id}`)
  }
  return { contract, sealRecord, admission, seal: computed.seal }
}

export async function runCaseVerifier(verifierPath, workspacePath, options = {}) {
  const verifierWorkspacePath = options.hermetic ? await realpath(workspacePath) : workspacePath
  const beforeManifest = await treeManifest(verifierWorkspacePath)
  const environment = options.hermetic
    ? null
    : await createQualificationExecutionEnvironment(workspacePath, options.envOverrides)
  let result
  try {
    result = options.hermetic
      ? await runHermeticNode(['node', verifierPath, verifierWorkspacePath], {
          workspacePath: verifierWorkspacePath,
          readPaths: [verifierPath],
          timeoutMs: options.timeoutMs ?? HERMETIC_VERIFICATION_PROFILE.verifierTimeoutMs,
          maxOutputBytes: options.maxOutputBytes ?? HERMETIC_VERIFICATION_PROFILE.maxOutputBytes
        })
      : await runCaptured(process.execPath, [verifierPath, verifierWorkspacePath], {
          cwd: verifierWorkspacePath,
          env: environment,
          timeoutMs: options.timeoutMs ?? 180_000,
          maxOutputBytes: options.maxOutputBytes ?? 2 * 1024 * 1024
        })
  } catch (error) {
    return {
      ...validateVerifierObservation({
        process: null,
        output: null,
        parseError: error
      }, options.verificationCatalog ?? []),
      output: null,
      rawOutputDigest: null
    }
  }
  let output = null
  let parseError = null
  try {
    output = JSON.parse(result.stdout.trim())
  } catch (error) {
    parseError = error
  }
  const processObservation = {
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      outputOverflow: result.outputOverflow,
      stdoutDigest: sha256(result.stdout),
      stderrDigest: sha256(result.stderr)
  }
  const validated = validateVerifierObservation({
    process: processObservation,
    output,
    parseError
  }, options.verificationCatalog ?? [])
  const afterManifest = await treeManifest(verifierWorkspacePath)
  if (result.outputOverflow || beforeManifest.digest !== afterManifest.digest) {
    return {
      validationState: 'invalid',
      validationErrors: [
        ...validated.validationErrors,
        ...(result.outputOverflow ? [{ code: 'verifier.output_overflow' }] : []),
        ...(beforeManifest.digest !== afterManifest.digest
          ? [{ code: 'verifier.workspace_mutated', detail: treeDiff(beforeManifest, afterManifest).digest }]
          : [])
      ],
      process: validated.process,
      checkResults: [],
      output: null,
      rawOutputDigest: sha256(result.stdout)
    }
  }
  return {
    ...validated,
    output: validated.validationState === 'valid' ? output : null,
    rawOutputDigest: sha256(result.stdout)
  }
}

export async function makeTemporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function removeTemporaryDirectory(path) {
  await rm(path, { recursive: true, force: true })
}

export async function assertNoGitMetadata(fixturePath) {
  if (await exists(join(fixturePath, '.git'))) throw new Error('qualification fixture must not contain .git metadata')
}

export async function assertNoAbsolutePathLeak(root) {
  const manifest = await treeManifest(root)
  for (const entry of manifest.entries) {
    if (entry.type !== 'file' || entry.bytes > 2 * 1024 * 1024) continue
    const body = await readFile(join(root, entry.path), 'utf8').catch(() => '')
    if (body.includes('/Users/') || body.includes('/home/')) {
      throw new Error(`qualification fixture contains an absolute home path: ${entry.path}`)
    }
  }
}

export async function assertNoEscapingSymlinks(root, manifest = null) {
  const absoluteRoot = resolve(root)
  const observed = manifest ?? await treeManifest(absoluteRoot)
  for (const entry of observed.entries) {
    if (entry.type !== 'symlink') continue
    const linkPath = join(absoluteRoot, entry.path)
    const lexicalTarget = resolve(dirname(linkPath), entry.target)
    if (lexicalTarget !== absoluteRoot && !lexicalTarget.startsWith(`${absoluteRoot}${sep}`)) {
      throw new Error(`qualification workspace contains an escaping symlink: ${entry.path}`)
    }
    const resolvedTarget = await realpath(linkPath).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (resolvedTarget
        && resolvedTarget !== absoluteRoot
        && !resolvedTarget.startsWith(`${absoluteRoot}${sep}`)) {
      throw new Error(`qualification workspace symlink resolves outside the workspace: ${entry.path}`)
    }
  }
}

export async function acquireExclusiveFile(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const handle = await open(path, 'wx', 0o600)
  return {
    async release() {
      await handle.close()
      await rm(path, { force: true })
    }
  }
}

export function safeLabel(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9._-]/g, '_')
}
