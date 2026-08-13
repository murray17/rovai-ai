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
  CAMP_WORLD_MAP_HEIGHT,
  CAMP_WORLD_MAP_NODE_IDS,
  CAMP_WORLD_MAP_NODES,
  CAMP_WORLD_MAP_ROUTES,
  CAMP_WORLD_MAP_WIDTH,
  campWorldMapAmbientSpeech,
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
  nextAmbientAt: number
  ambientSequence: number
  rendezvousKey: string | null
  rendezvousSide: -1 | 0 | 1
}

type WorldMapAmbientBubble = {
  agentId: string
  text: string
  expiresAt: number
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
  const motionActive = active && windowActive && !reducedMotion
  const viewportRef = useRef<HTMLDivElement>(null)
  const agentElementById = useRef(new Map<string, HTMLDivElement>())
  const routeElementById = useRef(new Map<string, SVGPathElement>())
  const motionByAgentId = useRef(new Map<string, WorldMapAgentMotion>())
  const activeRouteUsers = useRef(new Map<string, Map<string, WorldMapMovementKind>>())
  const rendezvousRef = useRef(rendezvous)
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null)
  const [density, setDensity] = useState<'regular' | 'compact' | 'condensed'>('regular')
  const [ambientBubble, setAmbientBubble] = useState<WorldMapAmbientBubble | null>(null)
  const ambientBubbleRef = useRef<WorldMapAmbientBubble | null>(null)
  const agentIdsKey = agents.map((agent) => agent.agentId).join('\u0000')
  const agentModesKey = agents.map((agent) => `${agent.agentId}:${agent.mode}`).join('\u0000')
  const initialNodes = useMemo(
    () => campWorldMapInitialNodes(campId, agents.map((agent) => agent.agentId)),
    [agentIdsKey, campId]
  )

  useEffect(() => {
    rendezvousRef.current = rendezvous
  }, [rendezvous])

  useEffect(() => {
    ambientBubbleRef.current = ambientBubble
  }, [ambientBubble])

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
      setFrameSize((current) => {
        const next = { width: Math.max(1, width), height: Math.max(1, height) }
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
    element.style.left = `${point.x / CAMP_WORLD_MAP_WIDTH * 100}%`
    element.style.top = `${point.y / CAMP_WORLD_MAP_HEIGHT * 100}%`
    element.classList.toggle('is-edge-left', point.x < 225)
    element.classList.toggle('is-edge-right', point.x > CAMP_WORLD_MAP_WIDTH - 225)
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
    const path = routeElementById.current.get(edge.routeId)
    const length = path && typeof path.getTotalLength === 'function'
      ? path.getTotalLength()
      : routeFallbackLength(edge)
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
    const activeIds = new Set(agents.map((agent) => agent.agentId))
    for (const [agentId, motion] of motionByAgentId.current) {
      if (activeIds.has(agentId)) continue
      if (motion.movement) deactivateRoute(motion.movement.edge.routeId, agentId)
      motionByAgentId.current.delete(agentId)
      agentElementById.current.delete(agentId)
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
        nextAmbientAt: now + 5_000 + (campWorldMapStableHash(`${agent.agentId}:speech`) % 8_000),
        ambientSequence: 0,
        rendezvousKey: null,
        rendezvousSide: 0
      } satisfies WorldMapAgentMotion
      motion.mode = agent.mode
      if (agent.mode === 'waiting' && motion.movement) cancelMovement(motion, now)
      motionByAgentId.current.set(agent.agentId, motion)
      setAgentPoint(motion, motion.point)
    }
  }, [agentIdsKey, agentModesKey, agents, campId, cancelMovement, deactivateRoute, initialNodes, setAgentPoint])

  useEffect(() => {
    if (!ambientBubble) return
    const agent = agents.find((candidate) => candidate.agentId === ambientBubble.agentId)
    if (agent?.mode === 'idle') return
    ambientBubbleRef.current = null
    setAmbientBubble(null)
  }, [agentModesKey, agents, ambientBubble])

  useEffect(() => {
    if (motionActive) return
    ambientBubbleRef.current = null
    setAmbientBubble(null)
  }, [motionActive])

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
      }
    }
    const chooseAmbientPath = (motion: WorldMapAgentMotion, now: number): void => {
      if (motion.mode === 'waiting' || motion.rendezvousKey) return
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
    }
    const updateMovement = (motion: WorldMapAgentMotion, now: number): void => {
      const movement = motion.movement
      if (!movement) {
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
    const updateAmbientBubble = (now: number): void => {
      const current = ambientBubbleRef.current
      if (current && now >= current.expiresAt) {
        ambientBubbleRef.current = null
        setAmbientBubble(null)
      }
      if (ambientBubbleRef.current) return
      const eligible = [...motionByAgentId.current.values()]
        .filter((motion) => motion.mode === 'idle' && !motion.rendezvousKey && now >= motion.nextAmbientAt)
        .sort((left, right) => left.nextAmbientAt - right.nextAmbientAt || left.agentId.localeCompare(right.agentId))
      const motion = eligible[0]
      if (!motion) return
      motion.ambientSequence += 1
      motion.nextAmbientAt = now + 30_000 + nextRandom(motion) * 24_000
      const next = {
        agentId: motion.agentId,
        text: campWorldMapAmbientSpeech(campId, motion.agentId, motion.nodeId, motion.ambientSequence),
        expiresAt: now + 5_600
      }
      ambientBubbleRef.current = next
      setAmbientBubble(next)
    }
    const tick = (now: number): void => {
      reconcileRendezvous(now)
      for (const motion of motionByAgentId.current.values()) updateMovement(motion, now)
      updateAmbientBubble(now)
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
    clearRendezvousOffset,
    deactivateRoute,
    motionActive,
    setAgentPoint,
    showRendezvousOffset,
    startEdge,
    startPath
  ])

  const setAgentElement = (agentId: string, element: HTMLDivElement | null): void => {
    if (!element) {
      agentElementById.current.delete(agentId)
      return
    }
    agentElementById.current.set(agentId, element)
    const motion = motionByAgentId.current.get(agentId)
    if (motion) setAgentPoint(motion, motion.point)
    else {
      const node = initialNodes[agentId] ?? 'camp'
      element.style.left = `${CAMP_WORLD_MAP_NODES[node].x / CAMP_WORLD_MAP_WIDTH * 100}%`
      element.style.top = `${CAMP_WORLD_MAP_NODES[node].y / CAMP_WORLD_MAP_HEIGHT * 100}%`
    }
  }

  const setRouteElement = (routeId: string, element: SVGPathElement | null): void => {
    if (!element) {
      routeElementById.current.delete(routeId)
      return
    }
    routeElementById.current.set(routeId, element)
    renderRouteActivity(routeId)
  }

  const frameStyle = frameSize
    ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` }
    : undefined
  const condensedRealAgent = density === 'condensed'
    ? agents.find((agent) => agent.speech?.kind === 'real') ?? null
    : null

  return (
    <section
      className={`camp-world-map${routesVisible ? ' routes-visible' : ''}${motionActive ? '' : ' is-static'}`}
      data-density={density}
      data-motion-state={motionActive ? 'active' : 'paused'}
      data-population={agents.length > 6 ? 'crowded' : 'normal'}
      aria-label="Camp 世界地图"
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
                ref={(element) => setRouteElement(route.id, element)}
              />
            ))}
          </svg>
          <div className="camp-world-map-agents">
            {agents.map((agent) => {
              const ambient = ambientBubble?.agentId === agent.agentId
                ? {
                    key: `${agent.agentId}:ambient:${ambientBubble.text}`,
                    label: '闲时 · 环境预设',
                    text: ambientBubble.text
                  }
                : null
              const speech = agent.speech ?? ambient
              const canOpenProcess = agent.hasExecutionProcess
              return (
                <div
                  className="camp-world-map-agent"
                  data-mode={agent.mode}
                  key={agent.agentId}
                  ref={(element) => setAgentElement(agent.agentId, element)}
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
                          <span className="camp-world-map-speech-kind">{speech.label}</span>
                          <span className="camp-world-map-speech-text">{speech.text}</span>
                        </button>
                      )
                    : (
                        <div
                          className={`camp-world-map-speech${agent.speech ? ` is-${agent.speech.kind}` : ' is-ambient'}`}
                          title={speech.text}
                          key={speech.key}
                        >
                          <span className="camp-world-map-speech-kind">{speech.label}</span>
                          <span className="camp-world-map-speech-text">{speech.text}</span>
                        </div>
                      ))}
                </div>
              )
            })}
          </div>
          {condensedRealAgent?.speech && (
            <button
              className="camp-world-map-live-caption"
              type="button"
              title={condensedRealAgent.speech.text}
              onClick={(event) => onOpenExecutionProcess(condensedRealAgent.agentId, event.currentTarget)}
            >
              <strong>真实执行 · {condensedRealAgent.displayName}</strong>
              <span>{condensedRealAgent.speech.text}</span>
            </button>
          )}
          {agents.length === 0 && (
            <div className="camp-world-map-empty">
              当前 Camp 暂无可在地图中呈现的队员。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
