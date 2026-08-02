import { cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  assertNoAbsolutePathLeak,
  assertNoGitMetadata,
  atomicWriteJson,
  canonicalJson,
  computeCaseSeal,
  copyFixture,
  digestJson,
  makeTemporaryDirectory,
  readCaseContract,
  removeTemporaryDirectory,
  runCaptured,
  runCaseVerifier,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'

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
    for (const destination of [firstInitial, secondInitial, firstReference, secondReference]) {
      await copyFixture(contract.fixturePath, destination)
    }
    const publicChecks = []
    for (const check of contract.manifest.publicChecks) {
      const [executable, ...args] = check.command
      const run = await runCaptured(executable, args, { cwd: firstInitial, timeoutMs: 180_000 })
      publicChecks.push({
        name: check.name,
        passed: run.code === 0 && !run.timedOut,
        code: run.code,
        timedOut: run.timedOut
      })
    }
    if (publicChecks.some((check) => !check.passed)) {
      throw new Error(`qualification fixture public baseline failed: ${JSON.stringify(publicChecks)}`)
    }
    const verifierEnvironment = { ...process.env, ROVAI_QUALIFICATION_VERIFIER_OFFLINE: '1' }
    const initialA = await runCaseVerifier(contract.verifierPath, firstInitial, { env: verifierEnvironment })
    const initialB = await runCaseVerifier(contract.verifierPath, secondInitial, { env: verifierEnvironment })
    if (initialA.output.verifiedDelivery || initialB.output.verifiedDelivery
        || canonicalJson(initialA.output) !== canonicalJson(initialB.output)
        || !initialA.output.categories.some((category) => (
          category.name === contract.manifest.expectedInitialFailureCategory && category.status === 'failed'
        ))) {
      throw new Error('qualification initial verifier result is not deterministic expected failure')
    }
    await cp(referencePath, firstReference, { recursive: true, force: true })
    await cp(referencePath, secondReference, { recursive: true, force: true })
    const referenceA = await runCaseVerifier(contract.verifierPath, firstReference, { env: verifierEnvironment })
    const referenceB = await runCaseVerifier(contract.verifierPath, secondReference, { env: verifierEnvironment })
    if (!referenceA.output.verifiedDelivery || !referenceB.output.verifiedDelivery
        || canonicalJson(referenceA.output) !== canonicalJson(referenceB.output)) {
      throw new Error('qualification reference result is not deterministic pass')
    }
    const referenceEvidence = {
      schemaVersion: 1,
      publicChecks,
      initialResultDigest: digestJson(initialA.output),
      referenceResultDigest: digestJson(referenceA.output),
      twoMaterializationDeterministic: true,
      initialExpectedFailure: true,
      referenceVerifiedDelivery: true
    }
    const referenceEvidenceDigest = digestJson(referenceEvidence)
    const computed = computeCaseSeal(contract, referenceEvidenceDigest)
    const admissionWithoutDigest = {
      schemaVersion: 1,
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
      schemaVersion: 1,
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
