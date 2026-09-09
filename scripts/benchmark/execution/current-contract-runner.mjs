import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { collectContractTestEvidence } from './contract-test-evidence.mjs'
import { aggregateBenchmarkSuite } from './suite.mjs'
import {
  CURRENT_CONTRACT_CRITERIA,
  CURRENT_CONTRACT_DATA_STORE,
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
  const sourceEvidence = await collectContractTestEvidence({ repositoryRoot, timeoutMs,
    outputDirectory: join(outputDirectory, 'test-logs'),
    references: [...CURRENT_CONTRACT_CRITERIA.flatMap(criterion => criterion.evidence), ...CURRENT_CONTRACT_PREREQUISITES.map(entry => entry.evidence)] })
  const statusFor = references => {
    const results = references.map(reference => sourceEvidence.find(entry => entry.locator === reference.locator && entry.testName === reference.testName))
    return results.some(entry => entry?.status === 'failed') ? 'failed' : results.every(entry => entry?.status === 'passed') ? 'passed' : 'indeterminate'
  }
  const infrastructurePassed = sourceEvidence.every(entry => entry.status !== 'indeterminate')
  const testsPassed = sourceEvidence.every(entry => entry.status === 'passed')
  const execution = { code: testsPassed ? 0 : infrastructurePassed ? 1 : null, signal: null, timedOut: sourceEvidence.some(entry => entry.timedOut), stdout: JSON.stringify(sourceEvidence), stderr: '', spawnError: sourceEvidence.find(entry => entry.spawnError)?.spawnError ?? null }
  const outcomes = CURRENT_CONTRACT_CRITERIA.map((criterion) => ({
    plannedSlotId: `deterministic-${criterion.id}`,
    validity: statusFor(criterion.evidence) !== 'indeterminate' ? 'valid' : 'invalid',
    evaluationState: statusFor(criterion.evidence) !== 'indeterminate' ? 'complete' : 'pending',
    hardOutcome: statusFor(criterion.evidence) === 'passed' ? 'pass' : statusFor(criterion.evidence) === 'failed' ? 'fail' : 'unavailable',
    evidenceTests: criterion.evidence.map((entry) => entry.testName)
  }))
  const suiteResult = aggregateBenchmarkSuite(CURRENT_CONTRACT_PROFILE, outcomes)
  const evidenceRecord = {
    schemaId: 'rovai.benchmark.contract-conformance-evidence',
    schemaVersion: '1.0.0',
    profile: `${CURRENT_CONTRACT_PROFILE.id}@${CURRENT_CONTRACT_PROFILE.version}`,
    commands: sourceEvidence.map(entry => entry.command),
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
      status: statusFor(criterion.evidence),
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
    productContractMatched:
      productContract.dataContractVersion.value === CURRENT_CONTRACT_DATA_STORE.version &&
      productContract.dataContractSchemaVersion.value ===
        CURRENT_CONTRACT_DATA_STORE.projectionSchemaVersion,
    environmentValid: infrastructurePassed,
    evaluationState: infrastructurePassed ? 'complete' : 'pending',
    verifiedDelivery: infrastructurePassed ? (testsPassed ? 'pass' : 'fail') : 'unavailable',
    orchestrationConvergence: infrastructurePassed ? 'pass' : 'unavailable',
    postDispatchHumanIntervention: 'absent',
    changeBoundaryPassed: true,
    evidenceIntegrityPassed: sourceEvidence.every((entry) => entry.sourceDigest && entry.observed.length > 0),
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
          criteriaPassed: evidenceRecord.criteria.filter(entry => entry.status === 'passed').length,
          criteriaFailed: evidenceRecord.criteria.filter(entry => entry.status === 'failed').length,
          criteriaIndeterminate: evidenceRecord.criteria.filter(entry => entry.status === 'indeterminate').length
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
