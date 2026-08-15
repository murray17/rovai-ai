import { describe, expect, it } from 'vitest'
import {
  CAMP_WORLD_MAP_AMBIENT_BEATS,
  CAMP_WORLD_MAP_NODE_ENVIRONMENT
} from './camp-world-map-ambient-copy'
import {
  CAMP_WORLD_MAP_AMBIENT_ATTEMPT_DELAY,
  CAMP_WORLD_MAP_AMBIENT_DISPLAY_MS,
  CAMP_WORLD_MAP_AMBIENT_INITIAL_DELAY,
  CAMP_WORLD_MAP_AMBIENT_RELAXATION_TIERS,
  CampWorldMapAmbientScheduler,
  campWorldMapCaption,
  campWorldMapAmbientAttemptDelay,
  campWorldMapAmbientInitialDelay,
  campWorldMapAmbientPairKey,
  createCampWorldMapAmbientHistory,
  recordCampWorldMapAmbientEvent,
  selectCampWorldMapAmbientEvent,
  type CampWorldMapAmbientDisplayedEvent,
  type CampWorldMapAmbientParticipant,
  type CampWorldMapAmbientRandom,
  type CampWorldMapAmbientSchedulerClock,
  type CampWorldMapAmbientSelection
} from './camp-world-map-ambient'
import { CAMP_WORLD_MAP_NODE_IDS, type CampWorldMapAgent } from './camp-world-map-model'

function participant(
  agentId: string,
  nodeId: CampWorldMapAmbientParticipant['nodeId'] = 'research',
  overrides: Partial<CampWorldMapAmbientParticipant> = {}
): CampWorldMapAmbientParticipant {
  return {
    agentId,
    nodeId,
    mode: 'idle',
    motion: 'stationary',
    rendezvousKey: null,
    ...overrides
  }
}

function queuedRandom(values: readonly number[], fallback = 0): CampWorldMapAmbientRandom & { calls: () => number } {
  let index = 0
  const random = (() => values[index++] ?? fallback) as CampWorldMapAmbientRandom & { calls: () => number }
  random.calls = () => index
  return random
}

function select(
  participants: readonly CampWorldMapAmbientParticipant[],
  random: CampWorldMapAmbientRandom,
  configure?: (history: ReturnType<typeof createCampWorldMapAmbientHistory>) => void,
  now = 200_000
): CampWorldMapAmbientSelection | null {
  const history = createCampWorldMapAmbientHistory()
  configure?.(history)
  return selectCampWorldMapAmbientEvent({
    now,
    hasAuthoritativeSpeech: false,
    participants,
    history
  }, random)
}

describe('Camp world map ambient copy', () => {
  it('keeps the accepted 120 complete sentences and category counts intact', () => {
    const ids = CAMP_WORLD_MAP_AMBIENT_BEATS.map((beat) => beat.id)
    const texts = CAMP_WORLD_MAP_AMBIENT_BEATS.map((beat) => beat.text)
    const nodeSolos = CAMP_WORLD_MAP_AMBIENT_BEATS.filter(
      (beat) => beat.kind === 'solo' && beat.scope === 'node'
    )
    const genericSolos = CAMP_WORLD_MAP_AMBIENT_BEATS.filter(
      (beat) => beat.kind === 'solo' && beat.scope === 'generic'
    )
    const encounters = CAMP_WORLD_MAP_AMBIENT_BEATS.filter((beat) => beat.kind === 'encounter')
    const moving = CAMP_WORLD_MAP_AMBIENT_BEATS.filter((beat) => beat.motion === 'moving')

    expect(CAMP_WORLD_MAP_AMBIENT_BEATS).toHaveLength(120)
    expect(new Set(ids).size).toBe(120)
    expect(new Set(texts).size).toBe(120)
    expect(nodeSolos).toHaveLength(80)
    expect(genericSolos).toHaveLength(24)
    expect(encounters).toHaveLength(16)
    expect(moving).toHaveLength(6)
    for (const nodeId of CAMP_WORLD_MAP_NODE_IDS) {
      expect(nodeSolos.filter((beat) => beat.node === nodeId), nodeId).toHaveLength(8)
    }
  })

  it('uses complete punctuated copy within the grapheme budget and no persona metadata', () => {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
    for (const beat of CAMP_WORLD_MAP_AMBIENT_BEATS) {
      expect(beat.text, beat.id).toMatch(/[。！？]$/u)
      expect([...segmenter.segment(beat.text)].length, beat.id).toBeLessThanOrEqual(28)
      expect(beat.text, beat.id).not.toMatch(/性格|职业|职责|擅长|偏好|喜欢|习惯/u)
      expect(beat, beat.id).not.toHaveProperty('family')
      expect(beat, beat.id).not.toHaveProperty('nodes')
      expect(beat, beat.id).not.toHaveProperty('environments')
    }
  })

  it('freezes node environments and the reviewed topic examples', () => {
    expect(CAMP_WORLD_MAP_NODE_ENVIRONMENT.approval).toBe('outdoor')
    expect(CAMP_WORLD_MAP_AMBIENT_BEATS.find((beat) => beat.id === 'research-01')?.topic).toBe('wayfinding')
    expect(CAMP_WORLD_MAP_AMBIENT_BEATS.find((beat) => beat.id === 'a2a-02')?.topic).toBe('water')
    expect(CAMP_WORLD_MAP_AMBIENT_BEATS.find((beat) => beat.id === 'harbor-01')?.topic).toBe('wayfinding')
    expect(CAMP_WORLD_MAP_AMBIENT_BEATS.find((beat) => beat.id === 'memory-02')?.topic).toBe('document')
    expect(CAMP_WORLD_MAP_AMBIENT_BEATS.find((beat) => beat.id === 'encounter-generic-06')).toMatchObject({
      environment: 'outdoor',
      topic: 'light'
    })
  })
})

describe('Camp world map ambient selection', () => {
  it('selects node copy below the 70% boundary and generic copy at the boundary', () => {
    const node = select([participant('alice')], queuedRandom([0.699, 0]))
    const generic = select([participant('alice')], queuedRandom([0.7, 0]))

    expect(node?.beatId.startsWith('research-')).toBe(true)
    expect(generic?.beatId.startsWith('generic-')).toBe(true)
    expect(generic?.motion).toBe('stationary')
  })

  it('filters generic copy by environment and moving copy by motion', () => {
    const indoor = select([participant('alice', 'review')], queuedRandom([0.7, 0]))
    const moving = select([
      participant('alice', 'research', { motion: 'moving' })
    ], queuedRandom([0]))

    expect(indoor?.beatId).not.toMatch(/^generic-outdoor-/u)
    expect(moving?.beatId).toMatch(/^generic-moving-/u)
    expect(moving?.motion).toBe('moving')
  })

  it('draws the conditional encounter branch once and only for a same-node stationary pair', () => {
    const encounterRandom = queuedRandom([0.099])
    const encounter = select([
      participant('alice'),
      participant('bob')
    ], encounterRandom)
    const boundary = select([
      participant('alice'),
      participant('bob')
    ], queuedRandom([0.1, 0, 0, 0]))
    const separated = select([
      participant('alice', 'research'),
      participant('bob', 'explore')
    ], queuedRandom([0, 0]))

    expect(encounter?.kind).toBe('encounter')
    expect(encounterRandom.calls()).toBe(1)
    expect(boundary?.kind).toBe('solo')
    expect(separated?.kind).toBe('solo')
  })

  it('enforces authoritative speech, mode, rendezvous and participant cooldown as hard constraints', () => {
    const history = createCampWorldMapAmbientHistory()
    history.participantLastShownAt.set('alice', 145_001)
    const cooling = selectCampWorldMapAmbientEvent({
      now: 200_000,
      hasAuthoritativeSpeech: false,
      participants: [participant('alice')],
      history
    }, queuedRandom([0]))
    history.participantLastShownAt.set('alice', 145_000)
    const ready = selectCampWorldMapAmbientEvent({
      now: 200_000,
      hasAuthoritativeSpeech: false,
      participants: [participant('alice')],
      history
    }, queuedRandom([0, 0]))
    const authoritative = selectCampWorldMapAmbientEvent({
      now: 200_000,
      hasAuthoritativeSpeech: true,
      participants: [participant('alice')],
      history: createCampWorldMapAmbientHistory()
    }, queuedRandom([0]))

    expect(cooling).toBeNull()
    expect(ready).not.toBeNull()
    expect(authoritative).toBeNull()
    expect(select([participant('alice', 'research', { mode: 'running' })], queuedRandom([0]))).toBeNull()
    expect(select([participant('alice', 'research', { rendezvousKey: 'real-a2a' })], queuedRandom([0]))).toBeNull()
  })

  it('enforces the canonical pair cooldown in addition to participant cooldown', () => {
    const configure = (pairShownAt: number) => (
      history: ReturnType<typeof createCampWorldMapAmbientHistory>
    ): void => {
      history.participantLastShownAt.set('alice', 145_000)
      history.participantLastShownAt.set('bob', 145_000)
      history.pairLastShownAt.set(campWorldMapAmbientPairKey('bob', 'alice'), pairShownAt)
    }
    const cooling = select(
      [participant('alice'), participant('bob')],
      queuedRandom([0.05, 0, 0, 0]),
      configure(80_001)
    )
    const ready = select(
      [participant('alice'), participant('bob')],
      queuedRandom([0.05]),
      configure(80_000)
    )

    expect(campWorldMapAmbientPairKey('bob', 'alice')).toBe(campWorldMapAmbientPairKey('alice', 'bob'))
    expect(cooling?.kind).toBe('solo')
    expect(ready?.kind).toBe('encounter')
  })

  it('never relaxes adjacent ID/topic and uses only the four declared history tiers', () => {
    const result = select([participant('alice')], queuedRandom([0, 0]), (history) => {
      history.lastBeatId = 'research-01'
      history.lastTopic = 'wayfinding'
      history.globalBeatIds.push(
        'research-01',
        'research-02',
        'research-03',
        'research-04',
        'research-05',
        'research-06',
        'research-07',
        'research-08'
      )
    })

    expect(CAMP_WORLD_MAP_AMBIENT_RELAXATION_TIERS).toEqual([
      { globalRecent: 12, nodeRecent: 4 },
      { globalRecent: 12, nodeRecent: 0 },
      { globalRecent: 6, nodeRecent: 0 },
      { globalRecent: 0, nodeRecent: 0 }
    ])
    expect(result?.beatId).not.toBe('research-01')
    expect(result?.topic).not.toBe('wayfinding')
  })

  it('relaxes only soft history, prefers the least-shown participant and safely skips exhaustion', () => {
    const movingIds = CAMP_WORLD_MAP_AMBIENT_BEATS
      .filter((beat) => beat.motion === 'moving')
      .map((beat) => beat.id)
    const relaxed = select([
      participant('alice', 'research', { motion: 'moving' })
    ], queuedRandom([0]), (history) => {
      history.globalBeatIds.push(...movingIds, 'research-01', 'research-02', 'research-03', 'research-04', 'research-05', 'research-06')
    })
    const fair = select([
      participant('alice', 'research'),
      participant('bob', 'explore')
    ], queuedRandom([0, 0]), (history) => {
      history.participantLastShownAt.set('alice', 0)
      history.participantLastShownAt.set('bob', 1_000)
    })
    const exhausted = select([participant('alice')], queuedRandom([0]), (history) => {
      history.participantLastShownAt.set('alice', 199_999)
    })

    expect(relaxed?.beatId).toMatch(/^generic-moving-/u)
    expect(fair?.agentIds).toEqual(['alice'])
    expect(exhausted).toBeNull()
  })

  it('writes history when displayed and does not require rollback on cancellation', () => {
    const history = createCampWorldMapAmbientHistory()
    const event = select([participant('alice')], queuedRandom([0, 0]))
    expect(event).not.toBeNull()
    if (!event) return
    recordCampWorldMapAmbientEvent(history, event, 200_000)

    expect(history.globalBeatIds).toEqual([event.beatId])
    expect(history.nodeBeatIds.get(event.nodeId)).toEqual([event.beatId])
    expect(history.participantLastShownAt.get('alice')).toBe(200_000)
    expect(history.lastTopic).toBe(event.topic)
  })
})

type FakeTimer = {
  id: number
  dueAt: number
  callback: () => void
  cleared: boolean
}

class FakeClock implements CampWorldMapAmbientSchedulerClock {
  nowValue = 0
  nextId = 1
  timers: FakeTimer[] = []

  now(): number {
    return this.nowValue
  }

  setTimeout(callback: () => void, delay: number): unknown {
    const timer = { id: this.nextId++, dueAt: this.nowValue + delay, callback, cleared: false }
    this.timers.push(timer)
    return timer.id
  }

  clearTimeout(handle: unknown): void {
    const timer = this.timers.find((candidate) => candidate.id === handle)
    if (timer) timer.cleared = true
  }

  pending(): FakeTimer[] {
    return this.timers.filter((timer) => !timer.cleared && timer.dueAt >= this.nowValue)
  }

  advanceBy(duration: number): void {
    const target = this.nowValue + duration
    while (true) {
      const next = this.timers
        .filter((timer) => !timer.cleared && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0]
      if (!next) break
      next.cleared = true
      this.nowValue = next.dueAt
      next.callback()
    }
    this.nowValue = target
  }

  fireEvenIfCleared(id: number): void {
    this.timers.find((timer) => timer.id === id)?.callback()
  }
}

const FIXED_SELECTION: CampWorldMapAmbientSelection = {
  kind: 'solo',
  beatId: 'research-01',
  topic: 'wayfinding',
  agentIds: ['alice'],
  nodeId: 'research',
  motion: 'stationary',
  text: '树根旁露出半块旧路标，箭头被苔藓盖住了一半。'
}

describe('Camp world map ambient scheduler', () => {
  it('uses exact delay bounds', () => {
    expect(campWorldMapAmbientInitialDelay(() => 0)).toBe(CAMP_WORLD_MAP_AMBIENT_INITIAL_DELAY.minimum)
    expect(campWorldMapAmbientInitialDelay(() => 1)).toBe(CAMP_WORLD_MAP_AMBIENT_INITIAL_DELAY.maximum)
    expect(campWorldMapAmbientAttemptDelay(() => 0)).toBe(CAMP_WORLD_MAP_AMBIENT_ATTEMPT_DELAY.minimum)
    expect(campWorldMapAmbientAttemptDelay(() => 1)).toBe(CAMP_WORLD_MAP_AMBIENT_ATTEMPT_DELAY.maximum)
  })

  it('schedules the first event at 6 seconds, displays 5.6 seconds and retries 22 seconds start-to-start', () => {
    const clock = new FakeClock()
    const events: (CampWorldMapAmbientDisplayedEvent | null)[] = []
    const scheduler = new CampWorldMapAmbientScheduler({
      clock,
      random: () => 0,
      select: () => FIXED_SELECTION,
      onDisplayed: () => undefined,
      onEventChange: (event) => events.push(event)
    })

    scheduler.start('initial')
    expect(clock.pending().map((timer) => timer.dueAt)).toEqual([6_000])
    clock.advanceBy(6_000)
    expect(events.at(-1)?.beatId).toBe('research-01')
    expect(clock.pending().map((timer) => timer.dueAt).sort((a, b) => a - b)).toEqual([11_600, 28_000])
    clock.advanceBy(CAMP_WORLD_MAP_AMBIENT_DISPLAY_MS)
    expect(events.at(-1)).toBeNull()
    clock.advanceBy(16_400)
    expect(events.at(-1)?.startedAt).toBe(28_000)
  })

  it('waits a full subsequent interval after a no-candidate attempt or resume', () => {
    const clock = new FakeClock()
    let canSelect = false
    const events: (CampWorldMapAmbientDisplayedEvent | null)[] = []
    const scheduler = new CampWorldMapAmbientScheduler({
      clock,
      random: () => 0,
      select: () => canSelect ? FIXED_SELECTION : null,
      onDisplayed: () => undefined,
      onEventChange: (event) => events.push(event)
    })

    scheduler.start('initial')
    clock.advanceBy(6_000)
    expect(events).toEqual([])
    canSelect = true
    clock.advanceBy(21_999)
    expect(events).toEqual([])
    clock.advanceBy(1)
    expect(events.at(-1)?.startedAt).toBe(28_000)
    scheduler.suspend()
    scheduler.start('subsequent')
    expect(clock.pending().some((timer) => timer.dueAt === 50_000)).toBe(true)
  })

  it('rejects stale schedule and expiry callbacks after suspension or a replacement event', () => {
    const clock = new FakeClock()
    const events: (CampWorldMapAmbientDisplayedEvent | null)[] = []
    const scheduler = new CampWorldMapAmbientScheduler({
      clock,
      random: () => 0,
      select: () => FIXED_SELECTION,
      onDisplayed: () => undefined,
      onEventChange: (event) => events.push(event)
    })

    scheduler.start('initial')
    const staleAttemptId = clock.pending()[0]?.id
    scheduler.suspend()
    if (staleAttemptId) clock.fireEvenIfCleared(staleAttemptId)
    expect(events).toEqual([])

    scheduler.start('initial')
    clock.advanceBy(6_000)
    const firstEventId = events.at(-1)?.eventId
    const staleExpiryId = clock.pending().find((timer) => timer.dueAt === clock.now() + 5_600)?.id
    scheduler.cancelCurrentAndReschedule()
    clock.advanceBy(22_000)
    expect(events.at(-1)?.eventId).not.toBe(firstEventId)
    if (staleExpiryId) clock.fireEvenIfCleared(staleExpiryId)
    expect(events.at(-1)?.eventId).not.toBe(firstEventId)
  })
})

describe('Camp world map caption arbitration', () => {
  function agent(
    agentId: string,
    kind: 'real' | 'waiting' | null
  ): CampWorldMapAgent {
    return {
      agentId,
      displayName: agentId,
      avatarRef: null,
      mode: kind === 'real' ? 'running' : kind === 'waiting' ? 'waiting' : 'idle',
      hasExecutionProcess: kind !== null,
      activeRunId: kind ? `run-${agentId}` : null,
      speech: kind
        ? { key: `${kind}-${agentId}`, kind, label: kind, text: `${kind} text` }
        : null
    }
  }

  it('uses real, waiting, encounter and solo priority in stable member order', () => {
    const ambient = {
      ...FIXED_SELECTION,
      eventId: 'ambient-1',
      startedAt: 0,
      expiresAt: 5_600
    } satisfies CampWorldMapAmbientDisplayedEvent
    const encounter = {
      ...ambient,
      kind: 'encounter' as const,
      agentIds: ['alice', 'bob'] as const,
      motion: 'stationary' as const
    }

    expect(campWorldMapCaption([
      agent('waiting-first', 'waiting'),
      agent('real-first', 'real'),
      agent('real-second', 'real')
    ], encounter)).toMatchObject({ kind: 'real', agentId: 'real-first', interactive: true })
    expect(campWorldMapCaption([
      agent('waiting-first', 'waiting'),
      agent('waiting-second', 'waiting')
    ], encounter)).toMatchObject({ kind: 'waiting', agentId: 'waiting-first', interactive: true })
    expect(campWorldMapCaption([agent('alice', null), agent('bob', null)], encounter)).toMatchObject({
      kind: 'ambient-encounter',
      interactive: false,
      label: '闲时预设 · 偶遇'
    })
    expect(campWorldMapCaption([agent('alice', null)], ambient)).toMatchObject({
      kind: 'ambient-solo',
      interactive: false,
      label: '闲时 · 环境预设'
    })
  })
})
