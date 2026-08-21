import { lstat, readFile } from 'node:fs/promises'
import { hostname, platform } from 'node:os'
import { digestJson, runCaptured, sha256 } from './qualification-common.mjs'

const PROFILE_SCHEMA_ID = 'rovai.qualification.intervention-isolation-profile'
const PROFILE_SCHEMA_VERSION = '1.0.0'
const MAX_PROFILE_BYTES = 1_048_576
const DIGEST = /^sha256:[a-f0-9]{64}$/
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/
const CHANNEL_NAMES = [
  'coreControl',
  'approvals',
  'configuration',
  'runtimeLifecycle',
  'workspaceWriters',
  'processAncestry',
  'networkMutation',
  'gitRemoteMutation',
  'externalMcpMutation',
  'observationContinuity'
]
const REQUIRED_RUNNER_ACTIONS = [
  'passive_observation',
  'deadline_watchdog',
  'evidence_capture',
  'turn_fencing',
  'bounded_cleanup'
]
const ALLOWED_EXECUTION_ISOLATION = new Set([
  'disposable_vm',
  'dedicated_host_session',
  'dedicated_os_identity',
  'dedicated_graphical_session'
])
const ALLOWED_AUTHORITY = new Set(['core', 'runner', 'provider', 'operating_system', 'none'])
const ALLOWED_SOURCE_AUTHORITY = new Set(['core', 'runner', 'verifier', 'runtime', 'derived', 'judge'])
const REQUIRED_CHANNEL_STATES = {
  coreControl: new Set(['isolated', 'ledgered']),
  approvals: new Set(['disabled', 'isolated', 'ledgered']),
  configuration: new Set(['isolated', 'ledgered']),
  runtimeLifecycle: new Set(['isolated', 'ledgered']),
  workspaceWriters: new Set(['isolated', 'ledgered']),
  processAncestry: new Set(['isolated', 'ledgered']),
  networkMutation: new Set(['disabled', 'ledgered']),
  gitRemoteMutation: new Set(['disabled', 'ledgered']),
  externalMcpMutation: new Set(['disabled', 'ledgered']),
  observationContinuity: new Set(['isolated', 'ledgered'])
}
const REQUIRED_CHANNEL_AUTHORITIES = {
  coreControl: new Set(['core', 'runner', 'operating_system']),
  approvals: new Set(['core', 'runner', 'operating_system']),
  configuration: new Set(['operating_system']),
  runtimeLifecycle: new Set(['operating_system']),
  workspaceWriters: new Set(['operating_system']),
  processAncestry: new Set(['operating_system']),
  networkMutation: new Set(['operating_system']),
  gitRemoteMutation: new Set(['core', 'runner', 'provider', 'operating_system']),
  externalMcpMutation: new Set(['core', 'runner', 'provider', 'operating_system']),
  observationContinuity: new Set(['runner', 'operating_system'])
}

export class InterventionIsolationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'InterventionIsolationError'
    this.code = code
  }
}

export async function collectIsolationIdentityObservation() {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
    fail('intervention_isolation.identity_unavailable', 'Formal isolation requires a POSIX execution identity')
  }
  const session = await runCaptured('/bin/ps', [
    '-o', 'sess=',
    '-p', String(process.pid)
  ], { timeoutMs: 10_000 })
  const sessionId = Number(session.stdout.trim())
  if (session.code !== 0 || !Number.isSafeInteger(sessionId) || sessionId < 1) {
    fail('intervention_isolation.session_identity_unavailable', 'Could not establish the Runner session identity')
  }
  return {
    schemaVersion: 1,
    operatingSystem: platform(),
    hostIdentityDigest: `sha256:${sha256(hostname())}`,
    uid: process.getuid(),
    gid: process.getgid(),
    sessionId
  }
}

export function isolationIdentityDigest(observation) {
  return `sha256:${digestJson(observation)}`
}

export async function loadAndAdmitInterventionIsolationProfile(path, expected) {
  const metadata = await lstat(path).catch(() => null)
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    fail('intervention_isolation.profile_file_invalid', 'Isolation Profile must be a regular non-symlink file')
  }
  if (metadata.size < 2 || metadata.size > MAX_PROFILE_BYTES) {
    fail('intervention_isolation.profile_file_invalid', 'Isolation Profile size is outside the accepted boundary')
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    fail('intervention_isolation.profile_file_not_private', 'Isolation Profile must not be group/world accessible')
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    fail('intervention_isolation.profile_owner_mismatch', 'Isolation Profile must be owned by the Runner identity')
  }
  let profile
  try {
    profile = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    fail('intervention_isolation.profile_json_invalid', 'Isolation Profile is not valid JSON')
  }
  const identity = expected.dedicatedIdentityDigest
    ? null
    : await collectIsolationIdentityObservation()
  return admitInterventionIsolationProfile(profile, {
    ...expected,
    dedicatedIdentityDigest: expected.dedicatedIdentityDigest ?? isolationIdentityDigest(identity)
  })
}

export async function verifyInterventionIsolationContinuity(path, initialAdmission, expected) {
  try {
    const finalAdmission = await loadAndAdmitInterventionIsolationProfile(path, expected)
    if (finalAdmission.artifactDigest !== initialAdmission.artifactDigest
        || finalAdmission.artifactId !== initialAdmission.artifactId
        || finalAdmission.payloadDigest !== initialAdmission.payloadDigest) {
      return {
        state: 'partial',
        reason: { code: 'intervention_isolation.profile_changed_after_dispatch' },
        initialArtifactDigest: initialAdmission.artifactDigest,
        finalArtifactDigest: finalAdmission.artifactDigest
      }
    }
    return {
      state: 'complete',
      reason: null,
      artifactId: finalAdmission.artifactId,
      artifactDigest: finalAdmission.artifactDigest,
      dedicatedIdentityDigest: finalAdmission.dedicatedIdentityDigest
    }
  } catch (error) {
    return {
      state: 'partial',
      reason: {
        code: error instanceof InterventionIsolationError
          ? error.code
          : 'intervention_isolation.continuity_check_failed'
      },
      initialArtifactDigest: initialAdmission.artifactDigest,
      finalArtifactDigest: null
    }
  }
}

export function admitInterventionIsolationProfile(profile, expected) {
  exactKeys(profile, [
    'artifactId',
    'schemaId',
    'schemaVersion',
    'producer',
    'binding',
    'sourceBoundaries',
    'payloadDigest',
    'payload'
  ], 'profile')
  stableId(profile.artifactId, 'artifactId')
  if (profile.schemaId !== PROFILE_SCHEMA_ID || profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    fail('intervention_isolation.schema_unsupported', 'Isolation Profile schema identity is unsupported')
  }
  validateProducer(profile.producer)
  validateBinding(profile.binding, expected)
  validateSourceBoundaries(profile.sourceBoundaries)
  digest(profile.payloadDigest, 'payloadDigest')
  if (profile.payloadDigest !== `sha256:${digestJson(profile.payload)}`) {
    fail('intervention_isolation.payload_digest_mismatch', 'Isolation Profile payload digest does not match its payload')
  }
  validatePayload(profile.payload, expected.dedicatedIdentityDigest)

  return {
    status: 'admitted',
    artifactId: profile.artifactId,
    schemaId: profile.schemaId,
    schemaVersion: profile.schemaVersion,
    artifactDigest: `sha256:${digestJson(profile)}`,
    payloadDigest: profile.payloadDigest,
    profileId: profile.payload.profileId,
    profileVersion: profile.payload.profileVersion,
    executionIsolation: profile.payload.executionIsolation,
    dedicatedIdentityDigest: profile.payload.dedicatedIdentityDigest,
    sourceBoundaries: profile.sourceBoundaries,
    channels: Object.fromEntries(CHANNEL_NAMES.map((name) => [name, {
      state: profile.payload.channels[name].state,
      authority: profile.payload.channels[name].authority,
      policyDigest: profile.payload.channels[name].policyDigest,
      coverage: profile.payload.channels[name].coverage
    }])),
    authorizedRunnerActions: [...profile.payload.authorizedRunnerActions],
    overallCoverage: profile.payload.overallCoverage,
    formalAdmissible: true,
    artifact: profile
  }
}

function validateProducer(producer) {
  exactKeys(producer, ['id', 'version', 'digest'], 'producer')
  stableId(producer.id, 'producer.id')
  if (typeof producer.version !== 'string' || !SEMVER.test(producer.version)) {
    fail('intervention_isolation.profile_contract_invalid', 'producer.version is invalid')
  }
  digest(producer.digest, 'producer.digest')
}

function validateBinding(binding, expected) {
  const allowed = ['suiteId', 'plannedSlotId', 'trialId', 'caseId', 'caseSeal']
  if (!plainObject(binding) || Object.keys(binding).length === 0) {
    fail('intervention_isolation.binding_invalid', 'Isolation Profile binding is required')
  }
  rejectUnknownKeys(binding, allowed, 'binding')
  for (const key of ['suiteId', 'plannedSlotId', 'trialId', 'caseId']) {
    if (binding[key] !== undefined) stableId(binding[key], `binding.${key}`)
  }
  if (binding.caseSeal !== undefined) digest(binding.caseSeal, 'binding.caseSeal')
  if ((binding.caseId === undefined) !== (binding.caseSeal === undefined)) {
    fail('intervention_isolation.binding_invalid', 'caseId and caseSeal must be bound together')
  }
  if (binding.suiteId === undefined && binding.trialId === undefined && binding.caseId === undefined) {
    fail('intervention_isolation.binding_invalid', 'Profile must bind a Suite, Trial, or sealed Case')
  }
  for (const key of allowed) {
    if (binding[key] === undefined) continue
    if (expected[key] === null || expected[key] === undefined || binding[key] !== expected[key]) {
      fail('intervention_isolation.binding_mismatch', `Isolation Profile ${key} does not match the planned Trial`)
    }
  }
}

function validateSourceBoundaries(boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length === 0) {
    fail('intervention_isolation.source_boundary_invalid', 'Isolation Profile source boundaries are required')
  }
  const sourceIds = new Set()
  for (const boundary of boundaries) {
    rejectUnknownKeys(boundary, [
      'authorityClass', 'sourceId', 'digest', 'throughSequence', 'declaredTotal', 'clockDomain', 'coverage'
    ], 'sourceBoundary')
    for (const field of ['authorityClass', 'sourceId', 'digest', 'coverage']) {
      if (boundary[field] === undefined) {
        fail('intervention_isolation.source_boundary_invalid', `sourceBoundary.${field} is required`)
      }
    }
    if (!ALLOWED_SOURCE_AUTHORITY.has(boundary.authorityClass)) {
      fail('intervention_isolation.source_boundary_invalid', 'sourceBoundary authority is invalid')
    }
    stableId(boundary.sourceId, 'sourceBoundary.sourceId')
    if (sourceIds.has(boundary.sourceId)) {
      fail('intervention_isolation.source_boundary_invalid', 'sourceBoundary IDs must be unique')
    }
    sourceIds.add(boundary.sourceId)
    digest(boundary.digest, 'sourceBoundary.digest')
    validateOptionalNonnegativeInteger(boundary.throughSequence, 'sourceBoundary.throughSequence')
    validateOptionalNonnegativeInteger(boundary.declaredTotal, 'sourceBoundary.declaredTotal')
    if (boundary.clockDomain !== undefined
        && boundary.clockDomain !== null
        && (typeof boundary.clockDomain !== 'string' || boundary.clockDomain.length > 160)) {
      fail('intervention_isolation.source_boundary_invalid', 'sourceBoundary.clockDomain is invalid')
    }
    validateCoverage(boundary.coverage, 'sourceBoundary.coverage')
    if (boundary.coverage.state !== 'complete') {
      fail('intervention_isolation.source_boundary_incomplete', 'Formal Profile source boundaries must be complete')
    }
  }
}

function validatePayload(payload, expectedIdentityDigest) {
  exactKeys(payload, [
    'profileId',
    'profileVersion',
    'executionIsolation',
    'dedicatedIdentityDigest',
    'channels',
    'authorizedRunnerActions',
    'overallCoverage',
    'formalAdmissible'
  ], 'payload')
  stableId(payload.profileId, 'payload.profileId')
  if (typeof payload.profileVersion !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(payload.profileVersion)) {
    fail('intervention_isolation.profile_contract_invalid', 'payload.profileVersion is invalid')
  }
  if (!ALLOWED_EXECUTION_ISOLATION.has(payload.executionIsolation)) {
    fail('intervention_isolation.profile_contract_invalid', 'payload.executionIsolation is invalid')
  }
  digest(payload.dedicatedIdentityDigest, 'payload.dedicatedIdentityDigest')
  if (payload.dedicatedIdentityDigest !== expectedIdentityDigest) {
    fail('intervention_isolation.identity_mismatch', 'Isolation Profile is not bound to the current Runner identity/session')
  }
  exactKeys(payload.channels, CHANNEL_NAMES, 'payload.channels')
  for (const name of CHANNEL_NAMES) validateChannel(name, payload.channels[name])
  if (!Array.isArray(payload.authorizedRunnerActions)
      || new Set(payload.authorizedRunnerActions).size !== REQUIRED_RUNNER_ACTIONS.length
      || REQUIRED_RUNNER_ACTIONS.some((action) => !payload.authorizedRunnerActions.includes(action))) {
    fail('intervention_isolation.runner_actions_invalid', 'Profile must freeze the exact Runner action set')
  }
  validateCoverage(payload.overallCoverage, 'payload.overallCoverage')
  if (payload.overallCoverage.state !== 'complete' || payload.formalAdmissible !== true) {
    fail('intervention_isolation.profile_not_admissible', 'Isolation Profile is not formally admissible')
  }
}

function validateChannel(name, channel) {
  exactKeys(channel, ['state', 'authority', 'policyDigest', 'coverage'], `payload.channels.${name}`)
  if (!REQUIRED_CHANNEL_STATES[name].has(channel.state)) {
    fail('intervention_isolation.channel_uncontrolled', `${name} is not in a formally admissible state`)
  }
  if (!ALLOWED_AUTHORITY.has(channel.authority)) {
    fail('intervention_isolation.profile_contract_invalid', `${name} authority is invalid`)
  }
  if (!REQUIRED_CHANNEL_AUTHORITIES[name].has(channel.authority)) {
    fail(
      'intervention_isolation.channel_authority_insufficient',
      `${name} authority cannot establish Formal coverage`
    )
  }
  if (channel.state === 'disabled' && !['none', 'operating_system', 'runner'].includes(channel.authority)) {
    fail('intervention_isolation.profile_contract_invalid', `${name} disabled authority is invalid`)
  }
  digest(channel.policyDigest, `payload.channels.${name}.policyDigest`)
  validateCoverage(channel.coverage, `payload.channels.${name}.coverage`)
  if (channel.coverage.state !== 'complete') {
    fail('intervention_isolation.channel_coverage_incomplete', `${name} coverage is incomplete`)
  }
}

function validateCoverage(coverage, field) {
  exactKeys(coverage, ['state', 'reason'], field)
  if (!['complete', 'partial', 'unavailable', 'not_applicable'].includes(coverage.state)) {
    fail('intervention_isolation.profile_contract_invalid', `${field}.state is invalid`)
  }
  if (coverage.state === 'complete') {
    if (coverage.reason !== null) fail('intervention_isolation.profile_contract_invalid', `${field}.reason must be null`)
    return
  }
  exactKeys(coverage.reason, ['code'], `${field}.reason`)
  stableId(coverage.reason.code, `${field}.reason.code`)
}

function exactKeys(value, expected, field) {
  if (!plainObject(value)) fail('intervention_isolation.profile_contract_invalid', `${field} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('intervention_isolation.profile_contract_invalid', `${field} has missing or unknown fields`)
  }
}

function rejectUnknownKeys(value, allowed, field) {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    fail('intervention_isolation.profile_contract_invalid', `${field} has unknown fields`)
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableId(value, field) {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    fail('intervention_isolation.profile_contract_invalid', `${field} is invalid`)
  }
}

function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail('intervention_isolation.profile_contract_invalid', `${field} is not a sha256 digest`)
  }
}

function validateOptionalNonnegativeInteger(value, field) {
  if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    fail('intervention_isolation.source_boundary_invalid', `${field} is invalid`)
  }
}

function fail(code, message) {
  throw new InterventionIsolationError(code, message)
}
