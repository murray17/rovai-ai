import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  SHA256_PATTERN,
  canonicalJson,
  digestJson,
  materializeJson,
  sha256
} from './canonical.mjs'

export const BENCHMARK_PROTOCOL_SCHEMA_VERSION = 3
export const BENCHMARK_PROTOCOL_VERSION = '3.0.0'
export const BENCHMARK_RUN_SCHEMA_ID = 'rovai.benchmark.run'
export const BENCHMARK_RUNNER_VERSION = '0.53.0'

const TOP_LEVEL_FIELDS = new Set([
  'schemaId',
  'schemaVersion',
  'benchmarkProtocolVersion',
  'runId',
  'recordedAt',
  'profile',
  'suite',
  'verification',
  'productContract',
  'executionEnvironment',
  'outcome',
  'evidence',
  'comparisonEligibility',
  'artifactIndex',
  'disclosure',
  'derivedFrom',
  'integrity'
])

const EVIDENCE_LAYERS = Object.freeze([
  'layer1HardOutcome',
  'layer2Delivery',
  'layer3Collaboration',
  'layer4ToolAndMutation',
  'layer5SemanticReview'
])

const AXES = Object.freeze([
  'hardOutcome',
  'collaboration',
  'performance',
  'evidenceIntegrity',
  'contractConformance'
])

const PUBLIC_FORBIDDEN_KEYS = new Set([
  'credential',
  'credentials',
  'environmentVariables',
  'privatePrompt',
  'referenceAnswer',
  'runtimePrivateRoot',
  'sqlitePath',
  'withheldVerifier'
])

export function createBenchmarkRunV3(input) {
  const value = materializeJson({
    schemaId: BENCHMARK_RUN_SCHEMA_ID,
    schemaVersion: BENCHMARK_PROTOCOL_SCHEMA_VERSION,
    benchmarkProtocolVersion: BENCHMARK_PROTOCOL_VERSION,
    ...input
  })
  delete value.integrity
  validateBenchmarkRunV3(value, { verifyIntegrity: false })
  value.integrity = computeBenchmarkIntegrity(value)
  validateBenchmarkRunV3(value)
  return value
}

export function computeBenchmarkIntegrity(value) {
  const payload = withoutIntegrity(value)
  return {
    canonicalization: 'rovai-canonical-json-v1',
    contentIdentityDigest: digestJson(contentIdentityView(payload)),
    payloadDigest: digestJson(payload)
  }
}

export function benchmarkContentIdentity(value) {
  validateBenchmarkRunV3(value)
  return value.integrity.contentIdentityDigest
}

export function validateBenchmarkRunV3(value, { verifyIntegrity = true } = {}) {
  assertRecord(value, 'Benchmark Run')
  rejectUnknownFields(value, TOP_LEVEL_FIELDS, 'Benchmark Run')
  if (value.schemaId !== BENCHMARK_RUN_SCHEMA_ID
      || value.schemaVersion !== BENCHMARK_PROTOCOL_SCHEMA_VERSION
      || value.benchmarkProtocolVersion !== BENCHMARK_PROTOCOL_VERSION) {
    throw new Error('unsupported Benchmark Protocol major version')
  }
  assertNonEmpty(value.runId, 'runId')
  assertIsoTimestamp(value.recordedAt, 'recordedAt')
  validateProfile(value.profile)
  validateSuite(value.suite)
  validateVerification(value.verification)
  validateProductContract(value.productContract)
  validateExecutionEnvironment(value.executionEnvironment)
  validateOutcome(value.outcome)
  validateEvidence(value.evidence)
  validateComparisonEligibility(value.comparisonEligibility)
  validateArtifactIndex(value.artifactIndex)
  validateDisclosure(value.disclosure)
  if (value.derivedFrom !== undefined && value.derivedFrom !== null) {
    assertRecord(value.derivedFrom, 'derivedFrom')
    assertDigest(value.derivedFrom.sourceArtifactDigest, 'derivedFrom.sourceArtifactDigest')
    assertNonEmpty(value.derivedFrom.adapterId, 'derivedFrom.adapterId')
    if (typeof value.derivedFrom.sourceSchemaVersion !== 'number') {
      throw new Error('derivedFrom.sourceSchemaVersion must be numeric')
    }
  }
  if (value.disclosure.classification === 'public') assertPublicSafe(value)
  if (verifyIntegrity) {
    assertRecord(value.integrity, 'integrity')
    const expected = computeBenchmarkIntegrity(value)
    if (canonicalJson(value.integrity) !== canonicalJson(expected)) {
      throw new Error('Benchmark Run integrity digest mismatch')
    }
  }
  return value
}

export async function readBenchmarkRunV3(path) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  return validateBenchmarkRunV3(value)
}

export async function writeBenchmarkRunV3(path, value) {
  validateBenchmarkRunV3(value)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export function deriveBenchmarkRunV3(sourceArtifact, normalized, adapterId) {
  const raw = typeof sourceArtifact === 'string'
    ? sourceArtifact
    : `${JSON.stringify(sourceArtifact)}\n`
  const source = typeof sourceArtifact === 'string' ? JSON.parse(sourceArtifact) : sourceArtifact
  return createBenchmarkRunV3({
    ...normalized,
    derivedFrom: {
      sourceArtifactDigest: sha256(raw),
      sourceSchemaVersion: source.schemaVersion,
      adapterId
    }
  })
}

export function contentIdentityView(value) {
  const stable = materializeJson(value)
  delete stable.integrity
  delete stable.runId
  delete stable.recordedAt
  stripTemporalAndEphemeralFields(stable)
  return stable
}

function withoutIntegrity(value) {
  const payload = materializeJson(value)
  delete payload.integrity
  return payload
}

function stripTemporalAndEphemeralFields(value) {
  if (Array.isArray(value)) {
    value.forEach(stripTemporalAndEphemeralFields)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    if (/^(generatedAt|observedAt|startedAt|completedAt|reviewedAt|attemptId)$/u.test(key)) {
      delete value[key]
    } else {
      stripTemporalAndEphemeralFields(value[key])
    }
  }
}

function validateProfile(profile) {
  assertRecord(profile, 'profile')
  for (const field of ['id', 'version', 'lane']) assertNonEmpty(profile[field], `profile.${field}`)
  for (const field of ['definitionDigest', 'hardOutcomeDefinitionDigest', 'publicationPolicyDigest']) {
    assertDigest(profile[field], `profile.${field}`)
  }
}

function validateSuite(suite) {
  assertRecord(suite, 'suite')
  for (const field of ['id', 'version']) assertNonEmpty(suite[field], `suite.${field}`)
  for (const field of ['definitionDigest', 'caseSetDigest']) assertDigest(suite[field], `suite.${field}`)
  for (const field of ['roundCount', 'caseCount', 'plannedSlotCount']) {
    if (!Number.isInteger(suite[field]) || suite[field] < 0) {
      throw new Error(`suite.${field} must be a non-negative integer`)
    }
  }
}

function validateVerification(verification) {
  assertRecord(verification, 'verification')
  for (const field of [
    'caseSealDigest',
    'verificationCatalogDigest',
    'changeBoundaryDigest',
    'budgetContractDigest'
  ]) assertDigest(verification[field], `verification.${field}`)
}

function validateProductContract(contract) {
  assertRecord(contract, 'productContract')
  assertDigest(contract.fingerprintDigest, 'productContract.fingerprintDigest')
  for (const field of [
    'releaseBuildIdentity',
    'gitCommit',
    'coreExecutableDigest',
    'dataContractVersion',
    'dataContractSchemaVersion',
    'campSnapshotSchemaVersion',
    'contextManifestVersion',
    'contextFormatterVersion',
    'contextDeliveryProfileVersion',
    'durableTaskContract',
    'builtInTransportVersion',
    'builtInCatalogDigest',
    'acceptedInputAckContract'
  ]) validateAvailability(contract[field], `productContract.${field}`)
}

function validateExecutionEnvironment(environment) {
  assertRecord(environment, 'executionEnvironment')
  assertNonEmpty(environment.benchmarkRunnerVersion, 'executionEnvironment.benchmarkRunnerVersion')
  assertNonEmpty(environment.nodeVersion, 'executionEnvironment.nodeVersion')
  assertNonEmpty(environment.platformClass, 'executionEnvironment.platformClass')
  for (const field of [
    'teamRuntimeCompatibilityDigest',
    'teamConfigurationDigest',
    'runtimeModelPermissionsDigest',
    'isolationProfileDigest',
    'caseHermeticVerificationProfileDigest',
    'compatibilityEnvelopeDigest'
  ]) assertDigest(environment[field], `executionEnvironment.${field}`)
}

function validateOutcome(outcome) {
  assertRecord(outcome, 'outcome')
  if (!['valid', 'invalid'].includes(outcome.validity)) throw new Error('outcome.validity is invalid')
  if (!['complete', 'pending'].includes(outcome.evaluationState)) {
    throw new Error('outcome.evaluationState is invalid')
  }
  if (!['pass', 'fail', 'unavailable'].includes(outcome.hardOutcome)
      || outcome.overall !== outcome.hardOutcome) {
    throw new Error('outcome Hard Outcome fields are inconsistent')
  }
  if (!['pass', 'fail', 'unavailable'].includes(outcome.verifiedDelivery)
      || !['pass', 'fail', 'unavailable'].includes(outcome.orchestrationConvergence)
      || !['absent', 'present', 'unavailable'].includes(outcome.postDispatchHumanIntervention)) {
    throw new Error('outcome hard gate is invalid')
  }
  if (!Array.isArray(outcome.failureTaxonomy)) throw new Error('outcome.failureTaxonomy must be an array')
}

function validateEvidence(evidence) {
  assertRecord(evidence, 'evidence')
  for (const layer of EVIDENCE_LAYERS) {
    const value = evidence[layer]
    assertRecord(value, `evidence.${layer}`)
    if (!['available', 'unavailable', 'not_applicable'].includes(value.status)) {
      throw new Error(`evidence.${layer}.status is invalid`)
    }
    if (!Array.isArray(value.references)) throw new Error(`evidence.${layer}.references must be an array`)
    value.references.forEach((reference, index) => validateArtifactReference(
      reference,
      `evidence.${layer}.references[${index}]`
    ))
    if (value.status !== 'available' && !value.reason?.code) {
      throw new Error(`evidence.${layer} requires a structured reason`)
    }
  }
}

function validateComparisonEligibility(comparison) {
  assertRecord(comparison, 'comparisonEligibility')
  for (const axis of AXES) {
    const value = comparison[axis]
    assertRecord(value, `comparisonEligibility.${axis}`)
    if (typeof value.eligible !== 'boolean' || !Array.isArray(value.reasonCodes)
        || !Array.isArray(value.suppressedMetrics) || !Array.isArray(value.displayOnlyMetrics)) {
      throw new Error(`comparisonEligibility.${axis} is invalid`)
    }
  }
}

function validateArtifactIndex(index) {
  if (!Array.isArray(index)) throw new Error('artifactIndex must be an array')
  const roles = new Set()
  index.forEach((entry, position) => {
    validateArtifactReference(entry, `artifactIndex[${position}]`)
    if (roles.has(entry.artifactRole)) throw new Error(`duplicate artifact role: ${entry.artifactRole}`)
    roles.add(entry.artifactRole)
    if (entry.locator !== undefined) validateRelativeLocator(entry.locator, `artifactIndex[${position}].locator`)
  })
}

function validateArtifactReference(reference, label) {
  assertRecord(reference, label)
  for (const field of ['artifactRole', 'schemaId', 'schemaVersion', 'disclosure']) {
    assertNonEmpty(reference[field], `${label}.${field}`)
  }
  assertDigest(reference.payloadDigest, `${label}.payloadDigest`)
  if (!['public', 'private', 'withheld'].includes(reference.disclosure)) {
    throw new Error(`${label}.disclosure is invalid`)
  }
}

function validateDisclosure(disclosure) {
  assertRecord(disclosure, 'disclosure')
  if (!['public', 'private'].includes(disclosure.classification)
      || typeof disclosure.containsPrivateCaseMaterial !== 'boolean'
      || typeof disclosure.containsUserData !== 'boolean') {
    throw new Error('disclosure is invalid')
  }
  if (disclosure.classification === 'public'
      && (disclosure.containsPrivateCaseMaterial || disclosure.containsUserData)) {
    throw new Error('public Benchmark Run cannot claim private material or user data')
  }
}

function validateAvailability(value, label) {
  assertRecord(value, label)
  if (value.status === 'available') {
    if (!Object.hasOwn(value, 'value') || !value.authority?.kind) {
      throw new Error(`${label} available value lacks authority`)
    }
    return
  }
  if (value.status !== 'unavailable' || !value.reason?.code) {
    throw new Error(`${label} must be available or have an unavailable reason`)
  }
}

function assertPublicSafe(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicSafe(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && looksLikePrivatePath(value)) {
      throw new Error(`public Benchmark Run leaks an absolute or private path at ${path}`)
    }
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PUBLIC_FORBIDDEN_KEYS.has(key)) throw new Error(`public Benchmark Run contains forbidden field ${path}.${key}`)
    assertPublicSafe(entry, `${path}.${key}`)
  }
}

function looksLikePrivatePath(value) {
  return /(^|\s)(?:file:\/\/|\/(?:Users|home|private|var\/folders)\/|[A-Za-z]:\\)/u.test(value)
    || /(?:\.sqlite3?|\/\.runtime|\/sealed(?:-|_)pack)/iu.test(value)
}

function validateRelativeLocator(value, label) {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('\\')
      || value.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new Error(`${label} must be a safe relative locator`)
  }
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field))
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`)
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}

function assertDigest(value, label) {
  if (!SHA256_PATTERN.test(value ?? '')) throw new Error(`${label} must be a SHA-256 digest`)
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
}

function assertIsoTimestamp(value, label) {
  assertNonEmpty(value, label)
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be an ISO timestamp`)
}

export const BENCHMARK_EVIDENCE_LAYERS = EVIDENCE_LAYERS
export const BENCHMARK_COMPARISON_AXES = AXES
