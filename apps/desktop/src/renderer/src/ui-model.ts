import type {
  AgentRunExecutionEvidenceView,
  AgentRunView,
  CanonicalRuntimeActivityView,
  CoreEvent,
  NavigationCampItem,
  NavigationSnapshot
} from '@contracts'

export const RAIL_COLLAPSED_WIDTH = 52
export const RAIL_EXPANDED_WIDTH = 176

export function railSnapWidth(width: number): number {
  return width < (RAIL_COLLAPSED_WIDTH + RAIL_EXPANDED_WIDTH) / 2
    ? RAIL_COLLAPSED_WIDTH
    : RAIL_EXPANDED_WIDTH
}

export function railExpandedFromWidth(width: number): boolean {
  return width >= (RAIL_COLLAPSED_WIDTH + RAIL_EXPANDED_WIDTH) / 2
}

export function allNavigationCamps(navigation: NavigationSnapshot): NavigationCampItem[] {
  return [
    ...navigation.quickChat.recentCamps,
    ...navigation.projects.flatMap((project) => project.recentCamps)
  ].sort((left, right) => {
    if (left.lastActivityGlobalSequence !== right.lastActivityGlobalSequence) {
      return right.lastActivityGlobalSequence - left.lastActivityGlobalSequence
    }
    return right.id.localeCompare(left.id)
  })
}

export function campDayNumber(createdAtIso: string, now: Date = new Date()): number {
  const created = new Date(createdAtIso)
  if (Number.isNaN(created.getTime())) return 1
  const localDayStart = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const elapsedDays = Math.floor((localDayStart(now) - localDayStart(created)) / 86_400_000)
  return Math.max(1, elapsedDays + 1)
}

export function localDayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function timelineDayLabel(dayIso: string, campCreatedAtIso: string): string {
  const date = new Date(dayIso)
  if (Number.isNaN(date.getTime())) return ''
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const day = campDayNumber(campCreatedAtIso, date)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]} · DAY ${day}`
}

export function messageClockTime(createdAtIso: string): string {
  const date = new Date(createdAtIso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const clock = messageClockTime(iso)
  if (localDayKey(iso) === localDayKey(now.toISOString())) {
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
    if (diffMinutes < 1) return '刚刚'
    if (diffMinutes < 60) return `${diffMinutes} 分钟前`
    return clock
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (localDayKey(iso) === localDayKey(yesterday.toISOString())) return `昨天 ${clock}`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export type ActivityStatus = 'running' | 'completed' | 'failed' | 'waiting' | 'recorded'

export type LiveRuntimeEvent = {
  id: string
  agentRunId: string
  eventType: string
  payload: unknown
  canonical?: CanonicalRuntimeActivityView | null
  createdAt: string
}

export type ExecutionPlanStep = {
  step: string
  status: 'pending' | 'inProgress' | 'completed'
}

export type ExecutionStep = {
  id: string
  title: string
  detail: string
  status: ActivityStatus
  activityDomain: string
  toolName: string | null
  credibility: string
}

export type ExecutionProgressItem =
  | { key: string; kind: 'narration'; body: string }
  | { key: string; kind: 'plan'; explanation: string; plan: ExecutionPlanStep[] }
  | { key: string; kind: 'tool'; step: ExecutionStep }

export type LiveExecutionProgress = {
  items: ExecutionProgressItem[]
}

export type DiffLineKind = 'context' | 'addition' | 'deletion' | 'hunk' | 'metadata'

export type GitStatusEntry = {
  code: string
  label: string
  path: string
  kind: 'addition' | 'deletion' | 'change' | 'neutral'
}

export type SemanticStatus = {
  label: string
  tone: 'neutral' | 'info' | 'attention' | 'success' | 'danger'
}

export function agentRunPresentation(
  run: Pick<AgentRunView, 'status' | 'waitReason'>
    & Partial<Pick<AgentRunView, 'terminalReasonCode'>>,
  cancelling = false
): SemanticStatus {
  if (cancelling && ['queued', 'running', 'waiting'].includes(run.status)) {
    return { label: '正在停止…', tone: 'neutral' }
  }
  if (run.status === 'queued') return { label: '已排队', tone: 'neutral' }
  if (run.status === 'running') return { label: '执行中', tone: 'info' }
  if (run.status === 'succeeded') return { label: '已完成', tone: 'success' }
  if (run.status === 'failed') return { label: '失败', tone: 'danger' }
  if (run.status === 'cancelled') {
    return run.terminalReasonCode === 'planned_shutdown_cancelled'
      ? { label: '已停止', tone: 'neutral' }
      : { label: '已取消', tone: 'neutral' }
  }
  return {
    label: ({
      delivery_unknown: '投递待确认',
      runtime_recovery: '恢复中',
      recovery_blocked: '结果待确认',
      approval: '等待审批',
      user_input: '等待用户'
    } as Record<string, string>)[run.waitReason ?? ''] ?? '等待处理',
    tone: run.waitReason === 'delivery_unknown' || run.waitReason === 'recovery_blocked'
      ? 'danger'
      : 'attention'
  }
}

export function agentRunStateTag(
  run: Pick<AgentRunView, 'status' | 'waitReason'>
    & Partial<Pick<AgentRunView, 'terminalReasonCode'>>,
  cancelling = false
): { tag: string; tone: 'brand' | 'attention' | 'success' | 'danger' | 'neutral' } {
  if (cancelling && ['queued', 'running', 'waiting'].includes(run.status)) {
    return { tag: '正在停止', tone: 'neutral' }
  }
  if (run.status === 'running') return { tag: 'RUNNING', tone: 'brand' }
  if (run.status === 'queued') return { tag: 'QUEUED', tone: 'neutral' }
  if (run.status === 'succeeded') return { tag: 'DONE', tone: 'success' }
  if (run.status === 'failed') return { tag: 'FAILED', tone: 'danger' }
  if (run.status === 'cancelled') {
    return run.terminalReasonCode === 'planned_shutdown_cancelled'
      ? { tag: 'STOPPED', tone: 'neutral' }
      : { tag: 'CANCELLED', tone: 'neutral' }
  }
  return {
    tag: run.waitReason === 'approval'
      ? 'WAITING APPROVAL'
      : run.waitReason === 'recovery_blocked'
        ? 'REVIEW'
        : 'WAITING',
    tone: run.waitReason === 'delivery_unknown' || run.waitReason === 'recovery_blocked'
      ? 'danger'
      : 'attention'
  }
}

export function agentRunWaitDetail(waitReason: string | null): string | null {
  return ({
    delivery_unknown: 'Agent 运行时是否接收输入尚不可确认；为避免重复执行，Rovai-ai 不会盲目重发。',
    runtime_recovery: '正在从持久化 AgentRun、Native Session 与输入回执恢复执行。',
    recovery_blocked: 'Agent 运行时已接受任务，但 Rovai-ai 重启后无法确认原任务的最终结果。原请求不会自动重发。',
    approval: '受限动作正在等待用户处理。',
    user_input: 'Agent 已暂停，等待用户补充信息。'
  } as Record<string, string>)[waitReason ?? ''] ?? null
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`
}

const LIVE_RUNTIME_EVENT_TYPES = new Set([
  'activity.started',
  'activity.completed',
  'agent.text.delta',
  'command.output.delta',
  'file.change.updated',
  'agent.reasoning.summary.delta',
  'agent.thought.delta',
  'runtime.plan',
  'runtime.plan.delta',
  'runtime.action'
])

export function liveRuntimeEventFromCore(
  event: CoreEvent,
  id: string,
  createdAt: string = new Date().toISOString()
): LiveRuntimeEvent | null {
  if (!LIVE_RUNTIME_EVENT_TYPES.has(event.method)) return null
  const params = asRecord(event.params)
  const agentRunId = stringField(params, 'agentRunId')
  if (!agentRunId) return null
  return {
    id: stringField(params, 'evidenceId') ?? id,
    agentRunId,
    eventType: event.method,
    payload: Object.prototype.hasOwnProperty.call(params, 'payload') ? params.payload : params,
    canonical: canonicalRuntimeActivity(params.canonical),
    createdAt
  }
}

export function liveRuntimeEventFromExecutionEvidence(
  evidence: AgentRunExecutionEvidenceView
): LiveRuntimeEvent {
  return {
    id: evidence.id,
    agentRunId: evidence.agentRunId,
    eventType: evidence.eventType,
    payload: evidence.payload,
    canonical: evidence.canonical,
    createdAt: evidence.occurredAt
  }
}

export function buildLiveExecutionProgress(
  events: LiveRuntimeEvent[],
  agentRunId: string
): LiveExecutionProgress {
  const narrationByItem = new Map<string, string>()
  let anonymousNarrationSegment = 0
  let activeAnonymousNarrationItemId: string | null = null
  let planExplanation = ''
  let plan: ExecutionPlanStep[] = []
  const steps: ExecutionStep[] = []
  const stepIndexes = new Map<string, number>()
  const itemOrder: string[] = []
  const rememberItem = (key: string): void => {
    if (!itemOrder.includes(key)) itemOrder.push(key)
  }

  const finishNarrationStream = (): void => {
    activeAnonymousNarrationItemId = null
  }

  const anonymousNarrationItemId = (): string => {
    if (activeAnonymousNarrationItemId) return activeAnonymousNarrationItemId
    activeAnonymousNarrationItemId = `anonymous-${++anonymousNarrationSegment}`
    return activeAnonymousNarrationItemId
  }

  const upsertStep = (step: ExecutionStep): void => {
    const index = stepIndexes.get(step.id)
    if (index === undefined) {
      stepIndexes.set(step.id, steps.length)
      steps.push(step)
      return
    }
    steps[index] = {
      ...steps[index],
      ...step,
      detail: step.detail || steps[index].detail
    }
  }

  for (const event of events) {
    if (event.agentRunId !== agentRunId) continue
    const payload = asRecord(event.payload)

    if (event.eventType === 'agent.reasoning.summary.delta' || event.eventType === 'agent.thought.delta') {
      finishNarrationStream()
      continue
    }
    if (event.eventType === 'agent.text.delta') {
      const delta = stringField(payload, 'delta') ?? ''
      const stableItemId = stringField(payload, 'itemId')
      const itemId = stableItemId ?? anonymousNarrationItemId()
      if (stableItemId) activeAnonymousNarrationItemId = null
      rememberItem(`narration:${itemId}`)
      narrationByItem.set(itemId, `${narrationByItem.get(itemId) ?? ''}${delta}`)
      continue
    }
    if (event.eventType === 'runtime.plan') {
      finishNarrationStream()
      rememberItem('plan')
      planExplanation = stringField(payload, 'explanation') ?? planExplanation
      const nativePlan = payload.plan
      if (Array.isArray(nativePlan)) {
        plan = nativePlan.flatMap((value) => {
          const item = asRecord(value)
          const step = stringField(item, 'step')
          if (!step) return []
          const status = stringField(item, 'status')
          return [{
            step,
            status: status === 'completed' || status === 'inProgress' ? status : 'pending'
          }]
        })
      }
      continue
    }
    if (event.eventType === 'runtime.plan.delta') {
      finishNarrationStream()
      rememberItem('plan')
      const delta = stringField(payload, 'delta') ?? ''
      if (delta) planExplanation += delta
      continue
    }

    if (event.eventType === 'activity.started' || event.eventType === 'activity.completed') {
      const item = asRecord(payload.item)
      const nativeType = stringField(item, 'type') ?? 'activity'
      if (nativeType === 'reasoning') {
        finishNarrationStream()
        continue
      }
      finishNarrationStream()
      if (nativeType === 'agentMessage' || nativeType === 'userMessage' || nativeType === 'plan') continue
      const canonical = event.canonical
      const itemId = canonical?.operationId ?? event.id
      rememberItem(`tool:${itemId}`)
      const nativeStatus = stringField(item, 'status')
      const title = canonicalActivityTitle(canonical)
      const command = stringField(item, 'command')
      const rawOutput = stringField(item, 'aggregatedOutput')
        ?? stringField(item, 'output')
      const structuredOutput = rawOutput === null && item.output != null
        ? jsonPreview(item.output)
        : null
      const detail = rawOutput !== null
        ? stripAnsi(rawOutput)
        : structuredOutput
          ?? command
        ?? fileChangeDetail(item)
        ?? runtimeToolDetail(item, nativeType)
        ?? nativeStatus
        ?? ''
      upsertStep({
        id: itemId,
        title,
        detail,
        status: canonicalActivityStatus(canonical, activityStatus(nativeStatus, event.eventType)),
        activityDomain: canonical?.activityDomain ?? 'unknown',
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown'
      })
      continue
    }

    if (event.eventType === 'runtime.action') {
      finishNarrationStream()
      const canonical = event.canonical
      const itemId = canonical?.operationId ?? event.id
      rememberItem(`tool:${itemId}`)
      const title = canonicalActivityTitle(canonical)
      const nativeStatus = stringField(payload, 'status')
      upsertStep({
        id: itemId,
        title,
        detail: Object.prototype.hasOwnProperty.call(payload, 'output') && payload.output != null
          ? jsonPreview(payload.output)
          : Object.prototype.hasOwnProperty.call(payload, 'input') && payload.input != null
            ? jsonPreview(payload.input)
            : '',
        status: canonicalActivityStatus(canonical, activityStatus(nativeStatus, event.eventType)),
        activityDomain: canonical?.activityDomain ?? 'unknown',
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown'
      })
      continue
    }

    if (event.eventType === 'file.change.updated') {
      finishNarrationStream()
      const canonical = event.canonical
      const itemId = canonical?.operationId ?? event.id
      rememberItem(`tool:${itemId}`)
      upsertStep({
        id: itemId,
        title: canonicalActivityTitle(canonical),
        detail: 'Patch 内容已更新',
        status: canonicalActivityStatus(canonical, 'running'),
        activityDomain: canonical?.activityDomain ?? 'unknown',
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown'
      })
    }
  }

  const stepById = new Map(steps.slice(-12).map((step) => [step.id, step]))
  const items = itemOrder.flatMap((key): ExecutionProgressItem[] => {
    if (key === 'plan') {
      const explanation = planExplanation.trim().slice(-2_000)
      return explanation || plan.length > 0
        ? [{ key, kind: 'plan', explanation, plan }]
        : []
    }
    if (key.startsWith('narration:')) {
      const itemId = key.slice('narration:'.length)
      const body = (narrationByItem.get(itemId) ?? '').trim().slice(-4_000)
      return body ? [{ key, kind: 'narration', body }] : []
    }
    if (key.startsWith('tool:')) {
      const step = stepById.get(key.slice('tool:'.length))
      return step ? [{ key, kind: 'tool', step }] : []
    }
    return []
  })
  return {
    items
  }
}

const TOOL_EVIDENCE_KINDS = new Set<AgentRunExecutionEvidenceView['kind']>([
  'tool_call',
  'tool_result',
  'command',
  'file_change'
])

export function selectCompleteExecutionEvidence<T extends AgentRunExecutionEvidenceView>(evidence: T[]): {
  byToolId: Map<string, T>
  unassigned: T[]
} {
  const byToolId = new Map<string, T>()
  const unassigned: T[] = []
  for (const item of evidence) {
    const toolId = TOOL_EVIDENCE_KINDS.has(item.kind)
      ? executionEvidenceToolId(item)
      : null
    if (!toolId) {
      unassigned.push(item)
      continue
    }
    const current = byToolId.get(toolId)
    if (!current || shouldPreferCompleteEvidence(item, current)) {
      byToolId.set(toolId, item)
    }
  }
  return { byToolId, unassigned }
}

function executionEvidenceToolId(evidence: AgentRunExecutionEvidenceView): string | null {
  return evidence.canonical?.operationId ?? null
}

function shouldPreferCompleteEvidence(
  candidate: AgentRunExecutionEvidenceView,
  current: AgentRunExecutionEvidenceView
): boolean {
  const phaseRank = (phase: AgentRunExecutionEvidenceView['phase']): number =>
    phase === 'completed' || phase === 'failed' ? 2 : phase === 'updated' ? 1 : 0
  const candidateRank = phaseRank(candidate.phase)
  const currentRank = phaseRank(current.phase)
  return candidateRank > currentRank
    || (candidateRank === currentRank && candidate.sequence > current.sequence)
}

export function parseGitStatus(line: string): GitStatusEntry {
  const code = line.slice(0, 2).trim() || line.slice(0, 2)
  const path = line.slice(3).trim() || line.trim()
  if (code === '??' || code.includes('A')) return { code, label: code === '??' ? '未跟踪' : '新增', path, kind: 'addition' }
  if (code.includes('D')) return { code, label: '删除', path, kind: 'deletion' }
  if (code.includes('M')) return { code, label: '修改', path, kind: 'change' }
  if (code.includes('R')) return { code, label: '重命名', path, kind: 'change' }
  return { code, label: '变化', path, kind: 'neutral' }
}

export function buildGitStatusEntries(status: string[], patch: string): GitStatusEntry[] {
  const entries = status.filter((line) => line.trim()).map(parseGitStatus)
  const indexes = new Map(entries.map((entry, index) => [entry.path, index]))
  let currentIndex: number | null = null

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const path = diffTargetPath(line)
      if (!path) {
        currentIndex = null
        continue
      }
      const existingIndex = indexes.get(path)
      if (existingIndex !== undefined) {
        currentIndex = existingIndex
        continue
      }
      currentIndex = entries.length
      indexes.set(path, currentIndex)
      entries.push({ code: 'Δ', label: '修改', path, kind: 'change' })
      continue
    }
    if (currentIndex === null) continue
    if (line.startsWith('new file mode ')) {
      entries[currentIndex] = { ...entries[currentIndex], code: 'A', label: '新增', kind: 'addition' }
    } else if (line.startsWith('deleted file mode ')) {
      entries[currentIndex] = { ...entries[currentIndex], code: 'D', label: '删除', kind: 'deletion' }
    } else if (line.startsWith('rename to ')) {
      const path = line.slice('rename to '.length).trim()
      entries[currentIndex] = { code: 'R', label: '重命名', path, kind: 'change' }
      indexes.set(path, currentIndex)
    }
  }

  return entries
}

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('+++ ') || line.startsWith('--- ')) return 'metadata'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  return 'context'
}

export function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

export function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000)
  if (Math.abs(seconds) < 60) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(hours, 'hour')
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

export function statusLabel(status: string): string {
  return ({ pending: '已排队', in_progress: '进行中', running: '执行中', waiting: '等待处理', completed: '已完成', succeeded: '已完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[status] ?? status
}

export function jsonPreview(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value)
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…（已截断）` : text
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
}

const TOOL_DETAIL_PREVIEW_MAX_LINES = 10
const TOOL_DETAIL_PREVIEW_MAX_CHARS = 2_000
const CORE_EVIDENCE_TRUNCATION_NOTICE = '…（内容已截断，可按需读取完整证据）'

export type ToolDetailPreview = {
  text: string
  truncated: boolean
}

export function toolDetailPreview(
  detail: string,
  completeEvidenceAvailable: boolean
): ToolDetailPreview {
  const coreStringWasTruncated = detail.endsWith(CORE_EVIDENCE_TRUNCATION_NOTICE)
  const coreStructuredValueWasTruncated = detail.includes('"_rovaiTruncated": true')
  const source = coreStringWasTruncated
    ? detail.slice(0, -CORE_EVIDENCE_TRUNCATION_NOTICE.length).trimEnd()
    : detail
  const characters = Array.from(source)
  const characterBounded = characters.slice(0, TOOL_DETAIL_PREVIEW_MAX_CHARS).join('')
  const lines = characterBounded.split('\n')
  const head = lines.slice(0, TOOL_DETAIL_PREVIEW_MAX_LINES).join('\n').trimEnd()
  const truncated = characters.length > TOOL_DETAIL_PREVIEW_MAX_CHARS
    || lines.length > TOOL_DETAIL_PREVIEW_MAX_LINES
    || source !== detail
    || (completeEvidenceAvailable && coreStructuredValueWasTruncated)
  return truncated
    ? { text: `${head}\n…（后续内容未显示）`, truncated: true }
    : { text: detail, truncated: false }
}

function fullEvidenceValue(value: unknown): string | null {
  if (typeof value === 'string') return stripAnsi(value)
  if (value === null || value === undefined) return null
  return JSON.stringify(value, null, 2) ?? String(value)
}

export function executionEvidenceCopyText(
  eventType: AgentRunExecutionEvidenceView['eventType'],
  payloadValue: unknown
): string | null {
  const payload = asRecord(payloadValue)
  if (eventType === 'activity.started' || eventType === 'activity.completed') {
    const item = asRecord(payload.item)
    const output = item.aggregatedOutput ?? item.output
    return fullEvidenceValue(output)
      ?? fullEvidenceValue(item.command)
      ?? fullEvidenceValue(item.changes)
      ?? runtimeToolDetail(item, stringField(item, 'type') ?? 'activity')
      ?? stringField(item, 'status')
  }
  if (eventType === 'runtime.action') {
    return fullEvidenceValue(payload.output)
      ?? fullEvidenceValue(payload.input)
  }
  if (eventType === 'command.output.delta') {
    return fullEvidenceValue(payload.delta ?? payload.output)
  }
  if (eventType === 'file.change.updated') {
    return fullEvidenceValue(payload.patch ?? payload.delta)
  }
  return null
}

function activityStatus(status: string | null, eventType: string): ActivityStatus {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  if (normalized.includes('progress') || normalized.includes('running') || eventType === 'activity.started' || normalized === 'started') return 'running'
  if (normalized.includes('complete') || normalized.includes('success') || eventType === 'activity.completed') return 'completed'
  if (normalized.includes('wait') || normalized.includes('approval')) return 'waiting'
  return 'recorded'
}

function fileChangeDetail(item: Record<string, unknown>): string | null {
  const changes = item.changes
  if (!Array.isArray(changes)) return null
  return changes.length === 1 ? '1 个文件' : `${changes.length} 个文件`
}

function runtimeToolDetail(item: Record<string, unknown>, nativeType: string): string | null {
  if (nativeType === 'mcpToolCall') {
    const server = stringField(item, 'server')
    const tool = stringField(item, 'tool')
    return [server, tool].filter(Boolean).join(' · ') || null
  }
  if (nativeType === 'dynamicToolCall') return stringField(item, 'tool')
  if (nativeType === 'collabAgentToolCall') return stringField(item, 'tool')
  const query = stringField(item, 'query')
  return query
}

function canonicalRuntimeActivity(value: unknown): CanonicalRuntimeActivityView | null {
  const candidate = asRecord(value)
  return typeof candidate.operationId === 'string'
    && typeof candidate.classifierVersion === 'string'
    && typeof candidate.activityDomain === 'string'
    ? value as CanonicalRuntimeActivityView
    : null
}

function canonicalActivityTitle(canonical: CanonicalRuntimeActivityView | null | undefined): string {
  if (canonical?.toolName) return canonical.toolName
  if (canonical?.presentationHint) return canonical.presentationHint
  return ({
    shell: '终端操作',
    file: '文件操作',
    git: 'Git 操作',
    network: '网络操作',
    tool: 'Runtime 工具调用',
    permission: '权限处理',
    runtime: 'Agent 运行',
    plan: '计划更新',
    unknown: 'Runtime 活动'
  } as Record<string, string>)[canonical?.activityDomain ?? 'unknown'] ?? 'Runtime 活动'
}

function canonicalActivityStatus(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  fallback: ActivityStatus
): ActivityStatus {
  if (!canonical) return fallback
  if (canonical.outcome === 'failed') return 'failed'
  if (canonical.outcome === 'succeeded') return 'completed'
  if (canonical.outcome !== 'unknown') return 'recorded'
  if (canonical.phase === 'started' || canonical.phase === 'progress') return 'running'
  return canonical.phase === 'terminal' ? 'recorded' : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : null
}

function deepString(value: unknown, path: string[]): string | null {
  let current: unknown = value
  for (const part of path) current = asRecord(current)[part]
  if (typeof current === 'string') return current
  if (Array.isArray(current)) return current.filter((part) => typeof part === 'string').join(' ')
  return null
}

function diffTargetPath(line: string): string | null {
  const marker = line.lastIndexOf(' b/')
  if (marker < 0) return null
  const path = line.slice(marker + 3).replace(/"$/, '')
  return path || null
}
