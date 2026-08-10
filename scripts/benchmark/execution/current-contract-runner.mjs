import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { aggregateBenchmarkSuite } from './suite.mjs'
import {
  CURRENT_CONTRACT_CRITERIA,
  CURRENT_CONTRACT_PREREQUISITES,
  CURRENT_CONTRACT_PROFILE
} from '../profiles/current-contract-conformance.mjs'
import { collectProductContractFingerprint } from '../protocol/product-contract.mjs'
import { buildExecutionEnvironment } from '../protocol/execution-environment.mjs'
import { createBenchmarkRunV3, writeBenchmarkRunV3 } from '../protocol/v3.mjs'
import { digestJson, sha256 } from '../protocol/canonical.mjs'
import { classifyBenchmarkFailure } from '../evaluation/failure-taxonomy.mjs'
import { comparisonNotRequested } from '../evaluation/comparison.mjs'
import { renderBenchmarkReview } from '../reporting/markdown.mjs'

const DEFAULT_REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..')

export async function runCurrentContractConformance({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  outputDirectory,
  runId,
  coreExecutable = null,
  timeoutMs = 20 * 60 * 1000
}) {
  if (!outputDirectory || !runId) throw new Error('current-contract runner requires outputDirectory and runId')
  const sourceEvidence = await verifySourceEvidence(repositoryRoot)
  const execution = await runCargoTests(repositoryRoot, timeoutMs)
  const infrastructurePassed = execution.spawnError === null && !execution.timedOut
  const testsPassed = infrastructurePassed && execution.code === 0
  const outcomes = CURRENT_CONTRACT_CRITERIA.map((criterion) => ({
    plannedSlotId: `deterministic-${criterion.id}`,
    validity: infrastructurePassed ? 'valid' : 'invalid',
    evaluationState: infrastructurePassed ? 'complete' : 'pending',
    hardOutcome: infrastructurePassed ? (testsPassed ? 'pass' : 'fail') : 'unavailable',
    evidenceTests: criterion.evidence.map((entry) => entry.testName)
  }))
  const suiteResult = aggregateBenchmarkSuite(CURRENT_CONTRACT_PROFILE, outcomes)
  const evidenceRecord = {
    schemaId: 'rovai.benchmark.contract-conformance-evidence',
    schemaVersion: '1.0.0',
    profile: `${CURRENT_CONTRACT_PROFILE.id}@${CURRENT_CONTRACT_PROFILE.version}`,
    command: ['cargo', 'test', '-p', 'rovai-core', '--lib', '--', '--test-threads=1'],
    sourceEvidence,
    prerequisites: CURRENT_CONTRACT_PREREQUISITES,
    process: {
      code: execution.code,
      signal: execution.signal,
      timedOut: execution.timedOut,
      outputDigest: sha256(`${execution.stdout}\n${execution.stderr}`)
    },
    criteria: CURRENT_CONTRACT_CRITERIA.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement,
      status: testsPassed ? 'passed' : infrastructurePassed ? 'failed' : 'indeterminate',
      testNames: criterion.evidence.map((entry) => entry.testName)
    }))
  }
  const evidenceDigest = digestJson(evidenceRecord)
  const productContract = await collectProductContractFingerprint({ repositoryRoot, coreExecutable })
  const executionEnvironment = buildExecutionEnvironment({
    teamRuntimeCompatibilityDigest: digestJson({
      runner: 'cargo-test',
      profile: `${CURRENT_CONTRACT_PROFILE.id}@${CURRENT_CONTRACT_PROFILE.version}`,
      noRealRuntimeAccounts: true
    }),
    teamConfiguration: { members: [], mode: 'not_applicable_contract_conformance' },
    runtimeModelPermissions: {
      summary: { runtime: 'rust-test-harness', model: 'none', network: 'not_requested', paidAccounts: 'not_used' }
    },
    isolationProfile: { id: 'offline-local-test-process-v1', dedicatedHostClaim: false },
    caseHermeticVerificationProfile: {
      id: 'rust-unit-test-fixtures-v1',
      userDataDirectory: 'not_used',
      privateSealedPack: 'not_used'
    }
  })
  const hardOutcome = infrastructurePassed ? (testsPassed ? 'pass' : 'fail') : 'unavailable'
  const failureTaxonomy = classifyBenchmarkFailure({
    benchmarkContractValid: true,
    productContractMatched: productContract.dataContractVersion.value === 'v0.54'
      && productContract.dataContractSchemaVersion.value === 30,
    environmentValid: infrastructurePassed,
    evaluationState: infrastructurePassed ? 'complete' : 'pending',
    verifiedDelivery: infrastructurePassed ? (testsPassed ? 'pass' : 'fail') : 'unavailable',
    orchestrationConvergence: infrastructurePassed ? 'pass' : 'unavailable',
    postDispatchHumanIntervention: 'absent',
    changeBoundaryPassed: true,
    evidenceIntegrityPassed: sourceEvidence.every((entry) => entry.present),
    verifierOrFixturePassed: infrastructurePassed ? testsPassed : undefined,
    infrastructurePassed
  })
  const artifactReference = {
    artifactRole: 'contract-conformance-evidence',
    schemaId: evidenceRecord.schemaId,
    schemaVersion: evidenceRecord.schemaVersion,
    payloadDigest: evidenceDigest,
    disclosure: 'public',
    locator: 'evidence.json'
  }
  const benchmarkRun = createBenchmarkRunV3({
    runId,
    recordedAt: new Date().toISOString(),
    profile: {
      id: CURRENT_CONTRACT_PROFILE.id,
      version: CURRENT_CONTRACT_PROFILE.version,
      lane: CURRENT_CONTRACT_PROFILE.lane,
      definitionDigest: CURRENT_CONTRACT_PROFILE.definitionDigest,
      hardOutcomeDefinitionDigest: CURRENT_CONTRACT_PROFILE.hardOutcomeDefinitionDigest,
      publicationPolicyDigest: CURRENT_CONTRACT_PROFILE.publicationPolicyDigest
    },
    suite: suiteResult.suite,
    verification: {
      caseSealDigest: digestJson(CURRENT_CONTRACT_PROFILE.suite.cases.map((entry) => entry.seal)),
      verificationCatalogDigest: digestJson(CURRENT_CONTRACT_CRITERIA.map((entry) => entry.evidence)),
      changeBoundaryDigest: digestJson({ policy: 'product_sources_read_only', version: 1 }),
      budgetContractDigest: digestJson({ timeoutMs, realModels: 0, paidRuntimeAccounts: 0 })
    },
    productContract,
    executionEnvironment,
    outcome: {
      validity: infrastructurePassed ? 'valid' : 'invalid',
      evaluationState: infrastructurePassed ? 'complete' : 'pending',
      verifiedDelivery: infrastructurePassed ? (testsPassed ? 'pass' : 'fail') : 'unavailable',
      orchestrationConvergence: infrastructurePassed ? 'pass' : 'unavailable',
      postDispatchHumanIntervention: 'absent',
      hardOutcome,
      overall: hardOutcome,
      failureTaxonomy,
      metrics: {
        contractConformance: {
          criteriaPassed: testsPassed ? CURRENT_CONTRACT_CRITERIA.length : 0,
          criteriaFailed: testsPassed ? 0 : CURRENT_CONTRACT_CRITERIA.length
        }
      }
    },
    evidence: {
      layer1HardOutcome: { status: 'available', references: [artifactReference] },
      layer2Delivery: { status: 'available', references: [artifactReference] },
      layer3Collaboration: {
        status: 'not_applicable',
        references: [],
        reason: { code: 'profile.contract_conformance_has_no_team_execution' }
      },
      layer4ToolAndMutation: { status: 'available', references: [artifactReference] },
      layer5SemanticReview: {
        status: 'unavailable',
        references: [],
        reason: { code: 'semantic_judge.not_invoked_and_non_authoritative' }
      }
    },
    comparisonEligibility: comparisonNotRequested(),
    artifactIndex: [artifactReference],
    disclosure: {
      classification: 'public',
      containsPrivateCaseMaterial: false,
      containsUserData: false
    }
  })
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  await writeFile(join(outputDirectory, 'evidence.json'), `${JSON.stringify(evidenceRecord, null, 2)}\n`, { mode: 0o600 })
  await writeBenchmarkRunV3(join(outputDirectory, 'benchmark-run.json'), benchmarkRun)
  await writeFile(
    join(outputDirectory, 'README.md'),
    renderBenchmarkReview(benchmarkRun, { criteria: evidenceRecord.criteria }),
    { mode: 0o600 }
  )
  return { benchmarkRun, suiteResult, evidenceRecord, execution }
}

async function verifySourceEvidence(repositoryRoot) {
  const references = [...CURRENT_CONTRACT_CRITERIA.flatMap((entry) => entry.evidence),
    ...CURRENT_CONTRACT_PREREQUISITES.map((entry) => entry.evidence)]
  const unique = new Map(references.map((entry) => [`${entry.locator}:${entry.testName}`, entry]))
  return Promise.all([...unique.values()].map(async (reference) => {
    const source = await readFile(resolve(repositoryRoot, reference.locator), 'utf8')
    const escaped = reference.testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const present = new RegExp(`fn\\s+${escaped}\\s*\\(`, 'u').test(source)
    if (!present) throw new Error(`required deterministic product test is missing: ${reference.testName}`)
    return { ...reference, present, sourceDigest: sha256(source) }
  }))
}

function runCargoTests(cwd, timeoutMs) {
  return new Promise((resolveRun) => {
    let child
    try {
      child = spawn('cargo', ['test', '-p', 'rovai-core', '--lib', '--', '--test-threads=1'], {
        cwd,
        env: { ...process.env, CARGO_TERM_COLOR: 'never' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolveRun({ code: null, signal: null, timedOut: false, stdout: '', stderr: '', spawnError: error.message })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-4 * 1024 * 1024) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4 * 1024 * 1024) })
    child.once('error', (error) => {
      resolveRun({ code: null, signal: null, timedOut, stdout, stderr, spawnError: error.message })
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code, signal, timedOut, stdout, stderr, spawnError: null })
    })
  })
}
