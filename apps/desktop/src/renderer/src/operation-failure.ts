import { readErrorMessage } from './error-message'
import { uiAttribute } from './interface-language'

type FailureKind = 'rejection' | 'connection' | 'local' | 'unknown'

export interface NormalizedFailure {
  code: string | null
  kind: FailureKind
  retryable: boolean
  raw: string
}

export class OperationFailure extends Error {
  constructor(readonly failure: NormalizedFailure) {
    super('Operation failed')
  }
}

const connectionCopy: ReadonlyMap<string, () => string> = new Map([
  ['core_request_timeout', () => uiAttribute('Rovai 暂时没有响应，请重试。')],
  ['full_core_shutting_down', () => uiAttribute('Rovai 正在退出。')],
  ['shutdown', () => uiAttribute('Rovai 正在退出。')],
  ['full_core_unavailable', () => uiAttribute('Rovai 还在启动，请稍后重试。')],
  ['full_core_startup_refused', () => uiAttribute('Rovai 还在启动，请稍后重试。')]
])
const connectionCodes = new Set([
  ...connectionCopy.keys(), 'core_process_exited', 'core_process_error', 'core_request_write_failed', 'core_request_failed'
])
const bareCode = /^[a-z_]+(?:\.[a-z_]+)*$/

export function normalizeFailure(value: unknown): NormalizedFailure {
  if (value instanceof OperationFailure) return value.failure
  if (value && typeof value === 'object') {
    const code = 'code' in value && typeof value.code === 'string' ? value.code : null
    const raw = readErrorMessage(value, '')
    const retryable = 'retryable' in value && value.retryable === true
    const kind = 'kind' in value ? value.kind : null
    if ('status' in value && value.status === 'rejected') {
      return {
        code, kind: 'rejection', retryable,
        raw: 'payload' in value ? readErrorMessage(value.payload, '') : raw
      }
    }
    if (kind === 'domain_rejection' || code === 'request_failed') {
      return { code: bareCode.test(raw) ? raw : code, kind: 'rejection', retryable, raw }
    }
    if (kind === 'infrastructure_failure' || kind === 'full_core_unavailable' || kind === 'shutdown' || (code && connectionCodes.has(code))) {
      return { code, kind: 'connection', retryable, raw }
    }
    if (code) return { code, kind: 'rejection', retryable, raw }
    if (raw || value instanceof Error) return { code: null, kind: 'local', retryable, raw }
  }
  return { code: null, kind: 'unknown', retryable: false, raw: readErrorMessage(value) }
}

const operationNames = {
  'run.stop': () => uiAttribute('停止'),
  'thread.open': () => uiAttribute('打开会话'),
  'thread.refresh': () => uiAttribute('刷新会话'),
  'thread.rename': () => uiAttribute('重命名对话'),
  'thread.delete': () => uiAttribute('删除对话'),
  'thread.member.remove': () => uiAttribute('移出队员'),
  'thread.lead.change': () => uiAttribute('更换默认队长'),
  'approval.resolve': () => uiAttribute('提交审批'),
  'overview.read': () => uiAttribute('刷新状态'),
  'members.read': () => uiAttribute('读取队员'),
  'runtime.read': () => uiAttribute('读取智能体'),
  'navigation.read': () => uiAttribute('读取会话列表'),
  'navigation.pins.read': () => uiAttribute('读取置顶'),
  'navigation.pin': () => uiAttribute('更新置顶'),
  'navigation.action': () => uiAttribute('更新侧栏'),
  'preferences.read': () => uiAttribute('读取设置'),
  'preferences.save': () => uiAttribute('保存设置'),
  'appearance.read': () => uiAttribute('读取外观设置'),
  'composer.leave': () => uiAttribute('保存当前会话输入'),
  'app.quit': () => uiAttribute('退出应用'),
  'core.recover': () => uiAttribute('恢复后台服务'),
  'updates.open': () => uiAttribute('打开更新内容'),
  'automation.save': () => uiAttribute('保存定时任务')
}

export type OperationId = keyof typeof operationNames

export interface FailureFeedback {
  message: string
  tone: 'danger' | 'neutral'
  outcome: 'failed' | 'stale' | 'gone' | 'resolved' | 'connection'
}

interface FailureFeedbackOptions {
  subject?: string
  presentation?: 'standalone' | 'detail'
}

const failed = (message: string): FailureFeedback => ({ message, tone: 'danger', outcome: 'failed' })
const changed = (message: string, outcome: 'stale' | 'gone' | 'resolved'): FailureFeedback =>
  ({ message, tone: 'neutral', outcome })

const sharedCopy: ReadonlyMap<string, () => string> = new Map([
  ['team.conflict', () => uiAttribute('团队已更改或不可用，请重新选择。')],
  ['team.unavailable', () => uiAttribute('团队已更改或不可用，请重新选择。')],
  ['reply_recipient_required', () => uiAttribute('原作者当前不可接收，请选择其他成员。')],
  ['mention_target_unavailable', () => uiAttribute('消息未发送：一位收件人当前不可接收，请重新选择。')],
  ['camp_message.invalid_reply', () => uiAttribute('消息未发送：引用的消息当前不可用。请取消引用后重试。')],
  ['camp_message.no_addressable_member', () => uiAttribute('当前无可用队员。')],
  ['camp.default_lead_invariant', () => uiAttribute('当前无可用队员。')],
  ['camp.no_present_members', () => uiAttribute('当前无可用队员。')],
  ['agent_run.runtime_not_ready', () => uiAttribute('目标队员的智能体暂不可用。')],
  ['camp.membership_generation_conflict', () => uiAttribute('名册已发生变化。请重新读取最新状态后再试。')],
  ['camp.membership_version_conflict', () => uiAttribute('名册已发生变化。请重新读取最新状态后再试。')],
  ['camp.member_not_found', () => uiAttribute('名册已发生变化。请重新读取最新状态后再试。')],
  ['camp.member_not_active', () => uiAttribute('名册已发生变化。请重新读取最新状态后再试。')]
])

const threadActionRejectionCopy: ReadonlyMap<string, () => string> = new Map([
  ['camp.name_too_long', () => uiAttribute('对话名称最多 80 个字符。')],
  ['camp.rename_user_required', () => uiAttribute('只有用户可以重命名对话。')],
  ['mission.use_mission_update', () => uiAttribute('请在使命页面修改名称。')],
  ['camp.pending_activation_required', () => uiAttribute('请发送第一条消息后再重命名。')],
  ['camp.delete_user_required', () => uiAttribute('只有用户可以删除对话。')],
  ['camp.deletion_retry_user_required', () => uiAttribute('只有用户可以重试删除。')],
  ['camp.workspace_cleanup_pending', () => uiAttribute('工作区正在清理，请稍后重试。')]
])

export function sharedRejectionMessage(code: string | null): string | undefined {
  return code ? sharedCopy.get(code)?.() : undefined
}

export function operationFailureTitle(operation: OperationId): string {
  return uiAttribute('{0}未完成', operationNames[operation]())
}

export function failureFeedback(
  operation: OperationId,
  failure: NormalizedFailure,
  { subject, presentation = 'standalone' }: FailureFeedbackOptions = {}
): FailureFeedback {
  const { code, kind } = failure
  if (operation === 'run.stop') {
    if (code === 'command.version_conflict') return changed(uiAttribute('执行状态刚刚更新，请再点一次停止。'), 'stale')
    if (code === 'agent_run.turn_cancellation_in_progress') return changed(uiAttribute('正在停止…'), 'resolved')
  }
  if (operation === 'thread.open' && kind === 'connection' && code === 'core_request_timeout' && subject && presentation === 'standalone') {
    return { message: uiAttribute('没能打开「{0}」，Rovai 暂时没有响应。', subject), tone: 'danger', outcome: 'connection' }
  }
  if ((operation === 'thread.rename' || operation === 'thread.delete') && kind === 'rejection' && code) {
    if (code === 'camp.not_found') return changed(uiAttribute('这个会话已被删除。'), 'gone')
    if (code === 'camp.deletion_in_progress') return changed(uiAttribute('对话正在删除。'), 'gone')
    if (code === 'camp.deletion_not_found') return changed(uiAttribute('找不到这次删除的记录。'), 'gone')
    const reason = threadActionRejectionCopy.get(code)?.()
    if (reason) return failed(reason)
  }
  if (operation === 'thread.lead.change' && code === 'camp.default_lead_unavailable') {
    return changed(uiAttribute('{0}已不在当前会话，队长没有更换。', subject ?? uiAttribute('该队员')), 'gone')
  }
  if (operation === 'thread.member.remove' && code === 'command.capability_denied') {
    return failed(uiAttribute('你没有权限从当前会话移出队员。'))
  }
  if (operation === 'approval.resolve') {
    if (code === 'approval.not_pending') return changed(uiAttribute('这条审批已在其他地方处理，无需再次提交。'), 'resolved')
    if (code === 'approval.expired') return changed(uiAttribute('这条审批已过期。'), 'resolved')
    if (code === 'approval.resolution_fenced' || code === 'approval.agent_run_effects_fenced') {
      return changed(uiAttribute('执行已停止，这条审批不再需要处理。'), 'resolved')
    }
    if (kind === 'connection') return { message: uiAttribute('提交失败，内容已保留'), tone: 'danger', outcome: 'connection' }
  }

  const shared = sharedRejectionMessage(code)
  if (shared) return failed(shared)
  if (kind === 'connection') {
    const reason = (code && connectionCopy.get(code)?.()) || uiAttribute('Rovai 后台暂时不可用，请稍后重试。')
    return {
      message: operation === 'thread.open' && subject && presentation === 'standalone'
        ? uiAttribute('没能打开「{0}」。{1}', subject, reason)
        : reason,
      tone: 'danger',
      outcome: 'connection'
    }
  }
  if (code?.endsWith('version_conflict') || code?.endsWith('generation_conflict') || code?.endsWith('_changed')) {
    return changed(uiAttribute('内容刚刚有变化，请再试一次。'), 'stale')
  }
  if (code?.endsWith('.not_found') && subject) return changed(uiAttribute('「{0}」已不存在。', subject), 'gone')
  return failed(presentation === 'detail'
    ? uiAttribute('请重试。')
    : uiAttribute('{0}未完成，请重试。', operationNames[operation]()))
}

export function reportOperationFailure(operation: OperationId, error: unknown, options?: FailureFeedbackOptions): FailureFeedback {
  const failure = normalizeFailure(error)
  console.warn('[operation-failure]', operation, failure.code, failure.raw)
  return failureFeedback(operation, failure, options)
}

/** Only call with reads. A failed mutation must be resolved by its receipt owner. */
export async function retryRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch {
    return read()
  }
}
