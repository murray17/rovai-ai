import { createBenchmarkRunV3 } from './protocol/v3.mjs'
import { digestJson, sha256 } from './protocol/canonical.mjs'
import { comparisonNotRequested } from './evaluation/comparison.mjs'

export function benchmarkRunFixture(overrides = {}) {
  const reference = {
    artifactRole: 'contract-evidence',
    schemaId: 'test.evidence',
    schemaVersion: '1.0.0',
    payloadDigest: sha256('evidence'),
    disclosure: 'public',
    locator: 'evidence.json'
  }
  const input = {
    runId: overrides.runId ?? 'run-fixture',
    recordedAt: overrides.recordedAt ?? '2026-08-10T00:00:00.000Z',
    profile: {
      id: 'fixture-profile',
      version: '1.0.0',
      lane: 'contract-conformance',
      definitionDigest: sha256('profile'),
      hardOutcomeDefinitionDigest: sha256('hard'),
      publicationPolicyDigest: sha256('publication'),
      ...overrides.profile
    },
    suite: {
      id: 'fixture-suite',
      version: '1.0.0',
      definitionDigest: sha256('suite'),
      caseSetDigest: sha256('case-set'),
      roundCount: 1,
      caseCount: 1,
      plannedSlotCount: 1,
      ...overrides.suite
    },
    verification: {
      caseSealDigest: sha256('case-seal'),
      verificationCatalogDigest: sha256('catalog'),
      changeBoundaryDigest: sha256('boundary'),
      budgetContractDigest: sha256('budget'),
      ...overrides.verification
    },
    productContract: productContractFixture(overrides.productContract),
    executionEnvironment: executionEnvironmentFixture(overrides.executionEnvironment),
    outcome: {
      validity: 'valid',
      evaluationState: 'complete',
      verifiedDelivery: 'pass',
      orchestrationConvergence: 'pass',
      postDispatchHumanIntervention: 'absent',
      hardOutcome: 'pass',
      overall: 'pass',
      failureTaxonomy: [],
      ...overrides.outcome
    },
    evidence: overrides.evidence ?? {
      layer1HardOutcome: { status: 'available', references: [reference] },
      layer2Delivery: { status: 'available', references: [reference] },
      layer3Collaboration: { status: 'available', references: [reference] },
      layer4ToolAndMutation: { status: 'available', references: [reference] },
      layer5SemanticReview: {
        status: 'unavailable',
        references: [],
        reason: { code: 'semantic_judge.not_invoked' }
      }
    },
    comparisonEligibility: comparisonNotRequested(),
    artifactIndex: overrides.artifactIndex ?? [reference],
    disclosure: overrides.disclosure ?? {
      classification: 'public',
      containsPrivateCaseMaterial: false,
      containsUserData: false
    }
  }
  if (overrides.derivedFrom) input.derivedFrom = overrides.derivedFrom
  return createBenchmarkRunV3(input)
}

function productContractFixture(overrides = {}) {
  const available = (value) => ({ status: 'available', value, authority: { kind: 'test_fixture' } })
  const fields = {
    releaseBuildIdentity: available('build'),
    gitCommit: available('commit'),
    coreExecutableDigest: { status: 'unavailable', reason: { code: 'fixture.no_core' } },
    dataContractVersion: available('v0.52'),
    dataContractSchemaVersion: available(28),
    campSnapshotSchemaVersion: available(27),
    contextManifestVersion: available(9),
    contextFormatterVersion: available(11),
    contextDeliveryProfileVersion: available(2),
    durableTaskContract: available({ version: 2, sourceDigest: sha256('task') }),
    builtInTransportVersion: available(4),
    builtInCatalogDigest: available(sha256('builtins')),
    acceptedInputAckContract: available({ semanticClass: 'accepted_input_only', sourceDigest: sha256('ack') }),
    ...overrides
  }
  const fingerprintFields = { ...fields }
  delete fingerprintFields.fingerprintDigest
  return { fingerprintDigest: digestJson(fingerprintFields), ...fields }
}

function executionEnvironmentFixture(overrides = {}) {
  const fields = {
    benchmarkRunnerVersion: '0.53.0',
    nodeVersion: process.version,
    platformClass: 'fixture-platform',
    teamRuntimeCompatibilityDigest: sha256('team-runtime'),
    teamConfigurationDigest: sha256('team'),
    runtimeModelPermissionsDigest: sha256('runtime-model-permissions'),
    isolationProfileDigest: sha256('isolation'),
    caseHermeticVerificationProfileDigest: sha256('hermetic'),
    ...overrides
  }
  return { ...fields, compatibilityEnvelopeDigest: digestJson(fields) }
}
