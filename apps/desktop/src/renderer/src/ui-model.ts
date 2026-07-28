import type {
  AgentRunView,
  Approval,
  CoreEvent,
  InboxMessageView,
  NavigationCampItem,
  NavigationSnapshot,
  TaskStatus,
  TimelineEvent
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
    ...navigation.lobby.recentCamps,
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

export type ConversationItem = {
  id: string
  kind: 'user' | 'agent' | 'system' | 'error'
  text: string
  time: string
}

export type ActivityKind = 'command' | 'file' | 'approval' | 'runtime' | 'activity'
export type ActivityStatus = 'running' | 'completed' | 'failed' | 'waiting' | 'recorded'

export type ActivityItem = {
  id: string
  itemId: string | null
  kind: ActivityKind
  title: string
  status: ActivityStatus
  detail: string
  command: string | null
  cwd: string | null
  durationMs: number | null
  exitCode: number | null
  time: string
  payload?: unknown
}

export type LiveRuntimeEvent = {
  id: string
  agentRunId: string
  eventType: string
  payload: unknown
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
}

export type LiveExecutionProgress = {
  reasoningSummary: string
  reasoningStreaming: boolean
  narration: string
  planExplanation: string
  plan: ExecutionPlanStep[]
  steps: ExecutionStep[]
}

export type ApprovalSummary = {
  title: string
  capability: string
  scope: string
  reason: string
  blockingImpact: string
  allowOnceEffect: string
  allowSessionEffect: string
  declineEffect: string
  cancelEffect: string
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

export function agentRunPresentation(run: Pick<AgentRunView, 'status' | 'waitReason'>): SemanticStatus {
  if (run.status === 'queued') return { label: '已排队', tone: 'neutral' }
  if (run.status === 'running') return { label: '执行中', tone: 'info' }
  if (run.status === 'succeeded') return { label: '已完成', tone: 'success' }
  if (run.status === 'failed') return { label: '失败', tone: 'danger' }
  if (run.status === 'cancelled') return { label: '已取消', tone: 'neutral' }
  return {
    label: ({
      context_compaction: '压缩上下文',
      context_overloaded: '上下文过载',
      delivery_unknown: '投递待确认',
      runtime_recovery: '恢复中',
      approval: '等待审批',
      user_input: '等待用户'
    } as Record<string, string>)[run.waitReason ?? ''] ?? '等待处理',
    tone: run.waitReason === 'context_overloaded' || run.waitReason === 'delivery_unknown'
      ? 'danger'
      : 'attention'
  }
}

export function agentRunStateTag(
  run: Pick<AgentRunView, 'status' | 'waitReason'>
): { tag: string; tone: 'brand' | 'attention' | 'success' | 'danger' | 'neutral' } {
  if (run.status === 'running') return { tag: 'RUNNING', tone: 'brand' }
  if (run.status === 'queued') return { tag: 'QUEUED', tone: 'neutral' }
  if (run.status === 'succeeded') return { tag: 'DONE', tone: 'success' }
  if (run.status === 'failed') return { tag: 'FAILED', tone: 'danger' }
  if (run.status === 'cancelled') return { tag: 'CANCELLED', tone: 'neutral' }
  return {
    tag: run.waitReason === 'approval' ? 'WAITING APPROVAL' : 'WAITING',
    tone: run.waitReason === 'context_overloaded' || run.waitReason === 'delivery_unknown'
      ? 'danger'
      : 'attention'
  }
}

export function agentRunWaitDetail(waitReason: string | null): string | null {
  return ({
    context_compaction: '公共上下文超过本轮预算，正在对较早的连续消息区间生成摘要。',
    context_overloaded: '必需输入仍然超出预算；Rovai-ai 没有静默裁剪，也没有调用 Agent。',
    delivery_unknown: '执行引擎是否接收输入尚不可确认；为避免重复执行，Rovai-ai 不会盲目重发。',
    runtime_recovery: '正在从持久化 AgentRun、Native Session 与输入回执恢复执行。',
    approval: '受限动作正在等待用户处理。',
    user_input: 'Agent 已暂停，等待用户补充信息。'
  } as Record<string, string>)[waitReason ?? ''] ?? null
}

export function inboxMessagePresentation(
  message: Pick<InboxMessageView, 'deliveredAt' | 'failedAt'>,
  targetRunStatus: AgentRunView['status'] | null
): SemanticStatus {
  if (message.failedAt) return { label: '投递失败', tone: 'danger' }
  if (targetRunStatus === 'queued') return { label: '已排队', tone: 'neutral' }
  if (targetRunStatus === 'running') return { label: '执行中', tone: 'info' }
  if (targetRunStatus === 'waiting') return { label: '等待处理', tone: 'attention' }
  if (targetRunStatus === 'succeeded') return { label: '已完成', tone: 'success' }
  if (targetRunStatus === 'failed') return { label: '执行失败', tone: 'danger' }
  if (targetRunStatus === 'cancelled') return { label: '已取消', tone: 'neutral' }
  return message.deliveredAt
    ? { label: '已投递', tone: 'success' }
    : { label: '待投递', tone: 'attention' }
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`
}

export function buildConversation(events: TimelineEvent[]): ConversationItem[] {
  const result: ConversationItem[] = []
  const agentIndexes = new Map<string, number>()
  for (const event of events) {
    const payload = asRecord(event.payload)
    if (event.eventType === 'user.message') {
      const text = stringField(payload, 'text')
      if (text) result.push({ id: `event-${event.id}`, kind: 'user', text, time: event.createdAt })
      continue
    }
    if (event.eventType === 'agent.text.delta') {
      const delta = stringField(payload, 'delta')
      if (!delta) continue
      const key = `${stringField(payload, 'turnId') ?? 'turn'}:${stringField(payload, 'itemId') ?? event.id}`
      const existingIndex = agentIndexes.get(key)
      if (existingIndex === undefined) {
        agentIndexes.set(key, result.length)
        result.push({ id: `agent-${key}`, kind: 'agent', text: delta, time: event.createdAt })
      } else {
        result[existingIndex] = {
          ...result[existingIndex],
          text: result[existingIndex].text + delta,
          time: event.createdAt
        }
      }
      continue
    }
    if (event.eventType === 'error') {
      result.push({
        id: `event-${event.id}`,
        kind: 'error',
        text: deepString(payload, ['message']) ?? jsonPreview(payload),
        time: event.createdAt
      })
      continue
    }
    if (event.nativeMethod === 'application/restarted' || event.nativeMethod === 'session/generation-changed') {
      result.push({
        id: `event-${event.id}`,
        kind: 'system',
        text: event.nativeMethod === 'application/restarted'
          ? '应用已重启，任务和项目变更已保留，等待你确认恢复。'
          : '原 Codex Thread 无法恢复，已切换到新的 Session Generation。',
        time: event.createdAt
      })
    }
  }
  return result
}

export function buildActivities(events: TimelineEvent[]): ActivityItem[] {
  const result: ActivityItem[] = []
  const indexes = new Map<string, number>()

  const upsert = (key: string, create: () => ActivityItem, update: (current: ActivityItem) => ActivityItem): void => {
    const index = indexes.get(key)
    if (index === undefined) {
      indexes.set(key, result.length)
      result.push(create())
      return
    }
    result[index] = update(result[index])
  }

  for (const event of events) {
    const payload = asRecord(event.payload)
    if (event.eventType === 'command.output.delta') {
      const delta = stripAnsi(stringField(payload, 'delta') ?? '')
      const itemId = stringField(payload, 'itemId') ?? `event-${event.id}`
      upsert(
        `item:${itemId}`,
        () => activity({
          id: `item-${itemId}`,
          itemId,
          kind: 'command',
          title: '命令执行',
          status: 'running',
          detail: delta,
          time: event.createdAt
        }),
        (current) => ({ ...current, detail: `${current.detail}${delta}`, time: event.createdAt })
      )
      continue
    }

    if (event.eventType === 'activity.started' || event.eventType === 'activity.completed') {
      const item = asRecord(payload.item)
      const nativeType = stringField(item, 'type') ?? 'activity'
      if (nativeType === 'agentMessage' || nativeType === 'reasoning' || nativeType === 'userMessage') continue
      const itemId = stringField(item, 'id') ?? `event-${event.id}`
      const kind = activityKind(nativeType)
      const command = stringField(item, 'command') ?? deepString(item, ['command', 'command'])
      const cwd = stringField(item, 'cwd')
      const nativeStatus = stringField(item, 'status')
      const durationMs = numberField(item, 'durationMs')
      const exitCode = numberField(item, 'exitCode')
      const status = exitCode !== null && exitCode !== 0
        ? 'failed'
        : activityStatus(nativeStatus, event.eventType)
      const rawOutput = stringField(item, 'aggregatedOutput')
      const output = rawOutput === null ? null : stripAnsi(rawOutput)
      const detail = output ?? fileChangeDetail(item) ?? nativeStatus ?? ''
      upsert(
        `item:${itemId}`,
        () => activity({
          id: `item-${itemId}`,
          itemId,
          kind,
          title: activityTitle(kind, nativeType),
          status,
          detail,
          command,
          cwd,
          durationMs,
          exitCode,
          time: event.createdAt,
          payload: item
        }),
        (current) => ({
          ...current,
          kind,
          title: activityTitle(kind, nativeType),
          status,
          detail: output ?? (current.detail || detail),
          command: command ?? current.command,
          cwd: cwd ?? current.cwd,
          durationMs: durationMs ?? current.durationMs,
          exitCode: exitCode ?? current.exitCode,
          time: event.createdAt,
          payload: item
        })
      )
      continue
    }

    if (event.eventType === 'file.change.updated') {
      const itemId = stringField(payload, 'itemId') ?? `event-${event.id}`
      upsert(
        `item:${itemId}`,
        () => activity({
          id: `item-${itemId}`,
          itemId,
          kind: 'file',
          title: '文件 Patch',
          status: 'running',
          detail: 'Patch 内容已更新',
          time: event.createdAt,
          payload
        }),
        (current) => ({ ...current, kind: 'file', title: '文件 Patch', time: event.createdAt, payload })
      )
      continue
    }

    if (event.eventType.startsWith('approval.')) {
      result.push(activity({
        id: `event-${event.id}`,
        itemId: null,
        kind: 'approval',
        title: event.eventType === 'approval.requested' ? '等待用户审批' : '审批已处理',
        status: event.eventType === 'approval.requested' ? 'waiting' : 'completed',
        detail: event.nativeMethod ?? '',
        time: event.createdAt,
        payload
      }))
      continue
    }

    if (event.eventType === 'runtime.log' || event.eventType === 'runtime.state' || event.eventType === 'turn.state') {
      const nativeStatus = stringField(payload, 'status') ?? stringField(payload, 'text') ?? ''
      result.push(activity({
        id: `event-${event.id}`,
        itemId: null,
        kind: 'runtime',
        title: event.eventType === 'turn.state' ? 'Turn 状态' : '执行引擎状态',
        status: activityStatus(nativeStatus, event.eventType),
        detail: nativeStatus,
        time: event.createdAt,
        payload
      }))
    }
  }

  return result.slice(-120)
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
    createdAt
  }
}

export function buildLiveExecutionProgress(
  events: LiveRuntimeEvent[],
  agentRunId: string
): LiveExecutionProgress {
  let reasoningSummary = ''
  const activeReasoningItemIds = new Set<string>()
  let anonymousReasoningStreaming = false
  const narrationByItem = new Map<string, string>()
  let planExplanation = ''
  let plan: ExecutionPlanStep[] = []
  const steps: ExecutionStep[] = []
  const stepIndexes = new Map<string, number>()

  const finishReasoningStream = (): void => {
    activeReasoningItemIds.clear()
    anonymousReasoningStreaming = false
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

    if (event.eventType === 'agent.reasoning.summary.delta') {
      reasoningSummary += stringField(payload, 'delta') ?? ''
      const itemId = stringField(payload, 'itemId')
      if (itemId) activeReasoningItemIds.add(itemId)
      else anonymousReasoningStreaming = true
      continue
    }
    if (event.eventType === 'agent.text.delta') {
      finishReasoningStream()
      const delta = stringField(payload, 'delta') ?? ''
      const itemId = stringField(payload, 'itemId') ?? event.id
      narrationByItem.set(itemId, `${narrationByItem.get(itemId) ?? ''}${delta}`)
      continue
    }
    if (event.eventType === 'agent.thought.delta') {
      reasoningSummary += stringField(payload, 'delta')
        ?? deepString(payload, ['content', 'text'])
        ?? stringField(payload, 'text')
        ?? ''
      const itemId = stringField(payload, 'itemId')
      if (itemId) activeReasoningItemIds.add(itemId)
      else anonymousReasoningStreaming = true
      continue
    }
    if (event.eventType === 'runtime.plan') {
      finishReasoningStream()
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
      finishReasoningStream()
      const delta = stringField(payload, 'delta') ?? ''
      if (delta) planExplanation += delta
      continue
    }

    if (event.eventType === 'activity.started' || event.eventType === 'activity.completed') {
      const item = asRecord(payload.item)
      const nativeType = stringField(item, 'type') ?? 'activity'
      if (nativeType === 'reasoning') {
        const itemId = stringField(item, 'id')
        if (event.eventType === 'activity.completed') {
          if (itemId) activeReasoningItemIds.delete(itemId)
          else anonymousReasoningStreaming = false
        } else if (itemId) {
          activeReasoningItemIds.add(itemId)
        } else {
          anonymousReasoningStreaming = true
        }
        if (!reasoningSummary.trim()) {
          const summary = item.summary
          if (Array.isArray(summary)) {
            reasoningSummary = summary.filter((value) => typeof value === 'string').join('\n')
          }
        }
        continue
      }
      finishReasoningStream()
      if (nativeType === 'agentMessage' || nativeType === 'userMessage' || nativeType === 'plan') continue
      const itemId = stringField(item, 'id') ?? event.id
      const kind = activityKind(nativeType)
      const nativeStatus = stringField(item, 'status')
      const title = activityTitle(kind, nativeType)
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
        status: activityStatus(nativeStatus, event.eventType)
      })
      continue
    }

    if (event.eventType === 'runtime.action') {
      finishReasoningStream()
      const itemId = stringField(payload, 'toolCallId') ?? event.id
      const title = stringField(payload, 'title') ?? runtimeActionTitle(stringField(payload, 'kind'))
      const nativeStatus = stringField(payload, 'status')
      upsertStep({
        id: itemId,
        title,
        detail: Object.prototype.hasOwnProperty.call(payload, 'output') && payload.output != null
          ? jsonPreview(payload.output)
          : Object.prototype.hasOwnProperty.call(payload, 'input') && payload.input != null
            ? jsonPreview(payload.input)
            : stringField(payload, 'kind') ?? '',
        status: activityStatus(nativeStatus, event.eventType)
      })
      continue
    }

    if (event.eventType === 'file.change.updated') {
      const itemId = stringField(payload, 'itemId') ?? event.id
      upsertStep({
        id: itemId,
        title: '文件变更',
        detail: 'Patch 内容已更新',
        status: 'running'
      })
    }
  }

  return {
    reasoningSummary: reasoningSummary.trim().slice(-4_000),
    reasoningStreaming: activeReasoningItemIds.size > 0 || anonymousReasoningStreaming,
    narration: [...narrationByItem.values()]
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(-4_000),
    planExplanation: planExplanation.trim().slice(-2_000),
    plan,
    steps: steps.slice(-12)
  }
}

export function summarizeApproval(approval: Approval): ApprovalSummary {
  const command = deepString(approval.request, ['command']) ?? deepString(approval.request, ['item', 'command'])
  const cwd = deepString(approval.request, ['cwd']) ?? deepString(approval.request, ['item', 'cwd'])
  const path = deepString(approval.request, ['path']) ?? deepString(approval.request, ['filePath'])
  const permissions = asRecord(approval.request.permissions)
  const type = approval.approvalType.toLowerCase()
  const isCommand = type.includes('command') || approval.approvalType === 'execCommandApproval'
  const isFile = type.includes('file') || approval.approvalType === 'applyPatchApproval'
  const isPermission = type.includes('permission')
  const capability = isCommand ? '执行终端命令' : isFile ? '修改文件' : isPermission ? '扩展执行引擎权限' : '调用受限能力'
  const scope = command
    ? [command, cwd ? `工作目录：${cwd}` : null].filter(Boolean).join('\n')
    : path ?? (Object.keys(permissions).length ? jsonPreview(permissions) : '完整范围见原始参数')

  return {
    title: isCommand ? '运行高风险命令' : isFile ? '应用文件变更' : isPermission ? '扩展执行引擎权限' : 'Codex 执行引擎请求',
    capability,
    scope,
    reason: approval.reason ?? 'Codex 请求执行超出当前自动授权范围的操作。',
    blockingImpact: '当前 Turn 已暂停；处理此请求前，Codex 不会继续执行。',
    allowOnceEffect: '只批准当前这一次请求，后续同类操作仍需再次确认。',
    allowSessionEffect: '在本次任务会话内批准同类请求，后续可能不再逐次询问。',
    declineEffect: '本次操作不会执行，Codex 可以根据拒绝结果调整方案。',
    cancelEffect: '本次操作不会执行，并立即停止当前 Turn。'
  }
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

export function taskStateSummary(
  status: TaskStatus,
  pendingApprovals: number,
  latestActivity?: ActivityItem,
  contextKind: 'lobby' | 'git' = 'git'
): string {
  if (pendingApprovals > 0) return `等待你处理 ${pendingApprovals} 个审批请求，当前 Turn 已暂停。`
  if (contextKind === 'lobby') {
    if (status === 'recovering') return '应用重启后发现未完成对话，等待你确认从结构化 Checkpoint 恢复。'
    if (status === 'failed') return '对话执行失败，已经保存的消息与审计记录仍然保留。'
    if (status === 'interrupted') return '当前 Turn 已停止，大厅对话记录保持不变。'
    if (status === 'completed') return '本轮对话已完成，可以继续追问或从大厅开始新对话。'
    if (status === 'draft') return '对话目标已保存，尚未启动 Codex 执行引擎。'
    if (status === 'preparing') return '正在准备大厅上下文和 Codex 执行引擎，不会读取用户项目。'
  }
  if (status === 'recovering') return '应用重启后发现未完成任务，项目变更已保留，等待确认恢复。'
  if (status === 'failed') return '任务执行失败，已完成的项目变更和审计记录仍然保留。'
  if (status === 'interrupted') return '当前 Turn 已停止，项目中的现有变更保持不变。'
  if (status === 'completed') return '任务已完成，请检查变更和审计证据后决定下一步。'
  if (status === 'pending') return 'Task 与首个 AgentRun 已原子受理，正在等待 Scheduler 认领。'
  if (status === 'in_progress') return latestActivity ? `AgentRun 正在执行；最近活动：${latestActivity.title}。` : '至少一个 AgentRun 已经开始执行。'
  if (status === 'draft') return '任务目标已保存，尚未启动 Codex 执行引擎。'
  if (status === 'preparing') return '正在准备项目上下文和 Codex 执行引擎。'
  if (status === 'running') return latestActivity ? `正在执行；最近活动：${latestActivity.title}。` : 'Codex 正在执行，活动证据即将出现。'
  return statusLabel(status)
}

export function activityStatusLabel(status: ActivityStatus): string {
  return ({ running: '进行中', completed: '已完成', failed: '失败', waiting: '等待处理', recorded: '已记录' } as const)[status]
}

export function activityIcon(kind: ActivityKind): string {
  return ({ command: '›_', file: '±', approval: '!', runtime: '◌', activity: '·' } as const)[kind]
}

export function formatDuration(milliseconds: number | null): string | null {
  if (milliseconds === null || milliseconds < 0) return null
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`
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
  return ({ draft: '待启动', pending: '已排队', preparing: '准备中', in_progress: '执行中', running: '执行中', waiting_approval: '等待审批', interrupted: '已中断', recovering: '待恢复', completed: '已完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[status] ?? status
}

export function eventActor(event: TimelineEvent): string {
  if (event.eventType === 'user.message') return '用户'
  if (event.eventType.startsWith('agent.')) return 'Agent'
  if (event.eventType.startsWith('approval.')) return '用户 / Tool Broker'
  if (event.eventType.startsWith('runtime.') || event.eventType.startsWith('turn.') || event.eventType.startsWith('activity.') || event.eventType.startsWith('command.')) return 'Codex 执行引擎'
  return 'Rovai-ai Core'
}

export function eventResult(event: TimelineEvent): string {
  const payload = asRecord(event.payload)
  return stringField(payload, 'status') ?? deepString(payload, ['item', 'status']) ?? (event.eventType.endsWith('.requested') ? '等待处理' : '已记录')
}

export function jsonPreview(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value)
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…（已截断）` : text
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
}

function activity(values: Partial<ActivityItem> & Pick<ActivityItem, 'id' | 'kind' | 'title' | 'status' | 'detail' | 'time'>): ActivityItem {
  return {
    itemId: null,
    command: null,
    cwd: null,
    durationMs: null,
    exitCode: null,
    ...values
  }
}

function activityKind(type: string): ActivityKind {
  const normalized = type.toLowerCase()
  if (normalized.includes('command')) return 'command'
  if (normalized.includes('file')) return 'file'
  return 'activity'
}

function activityTitle(kind: ActivityKind, nativeType: string): string {
  if (kind === 'command') return '命令执行'
  if (kind === 'file') return '文件变更'
  const labels: Record<string, string> = {
    mcpToolCall: 'MCP 调用',
    dynamicToolCall: '工具调用',
    webSearch: 'Web 搜索',
    imageGeneration: '生成图像',
    todoList: '计划',
    collabAgentToolCall: '协作调用'
  }
  return labels[nativeType] ?? nativeType
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

function runtimeActionTitle(kind: string | null): string {
  if (!kind) return '工具调用'
  const normalized = kind.toLowerCase()
  if (normalized.includes('terminal') || normalized.includes('command')) return '命令执行'
  if (normalized.includes('file') || normalized.includes('edit')) return '文件变更'
  if (normalized.includes('search')) return '搜索'
  return '工具调用'
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
