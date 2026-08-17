import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import { MemberAvatar } from './MemberAvatar'
import { identityColorToken } from './theme'
import harborCityMapUrl from './assets/world-map/harbor-city-2k.webp'
import {
  CampWorldMapAmbientScheduler,
  campWorldMapAuthoritativeSpeechBlocksAmbient,
  campWorldMapCaption,
  createCampWorldMapAmbientHistory,
  createCampWorldMapAmbientRandom,
  recordCampWorldMapAmbientEvent,
  selectCampWorldMapAmbientEvent,
  type CampWorldMapAmbientDisplayedEvent,
  type CampWorldMapAmbientParticipant
} from './camp-world-map-ambient'
import {
  CAMP_WORLD_MAP_HEIGHT,
  CAMP_WORLD_MAP_NODE_IDS,
  CAMP_WORLD_MAP_NODES,
  CAMP_WORLD_MAP_ROUTES,
  CAMP_WORLD_MAP_WIDTH,
  campWorldMapInitialNodes,
  campWorldMapRendezvousNode,
  campWorldMapShortestPath,
  campWorldMapStableHash,
  type CampWorldMapAgent,
  type CampWorldMapNodeId,
  type CampWorldMapPathEdge,
  type CampWorldMapRendezvous
} from './camp-world-map-model'

type WorldMapPoint = { x: number; y: number }
type WorldMapFrameSize = { width: number; height: number }
type WorldMapMovementKind = 'ambient' | 'run' | 'a2a'

type WorldMapMovement = {
  edge: CampWorldMapPathEdge
  kind: WorldMapMovementKind
  startedAt: number
  duration: number
  startParam: number
  endParam: number
  pausedAt: number | null
}

type WorldMapAgentMotion = {
  agentId: string
  nodeId: CampWorldMapNodeId
  point: WorldMapPoint
  mode: CampWorldMapAgent['mode']
  randomState: number
  movement: WorldMapMovement | null
  queue: CampWorldMapPathEdge[]
  nextMoveAt: number
  rendezvousKey: string | null
  rendezvousSide: -1 | 0 | 1
}

type CampWorldMapProps = {
  campId: string
  agents: readonly CampWorldMapAgent[]
  rendezvous: readonly CampWorldMapRendezvous[]
  routesVisible: boolean
  active: boolean
  onOpenExecutionProcess(agentId: string, trigger: HTMLButtonElement): void
}

const ROUTE_BY_ID = new Map(CAMP_WORLD_MAP_ROUTES.map((route) => [route.id, route]))
const MOVEMENT_SPEED: Readonly<Record<WorldMapMovementKind, number>> = {
  ambient: 10,
  run: 20,
  a2a: 62
}
const MOVEMENT_PRIORITY: Readonly<Record<WorldMapMovementKind, number>> = {
  ambient: 1,
  run: 2,
  a2a: 3
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function useWindowActive(): boolean {
  const [windowActive, setWindowActive] = useState(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible' && document.hasFocus()
  )

  useEffect(() => {
    const handleFocus = (): void => {
      setWindowActive(document.visibilityState === 'visible')
    }
    const handleBlur = (): void => {
      setWindowActive(false)
    }
    const handleVisibilityChange = (): void => {
      setWindowActive(document.visibilityState === 'visible' && document.hasFocus())
    }

    handleVisibilityChange()
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return windowActive
}

function nextRandom(motion: WorldMapAgentMotion): number {
  motion.randomState = (Math.imul(motion.randomState, 1664525) + 1013904223) >>> 0
  return motion.randomState / 4294967296
}

function pointForNode(nodeId: CampWorldMapNodeId): WorldMapPoint {
  const node = CAMP_WORLD_MAP_NODES[nodeId]
  return { x: node.x, y: node.y }
}

function positionAgentElement(
  element: HTMLDivElement,
  point: WorldMapPoint,
  frameSize: WorldMapFrameSize | null
): void {
  if (frameSize) {
    element.style.setProperty(
      '--world-map-agent-x',
      `${point.x / CAMP_WORLD_MAP_WIDTH * frameSize.width}px`
    )
    element.style.setProperty(
      '--world-map-agent-y',
      `${point.y / CAMP_WORLD_MAP_HEIGHT * frameSize.height}px`
    )
  }
  element.classList.toggle('is-edge-left', point.x < 225)
  element.classList.toggle('is-edge-right', point.x > CAMP_WORLD_MAP_WIDTH - 225)
}

function routeDirection(edge: CampWorldMapPathEdge): { start: number; end: number } {
  const route = ROUTE_BY_ID.get(edge.routeId)
  return route?.from === edge.from ? { start: 0, end: 1 } : { start: 1, end: 0 }
}

function routeFallbackLength(edge: CampWorldMapPathEdge): number {
  const from = CAMP_WORLD_MAP_NODES[edge.from]
  const to = CAMP_WORLD_MAP_NODES[edge.to]
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function easeInOutQuadratic(progress: number): number {
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2
}

export function CampWorldMap({
  campId,
  agents,
  rendezvous,
  routesVisible,
  active,
  onOpenExecutionProcess
}: CampWorldMapProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  const windowActive = useWindowActive()
  const sceneActive = active && windowActive
  const motionActive = sceneActive && !reducedMotion
  const authoritativeSpeechBlocksAmbient = campWorldMapAuthoritativeSpeechBlocksAmbient(agents)
  const viewportRef = useRef<HTMLDivElement>(null)
  const agentElementById = useRef(new Map<string, HTMLDivElement>())
  const agentElementRefById = useRef(new Map<string, (element: HTMLDivElement | null) => void>())
  const routeElementById = useRef(new Map<string, SVGPathElement>())
  const routeElementRefById = useRef(new Map<string, (element: SVGPathElement | null) => void>())
  const routeLengthById = useRef(new Map<string, number>())
  const motionByAgentId = useRef(new Map<string, WorldMapAgentMotion>())
  const motionCampIdRef = useRef(campId)
  const activeRouteUsers = useRef(new Map<string, Map<string, WorldMapMovementKind>>())
  const rendezvousRef = useRef(rendezvous)
  const agentsRef = useRef(agents)
  const campIdRef = useRef(campId)
  const sceneActiveRef = useRef(sceneActive)
  const motionActiveRef = useRef(motionActive)
  const authoritativeSpeechBlocksAmbientRef = useRef(authoritativeSpeechBlocksAmbient)
  const ambientSchedulerRef = useRef<CampWorldMapAmbientScheduler | null>(null)
  const ambientScheduleStartedRef = useRef(false)
  const ambientScheduleRunningRef = useRef(false)
  const [frameSize, setFrameSize] = useState<WorldMapFrameSize | null>(null)
  const frameSizeRef = useRef<WorldMapFrameSize | null>(null)
  const [density, setDensity] = useState<'regular' | 'compact' | 'condensed'>('regular')
  const [ambientEvent, setAmbientEvent] = useState<CampWorldMapAmbientDisplayedEvent | null>(null)
  const ambientEventRef = useRef<CampWorldMapAmbientDisplayedEvent | null>(null)
  const ambientEventCampIdRef = useRef<string | null>(null)
  const agentIdsKey = agents.map((agent) => agent.agentId).join('\u0000')
  const agentModesKey = agents.map((agent) => `${agent.agentId}:${agent.mode}`).join('\u0000')
  const initialNodes = useMemo(
    () => campWorldMapInitialNodes(campId, agents.map((agent) => agent.agentId)),
    [agentIdsKey, campId]
  )
  const initialNodesRef = useRef(initialNodes)
  initialNodesRef.current = initialNodes

  useEffect(() => {
    rendezvousRef.current = rendezvous
  }, [rendezvous])

  useLayoutEffect(() => {
    agentsRef.current = agents
    campIdRef.current = campId
    sceneActiveRef.current = sceneActive
    motionActiveRef.current = motionActive
    authoritativeSpeechBlocksAmbientRef.current = authoritativeSpeechBlocksAmbient
  }, [agents, authoritativeSpeechBlocksAmbient, campId, motionActive, sceneActive])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const resize = (): void => {
      const bounds = viewport.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      const sourceRatio = CAMP_WORLD_MAP_WIDTH / CAMP_WORLD_MAP_HEIGHT
      let width = bounds.width
      let height = width / sourceRatio
      if (height > bounds.height) {
        height = bounds.height
        width = height * sourceRatio
      }
      const next = { width: Math.max(1, width), height: Math.max(1, height) }
      frameSizeRef.current = next
      for (const motion of motionByAgentId.current.values()) {
        const element = agentElementById.current.get(motion.agentId)
        if (element) positionAgentElement(element, motion.point, next)
      }
      setFrameSize((current) => {
        return current
          && Math.abs(current.width - next.width) < 0.5
          && Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      })
      setDensity(
        bounds.height < 190 || bounds.width < 360
          ? 'condensed'
          : bounds.height < 280 || bounds.width < 620
            ? 'compact'
            : 'regular'
      )
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const renderRouteActivity = useCallback((routeId: string): void => {
    const path = routeElementById.current.get(routeId)
    if (!path) return
    const kinds = [...(activeRouteUsers.current.get(routeId)?.values() ?? [])]
    const activeKind = kinds.sort((left, right) => MOVEMENT_PRIORITY[right] - MOVEMENT_PRIORITY[left])[0]
    if (activeKind) path.dataset.active = activeKind
    else delete path.dataset.active
  }, [])

  const activateRoute = useCallback((
    routeId: string,
    agentId: string,
    kind: WorldMapMovementKind
  ): void => {
    const users = activeRouteUsers.current.get(routeId) ?? new Map<string, WorldMapMovementKind>()
    users.set(agentId, kind)
    activeRouteUsers.current.set(routeId, users)
    renderRouteActivity(routeId)
  }, [renderRouteActivity])

  const deactivateRoute = useCallback((routeId: string, agentId: string): void => {
    const users = activeRouteUsers.current.get(routeId)
    if (!users) return
    users.delete(agentId)
    if (users.size === 0) activeRouteUsers.current.delete(routeId)
    renderRouteActivity(routeId)
  }, [renderRouteActivity])

  const setAgentPoint = useCallback((motion: WorldMapAgentMotion, point: WorldMapPoint): void => {
    motion.point = point
    const element = agentElementById.current.get(motion.agentId)
    if (!element) return
    positionAgentElement(element, point, frameSizeRef.current)
  }, [])

  const clearRendezvousOffset = useCallback((motion: WorldMapAgentMotion): void => {
    const element = agentElementById.current.get(motion.agentId)
    element?.style.removeProperty('--world-map-agent-offset')
    if (element) delete element.dataset.rendezvous
  }, [])

  const showRendezvousOffset = useCallback((motion: WorldMapAgentMotion): void => {
    if (motion.rendezvousSide === 0) return
    const element = agentElementById.current.get(motion.agentId)
    if (!element) return
    element.dataset.rendezvous = 'true'
    element.style.setProperty('--world-map-agent-offset', `${motion.rendezvousSide * 16}px`)
  }, [])

  const startEdge = useCallback((
    motion: WorldMapAgentMotion,
    edge: CampWorldMapPathEdge,
    kind: WorldMapMovementKind,
    now: number
  ): void => {
    const direction = routeDirection(edge)
    const length = routeLengthById.current.get(edge.routeId) ?? routeFallbackLength(edge)
    motion.nodeId = edge.from
    motion.movement = {
      edge,
      kind,
      startedAt: now,
      duration: Math.max(kind === 'a2a' ? 520 : 1_600, length / MOVEMENT_SPEED[kind] * 1_000),
      startParam: direction.start,
      endParam: direction.end,
      pausedAt: null
    }
    activateRoute(edge.routeId, motion.agentId, kind)
  }, [activateRoute])

  const startPath = useCallback((
    motion: WorldMapAgentMotion,
    path: readonly CampWorldMapPathEdge[] | null,
    kind: WorldMapMovementKind,
    now: number
  ): void => {
    if (!path || path.length === 0) {
      if (kind === 'a2a') showRendezvousOffset(motion)
      return
    }
    motion.queue = [...path]
    const edge = motion.queue.shift()
    if (edge) startEdge(motion, edge, kind, now)
  }, [showRendezvousOffset, startEdge])

  const cancelMovement = useCallback((motion: WorldMapAgentMotion, now: number): void => {
    const movement = motion.movement
    if (movement) {
      const progress = Math.max(0, Math.min(1, (now - movement.startedAt) / movement.duration))
      motion.nodeId = progress >= 0.5 ? movement.edge.to : movement.edge.from
      deactivateRoute(movement.edge.routeId, motion.agentId)
    }
    motion.movement = null
    motion.queue = []
    setAgentPoint(motion, pointForNode(motion.nodeId))
  }, [deactivateRoute, setAgentPoint])

  useLayoutEffect(() => {
    const now = typeof performance === 'undefined' ? 0 : performance.now()
    if (motionCampIdRef.current !== campId) {
      for (const motion of motionByAgentId.current.values()) {
        if (motion.movement) deactivateRoute(motion.movement.edge.routeId, motion.agentId)
      }
      motionByAgentId.current.clear()
      activeRouteUsers.current.clear()
      motionCampIdRef.current = campId
    }
    const activeIds = new Set(agents.map((agent) => agent.agentId))
    for (const [agentId, motion] of motionByAgentId.current) {
      if (activeIds.has(agentId)) continue
      if (motion.movement) deactivateRoute(motion.movement.edge.routeId, agentId)
      motionByAgentId.current.delete(agentId)
      agentElementById.current.delete(agentId)
      agentElementRefById.current.delete(agentId)
    }
    for (const agent of agents) {
      const existing = motionByAgentId.current.get(agent.agentId)
      const nodeId = initialNodes[agent.agentId] ?? 'camp'
      const motion = existing ?? {
        agentId: agent.agentId,
        nodeId,
        point: pointForNode(nodeId),
        mode: agent.mode,
        randomState: campWorldMapStableHash(`${campId}:${agent.agentId}:motion`) || 1,
        movement: null,
        queue: [],
        nextMoveAt: now + 2_800 + (campWorldMapStableHash(`${agent.agentId}:move`) % 5_000),
        rendezvousKey: null,
        rendezvousSide: 0
      } satisfies WorldMapAgentMotion
      motion.mode = agent.mode
      if (agent.mode === 'waiting' && motion.movement) cancelMovement(motion, now)
      motionByAgentId.current.set(agent.agentId, motion)
      setAgentPoint(motion, motion.point)
    }
  }, [agentIdsKey, agentModesKey, campId, cancelMovement, deactivateRoute, initialNodes, setAgentPoint])

  const isAmbientEventValid = useCallback((event: CampWorldMapAmbientDisplayedEvent): boolean => {
    if (campIdRef.current !== ambientEventCampIdRef.current) return false
    if (!sceneActiveRef.current || authoritativeSpeechBlocksAmbientRef.current) return false
    const participantMotions = event.agentIds.map((agentId) => motionByAgentId.current.get(agentId))
    if (participantMotions.some((motion) => !motion || motion.mode !== 'idle' || motion.rendezvousKey)) {
      return false
    }
    if (event.kind === 'encounter') {
      const [left, right] = participantMotions
      return Boolean(left && right
        && !left.movement
        && !right.movement
        && left.nodeId === event.nodeId
        && right.nodeId === event.nodeId)
    }
    const motion = participantMotions[0]
    if (!motion) return false
    if (event.motion === 'moving') {
      return motionActiveRef.current && motion.movement?.kind === 'ambient'
    }
    return !motion.movement && motion.nodeId === event.nodeId
  }, [])

  const cancelAmbientEventIfInvalid = useCallback((): void => {
    const event = ambientEventRef.current
    if (!event || isAmbientEventValid(event)) return
    ambientSchedulerRef.current?.cancelCurrentAndReschedule()
  }, [isAmbientEventValid])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const history = createCampWorldMapAmbientHistory()
    const random = createCampWorldMapAmbientRandom(campId)
    let disposed = false
    ambientEventRef.current = null
    ambientEventCampIdRef.current = null
    setAmbientEvent(null)
    ambientScheduleStartedRef.current = sceneActiveRef.current
    ambientScheduleRunningRef.current = false

    const scheduler = new CampWorldMapAmbientScheduler({
      clock: {
        now: () => performance.now(),
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (handle) => window.clearTimeout(handle as number)
      },
      random,
      select: (now, selectionRandom) => {
        if (campIdRef.current !== campId
          || !sceneActiveRef.current
          || authoritativeSpeechBlocksAmbientRef.current
          || ambientEventRef.current) return null
        const participants: CampWorldMapAmbientParticipant[] = []
        for (const agent of agentsRef.current) {
          const motion = motionByAgentId.current.get(agent.agentId)
          if (!motion) continue
          participants.push({
            agentId: agent.agentId,
            nodeId: motion.nodeId,
            mode: agent.mode,
            motion: motion.movement && motionActiveRef.current ? 'moving' : 'stationary',
            rendezvousKey: motion.rendezvousKey
          })
        }
        return selectCampWorldMapAmbientEvent({
          now,
          hasAuthoritativeSpeech: authoritativeSpeechBlocksAmbientRef.current,
          participants,
          history
        }, selectionRandom)
      },
      onDisplayed: (event) => recordCampWorldMapAmbientEvent(history, event, event.startedAt),
      onEventChange: (event) => {
        if (disposed || ambientSchedulerRef.current !== scheduler) return
        ambientEventRef.current = event
        ambientEventCampIdRef.current = event ? campId : null
        setAmbientEvent(event)
      }
    })
    ambientSchedulerRef.current = scheduler
    if (sceneActiveRef.current && !authoritativeSpeechBlocksAmbientRef.current) {
      scheduler.start('initial')
      ambientScheduleStartedRef.current = true
      ambientScheduleRunningRef.current = true
    }

    return () => {
      disposed = true
      scheduler.suspend()
      if (ambientSchedulerRef.current === scheduler) {
        ambientSchedulerRef.current = null
        ambientScheduleRunningRef.current = false
        ambientEventRef.current = null
        ambientEventCampIdRef.current = null
      }
    }
  }, [campId])

  useEffect(() => {
    const scheduler = ambientSchedulerRef.current
    if (!scheduler) return
    const shouldRun = sceneActive && !authoritativeSpeechBlocksAmbient
    if (!shouldRun && ambientScheduleRunningRef.current) {
      scheduler.suspend()
      ambientScheduleRunningRef.current = false
      return
    }
    if (shouldRun && !ambientScheduleRunningRef.current) {
      scheduler.start(ambientScheduleStartedRef.current ? 'subsequent' : 'initial')
      ambientScheduleStartedRef.current = true
      ambientScheduleRunningRef.current = true
    }
  }, [authoritativeSpeechBlocksAmbient, campId, sceneActive])

  useLayoutEffect(() => {
    if (!sceneActive || !reducedMotion) return
    const now = typeof performance === 'undefined' ? 0 : performance.now()
    for (const motion of motionByAgentId.current.values()) {
      if (motion.mode !== 'idle' || motion.movement?.kind !== 'ambient') continue
      cancelMovement(motion, motion.movement.pausedAt ?? now)
    }
  }, [cancelMovement, reducedMotion, sceneActive])

  useEffect(() => {
    cancelAmbientEventIfInvalid()
  }, [agentModesKey, authoritativeSpeechBlocksAmbient, cancelAmbientEventIfInvalid, motionActive, rendezvous])

  useEffect(() => {
    if (!motionActive || typeof window === 'undefined') return
    let frame = 0

    const pauseAll = (now: number): void => {
      for (const motion of motionByAgentId.current.values()) {
        if (motion.movement && motion.movement.pausedAt === null) motion.movement.pausedAt = now
      }
    }
    const resumeAll = (now: number): void => {
      for (const motion of motionByAgentId.current.values()) {
        const movement = motion.movement
        if (!movement || movement.pausedAt === null) continue
        movement.startedAt += now - movement.pausedAt
        movement.pausedAt = null
      }
    }
    const reconcileRendezvous = (now: number): void => {
      const currentKeys = new Set(rendezvousRef.current.map((item) => item.key))
      let startedRendezvous = false
      for (const motion of motionByAgentId.current.values()) {
        if (!motion.rendezvousKey || currentKeys.has(motion.rendezvousKey)) continue
        cancelMovement(motion, now)
        motion.rendezvousKey = null
        motion.rendezvousSide = 0
        clearRendezvousOffset(motion)
        motion.nextMoveAt = now + 2_000 + nextRandom(motion) * 4_000
      }
      for (const item of rendezvousRef.current) {
        const source = motionByAgentId.current.get(item.sourceAgentId)
        const target = motionByAgentId.current.get(item.targetAgentId)
        if (!source || !target || source.mode !== 'running' || target.mode !== 'running') continue
        if (source.rendezvousKey === item.key && target.rendezvousKey === item.key) continue
        if (source.rendezvousKey || target.rendezvousKey) continue
        cancelMovement(source, now)
        cancelMovement(target, now)
        const meetingNode = campWorldMapRendezvousNode(source.nodeId, target.nodeId)
        if (!meetingNode) continue
        source.rendezvousKey = item.key
        source.rendezvousSide = -1
        target.rendezvousKey = item.key
        target.rendezvousSide = 1
        startPath(source, campWorldMapShortestPath(source.nodeId, meetingNode), 'a2a', now)
        startPath(target, campWorldMapShortestPath(target.nodeId, meetingNode), 'a2a', now)
        startedRendezvous = true
      }
      if (startedRendezvous) cancelAmbientEventIfInvalid()
    }
    const chooseAmbientPath = (motion: WorldMapAgentMotion, now: number): void => {
      if (motion.mode === 'waiting' || motion.rendezvousKey) return
      const ambient = ambientEventRef.current
      if (ambient?.motion === 'stationary' && ambient.agentIds.includes(motion.agentId)) return
      if (nextRandom(motion) < 0.48) {
        motion.nextMoveAt = now + 6_000 + nextRandom(motion) * 10_000
        return
      }
      const targets = CAMP_WORLD_MAP_NODE_IDS.filter((nodeId) => nodeId !== motion.nodeId)
      const target = targets[Math.floor(nextRandom(motion) * targets.length)]
      const path = campWorldMapShortestPath(motion.nodeId, target)
      if (!path || path.length === 0) {
        motion.nextMoveAt = now + 8_000
        return
      }
      startPath(motion, path, motion.mode === 'running' ? 'run' : 'ambient', now)
    }
    const finishMovement = (motion: WorldMapAgentMotion, now: number): void => {
      const movement = motion.movement
      if (!movement) return
      deactivateRoute(movement.edge.routeId, motion.agentId)
      motion.nodeId = movement.edge.to
      motion.movement = null
      setAgentPoint(motion, pointForNode(motion.nodeId))
      const nextEdge = motion.queue.shift()
      if (nextEdge) {
        startEdge(motion, nextEdge, movement.kind, now)
        return
      }
      if (movement.kind === 'a2a') showRendezvousOffset(motion)
      else motion.nextMoveAt = now + 4_500 + nextRandom(motion) * 9_500
      cancelAmbientEventIfInvalid()
    }
    const updateMovement = (motion: WorldMapAgentMotion, now: number): void => {
      const movement = motion.movement
      if (!movement) {
        const ambient = ambientEventRef.current
        if (ambient?.motion === 'stationary' && ambient.agentIds.includes(motion.agentId)) return
        if (!motion.rendezvousKey && now >= motion.nextMoveAt) chooseAmbientPath(motion, now)
        return
      }
      const progress = Math.max(0, Math.min(1, (now - movement.startedAt) / movement.duration))
      const param = movement.startParam
        + (movement.endParam - movement.startParam) * easeInOutQuadratic(progress)
      const path = routeElementById.current.get(movement.edge.routeId)
      if (path && typeof path.getTotalLength === 'function' && typeof path.getPointAtLength === 'function') {
        const point = path.getPointAtLength(path.getTotalLength() * param)
        setAgentPoint(motion, { x: point.x, y: point.y })
      } else {
        const from = CAMP_WORLD_MAP_NODES[movement.edge.from]
        const to = CAMP_WORLD_MAP_NODES[movement.edge.to]
        setAgentPoint(motion, {
          x: from.x + (to.x - from.x) * easeInOutQuadratic(progress),
          y: from.y + (to.y - from.y) * easeInOutQuadratic(progress)
        })
      }
      if (progress >= 1) finishMovement(motion, now)
    }
    const tick = (now: number): void => {
      reconcileRendezvous(now)
      for (const motion of motionByAgentId.current.values()) updateMovement(motion, now)
      frame = window.requestAnimationFrame(tick)
    }

    resumeAll(performance.now())
    frame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frame)
      pauseAll(performance.now())
    }
  }, [
    campId,
    cancelMovement,
    cancelAmbientEventIfInvalid,
    clearRendezvousOffset,
    deactivateRoute,
    motionActive,
    setAgentPoint,
    showRendezvousOffset,
    startEdge,
    startPath
  ])

  const setAgentElement = useCallback((agentId: string, element: HTMLDivElement | null): void => {
    if (!element) {
      agentElementById.current.delete(agentId)
      return
    }
    agentElementById.current.set(agentId, element)
    const motion = motionByAgentId.current.get(agentId)
    if (motion) setAgentPoint(motion, motion.point)
    else {
      const node = initialNodesRef.current[agentId] ?? 'camp'
      positionAgentElement(element, CAMP_WORLD_MAP_NODES[node], frameSizeRef.current)
    }
  }, [setAgentPoint])

  const agentElementRef = useCallback((agentId: string) => {
    const existing = agentElementRefById.current.get(agentId)
    if (existing) return existing
    const callback = (element: HTMLDivElement | null): void => setAgentElement(agentId, element)
    agentElementRefById.current.set(agentId, callback)
    return callback
  }, [setAgentElement])

  const setRouteElement = useCallback((routeId: string, element: SVGPathElement | null): void => {
    if (!element) {
      routeElementById.current.delete(routeId)
      routeLengthById.current.delete(routeId)
      return
    }
    routeElementById.current.set(routeId, element)
    routeLengthById.current.set(routeId, element.getTotalLength())
    renderRouteActivity(routeId)
  }, [renderRouteActivity])

  const routeElementRef = useCallback((routeId: string) => {
    const existing = routeElementRefById.current.get(routeId)
    if (existing) return existing
    const callback = (element: SVGPathElement | null): void => setRouteElement(routeId, element)
    routeElementRefById.current.set(routeId, callback)
    return callback
  }, [setRouteElement])

  const frameStyle = frameSize
    ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` }
    : undefined
  const visibleAmbientEvent = ambientEvent && ambientEventCampIdRef.current === campId
    ? ambientEvent
    : null
  const realAgent = agents.find(
    (agent) => agent.speech?.kind === 'real' && agent.hasExecutionProcess
  ) ?? null
  const captionCandidate = campWorldMapCaption(agents, visibleAmbientEvent)
  const caption = density === 'condensed' || (agents.length > 6 && !realAgent)
    ? captionCandidate
    : null
  const encounterNode = visibleAmbientEvent?.kind === 'encounter'
    ? CAMP_WORLD_MAP_NODES[visibleAmbientEvent.nodeId]
    : null

  return (
    <section
      className={`camp-world-map${routesVisible ? ' routes-visible' : ''}${motionActive ? '' : ' is-static'}`}
      data-density={density}
      data-motion-state={motionActive ? 'active' : 'paused'}
      data-population={agents.length > 6 ? 'crowded' : 'normal'}
      data-ambient-kind={visibleAmbientEvent?.kind ?? 'none'}
      data-ambient-beat-id={visibleAmbientEvent?.beatId}
      aria-label="会话世界地图"
    >
      <div
        className="camp-world-map-backdrop"
        style={{ backgroundImage: `url(${harborCityMapUrl})` }}
        aria-hidden="true"
      />
      <div className="camp-world-map-viewport" ref={viewportRef}>
        <div className="camp-world-map-frame" style={frameStyle}>
          <img
            className="camp-world-map-image"
            src={harborCityMapUrl}
            alt="港湾城市协作世界地图"
            draggable={false}
          />
          <svg
            className="camp-world-map-routes"
            viewBox={`0 0 ${CAMP_WORLD_MAP_WIDTH} ${CAMP_WORLD_MAP_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {CAMP_WORLD_MAP_ROUTES.map((route) => (
              <path
                className="camp-world-map-route"
                data-kind={route.kind}
                d={route.d}
                key={route.id}
                ref={routeElementRef(route.id)}
              />
            ))}
          </svg>
          <div className="camp-world-map-agents">
            {agents.map((agent) => {
              const ambient = visibleAmbientEvent?.kind === 'solo'
                && visibleAmbientEvent.agentIds[0] === agent.agentId
                ? {
                    key: visibleAmbientEvent.eventId,
                    label: '闲时 · 环境预设',
                    text: visibleAmbientEvent.text
                  }
                : null
              const speech = agent.speech ?? ambient
              const canOpenProcess = agent.hasExecutionProcess
              const encounterIndex = visibleAmbientEvent?.kind === 'encounter'
                ? visibleAmbientEvent.agentIds.indexOf(agent.agentId)
                : -1
              const encounterSide = encounterIndex === 0 ? -1 : encounterIndex === 1 ? 1 : 0
              return (
                <div
                  className="camp-world-map-agent"
                  data-mode={agent.mode}
                  data-ambient-encounter-participant={encounterSide < 0
                    ? 'left'
                    : encounterSide > 0
                      ? 'right'
                      : undefined}
                  key={agent.agentId}
                  ref={agentElementRef(agent.agentId)}
                  style={{ '--world-map-agent-color': identityColorToken(agent.agentId) } as CSSProperties}
                >
                  <button
                    className="camp-world-map-agent-button"
                    type="button"
                    aria-label={canOpenProcess
                      ? `打开${agent.displayName}的执行过程`
                      : `${agent.displayName}，当前没有执行过程`}
                    aria-disabled={canOpenProcess ? undefined : true}
                    tabIndex={canOpenProcess ? 0 : -1}
                    onClick={(event) => {
                      if (canOpenProcess) onOpenExecutionProcess(agent.agentId, event.currentTarget)
                    }}
                  >
                    <MemberAvatar
                      agentId={agent.agentId}
                      avatarRef={agent.avatarRef}
                      displayName={agent.displayName}
                      size="picker"
                      decorative
                    />
                  </button>
                  <div className="camp-world-map-agent-name">
                    <span className="camp-world-map-status-dot" aria-hidden="true" />
                    <span>{agent.displayName}</span>
                  </div>
                  {speech && (agent.speech && canOpenProcess
                    ? (
                        <button
                          className={`camp-world-map-speech is-${agent.speech.kind}`}
                          type="button"
                          title={speech.text}
                          onClick={(event) => onOpenExecutionProcess(agent.agentId, event.currentTarget)}
                          key={speech.key}
                        >
                          {agent.speech && (
                            <span className="camp-world-map-speech-kind">{speech.label}</span>
                          )}
                          <span className="camp-world-map-speech-text">{speech.text}</span>
                        </button>
                      )
                    : (
                        <div
                          className={`camp-world-map-speech${agent.speech ? ` is-${agent.speech.kind}` : ' is-ambient'}`}
                          title={speech.text}
                          key={speech.key}
                        >
                          {agent.speech && (
                            <span className="camp-world-map-speech-kind">{speech.label}</span>
                          )}
                          <span className="camp-world-map-speech-text">{speech.text}</span>
                        </div>
                      ))}
                </div>
              )
            })}
          </div>
          {visibleAmbientEvent?.kind === 'encounter' && encounterNode && (
            <div
              className="camp-world-map-ambient-encounter"
              data-beat-id={visibleAmbientEvent.beatId}
              key={visibleAmbientEvent.eventId}
              title={visibleAmbientEvent.text}
              style={{
                '--world-map-encounter-shift': encounterNode.x < 225
                  ? '-18%'
                  : encounterNode.x > CAMP_WORLD_MAP_WIDTH - 225
                    ? '-82%'
                    : '-50%',
                left: `${encounterNode.x / CAMP_WORLD_MAP_WIDTH * 100}%`,
                top: `${encounterNode.y / CAMP_WORLD_MAP_HEIGHT * 100}%`
              } as CSSProperties}
            >
              <span className="camp-world-map-speech-text">{visibleAmbientEvent.text}</span>
            </div>
          )}
          {caption && (caption.interactive
            ? (
                <button
                  className={`camp-world-map-live-caption is-${caption.kind}`}
                  type="button"
                  title={caption.text}
                  onClick={(event) => onOpenExecutionProcess(caption.agentId, event.currentTarget)}
                >
                  <strong>{caption.label}</strong>
                  <span>{caption.text}</span>
                </button>
              )
            : (
                <div
                  className={`camp-world-map-live-caption is-${caption.kind}`}
                  title={caption.text}
                >
                  <strong>{caption.label}</strong>
                  <span>{caption.text}</span>
                </div>
              ))}
          {agents.length === 0 && (
            <div className="camp-world-map-empty">
              当前会话暂无可在地图中呈现的队员。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
