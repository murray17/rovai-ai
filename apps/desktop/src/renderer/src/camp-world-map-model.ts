import type { AgentRunView, CampMemberView } from '@contracts'
import type { ExecutionProgressItem, LiveExecutionProgress } from './ui-model'

const NON_TERMINAL_RUN_STATUSES = new Set<AgentRunView['status']>([
  'queued',
  'running',
  'waiting'
])

export type CampWorldMapNodeId =
  | 'research'
  | 'explore'
  | 'remote'
  | 'review'
  | 'camp'
  | 'approval'
  | 'build'
  | 'a2a'
  | 'memory'
  | 'harbor'

export type CampWorldMapRouteKind = 'main' | 'forest' | 'mountain' | 'bridge' | 'water'

export type CampWorldMapNode = {
  id: CampWorldMapNodeId
  x: number
  y: number
  label: string
}

export type CampWorldMapRoute = {
  id: string
  from: CampWorldMapNodeId
  to: CampWorldMapNodeId
  kind: CampWorldMapRouteKind
  d: string
  graph?: boolean
}

export type CampWorldMapPathEdge = {
  routeId: string
  from: CampWorldMapNodeId
  to: CampWorldMapNodeId
}

export type CampWorldMapSpeech = {
  key: string
  kind: 'real' | 'waiting'
  label: string
  text: string
}

export type CampWorldMapAgent = {
  agentId: string
  displayName: string
  avatarRef: string | null
  mode: 'idle' | 'running' | 'waiting'
  hasExecutionProcess: boolean
  activeRunId: string | null
  speech: CampWorldMapSpeech | null
}

export type CampWorldMapRendezvous = {
  key: string
  sourceAgentId: string
  targetAgentId: string
  sourceRunId: string
  targetRunId: string
}

export type CampWorldMapProjection = {
  agents: CampWorldMapAgent[]
  rendezvous: CampWorldMapRendezvous[]
}

export const CAMP_WORLD_MAP_WIDTH = 1148
export const CAMP_WORLD_MAP_HEIGHT = 646

export const CAMP_WORLD_MAP_NODES: Readonly<Record<CampWorldMapNodeId, CampWorldMapNode>> = {
  research: { id: 'research', x: 130.45, y: 343.25, label: '探索林地' },
  explore: { id: 'explore', x: 357.03, y: 147.6, label: '风吟山脉' },
  remote: { id: 'remote', x: 504.65, y: 185.36, label: '观测台' },
  review: { id: 'review', x: 803.33, y: 196.34, label: '审阅塔' },
  camp: { id: 'camp', x: 638.54, y: 387.87, label: '协作公会' },
  approval: { id: 'approval', x: 978.41, y: 354.24, label: '守门所' },
  build: { id: 'build', x: 235.5, y: 545.08, label: '星火工坊' },
  a2a: { id: 'a2a', x: 538.98, y: 516.25, label: '河畔会合点' },
  memory: { id: 'memory', x: 898.08, y: 578.04, label: '记忆馆' },
  harbor: { id: 'harbor', x: 1095.13, y: 480.55, label: '港湾城' }
}

export const CAMP_WORLD_MAP_NODE_IDS = Object.freeze(
  Object.keys(CAMP_WORLD_MAP_NODES) as CampWorldMapNodeId[]
)

export const CAMP_WORLD_MAP_ROUTES: readonly CampWorldMapRoute[] = [
  {
    id: 'research-camp',
    from: 'research',
    to: 'camp',
    kind: 'forest',
    d: 'M 130.45 343.25 C 132.51 345.65, 136.86 352.52, 142.81 357.67 C 148.76 362.82, 157.69 368.54, 166.16 374.14 C 174.63 379.75, 183.78 386.27, 193.62 391.31 C 203.46 396.34, 214.33 402.06, 225.21 404.35 C 236.08 406.64, 247.75 406.52, 258.85 405.04 C 269.95 403.55, 280.59 399.2, 291.81 395.43 C 303.02 391.65, 314.46 386.27, 326.14 382.38 C 337.81 378.49, 349.82 375.52, 361.84 372.09 C 373.86 368.65, 385.87 365.33, 398.23 361.79 C 410.59 358.24, 423.41 353.89, 435.99 350.8 C 448.58 347.71, 461.28 343.6, 473.76 343.25 C 486.23 342.91, 498.59 345.43, 510.83 348.74 C 523.08 352.06, 534.86 358.35, 547.22 363.16 C 559.58 367.97, 569.77 373.46, 584.99 377.58 C 600.21 381.7, 629.61 386.16, 638.54 387.87'
  },
  {
    id: 'research-build',
    from: 'research',
    to: 'build',
    kind: 'forest',
    d: 'M 130.45 343.25 C 131.83 347.49, 135.03 360.3, 138.69 368.65 C 142.36 377, 147.28 384.9, 152.43 393.37 C 157.58 401.83, 163.75 410.64, 169.59 419.45 C 175.43 428.26, 181.61 437.42, 187.44 446.23 C 193.28 455.04, 199.46 463.05, 204.61 472.31 C 209.76 481.58, 214.45 493.02, 218.34 501.83 C 222.23 510.64, 225.09 517.97, 227.95 525.18 C 230.81 532.38, 234.25 541.77, 235.5 545.08'
  },
  {
    id: 'explore-remote',
    from: 'explore',
    to: 'remote',
    kind: 'mountain',
    d: 'M 357.03 147.6 C 360.7 148.28, 371.57 150.12, 379 151.72 C 386.44 153.32, 393.88 155.49, 401.66 157.21 C 409.44 158.93, 417.57 160.41, 425.69 162.01 C 433.82 163.62, 441.6 165.1, 450.41 166.82 C 459.22 168.54, 469.52 169.22, 478.56 172.31 C 487.6 175.4, 500.3 183.18, 504.65 185.36'
  },
  {
    id: 'remote-camp',
    from: 'remote',
    to: 'camp',
    kind: 'main',
    d: 'M 504.65 185.36 C 505.91 188.9, 511.18 199.54, 512.21 206.64 C 513.24 213.73, 512.55 220.94, 510.83 227.92 C 509.12 234.9, 504.31 241.53, 501.91 248.51 C 499.5 255.49, 496.41 262.59, 496.41 269.8 C 496.41 277, 498.82 284.67, 501.91 291.76 C 505 298.86, 509.34 305.38, 514.95 312.36 C 520.56 319.34, 528 326.66, 535.55 333.64 C 543.1 340.62, 551.34 347.71, 560.27 354.24 C 569.19 360.76, 579.49 367.85, 589.11 372.77 C 598.72 377.69, 609.7 381.24, 617.94 383.76 C 626.18 386.27, 635.11 387.19, 638.54 387.87'
  },
  {
    id: 'remote-review',
    from: 'remote',
    to: 'review',
    kind: 'bridge',
    d: 'M 504.65 185.36 C 509.57 187.3, 524.34 192.45, 534.18 197.03 C 544.02 201.6, 553.86 207.55, 563.7 212.82 C 573.54 218.08, 583.38 223.91, 593.22 228.61 C 603.07 233.3, 613.02 238.33, 622.75 240.96 C 632.48 243.59, 642.32 245.08, 651.59 244.4 C 660.86 243.71, 669.44 240.05, 678.36 236.84 C 687.29 233.64, 695.99 229.06, 705.14 225.17 C 714.3 221.28, 722.99 217.05, 733.29 213.5 C 743.59 209.96, 755.26 206.75, 766.94 203.89 C 778.61 201.03, 797.26 197.6, 803.33 196.34'
  },
  {
    id: 'camp-review',
    from: 'camp',
    to: 'review',
    kind: 'bridge',
    d: 'M 638.54 387.87 C 642.55 383.87, 656.28 372.43, 662.57 363.85 C 668.87 355.27, 673.1 345.65, 676.3 336.39 C 679.51 327.12, 681.8 317.62, 681.8 308.24 C 681.8 298.86, 676.42 289.02, 676.3 280.09 C 676.19 271.17, 677.68 262.13, 681.11 254.69 C 684.54 247.26, 690.04 240.73, 696.9 235.47 C 703.77 230.21, 713.04 227, 722.31 223.11 C 731.58 219.22, 742.9 215.33, 752.52 212.13 C 762.13 208.93, 771.51 206.52, 779.98 203.89 C 788.45 201.26, 799.43 197.6, 803.33 196.34'
  },
  {
    id: 'review-approval',
    from: 'review',
    to: 'approval',
    kind: 'mountain',
    d: 'M 803.33 196.34 C 807.22 199.66, 818.89 209.5, 826.67 216.25 C 834.45 223, 842.58 229.98, 850.01 236.84 C 857.45 243.71, 864.43 250.35, 871.3 257.44 C 878.17 264.53, 884.57 272.2, 891.21 279.41 C 897.85 286.62, 904.71 293.94, 911.12 300.69 C 917.53 307.44, 923.25 313.62, 929.66 319.91 C 936.07 326.2, 941.45 332.73, 949.57 338.45 C 957.7 344.17, 973.6 351.6, 978.41 354.24'
  },
  {
    id: 'camp-approval',
    from: 'camp',
    to: 'approval',
    kind: 'main',
    d: 'M 638.54 387.87 C 644.03 389.13, 660.63 394.4, 671.5 395.43 C 682.37 396.46, 693.01 395.54, 703.77 394.05 C 714.52 392.57, 725.17 389.48, 736.04 386.5 C 746.91 383.53, 757.78 379.41, 769 376.2 C 780.21 373, 791.65 369.91, 803.33 367.28 C 815 364.65, 827.01 362.25, 839.03 360.41 C 851.04 358.58, 863.29 357.33, 875.42 356.3 C 887.55 355.27, 900.25 354.81, 911.81 354.24 C 923.37 353.66, 933.67 352.86, 944.77 352.86 C 955.87 352.86, 972.8 354.01, 978.41 354.24'
  },
  {
    id: 'approval-harbor',
    from: 'approval',
    to: 'harbor',
    kind: 'bridge',
    d: 'M 978.41 354.24 C 979.9 357.9, 984.25 368.77, 987.33 376.2 C 990.42 383.64, 993.63 391.31, 996.95 398.86 C 1000.27 406.41, 1003.24 414.53, 1007.25 421.51 C 1011.25 428.49, 1015.71 434.67, 1020.98 440.74 C 1026.24 446.8, 1032.08 452.63, 1038.83 457.9 C 1045.58 463.16, 1052.1 468.54, 1061.49 472.31 C 1070.87 476.09, 1089.52 479.18, 1095.13 480.55'
  },
  {
    id: 'camp-a2a',
    from: 'camp',
    to: 'a2a',
    kind: 'main',
    d: 'M 638.54 387.87 C 636.25 391.65, 630.07 403.32, 624.81 410.53 C 619.54 417.74, 613.25 424.37, 606.96 431.12 C 600.66 437.87, 593.34 444.63, 587.05 451.03 C 580.75 457.44, 574.69 463.39, 569.19 469.57 C 563.7 475.75, 557.98 482.5, 554.09 488.1 C 550.2 493.71, 548.37 498.52, 545.85 503.21 C 543.33 507.9, 540.13 514.08, 538.98 516.25'
  },
  {
    id: 'build-a2a',
    from: 'build',
    to: 'a2a',
    kind: 'main',
    d: 'M 235.5 545.08 C 238.82 541.88, 248.21 532.15, 255.42 525.86 C 262.63 519.57, 270.06 512.93, 278.76 507.33 C 287.46 501.72, 297.53 495.88, 307.6 492.22 C 317.67 488.56, 328.54 486.39, 339.18 485.36 C 349.82 484.33, 360.58 484.9, 371.45 486.04 C 382.32 487.19, 393.42 490.05, 404.41 492.22 C 415.39 494.4, 426.15 496.91, 437.37 499.09 C 448.58 501.26, 460.48 503.32, 471.7 505.27 C 482.91 507.21, 493.44 508.93, 504.65 510.76 C 515.87 512.59, 533.26 515.34, 538.98 516.25'
  },
  {
    id: 'a2a-memory',
    from: 'a2a',
    to: 'memory',
    kind: 'bridge',
    d: 'M 538.98 516.25 C 544.36 514.65, 560.61 509.61, 571.25 506.64 C 581.9 503.66, 592.42 500.92, 602.84 498.4 C 613.25 495.88, 623.44 492.57, 633.73 491.54 C 644.03 490.51, 654.45 490.28, 664.63 492.22 C 674.82 494.17, 685 499.2, 694.84 503.21 C 704.68 507.21, 714.07 511.67, 723.68 516.25 C 733.29 520.83, 742.68 525.98, 752.52 530.67 C 762.36 535.36, 772.2 539.94, 782.73 544.4 C 793.26 548.86, 803.9 553.21, 815.68 557.44 C 827.47 561.67, 839.72 566.37, 853.45 569.8 C 867.18 573.23, 890.64 576.66, 898.08 578.04'
  },
  {
    id: 'a2a-harbor',
    from: 'a2a',
    to: 'harbor',
    kind: 'main',
    d: 'M 538.98 516.25 C 544.25 514.99, 560.15 511.22, 570.57 508.7 C 580.98 506.18, 591.17 504.01, 601.46 501.15 C 611.76 498.29, 621.95 495.08, 632.36 491.54 C 642.77 487.99, 653.3 483.76, 663.94 479.87 C 674.59 475.98, 685.34 471.97, 696.22 468.2 C 707.09 464.42, 718.19 460.87, 729.17 457.21 C 740.16 453.55, 751.14 449.66, 762.13 446.23 C 773.11 442.79, 784.21 439.59, 795.09 436.62 C 805.96 433.64, 816.49 430.67, 827.36 428.38 C 838.23 426.09, 849.21 424.26, 860.31 422.89 C 871.41 421.51, 882.63 420.14, 893.96 420.14 C 905.29 420.14, 916.73 421.06, 928.29 422.89 C 939.84 424.72, 951.63 427.46, 963.3 431.12 C 974.98 434.79, 986.88 440.05, 998.32 444.85 C 1009.76 449.66, 1021.09 455.04, 1031.96 459.96 C 1042.84 464.88, 1053.02 470.94, 1063.55 474.37 C 1074.08 477.81, 1089.87 479.52, 1095.13 480.55'
  },
  {
    id: 'memory-harbor',
    from: 'memory',
    to: 'harbor',
    kind: 'main',
    d: 'M 898.08 578.04 C 901.51 575.29, 911.69 567.05, 918.67 561.56 C 925.66 556.07, 932.75 550.58, 939.96 545.08 C 947.17 539.59, 954.49 534.1, 961.93 528.61 C 969.37 523.12, 976.81 517.05, 984.59 512.13 C 992.37 507.21, 1000.15 502.86, 1008.62 499.09 C 1017.09 495.31, 1026.13 492.11, 1035.4 489.48 C 1044.67 486.85, 1054.28 484.79, 1064.23 483.3 C 1074.19 481.81, 1089.98 481.01, 1095.13 480.55'
  },
  {
    id: 'memory-harbor-water',
    from: 'memory',
    to: 'harbor',
    kind: 'water',
    graph: false,
    d: 'M 898.08 578.04 C 903.23 581.58, 917.07 594.97, 928.97 599.32 C 940.87 603.67, 956.09 605.38, 969.48 604.12 C 982.87 602.86, 996.72 597.26, 1009.31 591.77 C 1021.89 586.27, 1034.25 580.1, 1045.01 571.17 C 1055.77 562.25, 1065.49 553.32, 1073.85 538.22 C 1082.2 523.12, 1091.58 490.16, 1095.13 480.55'
  }
]

const CAMP_WORLD_MAP_RENDEZVOUS_NODES: readonly CampWorldMapNodeId[] = [
  'a2a',
  'camp',
  'remote',
  'approval',
  'harbor'
]

function routeWeight(route: CampWorldMapRoute): number {
  const from = CAMP_WORLD_MAP_NODES[route.from]
  const to = CAMP_WORLD_MAP_NODES[route.to]
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function worldMapGraph(): ReadonlyMap<CampWorldMapNodeId, CampWorldMapPathEdge[]> {
  const graph = new Map<CampWorldMapNodeId, CampWorldMapPathEdge[]>(
    CAMP_WORLD_MAP_NODE_IDS.map((nodeId) => [nodeId, []])
  )
  for (const route of CAMP_WORLD_MAP_ROUTES) {
    if (route.graph === false) continue
    graph.get(route.from)?.push({ routeId: route.id, from: route.from, to: route.to })
    graph.get(route.to)?.push({ routeId: route.id, from: route.to, to: route.from })
  }
  return graph
}

const CAMP_WORLD_MAP_GRAPH = worldMapGraph()
const CAMP_WORLD_MAP_ROUTE_BY_ID = new Map(CAMP_WORLD_MAP_ROUTES.map((route) => [route.id, route]))

export function campWorldMapShortestPath(
  start: CampWorldMapNodeId,
  end: CampWorldMapNodeId
): CampWorldMapPathEdge[] | null {
  if (start === end) return []
  const distances = new Map<CampWorldMapNodeId, number>([[start, 0]])
  const previous = new Map<CampWorldMapNodeId, CampWorldMapPathEdge>()
  const unvisited = new Set(CAMP_WORLD_MAP_NODE_IDS)

  while (unvisited.size > 0) {
    let current: CampWorldMapNodeId | null = null
    let best = Number.POSITIVE_INFINITY
    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY
      if (distance < best) {
        current = nodeId
        best = distance
      }
    }
    if (current === null || !Number.isFinite(best)) break
    unvisited.delete(current)
    if (current === end) break
    for (const edge of CAMP_WORLD_MAP_GRAPH.get(current) ?? []) {
      if (!unvisited.has(edge.to)) continue
      const route = CAMP_WORLD_MAP_ROUTE_BY_ID.get(edge.routeId)
      if (!route) continue
      const next = best + routeWeight(route)
      if (next < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, next)
        previous.set(edge.to, edge)
      }
    }
  }

  if (!distances.has(end)) return null
  const edges: CampWorldMapPathEdge[] = []
  let cursor = end
  while (cursor !== start) {
    const edge = previous.get(cursor)
    if (!edge) return null
    edges.unshift(edge)
    cursor = edge.from
  }
  return edges
}

function campWorldMapPathDistance(path: readonly CampWorldMapPathEdge[] | null): number {
  if (!path) return Number.POSITIVE_INFINITY
  return path.reduce((total, edge) => {
    const route = CAMP_WORLD_MAP_ROUTE_BY_ID.get(edge.routeId)
    return total + (route ? routeWeight(route) : Number.POSITIVE_INFINITY)
  }, 0)
}

export function campWorldMapRendezvousNode(
  left: CampWorldMapNodeId,
  right: CampWorldMapNodeId
): CampWorldMapNodeId | null {
  let selected: CampWorldMapNodeId | null = null
  let selectedDistance = Number.POSITIVE_INFINITY
  for (const candidate of CAMP_WORLD_MAP_RENDEZVOUS_NODES) {
    const distance = campWorldMapPathDistance(campWorldMapShortestPath(left, candidate))
      + campWorldMapPathDistance(campWorldMapShortestPath(right, candidate))
    if (distance < selectedDistance) {
      selected = candidate
      selectedDistance = distance
    }
  }
  return selected
}

export function campWorldMapStableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function campWorldMapInitialNodes(
  campId: string,
  agentIds: readonly string[]
): Readonly<Record<string, CampWorldMapNodeId>> {
  const placements: Record<string, CampWorldMapNodeId> = {}
  const used = new Set<CampWorldMapNodeId>()
  const orderedAgentIds = [...new Set(agentIds)].sort((left, right) => left.localeCompare(right))
  for (const agentId of orderedAgentIds) {
    const start = campWorldMapStableHash(`${campId}:${agentId}`) % CAMP_WORLD_MAP_NODE_IDS.length
    let selected = CAMP_WORLD_MAP_NODE_IDS[start]
    for (let offset = 0; offset < CAMP_WORLD_MAP_NODE_IDS.length; offset += 1) {
      const candidate = CAMP_WORLD_MAP_NODE_IDS[(start + offset) % CAMP_WORLD_MAP_NODE_IDS.length]
      if (!used.has(candidate)) {
        selected = candidate
        break
      }
    }
    placements[agentId] = selected
    used.add(selected)
  }
  return placements
}

export function campWorldMapPlainText(value: string): string {
  return value
    .replace(/```[^\n]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/^\s{0,3}(?:#{1,6}|[-+>]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncateCampWorldMapSpeech(value: string, maximum = 92): string {
  const normalized = campWorldMapPlainText(value)
  const graphemes = Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(normalized),
    (entry) => entry.segment)
  if (graphemes.length <= maximum) return normalized
  return `${graphemes.slice(0, maximum).join('').trimEnd()}…`
}

function executionProgressItemText(item: ExecutionProgressItem): string {
  if (item.kind === 'narration') return item.body
  if (item.kind === 'tool') {
    return item.step.detail ? `${item.step.title}：${item.step.detail}` : item.step.title
  }
  const currentStep = item.plan.find((step) => step.status === 'inProgress')
    ?? item.plan.find((step) => step.status === 'pending')
    ?? item.plan.at(-1)
  return currentStep?.step ?? item.explanation
}

export function campWorldMapExecutionSummary(
  progress: LiveExecutionProgress | undefined
): { itemKey: string; text: string } | null {
  for (const item of [...(progress?.items ?? [])].reverse()) {
    const text = truncateCampWorldMapSpeech(executionProgressItemText(item))
    if (text) return { itemKey: item.key, text }
  }
  return null
}

function newestFirst(left: AgentRunView, right: AgentRunView): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
}

function preferredMapRun(runs: readonly AgentRunView[]): AgentRunView | null {
  const ordered = [...runs].sort(newestFirst)
  return ordered.find((run) => run.status === 'running')
    ?? ordered.find((run) => NON_TERMINAL_RUN_STATUSES.has(run.status))
    ?? null
}

function mapSpeechForRun(
  run: AgentRunView,
  progress: LiveExecutionProgress | undefined
): CampWorldMapSpeech {
  const summary = campWorldMapExecutionSummary(progress)
  if (run.status === 'running') {
    return summary
      ? {
          key: `${run.id}:${summary.itemKey}:${summary.text}`,
          kind: 'real',
          label: '执行 · 正在运行',
          text: summary.text
        }
      : {
          key: `${run.id}:running-without-output`,
          kind: 'real',
          label: '执行 · 等待输出',
          text: '运行已开始，暂未收到可展示步骤。'
        }
  }
  const queued = run.status === 'queued'
  return {
    key: `${run.id}:${run.status}:${summary?.itemKey ?? 'without-output'}:${summary?.text ?? ''}`,
    kind: 'waiting',
    label: queued ? '执行 · 已排队' : '执行 · 结果待确认',
    text: summary?.text
      ?? (queued
        ? '任务已进入队列，暂未收到可展示步骤。'
        : '运行处于等待状态，暂未收到新的可展示步骤。')
  }
}

export function projectCampWorldMap(
  members: readonly CampMemberView[],
  runs: readonly AgentRunView[],
  progressByRunId: ReadonlyMap<string, LiveExecutionProgress>
): CampWorldMapProjection {
  const visibleMembers = members
    .filter((member) => member.membershipStatus === 'active' && member.profilePresence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
  const visibleAgentIds = new Set(visibleMembers.map((member) => member.agentId))
  const runsByAgentId = new Map<string, AgentRunView[]>()
  for (const run of runs) {
    if (!visibleAgentIds.has(run.agentId)) continue
    runsByAgentId.set(run.agentId, [...(runsByAgentId.get(run.agentId) ?? []), run])
  }
  const activeRunByAgentId = new Map<string, AgentRunView>()
  const agents = visibleMembers.map((member): CampWorldMapAgent => {
    const agentRuns = runsByAgentId.get(member.agentId) ?? []
    const activeRun = preferredMapRun(agentRuns)
    if (activeRun) activeRunByAgentId.set(member.agentId, activeRun)
    return {
      agentId: member.agentId,
      displayName: member.displayName,
      avatarRef: member.avatarRef,
      mode: activeRun?.status === 'running'
        ? 'running'
        : activeRun
          ? 'waiting'
          : 'idle',
      hasExecutionProcess: agentRuns.length > 0,
      activeRunId: activeRun?.id ?? null,
      speech: activeRun
        ? mapSpeechForRun(activeRun, progressByRunId.get(activeRun.id))
        : null
    }
  })

  const reservedAgents = new Set<string>()
  const rendezvous = [...runs]
    .filter((run) => run.invocationKind === 'a2a' && run.status === 'running')
    .sort(newestFirst)
    .flatMap((targetRun): CampWorldMapRendezvous[] => {
      const sourceRun = targetRun.a2aParentAgentRunId
        ? runs.find((candidate) => candidate.id === targetRun.a2aParentAgentRunId) ?? null
        : null
      if (
        !sourceRun
        || sourceRun.agentId === targetRun.agentId
        || sourceRun.status !== 'running'
        || sourceRun.waitReason === 'recovery_blocked'
        || targetRun.waitReason === 'recovery_blocked'
        || activeRunByAgentId.get(sourceRun.agentId)?.id !== sourceRun.id
        || activeRunByAgentId.get(targetRun.agentId)?.id !== targetRun.id
        || reservedAgents.has(sourceRun.agentId)
        || reservedAgents.has(targetRun.agentId)
      ) return []
      reservedAgents.add(sourceRun.agentId)
      reservedAgents.add(targetRun.agentId)
      return [{
        key: `${sourceRun.id}:${targetRun.id}`,
        sourceAgentId: sourceRun.agentId,
        targetAgentId: targetRun.agentId,
        sourceRunId: sourceRun.id,
        targetRunId: targetRun.id
      }]
    })

  return { agents, rendezvous }
}
