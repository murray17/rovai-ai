import { cp, lstat, readFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  canonicalJson,
  copyFixture,
  digestFile,
  digestJson,
  evaluateChangeBoundary,
  hermeticVerificationProfileDigest,
  makeTemporaryDirectory,
  removeTemporaryDirectory,
  runCaseVerifier,
  runHermeticNode,
  sha256,
  treeDiff,
  treeManifest,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import {
  buildRunnerCheckResults,
  deriveDeliveryEvidence
} from './qualification-evaluation.mjs'
import { validateV036Schema } from './qualification-v036-schema-validation.mjs'

export const V3_NON_LEAKAGE_POLICY = Object.freeze({
  schemaVersion: 1,
  coverage: 'delivered_workspace_and_all_retained_or_exported_trial_artifacts',
  matchers: [
    'sealed_canary',
    'private_pack_path',
    'private_pack_basename',
    'private_locator',
    'forbidden_field',
    'credential_pattern'
  ],
  matchOutcome: 'irrecoverable_portfolio_incomplete',
  cleanOutcomeClaim: 'no_observed_leak_not_formal_isolation'
})

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const CANARY_FILE = '.rovai-sealed-canary'
const REQUIRED_FAULT_CLASSES = new Set([
  'public_overfit',
  'domain_edge',
  'regression_or_boundary'
])

export async function admitV3Case(contract) {
  if (contract.manifest.schemaVersion !== 3) throw new Error('v3 admission requires schemaVersion 3')
  await assertPrivateV3CasePack(contract)
  const challenge = await readChallengeManifest(contract)
  const canaries = await readSealedMaterialCanaries(contract, challenge)
  const temporaryRoot = await makeTemporaryDirectory(`rovai-qualification-v3-${contract.manifest.id}-`)
  try {
    const initial = await evaluatePair({
      contract,
      temporaryRoot,
      label: 'initial',
      overlayPath: null
    })
    assertDeterministicPair(initial, 'initial')
    const initialFailures = initial[0].failedHardCheckIds
    if (!sameStrings(initialFailures, contract.evaluationContract.expectedInitialFailureCheckIds)
        || initial[0].publicOutcomes.some((outcome) => outcome.observed !== outcome.expected)
        || initial[0].publicOutcomes.filter((outcome) => outcome.expected === 'fail').length !== 4
        || initial[0].publicOutcomes.filter((outcome) => outcome.expected === 'pass').length !== 1) {
      throw new Error('Case v3 initial fixture does not produce the exact expected failure profile')
    }

    const referencePath = resolveInsidePack(contract.root, contract.manifest.referenceDirectory, 'referenceDirectory')
    const referenceOverlayTree = await treeManifest(referencePath, { excludeTopLevel: [CANARY_FILE] })
    const reference = await evaluatePair({
      contract,
      temporaryRoot,
      label: 'reference',
      overlayPath: referencePath
    })
    assertDeterministicPair(reference, 'reference')
    if (reference[0].failedHardCheckIds.length !== 0
        || reference[0].publicOutcomes.some((outcome) => outcome.observed !== 'pass')) {
      throw new Error('Case v3 reference workspace is not an exact deterministic pass')
    }

    const mutantEvidence = []
    for (const mutant of challenge.mutants) {
      const overlayPath = resolveInsidePack(contract.root, mutant.directory, `Mutant ${mutant.mutantId} directory`)
      const materializations = await evaluatePair({
        contract,
        temporaryRoot,
        label: mutant.mutantId.toLowerCase(),
        overlayPath
      })
      assertDeterministicPair(materializations, mutant.mutantId)
      if (!sameStrings(materializations[0].failedHardCheckIds, mutant.expectedFailingCheckIds)) {
        throw new Error(`Challenge Mutant ${mutant.mutantId} did not fail exactly its declared Check IDs`)
      }
      const overlayTree = await treeManifest(overlayPath, { excludeTopLevel: [CANARY_FILE] })
      mutantEvidence.push({
        mutantId: mutant.mutantId,
        faultClass: mutant.faultClass,
        overlayTreeDigest: asDigest(overlayTree.digest),
        expectedFailingCheckIds: [...mutant.expectedFailingCheckIds].sort(),
        materializations
      })
    }
    validateMutantPortfolio(contract, mutantEvidence)

    const referenceEvidence = {
      initial,
      reference,
      referenceOverlayTreeDigest: asDigest(referenceOverlayTree.digest),
      twoMaterializationDeterministic: true
    }
    const challengeEvidence = {
      challengeManifestDigest: asDigest(contract.components.challengeManifestDigest),
      sealedMaterialCanaryDigests: canaries
        .map(({ materialId, tokenDigest }) => ({ materialId, tokenDigest }))
        .sort((left, right) => left.materialId.localeCompare(right.materialId)),
      mutants: mutantEvidence.sort((left, right) => left.mutantId.localeCompare(right.mutantId)),
      mandatoryFaultClassesPresent: true,
      publicSurvivorPresent: true,
      isolatedRegressionOrBoundaryPresent: true
    }
    const referenceEvidenceDigest = asDigest(digestJson(referenceEvidence))
    const challengeEvidenceDigest = asDigest(digestJson(challengeEvidence))
    const hermeticProfileDigest = asDigest(hermeticVerificationProfileDigest())
    const nonLeakagePolicyDigest = asDigest(digestJson(V3_NON_LEAKAGE_POLICY))
    const computed = computeV3CaseSeal(contract, {
      referenceEvidenceDigest,
      challengeEvidenceDigest,
      hermeticProfileDigest,
      nonLeakagePolicyDigest
    })
    const admissionWithoutDigest = {
      schemaVersion: 3,
      caseId: contract.manifest.id,
      caseVersion: contract.manifest.version,
      caseSeal: asDigest(computed.seal),
      referenceEvidenceDigest,
      referenceEvidence,
      challengeEvidenceDigest,
      challengeEvidence,
      hermeticProfileDigest,
      nonLeakagePolicyDigest
    }
    const admission = {
      ...admissionWithoutDigest,
      admissionDigest: asDigest(digestJson(admissionWithoutDigest))
    }
    validateV036Schema('case-admission-v3.schema.json', admission)
    await writePrivateJsonExclusive(join(contract.root, 'case-seal.json'), {
      schemaVersion: 3,
      caseId: contract.manifest.id,
      caseVersion: contract.manifest.version,
      seal: asDigest(computed.seal),
      sealInput: computed.sealInput,
      sealInputDigest: asDigest(digestJson(computed.sealInput))
    })
    await writePrivateJsonExclusive(join(contract.root, 'admission.json'), admission)
    return {
      ok: true,
      caseId: contract.manifest.id,
      caseVersion: contract.manifest.version,
      caseSeal: asDigest(computed.seal),
      admissionDigest: admission.admissionDigest,
      challengeMutants: challenge.mutants.length,
      sealedMaterialIds: canaries.map((item) => item.materialId).sort()
    }
  } finally {
    await removeTemporaryDirectory(temporaryRoot)
  }
}

export async function verifyStoredV3CaseSeal(contract, expectedSeal = null) {
  await assertPrivateV3CasePack(contract)
  const challenge = await readChallengeManifest(contract)
  const canaries = await readSealedMaterialCanaries(contract, challenge)
  const sealRecord = JSON.parse(await readFile(join(contract.root, 'case-seal.json'), 'utf8'))
  const admission = JSON.parse(await readFile(join(contract.root, 'admission.json'), 'utf8'))
  validateV036Schema('case-admission-v3.schema.json', admission)
  const referencePath = resolveInsidePack(
    contract.root,
    contract.manifest.referenceDirectory,
    'referenceDirectory'
  )
  const referenceOverlayTree = await treeManifest(referencePath, { excludeTopLevel: [CANARY_FILE] })
  const retainedMutants = new Map(admission.challengeEvidence.mutants.map((mutant) => [mutant.mutantId, mutant]))
  const mutantContentMatches = await Promise.all(challenge.mutants.map(async (mutant) => {
    const path = resolveInsidePack(contract.root, mutant.directory, `${mutant.mutantId} directory`)
    const tree = await treeManifest(path, { excludeTopLevel: [CANARY_FILE] })
    return retainedMutants.get(mutant.mutantId)?.overlayTreeDigest === asDigest(tree.digest)
  }))
  const currentCanaryDigests = canaries
    .map(({ materialId, tokenDigest }) => ({ materialId, tokenDigest }))
    .sort((left, right) => left.materialId.localeCompare(right.materialId))
  const computed = computeV3CaseSeal(contract, {
    referenceEvidenceDigest: admission.referenceEvidenceDigest,
    challengeEvidenceDigest: admission.challengeEvidenceDigest,
    hermeticProfileDigest: admission.hermeticProfileDigest,
    nonLeakagePolicyDigest: admission.nonLeakagePolicyDigest
  })
  const expected = expectedSeal ? stripDigest(expectedSeal) : null
  if (sealRecord.schemaVersion !== 3
      || sealRecord.caseId !== contract.manifest.id
      || sealRecord.caseVersion !== contract.manifest.version
      || stripDigest(sealRecord.seal) !== computed.seal
      || canonicalJson(sealRecord.sealInput) !== canonicalJson(computed.sealInput)
      || sealRecord.sealInputDigest !== asDigest(digestJson(sealRecord.sealInput))
      || admission.caseId !== contract.manifest.id
      || admission.caseVersion !== contract.manifest.version
      || stripDigest(admission.caseSeal) !== computed.seal
      || admission.referenceEvidenceDigest !== asDigest(digestJson(admission.referenceEvidence))
      || admission.challengeEvidenceDigest !== asDigest(digestJson(admission.challengeEvidence))
      || admission.referenceEvidence.referenceOverlayTreeDigest !== asDigest(referenceOverlayTree.digest)
      || mutantContentMatches.some((matches) => !matches)
      || canonicalJson(admission.challengeEvidence.sealedMaterialCanaryDigests) !== canonicalJson(currentCanaryDigests)
      || admission.hermeticProfileDigest !== asDigest(hermeticVerificationProfileDigest())
      || admission.nonLeakagePolicyDigest !== asDigest(digestJson(V3_NON_LEAKAGE_POLICY))
      || admission.admissionDigest !== asDigest(digestJson(withoutKey(admission, 'admissionDigest')))
      || (expected && expected !== computed.seal)) {
    throw new Error(`qualification Case v3 seal mismatch for ${contract.manifest.id}`)
  }
  return { contract, sealRecord, admission, seal: computed.seal }
}

export function computeV3CaseSeal(contract, evidence) {
  const sealInput = {
    schemaVersion: 3,
    caseId: contract.manifest.id,
    caseVersion: contract.manifest.version,
    visibility: contract.manifest.visibility,
    tags: contract.manifest.tags,
    budget: contract.manifest.budget,
    toolchain: contract.manifest.toolchain,
    temporalWritePolicy: contract.manifest.temporalWritePolicy,
    expectedInitialFailureCheckIds: [...contract.evaluationContract.expectedInitialFailureCheckIds].sort(),
    ...contract.components,
    referenceEvidenceDigest: evidence.referenceEvidenceDigest,
    challengeEvidenceDigest: evidence.challengeEvidenceDigest,
    hermeticProfileDigest: evidence.hermeticProfileDigest,
    nonLeakagePolicyDigest: evidence.nonLeakagePolicyDigest
  }
  return { seal: digestJson(sealInput), sealInput }
}

export async function readV3SealedMaterialIndex(contract) {
  const challenge = await readChallengeManifest(contract)
  const canaries = await readSealedMaterialCanaries(contract, challenge)
  return {
    packRoot: contract.root,
    packBasename: basename(contract.root),
    privateLocators: [
      contract.manifest.referenceDirectory,
      contract.manifest.verifierFile,
      contract.manifest.challengeManifestFile,
      ...challenge.mutants.flatMap((mutant) => [mutant.directory, mutant.canaryFile]),
      challenge.referenceCanaryFile
    ].sort(),
    canaries
  }
}

export async function runV3PublicChecks(contract, workspace) {
  if (contract.manifest.schemaVersion !== 3) return []
  const outcomes = []
  for (const check of contract.manifest.publicChecks) {
    const run = await runHermeticNode(check.command, {
      workspacePath: workspace,
      timeoutMs: contract.manifest.toolchain.publicCheckTimeoutMs,
      maxOutputBytes: contract.manifest.toolchain.maxOutputBytes
    })
    assertNormalPublicCheckProcess(check, run)
    outcomes.push({
      checkId: check.checkId,
      expected: check.initialExpectation,
      observed: run.code === 0 ? 'pass' : 'fail',
      processStatus: 'completed'
    })
  }
  return outcomes
}

async function evaluatePair({ contract, temporaryRoot, label, overlayPath }) {
  const results = []
  for (const suffix of ['a', 'b']) {
    const workspace = join(temporaryRoot, `${safeLabel(label)}-${suffix}`)
    await copyFixture(contract.fixturePath, workspace)
    if (overlayPath) await applyOverlayWithoutCanary(overlayPath, workspace)
    results.push(await evaluateMaterialization(contract, workspace))
  }
  return results
}

async function evaluateMaterialization(contract, workspace) {
  const materializedTree = await treeManifest(workspace)
  const publicOutcomes = await runV3PublicChecks(contract, workspace)
  const verifier = await runCaseVerifier(contract.verifierPath, workspace, {
    verificationCatalog: contract.evaluationContract.verificationCatalog,
    hermetic: true,
    timeoutMs: contract.manifest.toolchain.verifierTimeoutMs,
    maxOutputBytes: contract.manifest.toolchain.maxOutputBytes
  })
  if (verifier.validationState !== 'valid') {
    throw new Error(`Case v3 verifier did not complete validly: ${canonicalJson(verifier.validationErrors)}`)
  }
  const boundary = evaluateChangeBoundary(
    contract.manifest,
    treeDiff(contract.fixture, await treeManifest(workspace))
  )
  const delivery = deriveDeliveryEvidence(
    contract.evaluationContract,
    verifier,
    buildRunnerCheckResults(contract.evaluationContract.verificationCatalog, {
      changeBoundary: boundary,
      publicChecks: publicOutcomes
    })
  )
  if (delivery.verifiedDelivery === 'unavailable' || delivery.evaluationIssues.length > 0) {
    throw new Error(`Case v3 materialization produced unavailable delivery evidence: ${canonicalJson(delivery.evaluationIssues)}`)
  }
  const failedHardCheckIds = delivery.checkResults
    .filter((check) => check.kind === 'hard' && ['failed', 'blocked'].includes(check.status))
    .map((check) => check.checkId)
    .sort()
  return {
    treeDigest: asDigest(materializedTree.digest),
    publicOutcomes,
    failedHardCheckIds,
    verifierObservationDigest: asDigest(digestJson(verifier)),
    deliveryEvidenceDigest: asDigest(digestJson(delivery))
  }
}

function assertNormalPublicCheckProcess(check, run) {
  const permissionDenied = `${run.stdout}\n${run.stderr}`.includes('ERR_ACCESS_DENIED')
  if (run.timedOut
      || run.signal
      || run.outputOverflow
      || run.workspaceMutated
      || permissionDenied
      || ![0, 1].includes(run.code)) {
    throw new Error(`Case v3 public Check ${check.checkId} had an evaluator-process failure`)
  }
}

function assertDeterministicPair(pair, label) {
  if (pair.length !== 2 || canonicalJson(pair[0]) !== canonicalJson(pair[1])) {
    throw new Error(`Case v3 ${label} materializations are not deterministic`)
  }
}

function validateMutantPortfolio(contract, mutants) {
  const ids = new Set()
  const classes = new Set()
  for (const mutant of mutants) {
    if (ids.has(mutant.mutantId)) throw new Error(`duplicate Challenge Mutant ID: ${mutant.mutantId}`)
    ids.add(mutant.mutantId)
    classes.add(mutant.faultClass)
  }
  if ([...REQUIRED_FAULT_CLASSES].some((faultClass) => !classes.has(faultClass))) {
    throw new Error('Case v3 Challenge Mutants do not cover all mandatory fault classes')
  }
  const publicCheckIds = new Set(contract.manifest.publicChecks.map((check) => check.checkId))
  const hasPublicSurvivor = mutants.some((mutant) => (
    mutant.materializations[0].publicOutcomes.every((outcome) => outcome.observed === 'pass')
    && mutant.expectedFailingCheckIds.every((checkId) => !publicCheckIds.has(checkId))
  ))
  if (!hasPublicSurvivor) {
    throw new Error('Case v3 requires a Mutant that passes all public Checks and fails withheld verification')
  }
  const regressionRequirementId = `REQ-${contract.manifest.id.replace('-', '')}-R5`
  const boundaryRequirementId = `REQ-${contract.manifest.id.replace('-', '')}-R6`
  const isolatedIds = new Set(contract.evaluationContract.verificationCatalog
    .filter((check) => check.kind === 'hard'
      && check.requirementIds.some((id) => [regressionRequirementId, boundaryRequirementId].includes(id)))
    .map((check) => check.checkId))
  const regressionOrBoundary = mutants.find((mutant) => mutant.faultClass === 'regression_or_boundary')
  if (!regressionOrBoundary
      || regressionOrBoundary.expectedFailingCheckIds.some((checkId) => !isolatedIds.has(checkId))) {
    throw new Error('Case v3 regression/boundary Mutant is not isolated to R5 or R6')
  }
}

async function readChallengeManifest(contract) {
  const challenge = JSON.parse(await readFile(contract.challengeManifestPath, 'utf8'))
  validateV036Schema('challenge-manifest.schema.json', challenge)
  if (challenge.caseId !== contract.manifest.id || challenge.caseVersion !== contract.manifest.version) {
    throw new Error('Challenge Manifest binding does not match its Case')
  }
  await validateVerificationPairs(contract, challenge)
  return challenge
}

async function validateVerificationPairs(contract, challenge) {
  if ((contract.manifest.id === 'DC-004') !== (contract.manifest.temporalWritePolicy === 'workspace_root_only')) {
    throw new Error('only DC-004 may require the workspace-root temporal write policy')
  }
  const verifierSource = await readFile(contract.verifierPath, 'utf8')
  const expected = contract.manifest.requirements.slice(0, 4).map((requirement) => {
    const checks = contract.evaluationContract.verificationCatalog.filter((check) => (
      check.kind === 'hard' && check.requirementIds.includes(requirement.requirementId)
    ))
    return {
      requirementId: requirement.requirementId,
      publicCheckId: checks.find((check) => check.runnerCheck === 'public_check')?.checkId,
      withheldCheckIds: checks
        .filter((check) => check.observationAuthority === 'verifier')
        .map((check) => check.checkId)
        .sort()
    }
  })
  const actual = challenge.verificationPairs.map((pair) => ({
    requirementId: pair.requirementId,
    publicCheckId: pair.publicCheckId,
    withheldCheckIds: [...pair.withheldCheckIds].sort()
  }))
  if (canonicalJson(actual) !== canonicalJson(expected)
      || challenge.verificationPairs.some((pair) => (
        pair.publicAssertionDigest === pair.withheldAssertionDigest
      ))) {
    throw new Error('Challenge Manifest verification pairs are not exact independent boundaries')
  }
  for (const pair of challenge.verificationPairs) {
    const publicCommand = contract.manifest.publicChecks.find((check) => (
      check.checkId === pair.publicCheckId
    )).command
    const publicLocators = publicCommand.filter((part) => part.startsWith('tests/public/'))
    if (publicLocators.length !== 1) {
      throw new Error('each target public Check must bind one protected public assertion file')
    }
    const publicPath = resolveInsidePack(contract.fixturePath, publicLocators[0], 'public assertion file')
    const begin = `// ROVAI-WITHHELD-BEGIN:${pair.requirementId}\n`
    const end = `// ROVAI-WITHHELD-END:${pair.requirementId}`
    const startIndex = verifierSource.indexOf(begin)
    const endIndex = verifierSource.indexOf(end, startIndex + begin.length)
    if (startIndex < 0 || endIndex < 0 || verifierSource.indexOf(begin, startIndex + 1) >= 0) {
      throw new Error(`withheld assertion boundary is unavailable for ${pair.requirementId}`)
    }
    const withheldAssertion = verifierSource.slice(startIndex, endIndex + end.length)
    if (pair.publicAssertionDigest !== asDigest(await digestFile(publicPath))
        || pair.withheldAssertionDigest !== asDigest(sha256(withheldAssertion))) {
      throw new Error(`verification pair assertion digest mismatch for ${pair.requirementId}`)
    }
  }
}

async function readSealedMaterialCanaries(contract, challenge) {
  const canaries = [
    { materialId: 'challenge-manifest', token: challenge.manifestCanary },
    { materialId: 'verifier', token: challenge.verifierCanary }
  ]
  const verifierBytes = await readFile(contract.verifierPath, 'utf8')
  if (!verifierBytes.includes(challenge.verifierCanary)) {
    throw new Error('Withheld verifier does not carry its declared Sealed Material Canary')
  }
  const referenceCanaryPath = resolveInsidePack(
    contract.root,
    challenge.referenceCanaryFile,
    'referenceCanaryFile'
  )
  assertNestedLocator(challenge.referenceCanaryFile, contract.manifest.referenceDirectory, 'referenceCanaryFile')
  canaries.push({ materialId: 'reference', token: (await readFile(referenceCanaryPath, 'utf8')).trim() })
  for (const mutant of challenge.mutants) {
    assertNestedLocator(mutant.canaryFile, mutant.directory, `Mutant ${mutant.mutantId} canaryFile`)
    const canaryPath = resolveInsidePack(contract.root, mutant.canaryFile, `${mutant.mutantId} canaryFile`)
    canaries.push({ materialId: mutant.mutantId, token: (await readFile(canaryPath, 'utf8')).trim() })
  }
  const tokens = new Set()
  for (const canary of canaries) {
    if (!/^SCM-[A-Za-z0-9_-]{24,}$/.test(canary.token) || tokens.has(canary.token)) {
      throw new Error('Case v3 Sealed Material Canaries must be unique high-entropy tokens')
    }
    tokens.add(canary.token)
  }
  return canaries.map((canary) => ({ ...canary, tokenDigest: asDigest(sha256(canary.token)) }))
}

async function assertPrivateV3CasePack(contract) {
  const root = contract.root
  if (root === REPOSITORY_ROOT || root.startsWith(`${REPOSITORY_ROOT}${sep}`)) {
    throw new Error('Case v3 private Pack must remain outside the source repository')
  }
  const rootMetadata = await lstat(root)
  if (
    !rootMetadata.isDirectory()
    || rootMetadata.isSymbolicLink()
    || (process.platform !== 'win32' && (rootMetadata.mode & 0o777) !== 0o700)
  ) {
    throw new Error('Case v3 private Pack root must be a non-symlinked 0700 directory')
  }
  const manifest = await treeManifest(root, { excludeGit: false })
  for (const entry of manifest.entries) {
    if (entry.type === 'symlink' || entry.type === 'other') {
      throw new Error(`Case v3 private Pack contains unsupported entry: ${entry.path}`)
    }
    const expectedMode = entry.type === 'directory' ? 0o700 : 0o600
    if (process.platform !== 'win32' && entry.mode !== expectedMode) {
      throw new Error(`Case v3 private Pack entry has unsafe mode: ${entry.path}`)
    }
  }
}

async function applyOverlayWithoutCanary(source, destination) {
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter(path) {
      return basename(path) !== CANARY_FILE
    }
  })
}

function resolveInsidePack(root, locator, label) {
  if (typeof locator !== 'string' || locator === '' || locator.includes('..')) {
    throw new Error(`${label} must be a contained private Pack locator`)
  }
  const target = resolve(root, locator)
  const path = relative(root, target)
  if (path === '' || path.startsWith(`..${sep}`) || path === '..') {
    throw new Error(`${label} escapes the private Pack`)
  }
  return target
}

function assertNestedLocator(locator, parent, label) {
  if (locator !== `${parent}/${CANARY_FILE}`) {
    throw new Error(`${label} must be the sealed Canary sidecar inside its material directory`)
  }
}

function asDigest(value) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function stripDigest(value) {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== key))
}

function sameStrings(left, right) {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort())
}

function safeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}
