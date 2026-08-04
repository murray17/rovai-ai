import { cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  assertNoAbsolutePathLeak,
  assertNoGitMetadata,
  atomicWriteJson,
  canonicalJson,
  computeCaseSeal,
  copyFixture,
  createQualificationExecutionEnvironment,
  digestJson,
  evaluateChangeBoundary,
  makeTemporaryDirectory,
  readCaseContract,
  removeTemporaryDirectory,
  runCaptured,
  runCaseVerifier,
  treeDiff,
  treeManifest,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'
import {
  buildRunnerCheckResults,
  deriveDeliveryEvidence
} from './lib/qualification-evaluation.mjs'
import { admitV3Case } from './lib/qualification-case-v3.mjs'

const { command, caseDirectory } = parseArguments(process.argv.slice(2))

if (command === 'admit') {
  const result = await admitCase(caseDirectory)
  console.log(JSON.stringify(result, null, 2))
} else if (command === 'check') {
  const checked = await verifyStoredCaseSeal(caseDirectory)
  console.log(JSON.stringify({
    ok: true,
    caseId: checked.contract.manifest.id,
    caseVersion: checked.contract.manifest.version,
    caseSeal: checked.seal,
    admissionDigest: checked.admission.admissionDigest
  }, null, 2))
}

async function admitCase(directory) {
  const contract = await readCaseContract(directory)
  if (contract.manifest.schemaVersion === 3) return admitV3Case(contract)
  await assertNoGitMetadata(contract.fixturePath)
  await assertNoAbsolutePathLeak(contract.fixturePath)
  const referenceLocator = contract.manifest.referenceDirectory
  if (typeof referenceLocator !== 'string' || referenceLocator.includes('..')) {
    throw new Error('qualification admission requires a relative referenceDirectory')
  }
  const referencePath = join(contract.root, referenceLocator)
  const temporaryRoot = await makeTemporaryDirectory('rovai-qualification-admission-')
  try {
    const firstInitial = join(temporaryRoot, 'initial-a')
    const secondInitial = join(temporaryRoot, 'initial-b')
    const firstReference = join(temporaryRoot, 'reference-a')
    const secondReference = join(temporaryRoot, 'reference-b')
    const publicBaseline = join(temporaryRoot, 'public-baseline')
    for (const destination of [firstInitial, secondInitial, firstReference, secondReference, publicBaseline]) {
      await copyFixture(contract.fixturePath, destination)
    }
    const publicEnvironment = await createQualificationExecutionEnvironment(publicBaseline)
    const publicChecks = []
    for (const check of contract.manifest.publicChecks) {
      const [executable, ...args] = check.command
      const run = await runCaptured(executable, args, {
        cwd: publicBaseline,
        env: publicEnvironment,
        timeoutMs: 180_000
      })
      publicChecks.push({
        checkId: check.checkId,
        passed: run.code === 0 && !run.timedOut,
        code: run.code,
        timedOut: run.timedOut
      })
    }
    if (publicChecks.some((check) => !check.passed)) {
      throw new Error(`qualification fixture public baseline failed: ${JSON.stringify(publicChecks)}`)
    }
    const verifierOptions = {
      verificationCatalog: contract.evaluationContract.verificationCatalog
    }
    const initialA = await runCaseVerifier(contract.verifierPath, firstInitial, verifierOptions)
    const initialB = await runCaseVerifier(contract.verifierPath, secondInitial, verifierOptions)
    const initialBoundary = evaluateChangeBoundary(
      contract.manifest,
      treeDiff(contract.fixture, await treeManifest(firstInitial))
    )
    const initialDeliveryA = deriveDeliveryEvidence(
      contract.evaluationContract,
      initialA,
      buildRunnerCheckResults(contract.evaluationContract.verificationCatalog, {
        changeBoundary: initialBoundary
      })
    )
    const initialDeliveryB = deriveDeliveryEvidence(
      contract.evaluationContract,
      initialB,
      buildRunnerCheckResults(contract.evaluationContract.verificationCatalog, {
        changeBoundary: initialBoundary
      })
    )
    const observedInitialFailures = initialDeliveryA.checkResults
      .filter((check) => ['failed', 'blocked'].includes(check.status))
      .map((check) => check.checkId)
    if (initialA.validationState !== 'valid'
        || initialB.validationState !== 'valid'
        || initialDeliveryA.verifiedDelivery !== 'fail'
        || initialDeliveryB.verifiedDelivery !== 'fail'
        || canonicalJson(initialA.checkResults) !== canonicalJson(initialB.checkResults)
        || !contract.evaluationContract.expectedInitialFailureCheckIds.every(
          (checkId) => observedInitialFailures.includes(checkId)
        )) {
      throw new Error('qualification initial verifier result is not deterministic expected failure')
    }
    await cp(referencePath, firstReference, { recursive: true, force: true })
    await cp(referencePath, secondReference, { recursive: true, force: true })
    const referenceA = await runCaseVerifier(contract.verifierPath, firstReference, verifierOptions)
    const referenceB = await runCaseVerifier(contract.verifierPath, secondReference, verifierOptions)
    const referenceBoundaryA = evaluateChangeBoundary(
      contract.manifest,
      treeDiff(contract.fixture, await treeManifest(firstReference))
    )
    const referenceBoundaryB = evaluateChangeBoundary(
      contract.manifest,
      treeDiff(contract.fixture, await treeManifest(secondReference))
    )
    const referenceDeliveryA = deriveDeliveryEvidence(
      contract.evaluationContract,
      referenceA,
      buildRunnerCheckResults(contract.evaluationContract.verificationCatalog, {
        changeBoundary: referenceBoundaryA
      })
    )
    const referenceDeliveryB = deriveDeliveryEvidence(
      contract.evaluationContract,
      referenceB,
      buildRunnerCheckResults(contract.evaluationContract.verificationCatalog, {
        changeBoundary: referenceBoundaryB
      })
    )
    if (referenceA.validationState !== 'valid'
        || referenceB.validationState !== 'valid'
        || referenceDeliveryA.verifiedDelivery !== 'pass'
        || referenceDeliveryB.verifiedDelivery !== 'pass'
        || canonicalJson(referenceA.checkResults) !== canonicalJson(referenceB.checkResults)
        || canonicalJson(referenceDeliveryA) !== canonicalJson(referenceDeliveryB)) {
      throw new Error('qualification reference result is not deterministic pass')
    }
    const referenceEvidence = {
      schemaVersion: 2,
      publicChecks,
      initialVerifierObservationDigest: digestJson(initialA),
      initialDeliveryEvidenceDigest: digestJson(initialDeliveryA),
      referenceVerifierObservationDigest: digestJson(referenceA),
      referenceDeliveryEvidenceDigest: digestJson(referenceDeliveryA),
      twoMaterializationDeterministic: true,
      initialExpectedFailure: true,
      referenceVerifiedDelivery: 'pass'
    }
    const referenceEvidenceDigest = digestJson(referenceEvidence)
    const computed = computeCaseSeal(contract, referenceEvidenceDigest)
    const admissionWithoutDigest = {
      schemaVersion: 2,
      caseId: contract.manifest.id,
      caseVersion: contract.manifest.version,
      caseSeal: computed.seal,
      referenceEvidenceDigest,
      referenceEvidence
    }
    const admission = {
      ...admissionWithoutDigest,
      admissionDigest: digestJson(admissionWithoutDigest)
    }
    await atomicWriteJson(join(contract.root, 'case-seal.json'), {
      schemaVersion: 2,
      caseId: contract.manifest.id,
      caseVersion: contract.manifest.version,
      seal: computed.seal,
      sealInput: computed.sealInput
    })
    await atomicWriteJson(join(contract.root, 'admission.json'), admission)
    return {
      ok: true,
      caseId: contract.manifest.id,
      caseVersion: contract.manifest.version,
      caseSeal: computed.seal,
      admissionDigest: admission.admissionDigest
    }
  } finally {
    await removeTemporaryDirectory(temporaryRoot)
  }
}

function parseArguments(args) {
  const command = args.shift()
  if (!['admit', 'check'].includes(command)) usage()
  let caseDirectory = null
  while (args.length > 0) {
    const argument = args.shift()
    if (argument === '--case') caseDirectory = args.shift()
    else usage()
  }
  if (!caseDirectory) usage()
  return { command, caseDirectory: resolve(caseDirectory) }
}

function usage() {
  console.error('Usage: node scripts/qualification-case.mjs <admit|check> --case <directory>')
  process.exit(2)
}
