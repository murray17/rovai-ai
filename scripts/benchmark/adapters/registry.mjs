import { validateBenchmarkRunV3 } from '../protocol/v3.mjs'
import { digestJson } from '../protocol/canonical.mjs'

const adapters = new Map()

register({
  id: 'qualification-suite-v032',
  matches: (source) => source?.schemaVersion === 1 && source?.suiteVersion === 'v0.32',
  normalize: (source) => normalizeLegacyQualificationSuite(source, {
    adapterId: 'qualification-suite-v032',
    schemaVersion: 1,
    suiteVersion: 'v0.32'
  }),
  normalizeTrial: normalizeLegacyTrial
})

register({
  id: 'qualification-suite-v034',
  matches: (source) => source?.schemaVersion === 2
    && (source?.suiteVersion === 'v0.34' || source?.version === 'v0.34'),
  normalize: normalizeV034Suite,
  normalizeTrial: normalizeLegacyTrial
})

register({
  id: 'diagnostic-portfolio-v036',
  matches: (source) => source?.schemaVersion === 1
    && typeof source?.portfolioId === 'string'
    && typeof source?.portfolioVersion === 'string',
  normalize: normalizeV036Portfolio
})

register({
  id: 'benchmark-protocol-v3',
  matches: (source) => source?.schemaVersion === 3
    || source?.benchmarkProtocolVersion !== undefined,
  normalize: (source) => {
    validateBenchmarkRunV3(source)
    return {
      adapterId: 'benchmark-protocol-v3',
      sourceSchemaVersion: source.schemaVersion,
      lane: source.profile.lane,
      suite: source.suite,
      slots: source.artifactIndex.filter((entry) => entry.artifactRole === 'trial'),
      source
    }
  }
})

export function registerBenchmarkAdapter(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || typeof adapter.matches !== 'function'
      || typeof adapter.normalize !== 'function') {
    throw new Error('Benchmark Adapter registration is invalid')
  }
  if (adapters.has(adapter.id)) throw new Error(`Benchmark Adapter is already registered: ${adapter.id}`)
  adapters.set(adapter.id, Object.freeze({ ...adapter }))
}

export function listBenchmarkAdapters() {
  return [...adapters.keys()]
}

export function getBenchmarkAdapter(id) {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`unknown Benchmark Adapter: ${id}`)
  return adapter
}

export function resolveBenchmarkAdapter(source, requestedId = null) {
  if (requestedId) {
    const adapter = getBenchmarkAdapter(requestedId)
    if (!adapter.matches(source)) throw new Error(`artifact is not accepted by Benchmark Adapter ${requestedId}`)
    return adapter
  }
  const matches = [...adapters.values()].filter((adapter) => adapter.matches(source))
  if (matches.length !== 1) {
    const major = source?.schemaVersion ?? 'missing'
    throw new Error(matches.length === 0
      ? `unsupported or unknown Benchmark artifact schema major: ${major}`
      : 'Benchmark artifact matches more than one Adapter')
  }
  return matches[0]
}

export function normalizeBenchmarkArtifact(source, options = {}) {
  const adapter = resolveBenchmarkAdapter(source, options.adapterId)
  return adapter.normalize(source, options)
}

export function normalizeLegacyQualificationTrial(source, adapterId) {
  const adapter = getBenchmarkAdapter(adapterId)
  if (typeof adapter.normalizeTrial !== 'function') {
    throw new Error(`Benchmark Adapter cannot normalize Trials: ${adapterId}`)
  }
  return adapter.normalizeTrial(source)
}

export function validateLegacyV034SuiteDefinition(suite) {
  if (suite?.schemaVersion !== 2 || suite.version !== 'v0.34' || suite.rounds !== 3
      || !Array.isArray(suite.cases) || suite.cases.length !== 4 || !suite.calibration) {
    throw new Error('Legacy v0.34 Suite requires suite.version=v0.34, 3 rounds, 4 cases, and calibration')
  }
  const ids = suite.cases.map((entry) => entry?.id)
  if (ids.some((id) => typeof id !== 'string' || id === '') || new Set(ids).size !== 4) {
    throw new Error('Legacy v0.34 Suite Case identities are invalid')
  }
  return suite
}

function register(adapter) {
  adapters.set(adapter.id, Object.freeze(adapter))
}

function normalizeV034Suite(source) {
  if (source.version === 'v0.34') {
    validateLegacyV034SuiteDefinition(source)
    return {
      adapterId: 'qualification-suite-v034',
      sourceSchemaVersion: 2,
      lane: 'team-qualification',
      definition: source,
      suite: {
        id: source.id ?? 'legacy-v0.34-suite',
        version: source.version,
        roundCount: source.rounds,
        caseCount: source.cases.length,
        plannedSlotCount: source.rounds * source.cases.length,
        definitionDigest: digestJson(source),
        caseSetDigest: digestJson(source.cases.map(caseIdentity))
      },
      slots: legacyMatrixSlots(source.rounds, source.cases.map((entry) => entry.id))
    }
  }
  return normalizeLegacyQualificationSuite(source, {
    adapterId: 'qualification-suite-v034',
    schemaVersion: 2,
    suiteVersion: 'v0.34'
  })
}

function normalizeLegacyQualificationSuite(source, expected) {
  if (source?.schemaVersion !== expected.schemaVersion || source?.suiteVersion !== expected.suiteVersion
      || !Array.isArray(source.outcomes)) {
    throw new Error(`${expected.adapterId} source Suite is invalid`)
  }
  const outcomes = source.outcomes.filter((entry) => entry.phase !== 'calibration')
  const slotRows = outcomes.map((entry) => {
    const match = /^r(\d+)$/u.exec(entry.phase ?? '')
    if (!match || typeof entry.caseId !== 'string' || typeof entry.trialId !== 'string') {
      throw new Error(`${expected.adapterId} contains an invalid formal outcome`)
    }
    return { round: Number.parseInt(match[1], 10), caseId: entry.caseId, trialId: entry.trialId }
  })
  const caseIds = [...new Set(slotRows.map((entry) => entry.caseId))].sort()
  const roundIds = [...new Set(slotRows.map((entry) => entry.round))].sort((left, right) => left - right)
  if (roundIds.length !== 3 || caseIds.length !== 4 || slotRows.length !== 12) {
    throw new Error(`${expected.adapterId} requires the immutable 3 round by 4 case matrix`)
  }
  validateCompleteMatrix(slotRows, roundIds, caseIds)
  return {
    adapterId: expected.adapterId,
    sourceSchemaVersion: expected.schemaVersion,
    lane: source.resultClass === 'post_gate_diagnostic_benchmark' ? 'diagnostic' : 'team-qualification',
    suite: {
      id: source.suiteId,
      version: source.suiteVersion,
      roundCount: 3,
      caseCount: 4,
      plannedSlotCount: 12,
      definitionDigest: digestJson({
        suiteId: source.suiteId,
        suiteVersion: source.suiteVersion,
        seed: source.seed ?? null
      }),
      caseSetDigest: digestJson(caseIds)
    },
    publicationRate: expected.schemaVersion === 2 ? source.finalPassRate : source.passRate,
    slots: slotRows,
    source
  }
}

function normalizeV036Portfolio(source) {
  if (source.schemaVersion !== 1 || !Array.isArray(source.cases) || source.cases.length !== 4
      || !Array.isArray(source.slots) || source.slots.length !== 8 || source.status !== 'complete') {
    throw new Error('v0.36 Diagnostic Portfolio public report is invalid')
  }
  const caseIds = source.cases.map((entry) => entry.caseId)
  const repeats = [1, 2]
  validateCompleteMatrix(
    source.slots.map((entry) => ({ round: entry.repeatOrdinal, caseId: entry.caseId })),
    repeats,
    caseIds
  )
  return {
    adapterId: 'diagnostic-portfolio-v036',
    sourceSchemaVersion: 1,
    lane: 'diagnostic',
    suite: {
      id: source.portfolioId,
      version: source.portfolioVersion,
      roundCount: 2,
      caseCount: 4,
      plannedSlotCount: 8,
      definitionDigest: normalizeDigest(source.configurationDigest),
      caseSetDigest: digestJson(source.cases.map(caseIdentity))
    },
    slots: source.slots.map((entry) => ({
      round: entry.repeatOrdinal,
      caseId: entry.caseId,
      slotId: entry.slotId,
      hardOutcome: entry.hardOutcome
    })),
    source
  }
}

function normalizeLegacyTrial(result) {
  if (result?.schemaVersion === 2) {
    if (result.hardOutcome !== result.overall || result.hardLayer?.overall !== result.overall) {
      throw new Error('Qualification Trial v2 Hard Outcome fields are inconsistent')
    }
    return {
      sourceSchemaVersion: 2,
      validity: result.validity,
      evaluationState: result.evaluationState,
      hardOutcome: result.hardOutcome,
      verifiedDelivery: result.verifiedDelivery,
      orchestrationConvergence: result.orchestrationConvergence,
      postDispatchHumanIntervention: result.postDispatchHumanIntervention
    }
  }
  if (result?.schemaVersion === 1) {
    return {
      sourceSchemaVersion: 1,
      validity: result.validity,
      evaluationState: result.validity === 'valid' ? 'complete' : 'pending',
      hardOutcome: result.overall,
      verifiedDelivery: result.verifiedDelivery === true ? 'pass' : 'fail',
      orchestrationConvergence: result.orchestrationConvergence === true ? 'pass' : 'fail',
      postDispatchHumanIntervention: result.postDispatchHumanIntervention === true ? 'present' : 'absent'
    }
  }
  throw new Error(`unsupported Qualification Trial schema major: ${result?.schemaVersion ?? 'missing'}`)
}

function legacyMatrixSlots(roundCount, caseIds) {
  return Array.from({ length: roundCount }, (_, index) => index + 1)
    .flatMap((round) => caseIds.map((caseId) => ({
      round,
      caseId,
      plannedSlotId: `r${round}-${caseId}`
    })))
}

function validateCompleteMatrix(rows, rounds, caseIds) {
  const actual = new Set(rows.map((entry) => `${entry.round}:${entry.caseId}`))
  const expected = new Set(rounds.flatMap((round) => caseIds.map((caseId) => `${round}:${caseId}`)))
  if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    throw new Error('legacy Benchmark source does not contain one complete matrix')
  }
}

function caseIdentity(entry) {
  return {
    id: entry.id ?? entry.caseId,
    version: entry.version ?? entry.caseVersion,
    seal: normalizeDigest(entry.seal ?? entry.caseSeal)
  }
}

function normalizeDigest(value) {
  return typeof value === 'string' ? value.replace(/^sha256:/u, '') : value
}
