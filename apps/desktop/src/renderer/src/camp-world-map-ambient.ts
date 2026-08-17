import {
  CAMP_WORLD_MAP_AMBIENT_BEATS,
  CAMP_WORLD_MAP_NODE_ENVIRONMENT,
  type CampWorldMapAmbientBeat,
  type CampWorldMapAmbientEnvironment,
  type CampWorldMapAmbientTopic,
  type CampWorldMapGenericEncounterBeat,
  type CampWorldMapGenericStationarySoloBeat,
  type CampWorldMapMovingSoloBeat,
  type CampWorldMapNodeEncounterBeat,
  type CampWorldMapNodeSoloBeat
} from './camp-world-map-ambient-copy'
import {
  campWorldMapStableHash,
  type CampWorldMapAgent,
  type CampWorldMapNodeId
} from './camp-world-map-model'

export const CAMP_WORLD_MAP_AMBIENT_INITIAL_DELAY = { minimum: 6_000, maximum: 12_000 } as const
export const CAMP_WORLD_MAP_AMBIENT_ATTEMPT_DELAY = { minimum: 4_000, maximum: 6_000 } as const
export const CAMP_WORLD_MAP_AMBIENT_DISPLAY_MS = 5_600
export const CAMP_WORLD_MAP_AMBIENT_PARTICIPANT_COOLDOWN_MS = 55_000
export const CAMP_WORLD_MAP_AMBIENT_PAIR_COOLDOWN_MS = 120_000
export const CAMP_WORLD_MAP_AMBIENT_ENCOUNTER_PROBABILITY = 0.1

export const CAMP_WORLD_MAP_AMBIENT_RELAXATION_TIERS = [
  { globalRecent: 12, nodeRecent: 4 },
  { globalRecent: 12, nodeRecent: 0 },
  { globalRecent: 6, nodeRecent: 0 },
  { globalRecent: 0, nodeRecent: 0 }
] as const

export type CampWorldMapAmbientRandom = () => number

export type CampWorldMapAmbientParticipant = {
  agentId: string
  nodeId: CampWorldMapNodeId
  mode: CampWorldMapAgent['mode']
  motion: 'stationary' | 'moving'
  rendezvousKey: string | null
}

export type CampWorldMapAmbientHistory = {
  globalBeatIds: string[]
  nodeBeatIds: Map<CampWorldMapNodeId, string[]>
  participantLastShownAt: Map<string, number>
  pairLastShownAt: Map<string, number>
  lastBeatId: string | null
  lastTopic: CampWorldMapAmbientTopic | null
}

type CampWorldMapAmbientSelectionBase = {
  beatId: string
  topic: CampWorldMapAmbientTopic
  nodeId: CampWorldMapNodeId
  text: string
}

export type CampWorldMapAmbientSoloSelection = CampWorldMapAmbientSelectionBase & {
  kind: 'solo'
  agentIds: readonly [string]
  motion: 'stationary' | 'moving'
}

export type CampWorldMapAmbientEncounterSelection = CampWorldMapAmbientSelectionBase & {
  kind: 'encounter'
  agentIds: readonly [string, string]
  motion: 'stationary'
}

export type CampWorldMapAmbientSelection =
  | CampWorldMapAmbientSoloSelection
  | CampWorldMapAmbientEncounterSelection

export type CampWorldMapAmbientSelectionSnapshot = {
  now: number
  hasAuthoritativeSpeech: boolean
  participants: readonly CampWorldMapAmbientParticipant[]
  history: CampWorldMapAmbientHistory
}

type RelaxationTier = typeof CAMP_WORLD_MAP_AMBIENT_RELAXATION_TIERS[number]

type SoloBeat = CampWorldMapNodeSoloBeat
  | CampWorldMapGenericStationarySoloBeat
  | CampWorldMapMovingSoloBeat

type EncounterBeat = CampWorldMapNodeEncounterBeat | CampWorldMapGenericEncounterBeat

type SoloCandidate = {
  participant: CampWorldMapAmbientParticipant
  nodeBeats: readonly CampWorldMapNodeSoloBeat[]
  genericBeats: readonly (CampWorldMapGenericStationarySoloBeat | CampWorldMapMovingSoloBeat)[]
}

type EncounterCandidate = {
  pairKey: string
  participants: readonly [CampWorldMapAmbientParticipant, CampWorldMapAmbientParticipant]
  nodeBeats: readonly CampWorldMapNodeEncounterBeat[]
  genericBeats: readonly CampWorldMapGenericEncounterBeat[]
}

type AmbientCandidates = {
  solos: SoloCandidate[]
  encounters: EncounterCandidate[]
}

export type CampWorldMapAmbientDisplayedEvent = CampWorldMapAmbientSelection & {
  eventId: string
  startedAt: number
  expiresAt: number
}

export type CampWorldMapCaption =
  | {
      kind: 'real' | 'waiting'
      interactive: true
      agentId: string
      label: string
      text: string
    }
  | {
      kind: 'ambient-solo' | 'ambient-encounter'
      interactive: false
      label: string
      text: string
    }

export type CampWorldMapAmbientSchedulerClock = {
  now(): number
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

export type CampWorldMapAmbientSchedulerDependencies = {
  clock: CampWorldMapAmbientSchedulerClock
  random: CampWorldMapAmbientRandom
  select(now: number, random: CampWorldMapAmbientRandom): CampWorldMapAmbientSelection | null
  onDisplayed(event: CampWorldMapAmbientDisplayedEvent): void
  onEventChange(event: CampWorldMapAmbientDisplayedEvent | null): void
}

export function campWorldMapCaption(
  agents: readonly CampWorldMapAgent[],
  ambientEvent: CampWorldMapAmbientDisplayedEvent | null
): CampWorldMapCaption | null {
  const realAgent = agents.find(
    (agent) => agent.speech?.kind === 'real' && agent.hasExecutionProcess
  )
  if (realAgent?.speech) {
    return {
      kind: 'real',
      interactive: true,
      agentId: realAgent.agentId,
      label: `真实执行 · ${realAgent.displayName}`,
      text: realAgent.speech.text
    }
  }
  const waitingAgent = agents.find(
    (agent) => agent.speech?.kind === 'waiting' && agent.hasExecutionProcess
  )
  if (waitingAgent?.speech) {
    return {
      kind: 'waiting',
      interactive: true,
      agentId: waitingAgent.agentId,
      label: `结果待确认 · ${waitingAgent.displayName}`,
      text: waitingAgent.speech.text
    }
  }
  if (ambientEvent?.kind === 'encounter') {
    return {
      kind: 'ambient-encounter',
      interactive: false,
      label: '闲时预设 · 偶遇',
      text: ambientEvent.text
    }
  }
  return ambientEvent
    ? {
        kind: 'ambient-solo',
        interactive: false,
        label: '闲时 · 环境预设',
        text: ambientEvent.text
      }
    : null
}

export function campWorldMapAuthoritativeSpeechBlocksAmbient(
  agents: readonly CampWorldMapAgent[]
): boolean {
  return agents.some((agent) => agent.speech !== null)
    && !agents.some((agent) => agent.mode === 'idle')
}

function normalizedRandom(random: CampWorldMapAmbientRandom): number {
  const value = random()
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function randomItem<T>(items: readonly T[], random: CampWorldMapAmbientRandom): T | null {
  if (items.length === 0) return null
  if (items.length === 1) return items[0] ?? null
  const index = Math.min(items.length - 1, Math.floor(normalizedRandom(random) * items.length))
  return items[index] ?? null
}

function delayInRange(
  range: { minimum: number; maximum: number },
  random: CampWorldMapAmbientRandom
): number {
  return range.minimum + normalizedRandom(random) * (range.maximum - range.minimum)
}

export function campWorldMapAmbientInitialDelay(random: CampWorldMapAmbientRandom): number {
  return delayInRange(CAMP_WORLD_MAP_AMBIENT_INITIAL_DELAY, random)
}

export function campWorldMapAmbientAttemptDelay(random: CampWorldMapAmbientRandom): number {
  return delayInRange(CAMP_WORLD_MAP_AMBIENT_ATTEMPT_DELAY, random)
}

export function createCampWorldMapAmbientRandom(campId: string): CampWorldMapAmbientRandom {
  let state = campWorldMapStableHash(`${campId}:world-map-ambient-v2`) || 1
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

export function createCampWorldMapAmbientHistory(): CampWorldMapAmbientHistory {
  return {
    globalBeatIds: [],
    nodeBeatIds: new Map(),
    participantLastShownAt: new Map(),
    pairLastShownAt: new Map(),
    lastBeatId: null,
    lastTopic: null
  }
}

export function campWorldMapAmbientPairKey(leftAgentId: string, rightAgentId: string): string {
  return [leftAgentId, rightAgentId].sort((left, right) => left.localeCompare(right)).join('\u0000')
}

export function recordCampWorldMapAmbientEvent(
  history: CampWorldMapAmbientHistory,
  event: CampWorldMapAmbientSelection,
  shownAt: number
): void {
  history.globalBeatIds.push(event.beatId)
  if (history.globalBeatIds.length > 12) history.globalBeatIds.splice(0, history.globalBeatIds.length - 12)

  const nodeBeatIds = history.nodeBeatIds.get(event.nodeId) ?? []
  nodeBeatIds.push(event.beatId)
  if (nodeBeatIds.length > 4) nodeBeatIds.splice(0, nodeBeatIds.length - 4)
  history.nodeBeatIds.set(event.nodeId, nodeBeatIds)

  for (const agentId of event.agentIds) history.participantLastShownAt.set(agentId, shownAt)
  if (event.kind === 'encounter') {
    history.pairLastShownAt.set(campWorldMapAmbientPairKey(...event.agentIds), shownAt)
  }
  history.lastBeatId = event.beatId
  history.lastTopic = event.topic
}

function isEnvironmentMatch(
  beatEnvironment: CampWorldMapAmbientEnvironment,
  nodeId: CampWorldMapNodeId
): boolean {
  return beatEnvironment === 'any' || beatEnvironment === CAMP_WORLD_MAP_NODE_ENVIRONMENT[nodeId]
}

function isOutsideRecentHistory(
  beat: CampWorldMapAmbientBeat,
  nodeId: CampWorldMapNodeId,
  history: CampWorldMapAmbientHistory,
  tier: RelaxationTier
): boolean {
  const globalRecent = tier.globalRecent === 0
    ? []
    : history.globalBeatIds.slice(-tier.globalRecent)
  if (globalRecent.includes(beat.id)) return false
  const nodeRecent = tier.nodeRecent === 0
    ? []
    : (history.nodeBeatIds.get(nodeId) ?? []).slice(-tier.nodeRecent)
  return !nodeRecent.includes(beat.id)
}

function passesBeatConstraints(
  beat: CampWorldMapAmbientBeat,
  nodeId: CampWorldMapNodeId,
  history: CampWorldMapAmbientHistory,
  tier: RelaxationTier
): boolean {
  if (beat.id === history.lastBeatId || beat.topic === history.lastTopic) return false
  return isOutsideRecentHistory(beat, nodeId, history, tier)
}

function participantIsEligible(
  participant: CampWorldMapAmbientParticipant,
  snapshot: CampWorldMapAmbientSelectionSnapshot
): boolean {
  if (participant.mode !== 'idle' || participant.rendezvousKey) return false
  const lastShownAt = snapshot.history.participantLastShownAt.get(participant.agentId)
  return lastShownAt === undefined
    || snapshot.now - lastShownAt >= CAMP_WORLD_MAP_AMBIENT_PARTICIPANT_COOLDOWN_MS
}

function soloBeatsFor(
  participant: CampWorldMapAmbientParticipant,
  snapshot: CampWorldMapAmbientSelectionSnapshot,
  tier: RelaxationTier
): Pick<SoloCandidate, 'nodeBeats' | 'genericBeats'> {
  const nodeBeats: CampWorldMapNodeSoloBeat[] = []
  const genericBeats: (CampWorldMapGenericStationarySoloBeat | CampWorldMapMovingSoloBeat)[] = []
  for (const beat of CAMP_WORLD_MAP_AMBIENT_BEATS) {
    if (beat.kind !== 'solo' || beat.motion !== participant.motion) continue
    if (!passesBeatConstraints(beat, participant.nodeId, snapshot.history, tier)) continue
    if (beat.scope === 'node') {
      if (participant.motion === 'stationary' && beat.node === participant.nodeId) nodeBeats.push(beat)
      continue
    }
    if (isEnvironmentMatch(beat.environment, participant.nodeId)) genericBeats.push(beat)
  }
  return { nodeBeats, genericBeats }
}

function encounterBeatsFor(
  nodeId: CampWorldMapNodeId,
  snapshot: CampWorldMapAmbientSelectionSnapshot,
  tier: RelaxationTier
): Pick<EncounterCandidate, 'nodeBeats' | 'genericBeats'> {
  const nodeBeats: CampWorldMapNodeEncounterBeat[] = []
  const genericBeats: CampWorldMapGenericEncounterBeat[] = []
  for (const beat of CAMP_WORLD_MAP_AMBIENT_BEATS) {
    if (beat.kind !== 'encounter') continue
    if (!passesBeatConstraints(beat, nodeId, snapshot.history, tier)) continue
    if (beat.scope === 'node') {
      if (beat.node === nodeId) nodeBeats.push(beat)
      continue
    }
    if (isEnvironmentMatch(beat.environment, nodeId)) genericBeats.push(beat)
  }
  return { nodeBeats, genericBeats }
}

function buildCandidates(
  snapshot: CampWorldMapAmbientSelectionSnapshot,
  tier: RelaxationTier
): AmbientCandidates {
  const eligible = snapshot.participants
    .filter((participant) => participantIsEligible(participant, snapshot))
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
  const solos: SoloCandidate[] = []
  for (const participant of eligible) {
    const beats = soloBeatsFor(participant, snapshot, tier)
    if (beats.nodeBeats.length + beats.genericBeats.length > 0) {
      solos.push({ participant, ...beats })
    }
  }

  const encounters: EncounterCandidate[] = []
  const stationary = eligible.filter((participant) => participant.motion === 'stationary')
  for (let leftIndex = 0; leftIndex < stationary.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < stationary.length; rightIndex += 1) {
      const left = stationary[leftIndex]
      const right = stationary[rightIndex]
      if (!left || !right || left.nodeId !== right.nodeId) continue
      const pairKey = campWorldMapAmbientPairKey(left.agentId, right.agentId)
      const pairLastShownAt = snapshot.history.pairLastShownAt.get(pairKey)
      if (pairLastShownAt !== undefined
        && snapshot.now - pairLastShownAt < CAMP_WORLD_MAP_AMBIENT_PAIR_COOLDOWN_MS) continue
      const beats = encounterBeatsFor(left.nodeId, snapshot, tier)
      if (beats.nodeBeats.length + beats.genericBeats.length > 0) {
        encounters.push({ pairKey, participants: [left, right], ...beats })
      }
    }
  }
  return { solos, encounters }
}

function oldestCandidates<T>(
  candidates: readonly T[],
  lastShownAt: (candidate: T) => number | undefined
): T[] {
  let oldest = Number.POSITIVE_INFINITY
  const result: T[] = []
  for (const candidate of candidates) {
    const shownAt = lastShownAt(candidate) ?? Number.NEGATIVE_INFINITY
    if (shownAt < oldest) {
      oldest = shownAt
      result.splice(0, result.length, candidate)
    } else if (shownAt === oldest) {
      result.push(candidate)
    }
  }
  return result
}

function selectSolo(
  candidates: readonly SoloCandidate[],
  history: CampWorldMapAmbientHistory,
  random: CampWorldMapAmbientRandom
): CampWorldMapAmbientSoloSelection | null {
  const fairCandidates = oldestCandidates(
    candidates,
    (candidate) => history.participantLastShownAt.get(candidate.participant.agentId)
  )
  const candidate = randomItem(fairCandidates, random)
  if (!candidate) return null

  let beats: readonly SoloBeat[]
  if (candidate.nodeBeats.length > 0 && candidate.genericBeats.length > 0) {
    beats = normalizedRandom(random) < 0.7 ? candidate.nodeBeats : candidate.genericBeats
  } else {
    beats = candidate.nodeBeats.length > 0 ? candidate.nodeBeats : candidate.genericBeats
  }
  const beat = randomItem(beats, random)
  if (!beat) return null
  return {
    kind: 'solo',
    beatId: beat.id,
    topic: beat.topic,
    agentIds: [candidate.participant.agentId],
    nodeId: candidate.participant.nodeId,
    motion: candidate.participant.motion,
    text: beat.text
  }
}

function selectEncounter(
  candidates: readonly EncounterCandidate[],
  history: CampWorldMapAmbientHistory,
  random: CampWorldMapAmbientRandom
): CampWorldMapAmbientEncounterSelection | null {
  const fairCandidates = oldestCandidates(
    candidates,
    (candidate) => history.pairLastShownAt.get(candidate.pairKey)
  )
  const candidate = randomItem(fairCandidates, random)
  if (!candidate) return null
  const beats: readonly EncounterBeat[] = candidate.nodeBeats.length > 0
    ? candidate.nodeBeats
    : candidate.genericBeats
  const beat = randomItem(beats, random)
  if (!beat) return null
  return {
    kind: 'encounter',
    beatId: beat.id,
    topic: beat.topic,
    agentIds: [candidate.participants[0].agentId, candidate.participants[1].agentId],
    nodeId: candidate.participants[0].nodeId,
    motion: 'stationary',
    text: beat.text
  }
}

export function selectCampWorldMapAmbientEvent(
  snapshot: CampWorldMapAmbientSelectionSnapshot,
  random: CampWorldMapAmbientRandom
): CampWorldMapAmbientSelection | null {
  if (snapshot.hasAuthoritativeSpeech) return null
  const candidatesByTier = CAMP_WORLD_MAP_AMBIENT_RELAXATION_TIERS.map(
    (tier) => buildCandidates(snapshot, tier)
  )
  const hasEncounter = candidatesByTier.some((candidates) => candidates.encounters.length > 0)
  const wantsEncounter = hasEncounter
    && normalizedRandom(random) < CAMP_WORLD_MAP_AMBIENT_ENCOUNTER_PROBABILITY

  if (wantsEncounter) {
    for (const candidates of candidatesByTier) {
      const encounter = selectEncounter(candidates.encounters, snapshot.history, random)
      if (encounter) return encounter
    }
  }
  for (const candidates of candidatesByTier) {
    const solo = selectSolo(candidates.solos, snapshot.history, random)
    if (solo) return solo
  }
  return null
}

export class CampWorldMapAmbientScheduler {
  readonly #dependencies: CampWorldMapAmbientSchedulerDependencies
  #active = false
  #attemptHandle: unknown = null
  #expiryHandle: unknown = null
  #scheduleGeneration = 0
  #eventGeneration = 0
  #eventSequence = 0
  #currentEvent: CampWorldMapAmbientDisplayedEvent | null = null

  constructor(dependencies: CampWorldMapAmbientSchedulerDependencies) {
    this.#dependencies = dependencies
  }

  currentEvent(): CampWorldMapAmbientDisplayedEvent | null {
    return this.#currentEvent
  }

  start(delayKind: 'initial' | 'subsequent'): void {
    this.#active = true
    this.#clearAttempt()
    this.#clearEvent()
    const delay = delayKind === 'initial'
      ? campWorldMapAmbientInitialDelay(this.#dependencies.random)
      : campWorldMapAmbientAttemptDelay(this.#dependencies.random)
    this.#scheduleAttempt(delay)
  }

  suspend(): void {
    this.#active = false
    this.#clearAttempt()
    this.#clearEvent()
  }

  cancelCurrentAndReschedule(): void {
    if (!this.#active) return
    this.#clearAttempt()
    this.#clearEvent()
    this.#scheduleAttempt(campWorldMapAmbientAttemptDelay(this.#dependencies.random))
  }

  #clearAttempt(): void {
    this.#scheduleGeneration += 1
    if (this.#attemptHandle !== null) this.#dependencies.clock.clearTimeout(this.#attemptHandle)
    this.#attemptHandle = null
  }

  #clearEvent(): void {
    this.#eventGeneration += 1
    if (this.#expiryHandle !== null) this.#dependencies.clock.clearTimeout(this.#expiryHandle)
    this.#expiryHandle = null
    if (!this.#currentEvent) return
    this.#currentEvent = null
    this.#dependencies.onEventChange(null)
  }

  #scheduleAttempt(delay: number): void {
    const generation = ++this.#scheduleGeneration
    this.#attemptHandle = this.#dependencies.clock.setTimeout(() => {
      if (!this.#active || generation !== this.#scheduleGeneration) return
      this.#attemptHandle = null
      const now = this.#dependencies.clock.now()
      const selection = this.#dependencies.select(now, this.#dependencies.random)
      if (selection) this.#display(selection, now)
      this.#scheduleAttempt(campWorldMapAmbientAttemptDelay(this.#dependencies.random))
    }, delay)
  }

  #display(selection: CampWorldMapAmbientSelection, now: number): void {
    this.#clearEvent()
    const event = {
      ...selection,
      eventId: `${selection.beatId}:${++this.#eventSequence}`,
      startedAt: now,
      expiresAt: now + CAMP_WORLD_MAP_AMBIENT_DISPLAY_MS
    } satisfies CampWorldMapAmbientDisplayedEvent
    this.#currentEvent = event
    this.#dependencies.onDisplayed(event)
    this.#dependencies.onEventChange(event)

    const generation = ++this.#eventGeneration
    const eventId = event.eventId
    this.#expiryHandle = this.#dependencies.clock.setTimeout(() => {
      if (!this.#active || generation !== this.#eventGeneration) return
      if (this.#currentEvent?.eventId !== eventId) return
      this.#expiryHandle = null
      this.#currentEvent = null
      this.#dependencies.onEventChange(null)
    }, CAMP_WORLD_MAP_AMBIENT_DISPLAY_MS)
  }
}
