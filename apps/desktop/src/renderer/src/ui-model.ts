import type {
  AgentRunExecutionEvidenceView,
  AgentRunView,
  CanonicalRuntimeDiffProjectionView,
  CanonicalRuntimeActivityView,
  CoreEvent,
  NavigationCampItem,
  NavigationSnapshot
} from '@contracts'
import { safeMarkdownHasRenderableContent } from './safe-markdown-model'

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

export type ActivityStatus = 'running' | 'completed' | 'failed' | 'waiting' | 'stopped' | 'recorded'

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

export type ActivityIconKind = 'terminal' | 'file' | 'web' | 'tool' | 'rovai' | 'runtime' | 'unknown'

export type ExecutionStep = {
  id: string
  title: string
  detail: string
  status: ActivityStatus
  activityDomain: string
  iconKind: ActivityIconKind
  toolName: string | null
  credibility: string
  fileChanges?: Array<{
    path: string
    changeKind: 'add' | 'delete' | 'update'
    additions: number
    deletions: number
    diff: string
  }>
  fileChangeSemantics?: CanonicalRuntimeDiffProjectionView['semanticKind']
}

export type RuntimeDiagnostic = {
  id: string
  code: 'runtime_api_retrying'
  status: 'retrying'
  attempt: number
  maxAttempts: number
  retryAfterSeconds: number
}

export type ExecutionProgressItem =
  | { key: string; kind: 'narration'; body: string }
  | { key: string; kind: 'plan'; explanation: string; plan: ExecutionPlanStep[] }
  | { key: string; kind: 'diagnostic'; diagnostic: RuntimeDiagnostic }
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

export function activityStatusForAgentRun(
  activityStatus: ActivityStatus,
  agentRunStatus: AgentRunView['status']
): ActivityStatus {
  return agentRunStatus === 'cancelled' && activityStatus === 'running'
    ? 'stopped'
    : activityStatus
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
  if (run.terminalReasonCode === 'runtime_interrupted') {
    return { label: '执行已中断', tone: 'neutral' }
  }
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
  if (run.terminalReasonCode === 'runtime_interrupted') {
    return { tag: 'INTERRUPTED', tone: 'neutral' }
  }
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
    delivery_unknown: 'Agent 运行时是否接收输入尚不可确认；为避免重复执行，Rovai AI 不会盲目重发。',
    runtime_recovery: '正在从已保存的执行、运行会话与输入回执恢复。',
    recovery_blocked: 'Agent 运行时已接受任务，但 Rovai AI 重启后无法确认原任务的最终结果。原请求不会自动重发。',
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
  'file.change.updated',
  'agent.reasoning.summary.delta',
  'agent.thought.delta',
  'runtime.plan',
  'runtime.plan.delta',
  'runtime.diagnostic',
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
  const diagnosticsById = new Map<string, RuntimeDiagnostic>()
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
    const previous = steps[index]
    const title = step.activityDomain === 'shell'
      && !genericShellTitle(previous.title)
      && genericShellTitle(step.title)
      ? previous.title
      : step.title
    steps[index] = {
      ...previous,
      ...step,
      title,
      detail: step.detail || previous.detail
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

    if (event.eventType === 'runtime.diagnostic') {
      finishNarrationStream()
      const diagnosticId = stringField(payload, 'diagnosticId')
      const code = stringField(payload, 'code')
      const status = stringField(payload, 'status')
      const attempt = numberField(payload, 'attempt')
      const maxAttempts = numberField(payload, 'maxAttempts')
      const retryAfterSeconds = numberField(payload, 'retryAfterSeconds')
      if (
        diagnosticId
        && code === 'runtime_api_retrying'
        && status === 'retrying'
        && attempt !== null
        && maxAttempts !== null
        && retryAfterSeconds !== null
        && Number.isInteger(attempt)
        && Number.isInteger(maxAttempts)
        && Number.isInteger(retryAfterSeconds)
        && attempt >= 1
        && maxAttempts >= attempt
        && retryAfterSeconds >= 0
      ) {
        rememberItem(`diagnostic:${diagnosticId}`)
        diagnosticsById.set(diagnosticId, {
          id: diagnosticId,
          code,
          status,
          attempt,
          maxAttempts,
          retryAfterSeconds
        })
      }
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
      const title = executionActivityTitle(canonical, payload)
      const status = canonicalActivityStatus(canonical, activityStatus(nativeStatus, event.eventType))
      const fileChanges = canonicalFileChanges(canonical)
      const fileChangeSemantics = fileChanges ? canonical?.diffProjection?.semanticKind : undefined
      if (nativeType === 'fileChange' && !fileChanges) continue
      if (!fileChanges && isApplyPatchPresentation(canonical, payload)) continue
      const command = stringField(item, 'command')
      const rawOutput = stringField(item, 'aggregatedOutput')
        ?? stringField(item, 'output')
      const structuredOutput = rawOutput === null && item.output != null
        ? fullEvidenceValue(item.output)
        : null
      const publicOutput = rawOutput !== null ? stripAnsi(rawOutput) : structuredOutput
      const codexCommand = nativeType === 'commandExecution' && command
        ? shellCommandDetailText(command)
        : null
      const evidenceDetail = codexCommand
        ? shellCommandDetail(codexCommand, publicOutput)
        : publicOutput
          ?? command
          ?? fileChangeDetail(item)
          ?? runtimeToolDetail(item, nativeType)
          ?? nativeStatus
          ?? ''
      const detail = searchEvidenceText(typedSearchQuery(payload, canonical), evidenceDetail) ?? ''
      if (shouldDeferUnresolvedShellActivity(canonical, title, status)) continue
      upsertStep({
        id: itemId,
        title,
        detail,
        status,
        activityDomain: canonical?.activityDomain ?? 'unknown',
        iconKind: activityIconKind(canonical),
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown',
        fileChanges,
        fileChangeSemantics
      })
      continue
    }

    if (event.eventType === 'runtime.action') {
      finishNarrationStream()
      const canonical = event.canonical
      const itemId = canonical?.operationId ?? event.id
      rememberItem(`tool:${itemId}`)
      const title = executionActivityTitle(canonical, payload)
      const nativeStatus = stringField(payload, 'status')
      const status = canonicalActivityStatus(canonical, activityStatus(nativeStatus, event.eventType))
      const fileChanges = canonicalFileChanges(canonical)
      const fileChangeSemantics = fileChanges ? canonical?.diffProjection?.semanticKind : undefined
      if (!fileChanges && isApplyPatchPresentation(canonical, payload)) continue
      if (shouldDeferUnresolvedShellActivity(canonical, title, status)) continue
      upsertStep({
        id: itemId,
        title,
        detail: runtimeActionEvidenceText(payload, canonical) ?? '',
        status,
        activityDomain: canonical?.activityDomain ?? 'unknown',
        iconKind: activityIconKind(canonical),
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown',
        fileChanges,
        fileChangeSemantics
      })
      continue
    }

    // Incremental patch notifications are deliberately not presented. Only a
    // reliable terminal Runtime diff projection can produce modified-file rows.
  }

  const stepById = new Map(steps.map((step) => [step.id, step]))
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
      return safeMarkdownHasRenderableContent(body)
        ? [{ key, kind: 'narration', body }]
        : []
    }
    if (key.startsWith('diagnostic:')) {
      const diagnostic = diagnosticsById.get(key.slice('diagnostic:'.length))
      return diagnostic ? [{ key, kind: 'diagnostic', diagnostic }] : []
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

function canonicalFileChanges(
  canonical: CanonicalRuntimeActivityView | null | undefined
): ExecutionStep['fileChanges'] {
  const projection = canonical?.diffProjection
  return projection?.status === 'available' && Array.isArray(projection.entries)
    ? projection.entries
    : undefined
}

function isApplyPatchPresentation(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  payload: Record<string, unknown>
): boolean {
  const item = asRecord(payload.item)
  return [
    canonical?.toolName,
    stringField(item, 'tool'),
    stringField(payload, 'tool'),
    stringField(payload, 'title')
  ].some((value) => value?.trim().toLowerCase() === 'apply_patch')
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

function stripAnsi(value: string): string {
  return value.replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
}

function fullEvidenceValue(value: unknown): string | null {
  if (typeof value === 'string') return stripAnsi(value)
  if (value === null || value === undefined) return null
  return JSON.stringify(value, null, 2) ?? String(value)
}

function runtimeActionEvidenceText(
  payload: Record<string, unknown>,
  canonical: CanonicalRuntimeActivityView | null | undefined
): string | null {
  let evidenceText: string | null = null
  const coreOwnedBuiltIn = stringField(payload, 'sourceAuthority') === 'core'
    && stringField(payload, 'canonicalTool') !== null
  if (coreOwnedBuiltIn) {
    const coreEnvelope = asRecord(payload.coreEnvelope)
    if (Object.prototype.hasOwnProperty.call(coreEnvelope, 'result') && coreEnvelope.result != null) {
      evidenceText = fullEvidenceValue(coreEnvelope.result)
    } else if (Object.prototype.hasOwnProperty.call(coreEnvelope, 'error') && coreEnvelope.error != null) {
      evidenceText = fullEvidenceValue(coreEnvelope.error)
    } else {
      const operationProjection = asRecord(payload.operationProjection)
      if (Object.prototype.hasOwnProperty.call(operationProjection, 'canonicalResult')
      && operationProjection.canonicalResult != null) {
        evidenceText = fullEvidenceValue(operationProjection.canonicalResult)
      }
    }
  }
  if (evidenceText === null) {
    const output = fullEvidenceValue(payload.output)
    const command = runtimeActionShellCommand(payload)
    const commandDetail = command ? shellCommandDetailText(command) : null
    evidenceText = commandDetail
      ? shellCommandDetail(commandDetail, output)
      : output ?? fullEvidenceValue(payload.input)
  }
  return searchEvidenceText(typedSearchQuery(payload, canonical), evidenceText)
}

function typedSearchQuery(
  payload: unknown,
  canonical: CanonicalRuntimeActivityView | null | undefined
): string | null {
  if (
    canonical?.activityDomain !== 'tool'
    || canonical.semanticKind !== 'tool.web.search'
  ) return null
  const operation = asRecord(asRecord(payload).runtimeSearchOperation)
  if (
    numberField(operation, 'schemaVersion') !== 1
    || stringField(operation, 'source') !== 'runtime_reported'
    || stringField(operation, 'status') !== 'available'
    || stringField(operation, 'searchKind') !== 'web'
  ) return null
  const query = stringField(operation, 'query')
  if (query === null || query.trim().length === 0) return null
  const queryList = operation.queries
  if (queryList === undefined) return query
  if (!Array.isArray(queryList) || queryList.length < 2) return null
  const queries = queryList.map((value) => typeof value === 'string' ? value : null)
  if (
    queries.some((value) => value === null || value.trim().length === 0)
    || queries[0] !== query
  ) return null
  return queries.join('，')
}

function searchEvidenceText(query: string | null, evidenceText: string | null): string | null {
  if (query === null) return evidenceText
  const queryLine = `搜索 ${query}`
  if (evidenceText === null || evidenceText.length === 0 || evidenceText === query) return queryLine
  return `${queryLine}\n${evidenceText}`
}

function runtimeActionShellCommand(payload: Record<string, unknown>): string | null {
  const kind = stringField(payload, 'kind')?.toLocaleLowerCase()
  if (!kind || !['execute', 'command', 'terminal', 'shell'].includes(kind)) return null
  return publicShellCommand(payload)
}

export function executionEvidenceResultText(
  eventType: AgentRunExecutionEvidenceView['eventType'],
  payloadValue: unknown,
  canonical?: CanonicalRuntimeActivityView | null
): string | null {
  const payload = asRecord(payloadValue)
  if (eventType === 'activity.started' || eventType === 'activity.completed') {
    const item = asRecord(payload.item)
    const command = stringField(item, 'command')
    const commandDetail = command ? shellCommandDetailText(command) : null
    const output = fullEvidenceValue(item.aggregatedOutput ?? item.output)
    if (commandDetail) return shellCommandDetail(commandDetail, output)
    const evidenceText = output
      ?? fullEvidenceValue(item.changes)
      ?? runtimeToolDetail(item, stringField(item, 'type') ?? 'activity')
      ?? stringField(item, 'status')
    return searchEvidenceText(typedSearchQuery(payload, canonical), evidenceText)
  }
  if (eventType === 'runtime.action') {
    return runtimeActionEvidenceText(payload, canonical)
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
  if (normalized.includes('interrupt') || normalized.includes('cancel') || normalized.includes('stop')) return 'stopped'
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
  return null
}

function canonicalRuntimeActivity(value: unknown): CanonicalRuntimeActivityView | null {
  const candidate = asRecord(value)
  return typeof candidate.operationId === 'string'
    && typeof candidate.classifierVersion === 'string'
    && typeof candidate.activityDomain === 'string'
    ? value as CanonicalRuntimeActivityView
    : null
}

export function executionActivityTitle(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  payload: unknown
): string {
  const runtimeTitle = canonical?.presentationHint
    ?.replaceAll('Runtime 工具调用', '工具调用')
    .replaceAll('Runtime 活动', '系统活动')
  const domain = canonical?.activityDomain ?? 'unknown'

  if (domain === 'shell') {
    const command = publicShellCommand(payload)
    const commandPreview = command ? shellCommandPreview(command) : null
    if (commandPreview) return commandPreview
    if (runtimeTitle && !genericShellTitle(runtimeTitle)) {
      return runtimeTitle
    }
    const commandLabel = command ? shellCommandLabel(command) : null
    if (commandLabel) return commandLabel
    if (canonical?.toolName && !genericShellTitle(canonical.toolName)) return canonical.toolName
    return '终端操作'
  }
  if (domain === 'file') {
    const fileTitle = reliableFileActivityTitle(canonical, payload)
    if (fileTitle) return fileTitle
    if (canonical?.toolName) return canonical.toolName
    if (runtimeTitle) return runtimeTitle
    return '文件操作'
  }
  if (domain === 'tool' && canonical?.semanticKind === 'tool.web.search') {
    return 'Web 搜索'
  }
  if (domain === 'tool') {
    if (canonical?.toolName) return canonical.toolName
    if (runtimeTitle) return runtimeTitle
    return '工具调用'
  }
  if (domain === 'runtime') {
    if (runtimeTitle) return runtimeTitle
    return 'Agent 运行'
  }
  if (runtimeTitle) return runtimeTitle
  return '系统活动'
}

export function activityIconKind(
  canonical: CanonicalRuntimeActivityView | null | undefined
): ActivityIconKind {
  if (canonical?.activityDomain === 'shell') return 'terminal'
  if (canonical?.activityDomain === 'file') return 'file'
  if (canonical?.activityDomain === 'tool') {
    if (canonical.semanticKind === 'tool.web.search') return 'web'
    if (
      canonical.sourceAuthority === 'core'
      && canonical.credibility === 'core_verified'
      && canonical.toolName
    ) return 'rovai'
    return 'tool'
  }
  if (canonical?.activityDomain === 'runtime') return 'runtime'
  return 'unknown'
}

function reliableFileActivityTitle(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  payload: unknown
): string | null {
  const operation = asRecord(asRecord(payload).runtimeFileOperation)
  const operationPath = stringField(operation, 'status') === 'available'
    ? stringField(operation, 'path')
    : null
  const diffEntries = canonical?.diffProjection?.status === 'available'
    && Array.isArray(canonical.diffProjection.entries)
    ? canonical.diffProjection.entries
    : []
  const path = operationPath ?? (diffEntries.length === 1 ? diffEntries[0]?.path : null)
  if (!path) return null
  const fileName = path.split(/[\\/]/u).filter(Boolean).at(-1)
  return fileName ? `修改 ${fileName}` : null
}

const GENERIC_SHELL_TITLES = new Set([
  'bash',
  'execute',
  'exec_command',
  'execute_command',
  'run command',
  'run_command',
  'shell',
  'terminal',
  '执行 shell 命令',
  '终端操作'
])

function genericShellTitle(title: string): boolean {
  return GENERIC_SHELL_TITLES.has(title.toLocaleLowerCase())
}

function shouldDeferUnresolvedShellActivity(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  title: string,
  status: ActivityStatus
): boolean {
  return canonical?.activityDomain === 'shell'
    && status === 'running'
    && genericShellTitle(title)
}

const SHELL_WRAPPER_EXECUTABLES = new Set(['bash', 'dash', 'fish', 'ksh', 'sh', 'zsh'])
const REDACTED_COMMAND_VALUE = '[已隐藏]'
const SENSITIVE_COMMAND_NAME = /(?:^|[-_])(token|password|passwd|authorization|api[-_]?key|secret|credential)(?:[-_]|$)/iu
const ROVAI_SEND_VALUE_FLAGS = new Set([
  '--camp-id',
  '--file',
  '--format',
  '--idempotency-key',
  '--member',
  '--reply-to',
  '--task-id',
  '--to'
])

type ShellPreviewToken = {
  raw: string
  value: string
  operator: boolean
}

function shellCommandPreview(command: string): string | null {
  return normalizePublicShellCommand(command, true)
}

function shellCommandDetailText(command: string): string | null {
  return normalizePublicShellCommand(command, false)
}

function normalizePublicShellCommand(
  command: string,
  inlineNodeHeredoc: boolean
): string | null {
  const unwrapped = unwrapShellCommand(stripAnsi(command).trim())
  if (!unwrapped) return null
  const presentable = inlineNodeHeredoc ? unwrapNodeHeredoc(unwrapped) : unwrapped
  const tokens = tokenizeShellPreview(presentable)
  if (tokens.length === 0) return null
  const redacted = redactShellPreviewTokens(tokens)
  const normalized = redacted
    .map((token) => token.raw.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return null
  return redactInlineSensitiveAssignments(normalized)
}

function unwrapShellCommand(command: string): string {
  let current = command.trim()
  for (let depth = 0; depth < 3; depth += 1) {
    const tokens = tokenizeShellPreview(current)
    if (tokens.some((token) => token.operator) || tokens.length < 3) break
    const executable = shellExecutable(tokens[0].value)
    if (!executable || !SHELL_WRAPPER_EXECUTABLES.has(executable)) break
    const commandIndex = tokens.findIndex((token, index) =>
      index > 0 && (token.value === '-c' || token.value === '-lc')
    )
    if (commandIndex < 0 || commandIndex + 2 !== tokens.length) break
    current = tokens[commandIndex + 1].value.trim()
  }
  return current
}

function unwrapNodeHeredoc(command: string): string {
  const match = command.match(
    /^\s*((?:[^\s]*\/)?node(?:\s+-)?)\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[ \t]*\r?\n([\s\S]*?)\r?\n\3[ \t]*$/u
  )
  if (!match) return command
  const executable = match[1].trim()
  const script = match[4].trim()
  return script ? `${executable} ${script}` : executable
}

function tokenizeShellPreview(command: string): ShellPreviewToken[] {
  const tokens: ShellPreviewToken[] = []
  let raw = ''
  let value = ''
  let quote: 'single' | 'double' | 'backtick' | null = null
  let escaped = false
  const flush = (): void => {
    if (!raw) return
    tokens.push({ raw, value, operator: false })
    raw = ''
    value = ''
  }
  const pushOperator = (operator: string): void => {
    flush()
    if (operator === ';' && (tokens.length === 0 || tokens.at(-1)?.operator)) return
    tokens.push({ raw: operator, value: operator, operator: true })
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      raw += character
      value += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      raw += character
      escaped = true
      continue
    }
    if (quote === 'single') {
      raw += character
      if (character === "'") quote = null
      else value += character
      continue
    }
    if (quote === 'double') {
      raw += character
      if (character === '"') quote = null
      else value += character
      continue
    }
    if (quote === 'backtick') {
      raw += character
      if (character === '`') quote = null
      else value += character
      continue
    }
    if (character === "'") {
      raw += character
      quote = 'single'
      continue
    }
    if (character === '"') {
      raw += character
      quote = 'double'
      continue
    }
    if (character === '`') {
      raw += character
      quote = 'backtick'
      continue
    }
    if (character === '\n' || character === '\r') {
      pushOperator(';')
      if (character === '\r' && command[index + 1] === '\n') index += 1
      continue
    }
    if (/\s/u.test(character)) {
      flush()
      continue
    }
    if (character === ';' || character === '&' || character === '|') {
      const doubled = command[index + 1] === character && character !== ';'
      pushOperator(doubled ? character.repeat(2) : character)
      if (doubled) index += 1
      continue
    }
    raw += character
    value += character
  }
  if (escaped) value += '\\'
  flush()
  if (tokens.at(-1)?.operator && tokens.at(-1)?.value === ';') tokens.pop()
  return tokens
}

function redactShellPreviewTokens(tokens: ShellPreviewToken[]): ShellPreviewToken[] {
  const redacted = tokens.map((token) => ({ ...token }))
  for (let index = 0; index < redacted.length; index += 1) {
    const token = redacted[index]
    if (token.operator) continue

    const assignmentIndex = token.value.indexOf('=')
    if (assignmentIndex > 0) {
      const name = token.value.slice(0, assignmentIndex).replace(/^-+/u, '')
      if (sensitiveCommandName(name)) {
        const prefix = token.raw.slice(0, Math.max(0, token.raw.indexOf('=')))
        redactToken(token, `${prefix}=${REDACTED_COMMAND_VALUE}`)
        continue
      }
    }

    const flag = token.value.match(/^(-{1,2}[^=]+)(?:=(.*))?$/u)
    if (flag && sensitiveCommandName(flag[1].replace(/^-+/u, ''))) {
      if (flag[2] !== undefined) {
        redactToken(token, `${flag[1]}=${REDACTED_COMMAND_VALUE}`)
      } else {
        const valueIndex = nextShellValueIndex(redacted, index + 1)
        if (valueIndex !== null) redactToken(redacted[valueIndex], REDACTED_COMMAND_VALUE)
      }
      continue
    }

    if (/^authorization\s*:/iu.test(token.value)) {
      redactToken(token, `"Authorization: ${REDACTED_COMMAND_VALUE}"`)
      continue
    }
    if (/^--header=authorization\s*:/iu.test(token.value)) {
      redactToken(token, `--header="Authorization: ${REDACTED_COMMAND_VALUE}"`)
      continue
    }
    if (token.value === '-H' || token.value === '--header') {
      const valueIndex = nextShellValueIndex(redacted, index + 1)
      if (valueIndex !== null && /^authorization\s*:/iu.test(redacted[valueIndex].value)) {
        redactToken(redacted[valueIndex], `"Authorization: ${REDACTED_COMMAND_VALUE}"`)
      }
    }
  }
  redactRovaiSendBodies(redacted)
  return redacted
}

function sensitiveCommandName(name: string): boolean {
  return SENSITIVE_COMMAND_NAME.test(name.toLocaleLowerCase())
}

function nextShellValueIndex(tokens: ShellPreviewToken[], start: number): number | null {
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].operator) return null
    return index
  }
  return null
}

function redactToken(token: ShellPreviewToken, replacement: string): void {
  token.raw = replacement
  token.value = replacement
}

function redactRovaiSendBodies(tokens: ShellPreviewToken[]): void {
  let segmentStart = 0
  for (let index = 0; index <= tokens.length; index += 1) {
    if (index < tokens.length && !tokens[index].operator) continue
    redactRovaiSendSegment(tokens, segmentStart, index)
    segmentStart = index + 1
  }
}

function redactRovaiSendSegment(
  tokens: ShellPreviewToken[],
  start: number,
  end: number
): void {
  let cursor = start
  while (cursor < end && shellAssignment(tokens[cursor].value)) cursor += 1
  if (cursor + 1 >= end || shellExecutable(tokens[cursor].value) !== 'rovai') return
  if (tokens[cursor + 1].value !== 'send') return

  cursor += 2
  let positionalBodyRedacted = false
  while (cursor < end) {
    const token = tokens[cursor]
    if (token.value === '--body') {
      const valueIndex = cursor + 1 < end ? cursor + 1 : null
      if (valueIndex !== null) redactToken(tokens[valueIndex], REDACTED_COMMAND_VALUE)
      cursor += 2
      continue
    }
    if (token.value.startsWith('--body=')) {
      redactToken(token, `--body=${REDACTED_COMMAND_VALUE}`)
      cursor += 1
      continue
    }
    const flagName = token.value.split('=', 1)[0]
    if (ROVAI_SEND_VALUE_FLAGS.has(flagName) && !token.value.includes('=')) {
      cursor += 2
      continue
    }
    if (token.value === '--') {
      cursor += 1
      continue
    }
    if (token.value.startsWith('-')) {
      cursor += 1
      continue
    }
    if (!positionalBodyRedacted) {
      redactToken(token, REDACTED_COMMAND_VALUE)
      positionalBodyRedacted = true
    }
    cursor += 1
  }
}

function redactInlineSensitiveAssignments(command: string): string {
  return command.replace(
    /\b(token|password|passwd|authorization|api[-_]?key|secret|credential)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&|]+)/giu,
    (match, name: string, separator: string, value: string) => {
      if (value.includes(REDACTED_COMMAND_VALUE)) return match
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
      return `${name}${separator}${quote}${REDACTED_COMMAND_VALUE}${quote}`
    }
  )
}

function shellCommandDetail(command: string, output: string | null): string {
  const commandLine = `$ ${command}`
  if (output === null || output.length === 0) return commandLine
  return `${commandLine}\n${stripAnsi(output)}`
}

const COMMANDS_WITH_SUBCOMMAND = new Set([
  'bun',
  'cargo',
  'deno',
  'dotnet',
  'git',
  'go',
  'gradle',
  'gradlew',
  'mvn',
  'npm',
  'npx',
  'pnpm',
  'swift',
  'uv',
  'yarn'
])

const ROVAI_CAMP_ACTIONS = new Set(['list', 'read', 'search'])

type ShellToken = { value: string; operator: boolean }

function publicShellCommand(payload: unknown): string | null {
  const root = asRecord(payload)
  const item = asRecord(root.item)
  const itemCommand = stringField(item, 'command')
  if (itemCommand?.trim()) return itemCommand

  const input = root.input
  if (typeof input === 'string' && input.trim()) return input
  const inputRecord = asRecord(input)
  for (const key of ['command', 'commandLine', 'CommandLine', 'cmd']) {
    const command = stringField(inputRecord, key)
    if (command?.trim()) return command
  }
  return null
}

function shellCommandLabel(command: string, depth = 0): string | null {
  if (depth > 2) return null
  const segments = splitShellSegments(tokenizeShellCommand(command))
  for (const segment of segments) {
    const label = shellSegmentLabel(segment, depth)
    if (label) return label
  }
  return null
}

function shellSegmentLabel(tokens: string[], depth: number): string | null {
  let cursor = 0
  while (cursor < tokens.length && shellAssignment(tokens[cursor])) cursor += 1
  if (cursor >= tokens.length) return null

  const executable = shellExecutable(tokens[cursor])
  if (!executable) return null
  if (executable === 'cd') return null

  if (executable === 'env') {
    cursor += 1
    while (cursor < tokens.length && (tokens[cursor].startsWith('-') || shellAssignment(tokens[cursor]))) {
      cursor += 1
    }
    return shellSegmentLabel(tokens.slice(cursor), depth + 1)
  }

  if (['command', 'exec', 'nohup', 'time'].includes(executable)) {
    return shellSegmentLabel(tokens.slice(cursor + 1), depth + 1)
  }

  if (['bash', 'dash', 'fish', 'ksh', 'sh', 'zsh'].includes(executable)) {
    const commandIndex = tokens.findIndex((token, index) => index > cursor && ['-c', '-lc'].includes(token))
    return commandIndex >= 0 && tokens[commandIndex + 1]
      ? shellCommandLabel(tokens[commandIndex + 1], depth + 1)
      : executable
  }
  if (['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) {
    const commandIndex = tokens.findIndex((token, index) => index > cursor && ['/c', '-command'].includes(token.toLocaleLowerCase()))
    return commandIndex >= 0 && tokens[commandIndex + 1]
      ? shellCommandLabel(tokens.slice(commandIndex + 1).join(' '), depth + 1)
      : executable
  }

  const labelParts = [executable]
  const following = tokens.slice(cursor + 1)
  let displayedArgumentCount = 0
  if (executable === 'rovai') {
    const command = following[0]
    const safeCommand = command && !command.startsWith('-') ? shellLabelPart(command) : null
    if (safeCommand) {
      labelParts.push(safeCommand)
      displayedArgumentCount = 1
      if (safeCommand === 'camp') {
        const action = following[1]
        const safeAction = action && !action.startsWith('-') ? shellLabelPart(action) : null
        if (safeAction && ROVAI_CAMP_ACTIONS.has(safeAction)) {
          labelParts.push(safeAction)
          displayedArgumentCount = 2
        }
      }
    }
  } else if (COMMANDS_WITH_SUBCOMMAND.has(executable)) {
    const part = following[0]
    if (part && !part.startsWith('-')) {
      const safePart = shellLabelPart(part)
      if (safePart) {
        labelParts.push(safePart)
        displayedArgumentCount = 1
      }
    }
  }
  const helpFlag = following[displayedArgumentCount]
  if (helpFlag === '--help') labelParts.push(helpFlag)
  return truncateCommandLabel(labelParts.join(' '))
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false
  const flush = (): void => {
    if (!current) return
    tokens.push({ value: current, operator: false })
    current = ''
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (quote === 'single') {
      if (character === "'") quote = null
      else current += character
      continue
    }
    if (quote === 'double') {
      if (character === '"') quote = null
      else current += character
      continue
    }
    if (character === "'") {
      quote = 'single'
      continue
    }
    if (character === '"') {
      quote = 'double'
      continue
    }
    if (/\s/u.test(character)) {
      flush()
      if (character === '\n') tokens.push({ value: '\n', operator: true })
      continue
    }
    if (['&', '|', ';'].includes(character)) {
      flush()
      const doubled = command[index + 1] === character
      tokens.push({ value: doubled ? character.repeat(2) : character, operator: true })
      if (doubled) index += 1
      continue
    }
    current += character
  }
  if (escaped) current += '\\'
  flush()
  return tokens
}

function splitShellSegments(tokens: ShellToken[]): string[][] {
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (token.operator) {
      if (segments.at(-1)?.length) segments.push([])
      continue
    }
    segments.at(-1)?.push(token.value)
  }
  return segments.filter((segment) => segment.length > 0)
}

function shellExecutable(token: string): string | null {
  const basename = token.replaceAll('\\', '/').split('/').at(-1)?.toLocaleLowerCase() ?? ''
  return shellLabelPart(basename)
}

function shellLabelPart(token: string): string | null {
  const value = token.trim()
  return value && /^[\p{L}\p{N}._:+-]+$/u.test(value) ? value : null
}

function shellAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)
}

function truncateCommandLabel(label: string): string {
  const characters = Array.from(label)
  return characters.length <= 56 ? label : `${characters.slice(0, 55).join('')}…`
}

function canonicalActivityStatus(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  fallback: ActivityStatus
): ActivityStatus {
  if (!canonical) return fallback
  if (canonical.outcome === 'failed') return 'failed'
  if (canonical.outcome === 'succeeded') return 'completed'
  if (canonical.outcome === 'cancelled') return 'stopped'
  if (canonical.phase === 'terminal' && fallback === 'stopped') return 'stopped'
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
