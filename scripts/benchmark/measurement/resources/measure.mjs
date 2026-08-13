import { canonicalJson, digestJson } from '../../protocol/canonical.mjs'
import {
  defaultResourceMeasurementProfile,
  validateResourceMetricDescriptor,
  validateResourceMeasurementProfile
} from './profile.mjs'

export const RESOURCE_MEASUREMENT_SCHEMA_ID = 'rovai.benchmark.resource-measurement'
export const RESOURCE_MEASUREMENT_SCHEMA_VERSION = '1.0.0'

const SUPPORTED_METRICS = new Set([
  'makespan_ms',
  'agent_active_union_ms',
  'agent_active_sum_ms',
  'max_agent_concurrency',
  'coordination_wait_ms',
  'critical_path_ms',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'cost_usd_micros'
])

export function measureTrialResources({ profile = defaultResourceMeasurementProfile(), observation }) {
  validateResourceMeasurementProfile(profile)
  if (!observation || typeof observation !== 'object') throw new TypeError('observation must be an object')

  const context = buildContext(observation)
  const measurements = profile.metrics.map((descriptor) => measure(descriptor, context))
  const payload = {
    schemaId: RESOURCE_MEASUREMENT_SCHEMA_ID,
    schemaVersion: RESOURCE_MEASUREMENT_SCHEMA_VERSION,
    profile: {
      id: profile.id,
      version: profile.version,
      payloadDigest: profile.profileDigest
    },
    measurements
  }
  return { ...payload, integrity: { payloadDigest: digestJson(payload) } }
}

export function validateResourceMeasurement(artifact) {
  if (!artifact || typeof artifact !== 'object') throw new TypeError('resource measurement must be an object')
  exactKeys(
    artifact,
    ['schemaId', 'schemaVersion', 'profile', 'measurements', 'integrity'],
    'resource measurement'
  )
  exactKeys(artifact.profile, ['id', 'version', 'payloadDigest'], 'resource measurement profile')
  exactKeys(artifact.integrity, ['payloadDigest'], 'resource measurement integrity')
  if (artifact.schemaId !== RESOURCE_MEASUREMENT_SCHEMA_ID
      || artifact.schemaVersion !== RESOURCE_MEASUREMENT_SCHEMA_VERSION) {
    throw new TypeError('unsupported resource measurement schema')
  }
  if (!artifact.profile || typeof artifact.profile.payloadDigest !== 'string') {
    throw new TypeError('resource measurement profile reference is missing')
  }
  if (!/^[a-f0-9]{64}$/u.test(artifact.profile.payloadDigest)) {
    throw new TypeError('resource measurement profile digest is invalid')
  }
  if (!Array.isArray(artifact.measurements)) throw new TypeError('resource measurements must be an array')
  const { integrity, ...payload } = artifact
  if (!integrity || integrity.payloadDigest !== digestJson(payload)) {
    throw new TypeError('resource measurement digest mismatch')
  }
  for (const [index, measurement] of artifact.measurements.entries()) {
    validateMeasurement(measurement, index)
  }
  if (new Set(artifact.measurements.map(({ id }) => id)).size !== artifact.measurements.length) {
    throw new TypeError('resource measurements must have unique ids')
  }
  return artifact
}

function buildContext(observation) {
  return {
    trial: inspectIntervalSource(observation.trialInterval, 'resource.trial_interval'),
    runs: inspectIntervalCollection(observation.agentRuns, 'resource.agent_runs'),
    waits: inspectIntervalCollection(observation.coordinationWaits, 'resource.coordination_waits'),
    criticalPath: inspectCriticalPath(observation.criticalPath),
    usage: inspectUsage(observation.usage)
  }
}

function measure(descriptor, context) {
  if (!SUPPORTED_METRICS.has(descriptor.id)) {
    return unavailable(descriptor, 'resource.metric_implementation_unavailable', 'unavailable', [])
  }
  switch (descriptor.id) {
    case 'makespan_ms':
      return fromSingleInterval(descriptor, context.trial)
    case 'agent_active_union_ms':
      return fromIntervals(descriptor, context.runs, unionDuration)
    case 'agent_active_sum_ms':
      return fromIntervals(descriptor, context.runs, sumDuration)
    case 'max_agent_concurrency':
      return fromIntervals(descriptor, context.runs, maxConcurrency)
    case 'coordination_wait_ms':
      return fromIntervals(descriptor, context.waits, unionDuration)
    case 'critical_path_ms':
      return fromCriticalPath(descriptor, context.criticalPath)
    case 'input_tokens':
    case 'output_tokens':
    case 'total_tokens':
    case 'cost_usd_micros':
      return fromUsageReceipts(descriptor, context.usage)
    default:
      return unavailable(descriptor, 'resource.metric_implementation_unavailable', 'unavailable', [])
  }
}

function fromSingleInterval(descriptor, source) {
  if (source.status !== 'complete') {
    return unavailable(descriptor, source.reasonCode, source.status, source.evidenceReferences)
  }
  const mismatch = sourceMismatch(descriptor, source)
  if (mismatch) return unavailable(descriptor, mismatch, 'invalid', source.evidenceReferences)
  if (source.evidenceReferences.length === 0) {
    return unavailable(descriptor, 'resource.trial_interval_evidence_missing', 'invalid', [])
  }
  return available(descriptor, source.interval.endMs - source.interval.startMs, source.evidenceReferences, 1)
}

function fromIntervals(descriptor, source, aggregate) {
  if (source.status !== 'complete') {
    return unavailable(descriptor, source.reasonCode, source.status, source.evidenceReferences)
  }
  const mismatch = sourceMismatch(descriptor, source)
  if (mismatch) return unavailable(descriptor, mismatch, 'invalid', source.evidenceReferences)
  if (source.evidenceReferences.length === 0) {
    return unavailable(descriptor, `resource.${descriptor.id}_evidence_missing`, 'invalid', [])
  }
  return available(descriptor, aggregate(source.intervals), source.evidenceReferences, source.intervals.length)
}

function fromCriticalPath(descriptor, source) {
  if (source.status !== 'complete') {
    return unavailable(descriptor, source.reasonCode, source.status, source.evidenceReferences)
  }
  const mismatch = sourceMismatch(descriptor, source)
  if (mismatch) return unavailable(descriptor, mismatch, 'invalid', source.evidenceReferences)
  if (source.evidenceReferences.length === 0) {
    return unavailable(descriptor, 'resource.critical_path_evidence_missing', 'invalid', [])
  }
  const result = longestPath(source.nodes, source.edges)
  if (!result.available) {
    return unavailable(descriptor, result.reasonCode, 'invalid', source.evidenceReferences)
  }
  return available(descriptor, result.value, source.evidenceReferences, source.nodes.length)
}

function fromUsageReceipts(descriptor, source) {
  if (source.status !== 'complete') {
    return unavailable(descriptor, source.reasonCode, source.status, source.evidenceReferences)
  }
  const mismatch = sourceMismatch(descriptor, source)
  if (mismatch) return unavailable(descriptor, mismatch, 'invalid', source.evidenceReferences)
  if (source.receipts.length === 0 || source.evidenceReferences.length === 0) {
    return unavailable(descriptor, 'resource.usage_receipt_evidence_missing', 'invalid', source.evidenceReferences)
  }
  if (source.receipts.some((receipt) => (
    receipt.authority?.status !== 'authoritative' || receipt.authority?.kind !== 'provider_receipt'
  ))) {
    return unavailable(
      descriptor,
      'resource.usage_receipt_not_authoritative',
      'invalid',
      source.evidenceReferences
    )
  }
  let values
  if (descriptor.id === 'total_tokens') {
    values = source.receipts.map((receipt) => {
      if (isNonNegativeInteger(receipt.metrics?.total_tokens)) return receipt.metrics.total_tokens
      if (isNonNegativeInteger(receipt.metrics?.input_tokens)
          && isNonNegativeInteger(receipt.metrics?.output_tokens)) {
        return receipt.metrics.input_tokens + receipt.metrics.output_tokens
      }
      return null
    })
  } else {
    values = source.receipts.map((receipt) => receipt.metrics?.[descriptor.id] ?? null)
  }
  if (values.some((value) => !isNonNegativeInteger(value))) {
    return unavailable(
      descriptor,
      `resource.${descriptor.id}_receipt_incomplete`,
      'partial',
      source.evidenceReferences
    )
  }
  return available(
    descriptor,
    values.reduce((sum, value) => sum + value, 0),
    source.evidenceReferences,
    source.receipts.length
  )
}

function inspectIntervalSource(source, prefix) {
  if (!source || source.coverage?.status !== 'complete') {
    return incompleteSource(source, `${prefix}_coverage_incomplete`)
  }
  try {
    const interval = normalizeInterval(source)
    return {
      status: 'complete',
      interval,
      clockDomain: source.clockDomain,
      authority: source.authority,
      evidenceReferences: uniqueReferences(source.evidenceReferences)
    }
  } catch {
    return {
      status: 'invalid',
      reasonCode: `${prefix}_invalid`,
      evidenceReferences: uniqueReferences(source.evidenceReferences)
    }
  }
}

function inspectIntervalCollection(source, prefix) {
  if (!source || source.coverage?.status !== 'complete') {
    return incompleteSource(source, `${prefix}_coverage_incomplete`)
  }
  try {
    if (!Array.isArray(source.intervals)) throw new TypeError('intervals missing')
    const intervals = source.intervals.map(normalizeInterval)
    return {
      status: 'complete',
      intervals,
      clockDomain: source.clockDomain,
      authority: source.authority,
      evidenceReferences: uniqueReferences([
        ...(source.evidenceReferences ?? []),
        ...source.intervals.flatMap((interval) => interval.evidenceReferences ?? [])
      ])
    }
  } catch {
    return {
      status: 'invalid',
      reasonCode: `${prefix}_invalid`,
      evidenceReferences: uniqueReferences(source.evidenceReferences)
    }
  }
}

function inspectCriticalPath(source) {
  if (!source || source.coverage?.status !== 'complete') {
    return incompleteSource(source, 'resource.critical_path_coverage_incomplete')
  }
  try {
    if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) throw new TypeError('graph missing')
    const nodes = source.nodes.map((node) => {
      if (typeof node?.id !== 'string' || node.id.length === 0 || !isNonNegativeFinite(node.durationMs)) {
        throw new TypeError('invalid node')
      }
      return { id: node.id, durationMs: node.durationMs }
    })
    const edges = source.edges.map((edge) => {
      if (typeof edge?.from !== 'string' || typeof edge?.to !== 'string') throw new TypeError('invalid edge')
      return { from: edge.from, to: edge.to }
    })
    return {
      status: 'complete',
      nodes,
      edges,
      clockDomain: source.clockDomain,
      authority: source.authority,
      evidenceReferences: uniqueReferences([
        ...(source.evidenceReferences ?? []),
        ...source.nodes.flatMap((node) => node.evidenceReferences ?? []),
        ...source.edges.flatMap((edge) => edge.evidenceReferences ?? [])
      ])
    }
  } catch {
    return {
      status: 'invalid',
      reasonCode: 'resource.critical_path_graph_invalid',
      evidenceReferences: uniqueReferences(source.evidenceReferences)
    }
  }
}

function inspectUsage(source) {
  if (!source || source.coverage?.status !== 'complete') {
    return incompleteSource(source, 'resource.usage_receipt_coverage_incomplete')
  }
  if (!Array.isArray(source.receipts)) {
    return {
      status: 'invalid',
      reasonCode: 'resource.usage_receipts_invalid',
      evidenceReferences: uniqueReferences(source.evidenceReferences)
    }
  }
  return {
    status: 'complete',
    receipts: source.receipts,
    clockDomain: source.clockDomain,
    authority: source.authority,
    evidenceReferences: uniqueReferences([
      ...(source.evidenceReferences ?? []),
      ...source.receipts.flatMap((receipt) => receipt.evidenceReferences ?? [])
    ])
  }
}

function incompleteSource(source, defaultReasonCode) {
  const status = source?.coverage?.status === 'partial' ? 'partial' : 'unavailable'
  return {
    status,
    reasonCode: source?.coverage?.reasonCode ?? defaultReasonCode,
    evidenceReferences: uniqueReferences(source?.evidenceReferences)
  }
}

function normalizeInterval(interval) {
  if (!isNonNegativeFinite(interval?.startMs) || !isNonNegativeFinite(interval?.endMs)
      || interval.endMs < interval.startMs) {
    throw new TypeError('invalid monotonic interval')
  }
  return { startMs: interval.startMs, endMs: interval.endMs }
}

function sumDuration(intervals) {
  return intervals.reduce((sum, interval) => sum + interval.endMs - interval.startMs, 0)
}

function unionDuration(intervals) {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  let start = sorted[0].startMs
  let end = sorted[0].endMs
  let total = 0
  for (const interval of sorted.slice(1)) {
    if (interval.startMs <= end) {
      end = Math.max(end, interval.endMs)
    } else {
      total += end - start
      start = interval.startMs
      end = interval.endMs
    }
  }
  return total + end - start
}

function maxConcurrency(intervals) {
  const events = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .flatMap((interval) => [
      { at: interval.startMs, delta: 1 },
      { at: interval.endMs, delta: -1 }
    ])
    .sort((left, right) => left.at - right.at || left.delta - right.delta)
  let current = 0
  let maximum = 0
  for (const event of events) {
    current += event.delta
    maximum = Math.max(maximum, current)
  }
  return maximum
}

function longestPath(nodes, edges) {
  const durations = new Map(nodes.map((node) => [node.id, node.durationMs]))
  if (durations.size !== nodes.length) return { available: false, reasonCode: 'resource.critical_path_duplicate_node' }
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    if (!durations.has(edge.from) || !durations.has(edge.to)) {
      return { available: false, reasonCode: 'resource.critical_path_unknown_node' }
    }
    outgoing.get(edge.from).push(edge.to)
    incoming.set(edge.to, incoming.get(edge.to) + 1)
  }
  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort()
  const distance = new Map(nodes.map((node) => [node.id, node.durationMs]))
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift()
    visited += 1
    for (const next of outgoing.get(id)) {
      distance.set(next, Math.max(distance.get(next), distance.get(id) + durations.get(next)))
      incoming.set(next, incoming.get(next) - 1)
      if (incoming.get(next) === 0) queue.push(next)
    }
    queue.sort()
  }
  if (visited !== nodes.length) return { available: false, reasonCode: 'resource.critical_path_cycle' }
  return { available: true, value: nodes.length === 0 ? 0 : Math.max(...distance.values()) }
}

function available(descriptor, value, evidenceReferences, observedCount) {
  return {
    ...descriptor,
    status: 'available',
    value,
    coverage: {
      requirement: descriptor.coverage,
      status: 'complete',
      observedCount,
      reasonCodes: []
    },
    evidenceReferences: uniqueReferences(evidenceReferences)
  }
}

function unavailable(descriptor, reasonCode, coverageStatus, evidenceReferences) {
  return {
    ...descriptor,
    status: 'unavailable',
    reason: { code: reasonCode },
    coverage: {
      requirement: descriptor.coverage,
      status: coverageStatus,
      observedCount: null,
      reasonCodes: [reasonCode]
    },
    evidenceReferences: uniqueReferences(evidenceReferences)
  }
}

function validateMeasurement(measurement, index) {
  if (!measurement || typeof measurement !== 'object') throw new TypeError(`measurements[${index}] is invalid`)
  exactKeys(
    measurement,
    measurement.status === 'available'
      ? [
          'id', 'unit', 'direction', 'interval', 'aggregation', 'clockDomain', 'authority',
          'coverage', 'status', 'value', 'evidenceReferences'
        ]
      : [
          'id', 'unit', 'direction', 'interval', 'aggregation', 'clockDomain', 'authority',
          'coverage', 'status', 'reason', 'evidenceReferences'
        ],
    `measurements[${index}]`
  )
  exactKeys(
    measurement.coverage,
    ['requirement', 'status', 'observedCount', 'reasonCodes'],
    `measurements[${index}].coverage`
  )
  for (const field of ['id', 'unit', 'direction', 'interval', 'aggregation', 'clockDomain', 'authority']) {
    if (typeof measurement[field] !== 'string' || measurement[field].length === 0) {
      throw new TypeError(`measurements[${index}].${field} is invalid`)
    }
  }
  validateResourceMetricDescriptor({
    id: measurement.id,
    unit: measurement.unit,
    direction: measurement.direction,
    interval: measurement.interval,
    aggregation: measurement.aggregation,
    clockDomain: measurement.clockDomain,
    authority: measurement.authority,
    coverage: measurement.coverage?.requirement
  }, `measurements[${index}]`)
  if (!['available', 'unavailable'].includes(measurement.status)) {
    throw new TypeError(`measurements[${index}].status is invalid`)
  }
  if (!measurement.coverage || !['complete', 'partial', 'unavailable', 'invalid'].includes(measurement.coverage.status)
      || !Array.isArray(measurement.coverage.reasonCodes)) {
    throw new TypeError(`measurements[${index}].coverage is invalid`)
  }
  if (measurement.status === 'available' && !isNonNegativeFinite(measurement.value)) {
    throw new TypeError(`measurements[${index}].value is invalid`)
  }
  if (measurement.status === 'available' && measurement.coverage.status !== 'complete') {
    throw new TypeError(`measurements[${index}] cannot be available with incomplete coverage`)
  }
  if (measurement.status === 'available'
      && (!Number.isSafeInteger(measurement.coverage.observedCount)
        || measurement.coverage.observedCount < 0
        || measurement.coverage.reasonCodes.length !== 0)) {
    throw new TypeError(`measurements[${index}].coverage complete state is invalid`)
  }
  if (measurement.status === 'unavailable'
      && (typeof measurement.reason?.code !== 'string' || measurement.reason.code.length === 0)) {
    throw new TypeError(`measurements[${index}].reason is invalid`)
  }
  if (measurement.status === 'unavailable') {
    exactKeys(measurement.reason, ['code'], `measurements[${index}].reason`)
    if (measurement.coverage.observedCount !== null
        || !measurement.coverage.reasonCodes.includes(measurement.reason.code)) {
      throw new TypeError(`measurements[${index}].coverage unavailable state is invalid`)
    }
  }
  if (!Array.isArray(measurement.evidenceReferences)) {
    throw new TypeError(`measurements[${index}].evidenceReferences is invalid`)
  }
  if (measurement.status === 'available' && measurement.evidenceReferences.length === 0) {
    throw new TypeError(`measurements[${index}].evidenceReferences must not be empty for available metrics`)
  }
  for (const [referenceIndex, reference] of measurement.evidenceReferences.entries()) {
    validateEvidenceReference(reference, `measurements[${index}].evidenceReferences[${referenceIndex}]`)
  }
}

function validateEvidenceReference(reference, path) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new TypeError(`${path} is invalid`)
  }
  const allowed = new Set([
    'artifactRole', 'schemaId', 'schemaVersion', 'payloadDigest', 'disclosure', 'trialId'
  ])
  const keys = Object.keys(reference)
  if (keys.some((key) => !allowed.has(key))
      || ['artifactRole', 'schemaId', 'schemaVersion', 'payloadDigest', 'disclosure']
        .some((key) => !keys.includes(key))
      || typeof reference.artifactRole !== 'string'
      || typeof reference.schemaId !== 'string'
      || typeof reference.schemaVersion !== 'string'
      || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(reference.payloadDigest)
      || !['private', 'public'].includes(reference.disclosure)
      || (reference.trialId !== undefined
        && (typeof reference.trialId !== 'string' || reference.trialId.length === 0))) {
    throw new TypeError(`${path} is invalid`)
  }
}

function exactKeys(value, expected, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(keys)) {
    throw new TypeError(`${path} keys are not closed`)
  }
}

function sourceMismatch(descriptor, source) {
  if (source.clockDomain !== descriptor.clockDomain) return 'resource.source_clock_domain_mismatch'
  if (source.authority !== descriptor.authority) return 'resource.source_authority_mismatch'
  return null
}

function uniqueReferences(references = []) {
  const byIdentity = new Map()
  for (const reference of references ?? []) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) continue
    byIdentity.set(canonicalJson(reference), structuredClone(reference))
  }
  return [...byIdentity.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)
}

function isNonNegativeFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}
