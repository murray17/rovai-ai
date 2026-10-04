import {
  CAMP_WORLD_MAP_AMBIENT_BEATS,
  CAMP_WORLD_MAP_NODE_ENVIRONMENT,
  type ThreadWorldMapAmbientBeat,
  type ThreadWorldMapAmbientEnvironment,
  type ThreadWorldMapAmbientTopic,
  type ThreadWorldMapGenericEncounterBeat,
  type ThreadWorldMapGenericStationarySoloBeat,
  type ThreadWorldMapMovingSoloBeat,
  type ThreadWorldMapNodeEncounterBeat,
  type ThreadWorldMapNodeSoloBeat
} from './camp-world-map-ambient-copy'
import {
  campWorldMapStableHash,
  type ThreadWorldMapAgent,
  type ThreadWorldMapNodeId
} from './camp-world-map-model'
import { uiAttribute } from './interface-language'

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

export type ThreadWorldMapAmbientRandom = () => number

export type ThreadWorldMapAmbientParticipant = {
  agentId: string
  nodeId: ThreadWorldMapNodeId
  mode: ThreadWorldMapAgent['mode']
  motion: 'stationary' | 'moving'
  rendezvousKey: string | null
}

export type ThreadWorldMapAmbientHistory = {
  globalBeatIds: string[]
  nodeBeatIds: Map<ThreadWorldMapNodeId, string[]>
  participantLastShownAt: Map<string, number>
  pairLastShownAt: Map<string, number>
  lastBeatId: string | null
  lastTopic: ThreadWorldMapAmbientTopic | null
}

type ThreadWorldMapAmbientSelectionBase = {
  beatId: string
  topic: ThreadWorldMapAmbientTopic
  nodeId: ThreadWorldMapNodeId
  text: string
}

export type ThreadWorldMapAmbientSoloSelection = ThreadWorldMapAmbientSelectionBase & {
  kind: 'solo'
  agentIds: readonly [string]
  motion: 'stationary' | 'moving'
}

export type ThreadWorldMapAmbientEncounterSelection = ThreadWorldMapAmbientSelectionBase & {
  kind: 'encounter'
  agentIds: readonly [string, string]
  motion: 'stationary'
}

export type ThreadWorldMapAmbientSelection =
  | ThreadWorldMapAmbientSoloSelection
  | ThreadWorldMapAmbientEncounterSelection

export type ThreadWorldMapAmbientSelectionSnapshot = {
  now: number
  hasAuthoritativeSpeech: boolean
  participants: readonly ThreadWorldMapAmbientParticipant[]
  history: ThreadWorldMapAmbientHistory
}

type RelaxationTier = typeof CAMP_WORLD_MAP_AMBIENT_RELAXATION_TIERS[number]

type SoloBeat = ThreadWorldMapNodeSoloBeat
  | ThreadWorldMapGenericStationarySoloBeat
  | ThreadWorldMapMovingSoloBeat

type EncounterBeat = ThreadWorldMapNodeEncounterBeat | ThreadWorldMapGenericEncounterBeat

type SoloCandidate = {
  participant: ThreadWorldMapAmbientParticipant
  nodeBeats: readonly ThreadWorldMapNodeSoloBeat[]
  genericBeats: readonly (ThreadWorldMapGenericStationarySoloBeat | ThreadWorldMapMovingSoloBeat)[]
}

type EncounterCandidate = {
  pairKey: string
  participants: readonly [ThreadWorldMapAmbientParticipant, ThreadWorldMapAmbientParticipant]
  nodeBeats: readonly ThreadWorldMapNodeEncounterBeat[]
  genericBeats: readonly ThreadWorldMapGenericEncounterBeat[]
}

type AmbientCandidates = {
  solos: SoloCandidate[]
  encounters: EncounterCandidate[]
}

export type ThreadWorldMapAmbientDisplayedEvent = ThreadWorldMapAmbientSelection & {
  eventId: string
  startedAt: number
  expiresAt: number
}

export type ThreadWorldMapCaption =
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

export type ThreadWorldMapAmbientSchedulerClock = {
  now(): number
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

export type ThreadWorldMapAmbientSchedulerDependencies = {
  clock: ThreadWorldMapAmbientSchedulerClock
  random: ThreadWorldMapAmbientRandom
  select(now: number, random: ThreadWorldMapAmbientRandom): ThreadWorldMapAmbientSelection | null
  onDisplayed(event: ThreadWorldMapAmbientDisplayedEvent): void
  onEventChange(event: ThreadWorldMapAmbientDisplayedEvent | null): void
}

export function campWorldMapCaption(
  agents: readonly ThreadWorldMapAgent[],
  ambientEvent: ThreadWorldMapAmbientDisplayedEvent | null
): ThreadWorldMapCaption | null {
  const realAgent = agents.find(
    (agent) => agent.speech?.kind === 'real' && agent.hasExecutionProcess
  )
  if (realAgent?.speech) {
    return {
      kind: 'real',
      interactive: true,
      agentId: realAgent.agentId,
      label: uiAttribute('真实执行 · {0}', realAgent.displayName),
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
      label: uiAttribute('结果待确认 · {0}', waitingAgent.displayName),
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
  agents: readonly ThreadWorldMapAgent[]
): boolean {
  return agents.some((agent) => agent.speech !== null)
    && !agents.some((agent) => agent.mode === 'idle')
}

function normalizedRandom(random: ThreadWorldMapAmbientRandom): number {
  const value = random()
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function randomItem<T>(items: readonly T[], random: ThreadWorldMapAmbientRandom): T | null {
  if (items.length === 0) return null
  if (items.length === 1) return items[0] ?? null
  const index = Math.min(items.length - 1, Math.floor(normalizedRandom(random) * items.length))
  return items[index] ?? null
}

function delayInRange(
  range: { minimum: number; maximum: number },
  random: ThreadWorldMapAmbientRandom
): number {
  return range.minimum + normalizedRandom(random) * (range.maximum - range.minimum)
}

export function campWorldMapAmbientInitialDelay(random: ThreadWorldMapAmbientRandom): number {
  return delayInRange(CAMP_WORLD_MAP_AMBIENT_INITIAL_DELAY, random)
}

export function campWorldMapAmbientAttemptDelay(random: ThreadWorldMapAmbientRandom): number {
  return delayInRange(CAMP_WORLD_MAP_AMBIENT_ATTEMPT_DELAY, random)
}

export function createThreadWorldMapAmbientRandom(threadId: string): ThreadWorldMapAmbientRandom {
  let state = campWorldMapStableHash(`${threadId}:world-map-ambient-v2`) || 1
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

export function createThreadWorldMapAmbientHistory(): ThreadWorldMapAmbientHistory {
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

export function recordThreadWorldMapAmbientEvent(
  history: ThreadWorldMapAmbientHistory,
  event: ThreadWorldMapAmbientSelection,
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
  beatEnvironment: ThreadWorldMapAmbientEnvironment,
  nodeId: ThreadWorldMapNodeId
): boolean {
  return beatEnvironment === 'any' || beatEnvironment === CAMP_WORLD_MAP_NODE_ENVIRONMENT[nodeId]
}

function isOutsideRecentHistory(
  beat: ThreadWorldMapAmbientBeat,
  nodeId: ThreadWorldMapNodeId,
  history: ThreadWorldMapAmbientHistory,
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
  beat: ThreadWorldMapAmbientBeat,
  nodeId: ThreadWorldMapNodeId,
  history: ThreadWorldMapAmbientHistory,
  tier: RelaxationTier
): boolean {
  if (beat.id === history.lastBeatId || beat.topic === history.lastTopic) return false
  return isOutsideRecentHistory(beat, nodeId, history, tier)
}

function participantIsEligible(
  participant: ThreadWorldMapAmbientParticipant,
  snapshot: ThreadWorldMapAmbientSelectionSnapshot
): boolean {
  if (participant.mode !== 'idle' || participant.rendezvousKey) return false
  const lastShownAt = snapshot.history.participantLastShownAt.get(participant.agentId)
  return lastShownAt === undefined
    || snapshot.now - lastShownAt >= CAMP_WORLD_MAP_AMBIENT_PARTICIPANT_COOLDOWN_MS
}

function soloBeatsFor(
  participant: ThreadWorldMapAmbientParticipant,
  snapshot: ThreadWorldMapAmbientSelectionSnapshot,
  tier: RelaxationTier
): Pick<SoloCandidate, 'nodeBeats' | 'genericBeats'> {
  const nodeBeats: ThreadWorldMapNodeSoloBeat[] = []
  const genericBeats: (ThreadWorldMapGenericStationarySoloBeat | ThreadWorldMapMovingSoloBeat)[] = []
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
  nodeId: ThreadWorldMapNodeId,
  snapshot: ThreadWorldMapAmbientSelectionSnapshot,
  tier: RelaxationTier
): Pick<EncounterCandidate, 'nodeBeats' | 'genericBeats'> {
  const nodeBeats: ThreadWorldMapNodeEncounterBeat[] = []
  const genericBeats: ThreadWorldMapGenericEncounterBeat[] = []
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
  snapshot: ThreadWorldMapAmbientSelectionSnapshot,
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
  history: ThreadWorldMapAmbientHistory,
  random: ThreadWorldMapAmbientRandom
): ThreadWorldMapAmbientSoloSelection | null {
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
  history: ThreadWorldMapAmbientHistory,
  random: ThreadWorldMapAmbientRandom
): ThreadWorldMapAmbientEncounterSelection | null {
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

export function selectThreadWorldMapAmbientEvent(
  snapshot: ThreadWorldMapAmbientSelectionSnapshot,
  random: ThreadWorldMapAmbientRandom
): ThreadWorldMapAmbientSelection | null {
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

export class ThreadWorldMapAmbientScheduler {
  readonly #dependencies: ThreadWorldMapAmbientSchedulerDependencies
  #active = false
  #attemptHandle: unknown = null
  #expiryHandle: unknown = null
  #scheduleGeneration = 0
  #eventGeneration = 0
  #eventSequence = 0
  #currentEvent: ThreadWorldMapAmbientDisplayedEvent | null = null

  constructor(dependencies: ThreadWorldMapAmbientSchedulerDependencies) {
    this.#dependencies = dependencies
  }

  currentEvent(): ThreadWorldMapAmbientDisplayedEvent | null {
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

  #display(selection: ThreadWorldMapAmbientSelection, now: number): void {
    this.#clearEvent()
    const event = {
      ...selection,
      eventId: `${selection.beatId}:${++this.#eventSequence}`,
      startedAt: now,
      expiresAt: now + CAMP_WORLD_MAP_AMBIENT_DISPLAY_MS
    } satisfies ThreadWorldMapAmbientDisplayedEvent
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
