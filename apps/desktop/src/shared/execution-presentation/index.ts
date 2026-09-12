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
import { createExecutionPublicResultProjector } from './public-result'
import { BUILTIN_CLI_NAMES, builtinInputText, builtinOperation, supportingBuiltinShells } from './builtin-tools'

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

export function localDayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function timelineDayLabel(dayIso: string): string {
  const date = new Date(dayIso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
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

export type ActivityStatus = 'running' | 'completed' | 'failed' | 'waiting' | 'stopped' | 'skipped' | 'recorded'

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

export type ActivityIconKind = 'terminal' | 'file' | 'file-read' | 'file-write' | 'web' | 'tool' | 'rovai' | 'runtime' | 'unknown'

export type ShellReadSummary = {
  title: string
  paths: string[]
  displayPaths: string[]
}

export type ExecutionStep = {
  id: string
  title: string
  /**
   * The most specific public instruction available for an active group summary.
   * This does not replace the stable Tool row title or provider-card copy.
   */
  currentInstruction?: string | null
  /**
   * Complete command presentation, retaining arguments and values without masking.
   */
  publicCommand: string | null
  /** Bounded result-only preview. Never a fallback to tool input or local detail. */
  publicResult: string | null
  detail: string
  /** Core-owned built-in input presentation; never requests a result blob. */
  builtinOperation?: string
  status: ActivityStatus
  activityDomain: string
  iconKind: ActivityIconKind
  toolName: string | null
  credibility: string
  /** Renderer-only summary for one Shell activity containing multiple proven reads. */
  shellReadSummary?: ShellReadSummary
  fileOperation?: {
    operationKind: 'read' | 'write'
    path: string
    changeKind?: 'add' | 'update'
  }
  fileChanges?: Array<{
    path: string
    changeKind: 'add' | 'delete' | 'update'
    additions: number
    deletions: number
    diff: string
  }>
  fileChangeSemantics?: CanonicalRuntimeDiffProjectionView['semanticKind']
}

export type RuntimeCompactionDisplayItem = {
  id: string
  adapterKind: string
  phase: 'imminent' | 'started' | 'completed'
  completionEvidence: 'native_terminal' | 'pre_compaction_only' | 'post_compaction_boundary' | null
  tokens: {
    before?: number
    after?: number
    current?: number
    contextWindow?: number
    usagePercent?: number
  }
  messages: {
    compacted?: number
  }
  elapsedMs?: number
  summaryText: string | null
}

export function executionStepPublicTitle(step: ExecutionStep): string {
  return (step.builtinOperation ? BUILTIN_CLI_NAMES[step.builtinOperation] : null)
    ?? step.shellReadSummary?.title ?? step.publicCommand ?? step.title
}

export function executionStepCurrentInstructionTitle(step: ExecutionStep): string {
  return (step.builtinOperation ? BUILTIN_CLI_NAMES[step.builtinOperation] : null)
    ?? step.shellReadSummary?.title ?? step.publicCommand ?? step.currentInstruction ?? step.title
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
  | { key: string; kind: 'compaction'; compaction: RuntimeCompactionDisplayItem }
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
    & Partial<Pick<AgentRunView, 'terminalReasonCode' | 'failure'>>,
  cancelling = false
): SemanticStatus {
  if (cancelling && ['queued', 'running', 'waiting'].includes(run.status)) {
    return { label: '正在停止…', tone: 'neutral' }
  }
  if (run.status === 'queued') return { label: '已排队', tone: 'neutral' }
  if (run.status === 'running' && run.failure?.code === 'runtime_network_interrupted') {
    return { label: '正在恢复', tone: 'attention' }
  }
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
      network_recovery: '连接中断，等待恢复',
      network_recovery_blocked: '需要处理',
      recovery_blocked: '结果待确认',
      approval: '等待审批',
      user_input: '等待用户'
    } as Record<string, string>)[run.waitReason ?? ''] ?? '等待处理',
    tone: run.waitReason === 'delivery_unknown'
      || run.waitReason === 'recovery_blocked'
      || run.waitReason === 'network_recovery_blocked'
      ? 'danger'
      : 'attention'
  }
}

export function agentRunStateTag(
  run: Pick<AgentRunView, 'status' | 'waitReason'>
    & Partial<Pick<AgentRunView, 'terminalReasonCode' | 'failure'>>,
  cancelling = false
): { tag: string; tone: 'brand' | 'attention' | 'success' | 'danger' | 'neutral' } {
  if (cancelling && ['queued', 'running', 'waiting'].includes(run.status)) {
    return { tag: '正在停止', tone: 'neutral' }
  }
  if (run.status === 'running' && run.failure?.code === 'runtime_network_interrupted') {
    return { tag: 'RECOVERING', tone: 'attention' }
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
      : run.waitReason === 'recovery_blocked' || run.waitReason === 'network_recovery_blocked'
        ? 'REVIEW'
        : 'WAITING',
    tone: run.waitReason === 'delivery_unknown'
      || run.waitReason === 'recovery_blocked'
      || run.waitReason === 'network_recovery_blocked'
      ? 'danger'
      : 'attention'
  }
}

export function agentRunWaitDetail(waitReason: string | null): string | null {
  return ({
    delivery_unknown: 'Agent 运行时是否接收输入尚不可确认；为避免重复执行，Rovai AI 不会盲目重发。',
    runtime_recovery: '正在从已保存的执行、运行会话与输入回执恢复。',
    network_recovery: '连接中断，等待恢复。确认输入未被接收后，Rovai AI 会自动重试。',
    network_recovery_blocked: '自动恢复的安全条件已经变化，需要处理。请检查执行记录；确认后可停止本次运行并发送后续任务。',
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
  'agent.text.block',
  'agent.thought.block',
  'agent.reasoning.summary.block',
  'activity.started',
  'activity.completed',
  'agent.text.delta',
  'file.change.updated',
  'agent.reasoning.summary.delta',
  'agent.thought.delta',
  'runtime.plan',
  'runtime.plan.delta',
  'runtime.diagnostic',
  'runtime.compaction.display',
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
    createdAt: stringField(asRecord(params.payload), 'blockStartedAt') ?? createdAt
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

export function runtimeCompactionDisplayItem(
  payloadValue: unknown
): RuntimeCompactionDisplayItem | null {
  const payload = asRecord(payloadValue)
  const schemaVersion = numberField(payload, 'schemaVersion')
  const id = stringField(payload, 'compactionId')?.trim()
  const adapterKind = stringField(payload, 'adapterKind')?.trim()
  const phase = stringField(payload, 'phase')
  if (
    schemaVersion !== 1
    || !id
    || !adapterKind
    || (phase !== 'imminent' && phase !== 'started' && phase !== 'completed')
  ) return null

  const completionCandidate = stringField(payload, 'completionEvidence')
  const completionEvidence = completionCandidate === 'native_terminal'
    || completionCandidate === 'pre_compaction_only'
    || completionCandidate === 'post_compaction_boundary'
    ? completionCandidate
    : null
  const tokens = asRecord(payload.tokens)
  const messages = asRecord(payload.messages)
  const summary = stringField(payload, 'summaryText')?.trim() ?? ''
  return {
    id,
    adapterKind,
    phase,
    completionEvidence,
    tokens: {
      ...optionalUnsignedInteger(tokens, 'before', 'before'),
      ...optionalUnsignedInteger(tokens, 'after', 'after'),
      ...optionalUnsignedInteger(tokens, 'current', 'current'),
      ...optionalUnsignedInteger(tokens, 'contextWindow', 'contextWindow'),
      ...optionalNonNegativeNumber(tokens, 'usagePercent', 'usagePercent')
    },
    messages: {
      ...optionalUnsignedInteger(messages, 'compacted', 'compacted')
    },
    ...optionalUnsignedInteger(payload, 'elapsedMs', 'elapsedMs'),
    summaryText: summary || null
  }
}

function optionalUnsignedInteger<K extends string>(
  value: Record<string, unknown>,
  field: string,
  output: K
): Partial<Record<K, number>> {
  const candidate = numberField(value, field)
  return candidate !== null && Number.isSafeInteger(candidate) && candidate >= 0
    ? { [output]: candidate } as Partial<Record<K, number>>
    : {}
}

function optionalNonNegativeNumber<K extends string>(
  value: Record<string, unknown>,
  field: string,
  output: K
): Partial<Record<K, number>> {
  const candidate = numberField(value, field)
  return candidate !== null && Number.isFinite(candidate) && candidate >= 0
    ? { [output]: candidate } as Partial<Record<K, number>>
    : {}
}

export function runtimeCompactionIsExpandable(item: RuntimeCompactionDisplayItem): boolean {
  return item.tokens.before !== undefined
    || item.tokens.after !== undefined
    || item.tokens.current !== undefined
    || item.tokens.contextWindow !== undefined
    || item.tokens.usagePercent !== undefined
    || item.summaryText !== null
}

export function runtimeAdapterDisplayLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI',
    'cursor-agent': 'Cursor Agent',
    'kimi-code-cli': 'Kimi',
    'grok-build': 'Grok',
    'zcode-app': 'ZCode',
    'antigravity-app': 'Antigravity'
  } as Record<string, string>)[kind] ?? kind
}

export function runtimeCompactionTitle(item: RuntimeCompactionDisplayItem): string {
  const action = item.phase === 'imminent'
    ? '即将压缩会话上下文'
    : item.phase === 'started'
      ? '正在压缩会话上下文'
      : item.completionEvidence === 'post_compaction_boundary'
        ? '已进入压缩后的新上下文'
        : '压缩会话上下文'
  const tokenTransition = item.tokens.before !== undefined && item.tokens.after !== undefined
    ? ` · ${compactTokenCount(item.tokens.before)} → ${compactTokenCount(item.tokens.after)}`
    : ''
  return `${action} · ${runtimeAdapterDisplayLabel(item.adapterKind)}${tokenTransition}`
}

export function runtimeCompactionDetailText(
  item: RuntimeCompactionDisplayItem
): string | null {
  if (!runtimeCompactionIsExpandable(item)) return null
  const metrics: string[] = []
  const formatTokens = (value: number): string => `${new Intl.NumberFormat('zh-CN').format(value)} tokens`
  if (item.tokens.before !== undefined) metrics.push(`压缩前：${formatTokens(item.tokens.before)}`)
  if (item.tokens.after !== undefined) metrics.push(`压缩后：${formatTokens(item.tokens.after)}`)
  if (item.tokens.current !== undefined) metrics.push(`当前：${formatTokens(item.tokens.current)}`)
  if (item.tokens.contextWindow !== undefined) {
    metrics.push(`上下文窗口：${formatTokens(item.tokens.contextWindow)}`)
  }
  if (
    item.tokens.before !== undefined
    && item.tokens.after !== undefined
    && item.tokens.before >= item.tokens.after
  ) {
    const reduction = item.tokens.before - item.tokens.after
    const percent = item.tokens.before > 0
      ? ` · ${((reduction / item.tokens.before) * 100).toFixed(1)}%`
      : ''
    metrics.push(`减少：${formatTokens(reduction)}${percent}`)
  }
  if (item.tokens.usagePercent !== undefined) {
    metrics.push(`上下文使用：${item.tokens.usagePercent.toFixed(1)}%`)
  }
  if (item.messages.compacted !== undefined) {
    metrics.push(`整理消息：${new Intl.NumberFormat('zh-CN').format(item.messages.compacted)}`)
  }
  if (item.elapsedMs !== undefined) {
    const seconds = (item.elapsedMs / 1_000).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
    metrics.push(`耗时：${seconds} 秒`)
  }
  if (!item.summaryText) return metrics.join('\n') || null
  return metrics.length > 0
    ? `${metrics.join('\n')}\n\n会话摘要\n\n${item.summaryText}`
    : item.summaryText
}

function compactTokenCount(value: number): string {
  if (value < 1_000) return String(value)
  const divisor = value >= 1_000_000 ? 1_000_000 : 1_000
  const suffix = value >= 1_000_000 ? 'M' : 'K'
  return `${(value / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`
}

export function buildLiveExecutionProgress(
  events: LiveRuntimeEvent[],
  agentRunId: string,
  options: { textMode?: 'live_tail' | 'complete'; includePublicResults?: boolean } = {}
): LiveExecutionProgress {
  const narrationByItem = new Map<string, string>()
  const settledNarration = new Set<string>()
  let anonymousNarrationSegment = 0
  let activeAnonymousNarrationItemId: string | null = null
  let planExplanation = ''
  let plan: ExecutionPlanStep[] = []
  const diagnosticsById = new Map<string, RuntimeDiagnostic>()
  const compactionsById = new Map<string, RuntimeCompactionDisplayItem>()
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
    const readSummary = step.shellReadSummary ?? previous.shellReadSummary
    const publicCommand = step.publicCommand ?? previous.publicCommand
    const detail = readSummary && !step.shellReadSummary && publicCommand
      ? sparseShellReadDetail(publicCommand, previous.detail, step.detail)
      : step.detail || previous.detail
    steps[index] = {
      ...previous,
      ...step,
      title,
      currentInstruction: step.currentInstruction ?? previous.currentInstruction,
      publicCommand,
      iconKind: readSummary ? 'file-read' : step.iconKind,
      shellReadSummary: readSummary,
      fileOperation: readSummary ? undefined : step.fileOperation,
      detail
    }
  }

  const upsertCompaction = (compaction: RuntimeCompactionDisplayItem): void => {
    const previous = compactionsById.get(compaction.id)
    compactionsById.set(compaction.id, previous
      ? {
          ...previous,
          ...compaction,
          completionEvidence: compaction.completionEvidence ?? previous.completionEvidence,
          tokens: { ...previous.tokens, ...compaction.tokens },
          messages: { ...previous.messages, ...compaction.messages },
          elapsedMs: compaction.elapsedMs ?? previous.elapsedMs,
          summaryText: compaction.summaryText ?? previous.summaryText
        }
      : compaction)
  }

  for (const event of events) {
    if (event.agentRunId !== agentRunId) continue
    const payload = asRecord(event.payload)

    if (event.eventType === 'agent.reasoning.summary.delta' || event.eventType === 'agent.thought.delta'
      || event.eventType === 'agent.reasoning.summary.block' || event.eventType === 'agent.thought.block') {
      finishNarrationStream()
      continue
    }
    if (event.eventType === 'agent.text.block') {
      const itemId = stringField(payload, 'blockId') ?? event.id
      rememberItem(`narration:${itemId}`)
      narrationByItem.set(itemId, stringField(payload, 'text') ?? '')
      if (payload.status !== 'streaming') settledNarration.add(itemId)
      continue
    }
    if (event.eventType === 'agent.text.delta') {
      const delta = stringField(payload, 'delta') ?? ''
      const stableItemId = stringField(payload, 'itemId')
      const itemId = stableItemId ?? anonymousNarrationItemId()
      if (stableItemId) activeAnonymousNarrationItemId = null
      if (settledNarration.has(itemId)) continue
      rememberItem(`narration:${itemId}`)
      const previous = narrationByItem.get(itemId) ?? ''
      const offset = numberField(payload, 'textOffset')
      const unseen = offset === null ? delta : delta.slice(Math.max(0, previous.length - offset))
      narrationByItem.set(itemId, `${previous}${unseen}`)
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

    if (event.eventType === 'runtime.compaction.display') {
      finishNarrationStream()
      const compaction = runtimeCompactionDisplayItem(payload)
      if (compaction) {
        rememberItem(`compaction:${compaction.id}`)
        upsertCompaction(compaction)
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
      const fileOperation = reliableRuntimeFileOperation(payload)
      const readSummary = nativeType === 'commandExecution' ? shellReadSummary(payload) : null
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
      const publicCommand = command
        ? shellCommandDetailText(command)
        : canonical?.activityDomain === 'shell'
          ? publicShellCommandPresentation(payload)
          : null
      const evidenceDetail = codexCommand
        ? shellCommandDetail(codexCommand, publicOutput)
        : publicOutput
          ?? command
          ?? fileChangeDetail(item)
          ?? runtimeToolDetail(item, nativeType)
          ?? nativeStatus
          ?? ''
      const detail = fileOperation?.operationKind === 'read' && readSummary === null
        ? ''
        : searchEvidenceText(typedSearchQuery(payload, canonical), evidenceDetail) ?? ''
      if (shouldDeferUnresolvedShellActivity(canonical, title, status)) continue
      upsertStep({
        id: itemId,
        title,
        currentInstruction: executionActivityCurrentInstruction(canonical, payload),
        publicCommand,
        publicResult: null,
        detail,
        status,
        activityDomain: canonical?.activityDomain ?? 'unknown',
        iconKind: readSummary ? 'file-read' : activityIconKind(canonical),
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown',
        shellReadSummary: readSummary ?? undefined,
        fileOperation: readSummary ? undefined : fileOperation,
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
      const fileOperation = reliableRuntimeFileOperation(payload)
      const readSummary = canonical?.activityDomain === 'shell'
        ? shellReadSummary(payload)
        : null
      if (!fileChanges && isApplyPatchPresentation(canonical, payload)) continue
      if (shouldDeferUnresolvedShellActivity(canonical, title, status)) continue
      upsertStep({
        id: itemId,
        title,
        currentInstruction: executionActivityCurrentInstruction(canonical, payload),
        publicCommand: canonical?.activityDomain === 'shell'
          ? publicShellCommandPresentation(payload)
          : null,
        publicResult: null,
        builtinOperation: builtinOperation(payload) ?? undefined,
        detail: fileOperation?.operationKind === 'read' && readSummary === null
          ? ''
          : runtimeActionEvidenceText(payload, canonical) ?? '',
        status,
        activityDomain: canonical?.activityDomain ?? 'unknown',
        iconKind: readSummary ? 'file-read' : activityIconKind(canonical),
        toolName: canonical?.toolName ?? null,
        credibility: canonical?.credibility ?? 'unknown',
        shellReadSummary: readSummary ?? undefined,
        fileOperation: readSummary ? undefined : fileOperation,
        fileChanges,
        fileChangeSemantics
      })
      continue
    }

    // Incremental patch notifications are deliberately not presented. Only a
    // reliable terminal Runtime diff projection can produce modified-file rows.
  }

  const publicResult = options.includePublicResults === false
    ? () => null : createExecutionPublicResultProjector(events, agentRunId)
  const supportingShells = supportingBuiltinShells(events, agentRunId, pureBuiltinShellOperation, publicShellCommand)
  const stepById = new Map(steps.filter(step => !supportingShells.has(step.id))
    .map((step) => [step.id, { ...step, publicResult: publicResult(step) }]))
  const items = itemOrder.flatMap((key): ExecutionProgressItem[] => {
    if (key === 'plan') {
      const explanation = options.textMode === 'live_tail'
        ? planExplanation.trim().slice(-2_000)
        : planExplanation.trim()
      return explanation || plan.length > 0
        ? [{ key, kind: 'plan', explanation, plan }]
        : []
    }
    if (key.startsWith('narration:')) {
      const itemId = key.slice('narration:'.length)
      const narration = (narrationByItem.get(itemId) ?? '').trim()
      const body = options.textMode === 'live_tail' ? narration.slice(-4_000) : narration
      return safeMarkdownHasRenderableContent(body)
        ? [{ key, kind: 'narration', body }]
        : []
    }
    if (key.startsWith('diagnostic:')) {
      const diagnostic = diagnosticsById.get(key.slice('diagnostic:'.length))
      return diagnostic ? [{ key, kind: 'diagnostic', diagnostic }] : []
    }
    if (key.startsWith('compaction:')) {
      const compaction = compactionsById.get(key.slice('compaction:'.length))
      return compaction ? [{ key, kind: 'compaction', compaction }] : []
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

function sparseShellReadDetail(
  publicCommand: string,
  previousDetail: string,
  currentDetail: string
): string {
  const normalized = currentDetail.trim().toLocaleLowerCase()
  if (!normalized || [
    'completed',
    'failed',
    'cancelled',
    'stopped',
    'succeeded'
  ].includes(normalized)) return previousDetail
  if (currentDetail.startsWith('$ ')) return currentDetail
  return shellCommandDetail(publicCommand, currentDetail)
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
  byCompactionId: Map<string, T>
  unassigned: T[]
} {
  const byToolId = new Map<string, T>()
  const byCompactionId = new Map<string, T>()
  const unassigned: T[] = []
  for (const item of evidence) {
    if (item.eventType === 'runtime.compaction.display') {
      const compactionId = runtimeCompactionDisplayItem(item.payload)?.id ?? null
      if (!compactionId) {
        unassigned.push(item)
        continue
      }
      const current = byCompactionId.get(compactionId)
      if (!current || shouldPreferCompleteEvidence(item, current)) {
        byCompactionId.set(compactionId, item)
      }
      continue
    }
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
  return { byToolId, byCompactionId, unassigned }
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
  if (builtinOperation(payload)) return builtinInputText(payload)
  let evidenceText: string | null = null
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

function publicShellCommandPresentation(payload: unknown): string | null {
  const command = publicShellCommand(payload)
  return command ? shellCommandDetailText(command) : null
}

export function executionEvidenceResultText(
  eventType: AgentRunExecutionEvidenceView['eventType'],
  payloadValue: unknown,
  canonical?: CanonicalRuntimeActivityView | null
): string | null {
  const payload = asRecord(payloadValue)
  if (eventType === 'agent.text.block') return stringField(payload, 'text')
  if (eventType === 'runtime.compaction.display') {
    const compaction = runtimeCompactionDisplayItem(payload)
    return compaction ? runtimeCompactionDetailText(compaction) : null
  }
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
  const readSummary = domain === 'shell' ? shellReadSummary(payload) : null
  if (readSummary) return readSummary.title

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
    if (canonical?.semanticKind === 'file.read') return '阅读文件'
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

const GENERIC_CURRENT_INSTRUCTION_TITLES = new Set([
  'agent 正在处理',
  'agent 运行',
  'apply patch',
  'apply_patch',
  'edit',
  'file change',
  'file operation',
  'read',
  'read file',
  'read_file',
  'readfile',
  'runtime activity',
  'runtime tool call',
  'search',
  'shell',
  'terminal',
  'tool',
  'tool call',
  'tool_call',
  'web search',
  'web_search',
  'websearch',
  'write',
  'write file',
  'write_file',
  '文件操作',
  '修改文件',
  '工具调用',
  '搜索',
  '系统活动',
  '终端操作',
  '读取文件'
])

/**
 * Resolves only public, already-admitted evidence into the active Tool-group instruction.
 * Raw input/output and display text never establish file/search classification through this
 * helper; an explicit Runtime title is used only as presentation.
 */
export function executionActivityCurrentInstruction(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  payload: unknown
): string | null {
  const runtimeTitle = canonical?.presentationHint
    ?.replaceAll('Runtime 工具调用', '工具调用')
    .replaceAll('Runtime 活动', '系统活动')
  const domain = canonical?.activityDomain ?? 'unknown'

  if (domain === 'shell') {
    return publicShellCommandPresentation(payload)
      ?? specificShellCurrentInstruction(runtimeTitle)
      ?? specificShellCurrentInstruction(canonical?.toolName)
  }
  if (domain === 'file') {
    return reliableFileActivityInstruction(canonical, payload)
      ?? specificCurrentInstruction(runtimeTitle)
      ?? specificCurrentInstruction(canonical?.toolName)
  }
  if (domain === 'tool' && canonical?.semanticKind === 'tool.web.search') {
    const query = typedSearchQuery(payload, canonical)
    return query
      ? `搜索 ${query}`
      : specificCurrentInstruction(runtimeTitle)
        ?? specificCurrentInstruction(canonical?.toolName)
  }
  return specificCurrentInstruction(runtimeTitle)
    ?? specificCurrentInstruction(canonical?.toolName)
}

function specificCurrentInstruction(value: string | null | undefined): string | null {
  const title = value?.trim()
  if (!title || GENERIC_CURRENT_INSTRUCTION_TITLES.has(title.toLowerCase())) return null
  return title
}

function specificShellCurrentInstruction(value: string | null | undefined): string | null {
  const title = value?.trim()
  return title && !genericShellTitle(title) ? title : null
}

export function activityIconKind(
  canonical: CanonicalRuntimeActivityView | null | undefined
): ActivityIconKind {
  if (canonical?.activityDomain === 'shell') return 'terminal'
  if (canonical?.activityDomain === 'file') {
    if (canonical.semanticKind === 'file.read') return 'file-read'
    if (canonical.semanticKind === 'file.write') return 'file-write'
    return 'file'
  }
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
  const operation = reliableRuntimeFileOperation(payload)
  const operationPath = operation?.path ?? null
  const diffEntries = canonical?.diffProjection?.status === 'available'
    && Array.isArray(canonical.diffProjection.entries)
    ? canonical.diffProjection.entries
    : []
  const path = operationPath ?? (diffEntries.length === 1 ? diffEntries[0]?.path : null)
  if (!path) return null
  const fileName = path.split(/[\\/]/u).filter(Boolean).at(-1)
  if (!fileName) return null
  if (operation?.operationKind === 'read') return `阅读 ${fileName}`
  const changeKind = diffEntries.length === 1
    ? diffEntries[0]?.changeKind
    : operation?.changeKind
  return `${changeKind === 'add' ? '新增' : '编辑'} ${fileName}`
}

function reliableRuntimeFileOperation(payload: unknown): ExecutionStep['fileOperation'] {
  const operation = asRecord(asRecord(payload).runtimeFileOperation)
  if (numberField(operation, 'schemaVersion') !== 2 || stringField(operation, 'status') !== 'available') {
    return undefined
  }
  const operationKind = stringField(operation, 'operationKind')
  const path = stringField(operation, 'path')?.trim()
  if (!path || (operationKind !== 'read' && operationKind !== 'write')) return undefined
  const candidateChangeKind = stringField(operation, 'changeKind')
  const changeKind = operationKind === 'write'
    && (candidateChangeKind === 'add' || candidateChangeKind === 'update')
    ? candidateChangeKind
    : undefined
  return { operationKind, path, ...(changeKind ? { changeKind } : {}) }
}

function reliableFileActivityInstruction(
  canonical: CanonicalRuntimeActivityView | null | undefined,
  payload: unknown
): string | null {
  const singleFileTitle = reliableFileActivityTitle(canonical, payload)
  if (singleFileTitle) return singleFileTitle
  const entries = canonical?.diffProjection?.status === 'available'
    && Array.isArray(canonical.diffProjection.entries)
    ? canonical.diffProjection.entries
    : []
  return entries.length > 1 ? `修改 ${entries.length} 个文件` : null
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
  return GENERIC_SHELL_TITLES.has(title.toLowerCase())
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
const POWERSHELL_WRAPPER_EXECUTABLES = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'])
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
  const normalized = tokens
    .map((token) => token.raw.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return null
  return normalized
}

function unwrapShellCommand(command: string): string {
  let current = command.trim()
  for (let depth = 0; depth < 3; depth += 1) {
    const tokens = tokenizeShellPreview(current)
    if (tokens.some((token) => token.operator) || tokens.length < 3) break
    const executable = shellExecutable(tokens[0].value)
    // The POSIX tokenizer consumes single Windows backslashes; retain the raw path
    // when recognizing a quoted PowerShell executable.
    const rawExecutable = shellExecutable(tokens[0].raw.replace(/^(['"])(.*)\1$/u, '$2'))
    const powershell = POWERSHELL_WRAPPER_EXECUTABLES.has(executable ?? '')
      || POWERSHELL_WRAPPER_EXECUTABLES.has(rawExecutable ?? '')
    if (!powershell && (!executable || !SHELL_WRAPPER_EXECUTABLES.has(executable))) break
    const commandIndex = tokens.findIndex((token, index) =>
      index > 0 && (powershell
        ? ['-c', '-command'].includes(token.value.toLowerCase())
        : token.value === '-c' || token.value === '-lc')
    )
    if (commandIndex < 0 || commandIndex + 2 !== tokens.length) break
    current = tokens[commandIndex + 1].value.trim()
  }
  return current
}

function rovaiCommandCursor(tokens: ShellPreviewToken[]): number | null {
  let cursor = 0
  if (shellExecutable(tokens[cursor]?.value ?? '') === 'env') cursor += 1
  while (cursor < tokens.length && shellAssignment(tokens[cursor].value)) cursor += 1
  if (['npx', 'bunx'].includes(shellExecutable(tokens[cursor]?.value ?? '') ?? '')) {
    cursor += 1
    if (['--yes', '-y'].includes(tokens[cursor]?.value)) cursor += 1
  }
  return shellExecutable(tokens[cursor]?.value ?? '') === 'rovai' ? cursor : null
}

/** Omit Rovai stdin before the one-line tokenizer can expose its JSON as commands.
 * Preserve every independent command and non-Rovai heredoc, including mixed Shells. */
function omitBuiltinStdin(command: string): { command: string; complete: boolean; hasExpansion: boolean } {
  const lines = command.split(/\r?\n/u)
  const output: string[] = []
  let complete = true
  let hasExpansion = false
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    let offset = 0
    const tokens = tokenizeShellPreview(line).map(token => {
      const start = line.indexOf(token.raw, offset)
      offset = start + token.raw.length
      return { ...token, start, end: offset }
    })
    const omitted: { start: number; end: number }[] = []
    const retainedBodies: string[] = []
    let segmentStart = 0
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token.operator) { segmentStart = index + 1; continue }
      // Quoted occurrences are ordinary values, not redirects.
      const redirect = token.raw.match(/^((?:0)?<<<|(?:0)?<<-?)/u)?.[1]
      if (!redirect) continue
      const attached = token.value.slice(redirect.length)
      const valueToken = attached ? token : tokens[index + 1]
      const value = attached || valueToken?.value
      if (!valueToken || valueToken.operator || !value) continue
      const segment = tokens.slice(segmentStart, index)
      const cursor = rovaiCommandCursor(segment)
      const words = cursor === null ? [] : segment.slice(cursor + 1).map(part => part.value)
      const builtin = cursor !== null && Object.values(BUILTIN_CLI_NAMES).some(name =>
        name.split(' ').slice(1).every((part, position) => words[position] === part))
      if (redirect.endsWith('<<<')) {
        if (builtin) {
          omitted.push({ start: token.start, end: valueToken.end })
          hasExpansion ||= activeShellSyntax(valueToken.raw.slice(attached ? redirect.length : 0))
        }
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
        let end = lineIndex + 1
        while (end < lines.length && (redirect.endsWith('-') ? lines[end].replace(/^\t+/u, '') : lines[end]) !== value) end += 1
        if (builtin) {
          omitted.push({ start: token.start, end: valueToken.end })
          const quotedMarker = /['"\\]/u.test(valueToken.raw.slice(attached ? redirect.length : 0))
          if (!quotedMarker) hasExpansion ||= activeHeredocSubstitution(lines.slice(lineIndex + 1, end).join('\n'))
        } else retainedBodies.push(...lines.slice(lineIndex + 1, Math.min(end + 1, lines.length)))
        if (end === lines.length) complete = false
        lineIndex = end
      }
      if (!attached) index += 1
    }
    let rendered = line
    for (const span of omitted.reverse()) rendered = rendered.slice(0, span.start) + rendered.slice(span.end)
    output.push(rendered.trimEnd(), ...retainedBodies)
  }
  return { command: output.join('\n').trim(), complete, hasExpansion }
}

function activeHeredocSubstitution(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') { index += 1; continue }
    if (value[index] === '`' || (value[index] === '$' && value[index + 1] === '(')) return true
  }
  return false
}

function activeShellSyntax(value: string): boolean {
  let quote: 'single' | 'double' | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote === 'single') {
      if (character === "'") quote = null
      continue
    }
    if (character === '\\') { index += 1; continue }
    if (character === '`' || (character === '$' && value[index + 1] === '(')) return true
    if (character === '"') { quote = quote === 'double' ? null : 'double'; continue }
    if (quote === null && (character === '<' || character === '>')) return true
    if (quote === null && character === "'") quote = 'single'
  }
  return quote !== null
}

function pureBuiltinShellOperation(command: string): string | null {
  const source = unwrapShellCommand(stripAnsi(command).trim())
  const stdin = omitBuiltinStdin(source)
  if (!stdin.complete || stdin.hasExpansion) return null
  const tokens = tokenizeShellPreview(stdin.command)
  // Dynamic commands, redirection and additional work cannot be hidden as a CLI carrier.
  if (tokens.some(token => token.operator || activeShellSyntax(token.raw))) return null
  const cursor = rovaiCommandCursor(tokens)
  if (cursor === null) return null
  const words = tokens.slice(cursor + 1).map(token => token.value)
  if (words.some(word => ['--help', '-h', '--version', '-V'].includes(word))) return null
  return Object.entries(BUILTIN_CLI_NAMES).find(([, name]) =>
    name.split(' ').slice(1).every((part, index) => words[index] === part)
  )?.[0] ?? null
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

type StructuredReadPathResult =
  | { status: 'available'; paths: string[] }
  | { status: 'incompatible' | 'unavailable' }

/**
 * Builds a display-only summary for one command that is proven to contain
 * multiple file reads. It never changes execution, Evidence, or permissions.
 */
export function shellReadSummary(payload: unknown): ShellReadSummary | null {
  const structured = structuredShellReadPaths(payload)
  if (structured.status === 'incompatible') return null
  const paths = structured.status === 'available'
    ? structured.paths
    : fallbackSedReadPaths(publicShellCommand(payload))
  if (!paths || paths.length < 2) return null

  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0) return null
  const displayPaths = shortestUniquePathLabels(uniquePaths)
  return {
    title: `阅读 ${displayPaths.join('，')}`,
    paths: uniquePaths,
    displayPaths
  }
}

function structuredShellReadPaths(payload: unknown): StructuredReadPathResult {
  const root = asRecord(payload)
  const item = asRecord(root.item)
  const candidate = Object.prototype.hasOwnProperty.call(item, 'commandActions')
    ? item.commandActions
    : root.commandActions
  if (candidate === undefined || candidate === null) return { status: 'unavailable' }
  if (!Array.isArray(candidate) || candidate.length === 0) return { status: 'unavailable' }

  const actions = candidate.map(asRecord)
  const types = actions.map((action) => stringField(action, 'type'))
  if (types.some((type) => type !== null && type !== 'read' && type !== 'unknown')) {
    return { status: 'incompatible' }
  }
  if (types.some((type) => type !== 'read')) return { status: 'unavailable' }

  const paths = actions.map((action) => stringField(action, 'path')?.trim() ?? '')
  if (paths.length < 2 || paths.some((path) => path.length === 0)) {
    return { status: 'unavailable' }
  }
  return { status: 'available', paths }
}

function fallbackSedReadPaths(command: string | null): string[] | null {
  if (!command) return null
  const unwrapped = unwrapShellCommand(stripAnsi(command).trim())
  if (!unwrapped || unwrapped.includes('`') || !simpleShellQuotesAreBalanced(unwrapped)) return null
  const tokens = tokenizeShellCommand(unwrapped)
  if (tokens.length === 0 || tokens[0].operator || tokens.at(-1)?.operator) return null

  let actionCount = 1
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.operator) continue
    if (
      token.value !== ';'
      || index === 0
      || index === tokens.length - 1
      || tokens[index - 1].operator
      || tokens[index + 1].operator
    ) return null
    actionCount += 1
  }
  if (actionCount < 2) return null

  const previewSegments: ShellPreviewToken[][] = [[]]
  for (const token of tokenizeShellPreview(unwrapped)) {
    if (token.operator) {
      previewSegments.push([])
    } else {
      previewSegments.at(-1)?.push(token)
    }
  }
  const paths: string[] = []
  for (const segment of previewSegments) {
    if (
      segment.length !== 4
      || shellExecutable(segment[0].value) !== 'sed'
      || segment[1].value !== '-n'
      || !/^'\d+,\d+p'$/u.test(segment[2].raw)
      || !directShellFilePath(segment[3].value)
    ) return null
    paths.push(segment[3].value)
  }
  return paths.length === actionCount ? paths : null
}

function simpleShellQuotesAreBalanced(command: string): boolean {
  let quote: 'single' | 'double' | null = null
  let escaped = false
  for (const character of command) {
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      continue
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
    }
  }
  return quote === null && !escaped
}

function directShellFilePath(path: string): boolean {
  const value = path.trim()
  return value.length > 0
    && !value.startsWith('-')
    && !/[\u0000-\u001F\u007F$`*?{}\[\]<>|;&()]/u.test(value)
}

function shortestUniquePathLabels(paths: string[]): string[] {
  const parts = paths.map((path) => path.replaceAll('\\', '/').split('/').filter(Boolean))
  return parts.map((pathParts, index) => {
    const fallback = pathParts.at(-1) ?? paths[index]
    for (let length = 1; length <= pathParts.length; length += 1) {
      const suffix = pathParts.slice(-length).join('/')
      const unique = parts.every((otherParts, otherIndex) =>
        otherIndex === index || otherParts.slice(-length).join('/') !== suffix
      )
      if (unique) return suffix
    }
    return paths[index] || fallback
  })
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
  if (canonical.outcome === 'not_executed' || canonical.outcome === 'denied') return 'skipped'
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
