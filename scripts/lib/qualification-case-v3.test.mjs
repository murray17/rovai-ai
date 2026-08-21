import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  digestFile,
  readCaseContract,
  runHermeticNode,
  sha256,
  verifyStoredCaseSeal
} from './qualification-common.mjs'
import {
  admitV3Case,
  runV3PublicChecks
} from './qualification-case-v3.mjs'
import {
  buildQualificationCaseArtifact,
  buildVerificationCatalogArtifact
} from './qualification-artifacts.mjs'
import { validateCatalogedQualificationArtifact } from './qualification-schema-validation.mjs'

const CASE_ID = 'DC-900'
const CASE_STEM = 'DC900'

test('Case v3 admission proves initial, reference, Mutants, hermetic checks, and seal binding', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-case-v3-test-')))
  await chmod(root, 0o700)
  try {
    await buildPrivateCasePack(root)
    const contract = await readCaseContract(root)
    const admitted = await admitV3Case(contract)

    assert.equal(admitted.ok, true)
    assert.equal(admitted.challengeMutants, 3)
    assert.deepEqual(admitted.sealedMaterialIds, [
      'MUT-DC900-DOMAIN',
      'MUT-DC900-OVERFIT',
      'MUT-DC900-REGRESSION',
      'challenge-manifest',
      'reference',
      'verifier'
    ])

    const verified = await verifyStoredCaseSeal(root, admitted.caseSeal)
    assert.equal(`sha256:${verified.seal}`, admitted.caseSeal)

    const artifactResult = {
      trialId: 'trial-v3-artifact-test',
      plannedSlotId: 'slot-v3-artifact-test',
      case: { id: CASE_ID, seal: verified.seal },
      isolationProfile: { status: 'not_applicable' }
    }
    const caseArtifact = buildQualificationCaseArtifact({
      result: artifactResult,
      caseRecord: verified,
      producerDigest: 'a'.repeat(64)
    })
    const catalogArtifact = buildVerificationCatalogArtifact({
      result: artifactResult,
      caseRecord: verified,
      producerDigest: 'a'.repeat(64)
    })
    assert.equal(caseArtifact.schemaVersion, '1.1.0')
    assert.equal(catalogArtifact.schemaVersion, '1.2.0')
    validateCatalogedQualificationArtifact(caseArtifact)
    validateCatalogedQualificationArtifact(catalogArtifact)

    const referenceWorkspace = join(root, 'sealed/reference')
    const publicOutcomes = await runV3PublicChecks(contract, referenceWorkspace)
    assert.deepEqual(publicOutcomes.map(({ checkId, observed }) => ({ checkId, observed })), [
      { checkId: 'CHK-DC900-R1-PUBLIC', observed: 'pass' },
      { checkId: 'CHK-DC900-R2-PUBLIC', observed: 'pass' },
      { checkId: 'CHK-DC900-R3-PUBLIC', observed: 'pass' },
      { checkId: 'CHK-DC900-R4-PUBLIC', observed: 'pass' },
      { checkId: 'CHK-DC900-R5-REGRESSION', observed: 'pass' }
    ])

    await writePrivate(
      join(root, 'sealed/mutants/overfit/src/solution.mjs'),
      `${overfitSource()}\n// post-admission tamper\n`
    )
    await assert.rejects(verifyStoredCaseSeal(root, admitted.caseSeal), /seal mismatch/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Case v3 rejects legacy fields, invalid topology, weak permissions, and a symlinked Pack root', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'rovai-case-v3-test-negative-')))
  await chmod(parent, 0o700)
  const root = join(parent, 'pack')
  await mkdir(root, { mode: 0o700 })
  try {
    await buildPrivateCasePack(root)
    const manifestPath = join(root, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

    await writePrivate(manifestPath, `${JSON.stringify({
      ...manifest,
      collaboration: { required: true }
    }, null, 2)}\n`)
    await assert.rejects(readCaseContract(root), /schema validation failed|additional/i)

    await writePrivate(manifestPath, `${JSON.stringify({
      ...manifest,
      requirements: manifest.requirements.slice(0, 5)
    }, null, 2)}\n`)
    await assert.rejects(readCaseContract(root), /schema validation failed|items/i)

    await writePrivate(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    if (process.platform !== 'win32') {
      await chmod(manifestPath, 0o644)
      await assert.rejects(
        admitV3Case(await readCaseContract(root)),
        /0600|current-user-only|permission|unsafe mode/i
      )
      await chmod(manifestPath, 0o600)
    }
    const linkedRoot = join(parent, 'linked-pack')
    await symlink(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(readCaseContract(linkedRoot), /must not traverse a symlink/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('Hermetic Node verification denies writes outside its per-check temporary directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermetic-negative-')))
  await chmod(root, 0o700)
  try {
    await writeFile(join(root, 'attempt-write.mjs'), [
      "import { writeFile } from 'node:fs/promises'",
      "await writeFile('../forbidden-output.txt', 'forbidden')",
      ''
    ].join('\n'), { mode: 0o600 })
    const run = await runHermeticNode(['node', 'attempt-write.mjs'], {
      workspacePath: root,
      timeoutMs: 10_000
    })
    assert.notEqual(run.code, 0)
    assert.match(`${run.stdout}\n${run.stderr}`, /ERR_ACCESS_DENIED/)
    assert.equal(run.workspaceMutated, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function buildPrivateCasePack(root) {
  const fixtureSource = initialSource()
  const referenceSource = correctSource()
  const paths = {
    fixture: join(root, 'fixture'),
    reference: join(root, 'sealed/reference'),
    verifier: join(root, 'sealed/verifier.mjs'),
    challenge: join(root, 'sealed/challenge.json')
  }

  await writePrivate(join(root, 'prompt.md'), [
    '# Goal',
    'Implement all six disclosed requirements.',
    'Run the five public Node.js test commands from case.json.',
    'Only change src/** and tests/agent/**.'
  ].join('\n'))
  await writeWorkspace(paths.fixture, fixtureSource)
  await writeWorkspace(paths.reference, referenceSource)
  await writePrivate(join(paths.reference, '.rovai-sealed-canary'), canary('REFERENCE'))

  const mutants = [
    {
      mutantId: 'MUT-DC900-OVERFIT',
      faultClass: 'public_overfit',
      name: 'overfit',
      source: overfitSource(),
      expectedFailingCheckIds: ['CHK-DC900-R1-WITHHELD']
    },
    {
      mutantId: 'MUT-DC900-DOMAIN',
      faultClass: 'domain_edge',
      name: 'domain',
      source: domainEdgeSource(),
      expectedFailingCheckIds: ['CHK-DC900-R2-WITHHELD']
    },
    {
      mutantId: 'MUT-DC900-REGRESSION',
      faultClass: 'regression_or_boundary',
      name: 'regression',
      source: regressionSource(),
      expectedFailingCheckIds: ['CHK-DC900-R5-REGRESSION']
    }
  ]
  for (const mutant of mutants) {
    const directory = join(root, `sealed/mutants/${mutant.name}`)
    await writePrivate(join(directory, 'src/solution.mjs'), mutant.source)
    await writePrivate(join(directory, '.rovai-sealed-canary'), canary(mutant.name.toUpperCase()))
  }

  const verifier = verifierSource()
  await writePrivate(paths.verifier, verifier)
  const verificationPairs = []
  for (let index = 1; index <= 4; index += 1) {
    const requirementId = `REQ-${CASE_STEM}-R${index}`
    verificationPairs.push({
      requirementId,
      publicCheckId: `CHK-${CASE_STEM}-R${index}-PUBLIC`,
      withheldCheckIds: [`CHK-${CASE_STEM}-R${index}-WITHHELD`],
      publicAssertionDigest: `sha256:${await digestFile(join(paths.fixture, `tests/public/r${index}.test.mjs`))}`,
      withheldAssertionDigest: `sha256:${sha256(withheldSection(verifier, requirementId))}`
    })
  }
  const challenge = {
    schemaVersion: 1,
    caseId: CASE_ID,
    caseVersion: '1.0.0',
    manifestCanary: canary('MANIFEST'),
    referenceCanaryFile: 'sealed/reference/.rovai-sealed-canary',
    verifierCanary: canary('VERIFIER'),
    verificationPairs,
    mutants: mutants.map((mutant) => ({
      mutantId: mutant.mutantId,
      faultClass: mutant.faultClass,
      directory: `sealed/mutants/${mutant.name}`,
      canaryFile: `sealed/mutants/${mutant.name}/.rovai-sealed-canary`,
      expectedFailingCheckIds: mutant.expectedFailingCheckIds
    }))
  }
  await writePrivate(paths.challenge, `${JSON.stringify(challenge, null, 2)}\n`)
  await writePrivate(join(root, 'manifest.json'), `${JSON.stringify(caseManifest(), null, 2)}\n`)
}

function caseManifest() {
  const categories = [
    'workstream_a',
    'workstream_b',
    'workstream_c',
    'integration',
    'regression',
    'change_boundary'
  ]
  const requirements = categories.map((categoryId, index) => ({
    requirementId: `REQ-${CASE_STEM}-R${index + 1}`,
    criticality: index === 5 ? 'non_critical' : 'critical',
    categoryId,
    statement: `Disclosed requirement R${index + 1}`
  }))
  const verificationCatalog = []
  for (let index = 1; index <= 4; index += 1) {
    verificationCatalog.push(catalogCheck(index, 'PUBLIC', 'runner', 'public_check', 'public'))
    verificationCatalog.push(catalogCheck(index, 'WITHHELD', 'verifier', null, 'withheld'))
  }
  verificationCatalog.push(catalogCheck(5, 'REGRESSION', 'runner', 'public_check', 'public'))
  verificationCatalog.push(catalogCheck(6, 'BOUNDARY', 'runner', 'change_boundary', 'public'))
  const publicChecks = [1, 2, 3, 4].map((index) => ({
    checkId: `CHK-${CASE_STEM}-R${index}-PUBLIC`,
    initialExpectation: 'fail',
    command: ['node', '--test', '--test-concurrency=1', `tests/public/r${index}.test.mjs`]
  }))
  publicChecks.push({
    checkId: `CHK-${CASE_STEM}-R5-REGRESSION`,
    initialExpectation: 'pass',
    command: [
      'node',
      '--test',
      '--test-concurrency=1',
      'tests/public/r5.test.mjs',
      'tests/agent/**/*.test.mjs'
    ]
  })
  return {
    schemaVersion: 3,
    id: CASE_ID,
    version: '1.0.0',
    visibility: 'diagnostic',
    title: 'Synthetic v3 admission fixture',
    tags: ['collaboration-value', 'diagnostic', 'synthetic'],
    fixtureDirectory: 'fixture',
    promptFile: 'prompt.md',
    verifierFile: 'sealed/verifier.mjs',
    referenceDirectory: 'sealed/reference',
    challengeManifestFile: 'sealed/challenge.json',
    requirements,
    verificationCatalog,
    expectedInitialFailureCheckIds: verificationCatalog
      .filter((check) => Number(check.requirementIds[0].at(-1)) <= 4)
      .map((check) => check.checkId),
    publicChecks,
    allowedPaths: ['src/**', 'tests/agent/**'],
    forbiddenPaths: ['tests/public/**', 'fixtures/**', 'package.json', 'README.md'],
    temporalWritePolicy: 'final_tree',
    toolchain: {
      runtime: 'node',
      minimumMajorVersion: 26,
      verificationProfileVersion: 1,
      publicCheckTimeoutMs: 30000,
      verifierTimeoutMs: 60000,
      maxOutputBytes: 1048576
    },
    budget: { elapsedSeconds: 900, maxAgentRuns: 8, maxAcceptedA2a: 7 }
  }

  function catalogCheck(index, suffix, observationAuthority, runnerCheck, disclosure) {
    return {
      checkId: `CHK-${CASE_STEM}-R${index}-${suffix}`,
      kind: 'hard',
      observationAuthority,
      runnerCheck,
      categoryId: categories[index - 1],
      requirementIds: [`REQ-${CASE_STEM}-R${index}`],
      disclosure,
      prerequisiteCheckIds: []
    }
  }
}

async function writeWorkspace(directory, source) {
  await writePrivate(join(directory, 'src/solution.mjs'), source)
  for (let index = 1; index <= 5; index += 1) {
    await writePrivate(join(directory, `tests/public/r${index}.test.mjs`), publicTestSource(index))
  }
  await writePrivate(join(directory, 'tests/agent/baseline.test.mjs'), [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    "test('agent test discovery baseline', () => assert.equal(2 + 2, 4))",
    ''
  ].join('\n'))
  await writePrivate(join(directory, 'package.json'), '{"type":"module"}\n')
  await writePrivate(join(directory, 'README.md'), 'Protected fixture documentation.\n')
  await writePrivate(join(directory, 'fixtures/input.json'), '{}\n')
}

function publicTestSource(index) {
  const assertions = {
    1: "assert.equal(normalizeEvent({ version: 1, type: 'Created' }), 'v1:created')",
    2: "const state = new Map(); assert.equal(reserveOnce('A', state), true); assert.equal(reserveOnce('A', state), false)",
    3: "assert.deepEqual(migrateState({ version: 1, name: 'Ada' }), { version: 2, userName: 'Ada' })",
    4: "assert.deepEqual(integrate({ event: 'v1:created', reserved: true, userName: 'Ada' }), { key: 'v1:created:Ada', accepted: true })",
    5: "assert.equal(legacyChecksum('abc'), 294)"
  }
  return [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    `import { ${functionName(index)} } from '../../src/solution.mjs'`,
    `test('R${index} public behavior', () => { ${assertions[index]} })`,
    ''
  ].join('\n')
}

function functionName(index) {
  return ['normalizeEvent', 'reserveOnce', 'migrateState', 'integrate', 'legacyChecksum'][index - 1]
}

function verifierSource() {
  return `// ${canary('VERIFIER')}
import { pathToFileURL } from 'node:url'
const workspace = process.argv[2]
const module = await import(pathToFileURL(\`${'${workspace}'}/src/solution.mjs\`).href)
const checks = []
function check(checkId, probe) {
  let passed = false
  try { passed = probe() === true } catch {}
  checks.push({
    checkId,
    status: passed ? 'passed' : 'failed',
    evidence: [{ code: passed ? 'withheld.passed' : 'withheld.failed', summary: passed ? 'Withheld behavior passed.' : 'Withheld behavior failed.' }]
  })
}
// ROVAI-WITHHELD-BEGIN:REQ-DC900-R1
check('CHK-DC900-R1-WITHHELD', () => module.normalizeEvent({ version: 2, type: '  UPDATED ' }) === 'v2:updated')
// ROVAI-WITHHELD-END:REQ-DC900-R1
// ROVAI-WITHHELD-BEGIN:REQ-DC900-R2
check('CHK-DC900-R2-WITHHELD', () => { const state = new Map(); return module.reserveOnce(' Key ', state) && !module.reserveOnce('key', state) })
// ROVAI-WITHHELD-END:REQ-DC900-R2
// ROVAI-WITHHELD-BEGIN:REQ-DC900-R3
check('CHK-DC900-R3-WITHHELD', () => JSON.stringify(module.migrateState({ version: 0, label: 'Lin' })) === JSON.stringify({ version: 2, userName: 'Lin' }))
// ROVAI-WITHHELD-END:REQ-DC900-R3
// ROVAI-WITHHELD-BEGIN:REQ-DC900-R4
check('CHK-DC900-R4-WITHHELD', () => JSON.stringify(module.integrate({ event: 'v2:updated', reserved: false, userName: 'Lin' })) === JSON.stringify({ key: 'v2:updated:Lin', accepted: false }))
// ROVAI-WITHHELD-END:REQ-DC900-R4
process.stdout.write(JSON.stringify({ schemaVersion: 2, checks }))
`
}

function initialSource() {
  return `
export function normalizeEvent() { return null }
export function reserveOnce() { return null }
export function migrateState() { return null }
export function integrate() { return null }
export function legacyChecksum(value) { return [...value].reduce((sum, character) => sum + character.codePointAt(0), 0) }
`
}

function correctSource() {
  return solutionSource({ normalizeMode: 'correct', reserveMode: 'correct', regression: false })
}

function overfitSource() {
  return solutionSource({ normalizeMode: 'overfit', reserveMode: 'correct', regression: false })
}

function domainEdgeSource() {
  return solutionSource({ normalizeMode: 'correct', reserveMode: 'exact', regression: false })
}

function regressionSource() {
  return solutionSource({ normalizeMode: 'correct', reserveMode: 'correct', regression: true })
}

function solutionSource({ normalizeMode, reserveMode, regression }) {
  const normalize = normalizeMode === 'correct'
    ? "return `v${event.version}:${event.type.trim().toLowerCase()}`"
    : "if (event.version === 1 && event.type === 'Created') return 'v1:created'; return null"
  const reserveKey = reserveMode === 'correct' ? 'key.trim().toLowerCase()' : 'key'
  return `
export function normalizeEvent(event) { ${normalize} }
export function reserveOnce(key, state) { const normalized = ${reserveKey}; if (state.has(normalized)) return false; state.set(normalized, true); return true }
export function migrateState(input) { if (input.version === 0) return { version: 2, userName: input.label }; return { version: 2, userName: input.name } }
export function integrate(input) { return { key: \`${'${input.event}'}:${'${input.userName}'}\`, accepted: input.reserved } }
export function legacyChecksum(value) { return ${regression ? '-1' : '[...value].reduce((sum, character) => sum + character.codePointAt(0), 0)'} }
`
}

async function writePrivate(path, content) {
  const directory = path.slice(0, path.lastIndexOf('/'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  await writeFile(path, content, { mode: 0o600 })
  await chmod(path, 0o600)
  await hardenParents(directory)
}

async function hardenParents(directory) {
  let current = directory
  while (current && current !== '/') {
    await chmod(current, 0o700)
    if (current.includes('rovai-case-v3-test-')) break
    current = current.slice(0, current.lastIndexOf('/'))
  }
}

function canary(label) {
  return `SCM-${label}-0123456789abcdefghijklmnop`
}

function withheldSection(source, requirementId) {
  const begin = `// ROVAI-WITHHELD-BEGIN:${requirementId}\n`
  const end = `// ROVAI-WITHHELD-END:${requirementId}`
  return source.slice(source.indexOf(begin), source.indexOf(end) + end.length)
}
