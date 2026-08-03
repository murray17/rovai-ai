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
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

export const QUALIFICATION_SCHEMA_VERSION = 1
export const QUALIFICATION_RUNNER_VERSION = '0.32.6'

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

export async function treeManifest(root, { excludeGit = true } = {}) {
  const absoluteRoot = resolve(root)
  const entries = []
  await walk(absoluteRoot, '')
  const digest = digestJson(entries)
  return { schemaVersion: 1, digest, entries }

  async function walk(directory, relativeDirectory) {
    const names = await readdir(directory)
    names.sort()
    for (const name of names) {
      if (excludeGit && relativeDirectory === '' && name === '.git') continue
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
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk])
      return next.length > maxOutputBytes ? next.subarray(next.length - maxOutputBytes) : next
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
  const root = await realpath(resolve(caseDirectory))
  const manifestPath = join(root, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  validateCaseManifest(manifest)
  const fixturePath = resolveInside(root, manifest.fixtureDirectory, 'fixtureDirectory')
  const promptPath = resolveInside(root, manifest.promptFile, 'promptFile')
  const verifierPath = resolveInside(root, manifest.verifierFile, 'verifierFile')
  const fixture = await treeManifest(fixturePath)
  const prompt = await readFile(promptPath, 'utf8')
  const components = {
    manifestDigest: digestJson(manifest),
    fixtureTreeDigest: fixture.digest,
    promptDigest: sha256(prompt),
    verifierDigest: await digestFile(verifierPath),
    publicCheckContractDigest: digestJson(manifest.publicChecks),
    allowedBoundaryDigest: digestJson({
      allowedPaths: manifest.allowedPaths,
      forbiddenPaths: manifest.forbiddenPaths
    })
  }
  return { root, manifest, fixturePath, promptPath, verifierPath, prompt, fixture, components }
}

export function validateCaseManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error('qualification case manifest schemaVersion must be 1')
  if (!/^(?:(?:CAL|DEMO)-[0-9]{3}|TQ[0-9]{3})$/.test(manifest.id ?? '')) throw new Error('qualification case id is invalid')
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) throw new Error('qualification case version is invalid')
  if (!['demo', 'formal'].includes(manifest.visibility)) throw new Error('qualification case visibility is invalid')
  for (const field of ['fixtureDirectory', 'promptFile', 'verifierFile']) validateRelativeLocator(manifest[field], field)
  if (!Array.isArray(manifest.tags) || manifest.tags.length === 0) throw new Error('qualification case tags are required')
  if (!Array.isArray(manifest.publicChecks)) throw new Error('qualification case publicChecks must be an array')
  for (const check of manifest.publicChecks) {
    if (typeof check?.name !== 'string' || !Array.isArray(check.command) || check.command.length === 0) {
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
    'requireNoOpenHandoff',
    'requireAllTasksCompleted',
    'forbidPolling'
  ]) {
    if (typeof contract[field] !== 'boolean') {
      throw new Error(`qualification collaboration ${field} must be boolean`)
    }
  }
}

export function computeCaseSeal(contract, referenceEvidenceDigest) {
  const sealInput = {
    schemaVersion: 1,
    caseId: contract.manifest.id,
    caseVersion: contract.manifest.version,
    tags: contract.manifest.tags,
    budget: contract.manifest.budget,
    toolchain: contract.manifest.toolchain,
    expectedInitialFailureCategory: contract.manifest.expectedInitialFailureCategory,
    ...contract.components,
    referenceEvidenceDigest
  }
  return { seal: digestJson(sealInput), sealInput }
}

export async function verifyStoredCaseSeal(caseDirectory, expectedSeal = null) {
  const contract = await readCaseContract(caseDirectory)
  const sealRecord = JSON.parse(await readFile(join(contract.root, 'case-seal.json'), 'utf8'))
  const admission = JSON.parse(await readFile(join(contract.root, 'admission.json'), 'utf8'))
  const computed = computeCaseSeal(contract, admission.referenceEvidenceDigest)
  if (sealRecord.schemaVersion !== 1
      || sealRecord.caseId !== contract.manifest.id
      || sealRecord.caseVersion !== contract.manifest.version
      || sealRecord.seal !== computed.seal
      || admission.caseSeal !== computed.seal
      || (expectedSeal && expectedSeal !== computed.seal)
      || admission.admissionDigest !== digestJson(Object.fromEntries(
        Object.entries(admission).filter(([key]) => key !== 'admissionDigest')
      ))) {
    throw new Error(`qualification case seal mismatch for ${contract.manifest.id}`)
  }
  return { contract, sealRecord, admission, seal: computed.seal }
}

export async function runCaseVerifier(verifierPath, workspacePath, options = {}) {
  const result = await runCaptured(process.execPath, [verifierPath, workspacePath], {
    cwd: workspacePath,
    env: options.env,
    timeoutMs: options.timeoutMs ?? 180_000,
    maxOutputBytes: 2 * 1024 * 1024
  })
  let output = null
  try {
    output = JSON.parse(result.stdout.trim())
  } catch (error) {
    throw new Error(`qualification verifier returned invalid JSON: ${error.message}; stderr=${result.stderr.slice(-2000)}`)
  }
  if (output?.schemaVersion !== 1
      || typeof output.verifiedDelivery !== 'boolean'
      || !Array.isArray(output.categories)) {
    throw new Error('qualification verifier result does not match schema v1')
  }
  return {
    output,
    process: {
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      stdoutDigest: sha256(result.stdout),
      stderrDigest: sha256(result.stderr)
    }
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
