import { digestJson } from '../../protocol/canonical.mjs'

export const RESOURCE_PROFILE_SCHEMA_ID = 'rovai.benchmark.resource-measurement-profile'
export const RESOURCE_PROFILE_SCHEMA_VERSION = '1.0.0'

const DIRECTIONS = new Set(['lower_is_better', 'higher_is_better', 'descriptive'])
const AGGREGATIONS = new Set(['elapsed', 'union', 'sum', 'maximum', 'receipt_total', 'longest_path'])
const CLOCK_DOMAINS = new Set(['runner_monotonic', 'core_persisted_wall_clock', 'provider_receipt'])
const AUTHORITIES = new Set(['runner', 'core', 'provider'])
const COVERAGE_REQUIREMENTS = new Set(['complete_required', 'partial_allowed'])
const DEFAULT_METRICS = Object.freeze([
  metric('makespan_ms', 'milliseconds', 'lower_is_better', 'dispatch_to_terminal', 'elapsed', 'runner_monotonic', 'runner', 'complete_required'),
  metric('agent_active_union_ms', 'milliseconds', 'lower_is_better', 'agent_run_intervals', 'union', 'core_persisted_wall_clock', 'core', 'complete_required'),
  metric('agent_active_sum_ms', 'milliseconds', 'lower_is_better', 'agent_run_intervals', 'sum', 'core_persisted_wall_clock', 'core', 'complete_required'),
  metric('max_agent_concurrency', 'count', 'descriptive', 'agent_run_intervals', 'maximum', 'core_persisted_wall_clock', 'core', 'complete_required'),
  metric('coordination_wait_ms', 'milliseconds', 'lower_is_better', 'coordination_wait_intervals', 'union', 'core_persisted_wall_clock', 'core', 'complete_required'),
  metric('critical_path_ms', 'milliseconds', 'lower_is_better', 'dependency_graph', 'longest_path', 'core_persisted_wall_clock', 'core', 'complete_required'),
  metric('input_tokens', 'tokens', 'lower_is_better', 'trial_provider_receipts', 'receipt_total', 'provider_receipt', 'provider', 'complete_required'),
  metric('output_tokens', 'tokens', 'lower_is_better', 'trial_provider_receipts', 'receipt_total', 'provider_receipt', 'provider', 'complete_required'),
  metric('total_tokens', 'tokens', 'lower_is_better', 'trial_provider_receipts', 'receipt_total', 'provider_receipt', 'provider', 'complete_required'),
  metric('cost_usd_micros', 'usd_micros', 'lower_is_better', 'trial_provider_receipts', 'receipt_total', 'provider_receipt', 'provider', 'complete_required')
])

export function defaultResourceMeasurementProfile() {
  return createResourceMeasurementProfile({
    id: 'rovai-default-resource-measurement',
    version: '1.0.0',
    metrics: DEFAULT_METRICS
  })
}

export function createResourceMeasurementProfile({ id, version, metrics }) {
  requireNonEmptyString(id, 'profile.id')
  requireNonEmptyString(version, 'profile.version')
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw new TypeError('profile.metrics must be a non-empty array')
  }
  const normalized = metrics.map((entry, index) => normalizeMetric(entry, index))
  const ids = new Set(normalized.map((entry) => entry.id))
  if (ids.size !== normalized.length) throw new TypeError('profile.metrics must have unique ids')
  const payload = {
    schemaId: RESOURCE_PROFILE_SCHEMA_ID,
    schemaVersion: RESOURCE_PROFILE_SCHEMA_VERSION,
    id,
    version,
    metrics: normalized.sort((left, right) => left.id.localeCompare(right.id))
  }
  return deepFreeze({ ...payload, profileDigest: digestJson(payload) })
}

export function validateResourceMeasurementProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('resource profile must be an object')
  exactKeys(
    profile,
    ['schemaId', 'schemaVersion', 'id', 'version', 'metrics', 'profileDigest'],
    'resource profile'
  )
  if (profile.schemaId !== RESOURCE_PROFILE_SCHEMA_ID
      || profile.schemaVersion !== RESOURCE_PROFILE_SCHEMA_VERSION) {
    throw new TypeError('unsupported resource profile schema')
  }
  const rebuilt = createResourceMeasurementProfile(profile)
  if (profile.profileDigest !== rebuilt.profileDigest) {
    throw new TypeError('resource profile digest mismatch')
  }
  return profile
}

export function validateResourceMetricDescriptor(descriptor, path = 'metric') {
  normalizeMetric(descriptor, path)
  return descriptor
}

function metric(id, unit, direction, interval, aggregation, clockDomain, authority, coverage) {
  return { id, unit, direction, interval, aggregation, clockDomain, authority, coverage }
}

function normalizeMetric(entry, index) {
  const path = typeof index === 'number' ? `profile.metrics[${index}]` : index
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`${path} must be an object`)
  }
  exactKeys(entry, [
    'id', 'unit', 'direction', 'interval', 'aggregation', 'clockDomain', 'authority', 'coverage'
  ], path)
  for (const key of ['id', 'unit', 'aggregation', 'clockDomain', 'authority', 'coverage']) {
    requireNonEmptyString(entry[key], `${path}.${key}`)
  }
  if (!DIRECTIONS.has(entry.direction)) {
    throw new TypeError(`${path}.direction is unsupported`)
  }
  if (!AGGREGATIONS.has(entry.aggregation)) {
    throw new TypeError(`${path}.aggregation is unsupported`)
  }
  if (!CLOCK_DOMAINS.has(entry.clockDomain)) {
    throw new TypeError(`${path}.clockDomain is unsupported`)
  }
  if (!AUTHORITIES.has(entry.authority)) {
    throw new TypeError(`${path}.authority is unsupported`)
  }
  if (!COVERAGE_REQUIREMENTS.has(entry.coverage)) {
    throw new TypeError(`${path}.coverage is unsupported`)
  }
  return {
    id: entry.id,
    unit: entry.unit,
    direction: entry.direction,
    interval: entry.interval,
    aggregation: entry.aggregation,
    clockDomain: entry.clockDomain,
    authority: entry.authority,
    coverage: entry.coverage
  }
}

function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(keys)) {
    throw new TypeError(`${path} keys are not closed`)
  }
}

function requireNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${path} must be a non-empty string`)
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
