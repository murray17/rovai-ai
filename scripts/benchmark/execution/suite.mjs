import { digestJson, sha256 } from '../protocol/canonical.mjs'

export function defineBenchmarkProfile(profile) {
  validateProfile(profile)
  const definition = structuredClone(profile)
  definition.definitionDigest = digestJson(profileIdentity(definition))
  definition.hardOutcomeDefinitionDigest = digestJson(definition.hardOutcomeDefinition)
  definition.publicationPolicyDigest = digestJson(definition.publicationPolicy)
  return Object.freeze(definition)
}

export function validateBenchmarkProfile(profile) {
  validateProfile(profile)
  if (profile.definitionDigest !== undefined
      && profile.definitionDigest !== digestJson(profileIdentity(profile))) {
    throw new Error('Benchmark Profile definition digest mismatch')
  }
  return profile
}

export function generatePlannedSlots(profile) {
  validateBenchmarkProfile(profile)
  const slots = []
  for (const round of profile.suite.rounds) {
    const ordered = profile.suite.shuffle
      ? [...profile.suite.cases].sort((left, right) => (
          sha256(`${profile.suite.seed}:${shuffleRoundKey(profile.suite, round)}:${left.id}`)
            .localeCompare(sha256(`${profile.suite.seed}:${shuffleRoundKey(profile.suite, round)}:${right.id}`))
        ))
      : profile.suite.cases
    for (const caseEntry of ordered) {
      slots.push({
        plannedSlotId: `${round.id}-${caseEntry.id}`,
        roundId: round.id,
        roundOrdinal: round.ordinal,
        caseId: caseEntry.id,
        caseVersion: caseEntry.version,
        caseSeal: caseEntry.seal
      })
    }
  }
  return slots
}

export async function invokePlannedSlots(profile, invoke) {
  const outcomes = []
  for (const slot of generatePlannedSlots(profile)) outcomes.push(await invoke(slot))
  return outcomes
}

export function aggregateBenchmarkSuite(profile, outcomes) {
  const plannedSlots = generatePlannedSlots(profile)
  if (!Array.isArray(outcomes)) throw new Error('Benchmark Suite outcomes must be an array')
  const bySlot = new Map()
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome.plannedSlotId !== 'string' || bySlot.has(outcome.plannedSlotId)) {
      throw new Error('Benchmark Suite contains an invalid or duplicate outcome')
    }
    bySlot.set(outcome.plannedSlotId, outcome)
  }
  const unknown = [...bySlot.keys()].filter((slotId) => !plannedSlots.some((slot) => slot.plannedSlotId === slotId))
  if (unknown.length > 0) throw new Error(`Benchmark Suite contains unknown slots: ${unknown.join(', ')}`)
  const rows = plannedSlots.map((slot) => ({ ...slot, outcome: bySlot.get(slot.plannedSlotId) ?? null }))
  const completed = rows.filter((row) => row.outcome).length
  const scorable = rows.filter((row) => isScorable(row.outcome))
  const passes = scorable.filter((row) => row.outcome.hardOutcome === 'pass').length
  const failures = scorable.length - passes
  const complete = completed === plannedSlots.length
  const integrityComplete = complete && scorable.length === plannedSlots.length
  const publication = derivePublication(profile.publicationPolicy, {
    complete,
    integrityComplete,
    passes,
    failures,
    total: plannedSlots.length
  })
  const perCase = Object.fromEntries(profile.suite.cases.map((caseEntry) => {
    const values = rows.filter((row) => row.caseId === caseEntry.id && isScorable(row.outcome))
    return [caseEntry.id, {
      repeats: values.length,
      passes: values.filter((row) => row.outcome.hardOutcome === 'pass').length,
      outcomes: values.map((row) => row.outcome.hardOutcome)
    }]
  }))
  return {
    profile: { id: profile.id, version: profile.version, lane: profile.lane },
    suite: {
      id: profile.suite.id,
      version: profile.suite.version,
      definitionDigest: digestJson(profile.suite),
      caseSetDigest: digestJson(profile.suite.cases.map(caseIdentity)),
      roundCount: profile.suite.rounds.length,
      caseCount: profile.suite.cases.length,
      plannedSlotCount: plannedSlots.length
    },
    counts: { planned: plannedSlots.length, completed, scorable: scorable.length, passes, failures },
    perCase,
    slots: rows,
    publication,
    metric: 'raw_repeat_outcomes_not_pass_at_k'
  }
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Benchmark Profile is invalid')
  for (const field of ['id', 'version', 'lane']) {
    if (typeof profile[field] !== 'string' || profile[field] === '') throw new Error(`Benchmark Profile ${field} is invalid`)
  }
  if (!profile.hardOutcomeDefinition || !profile.publicationPolicy || !profile.suite) {
    throw new Error('Benchmark Profile contracts are incomplete')
  }
  const { suite } = profile
  if (typeof suite.id !== 'string' || typeof suite.version !== 'string'
      || !Array.isArray(suite.rounds) || suite.rounds.length === 0
      || !Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error('Benchmark Profile Suite is invalid')
  }
  assertUnique(suite.rounds.map((round) => round.id), 'round')
  assertUnique(suite.cases.map((entry) => entry.id), 'Case')
  for (const [index, round] of suite.rounds.entries()) {
    if (typeof round.id !== 'string' || round.id === '' || round.ordinal !== index + 1) {
      throw new Error('Benchmark Profile round is invalid')
    }
  }
  for (const entry of suite.cases) {
    if (typeof entry.id !== 'string' || entry.id === '' || typeof entry.version !== 'string'
        || !/^[a-f0-9]{64}$/u.test(entry.seal ?? '')) {
      throw new Error('Benchmark Profile Case is invalid')
    }
  }
  if (suite.shuffle && (typeof suite.seed !== 'string' || suite.seed === '')) {
    throw new Error('shuffled Benchmark Profile requires a seed')
  }
}

function derivePublication(policy, state) {
  if (!state.complete) {
    return { state: 'partial', outcomeRate: null, reason: { code: 'suite.incomplete' } }
  }
  if (!state.integrityComplete) {
    return { state: 'unpublishable', outcomeRate: null, reason: { code: 'suite.unscorable_slot' } }
  }
  return {
    state: 'complete',
    outcomeRate: policy.publishOutcomeRate ? state.passes / state.total : null,
    reason: policy.publishOutcomeRate ? null : { code: 'profile.aggregate_rate_not_defined' }
  }
}

function isScorable(outcome) {
  return outcome?.validity === 'valid' && outcome?.evaluationState === 'complete'
    && ['pass', 'fail'].includes(outcome?.hardOutcome)
}

function profileIdentity(profile) {
  const value = structuredClone(profile)
  delete value.definitionDigest
  delete value.hardOutcomeDefinitionDigest
  delete value.publicationPolicyDigest
  return value
}

function caseIdentity(entry) {
  return { id: entry.id, version: entry.version, seal: entry.seal }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Benchmark Profile ${label} identities are not unique`)
}

function shuffleRoundKey(suite, round) {
  return suite.shuffleKeyMode === 'legacy_numeric_round' ? round.ordinal : round.id
}
