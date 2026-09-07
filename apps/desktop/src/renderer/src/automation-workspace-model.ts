import type { AutomationNotifyChannel, AutomationProjectRef, AutomationRunSummary, AutomationSchedule, AutomationView, AutomationWeekday, StoredCommandResult } from '@contracts'

export type AutomationDraft = {
  name: string
  prompt: string
  memberId: string
  projectRef: AutomationProjectRef
  schedule: AutomationSchedule
  notifyChannels: AutomationNotifyChannel[]
}

export type TemplateId = 'issue-pr' | 'weekly-report' | 'release-notes'
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'
export type AutomationIssue = {
  kind: 'load' | 'save' | 'conflict' | 'action'
  message: string
}

export class AutomationCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export const templates: Record<TemplateId, Pick<AutomationDraft, 'name' | 'prompt' | 'schedule'> & { description: string; icon: 'code' | 'calendar' | 'document' }> = {
  'issue-pr': {
    name: 'Issue / PR 巡检',
    description: '检查新增或更新的 Issue、PR 与评审进展，整理需要关注的事项。',
    icon: 'code',
    prompt: '检查当前项目新增和更新的 Issue、PR，整理需要我关注的风险、阻塞和下一步行动。',
    schedule: { kind: 'daily', at: '09:00' }
  },
  'weekly-report': {
    name: '每周周报总结',
    description: '汇总一周完成事项、进展与阻塞，生成可直接分享的周报。',
    icon: 'calendar',
    prompt: '汇总本周项目进展、已完成事项、未解决风险和下周优先事项，给出一份简洁周报。',
    schedule: { kind: 'weekly', weekday: 'friday', at: '17:30' }
  },
  'release-notes': {
    name: '新版更新说明',
    description: '读取近期完成的改动，整理成面向用户的简洁版本更新说明。',
    icon: 'document',
    prompt: '根据当前项目的变更和提交记录，整理面向用户的发布说明，并标出需要人工确认的内容。',
    schedule: { kind: 'manual' }
  }
}

export const weekdays: Array<{ value: AutomationWeekday; label: string }> = [
  { value: 'monday', label: '周一' },
  { value: 'tuesday', label: '周二' },
  { value: 'wednesday', label: '周三' },
  { value: 'thursday', label: '周四' },
  { value: 'friday', label: '周五' },
  { value: 'saturday', label: '周六' },
  { value: 'sunday', label: '周日' }
]

export const scheduleKinds: Array<{ value: AutomationSchedule['kind']; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'once', label: '仅一次' },
  { value: 'cron', label: '自定义' },
  { value: 'manual', label: '手动触发' }
]

export function defaultDraft(memberId: string): AutomationDraft {
  return {
    name: '',
    prompt: '',
    memberId,
    projectRef: { kind: 'quick_chat' },
    schedule: { kind: 'daily', at: '09:00' },
    notifyChannels: []
  }
}

export function draftFromAutomation(automation: AutomationView): AutomationDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    memberId: automation.memberId,
    projectRef: automation.projectRef,
    schedule: automation.schedule,
    notifyChannels: automation.notifyChannels
  }
}

export function draftFingerprint(draft: AutomationDraft): string {
  return JSON.stringify(draft)
}

export function automationFromResult(result: StoredCommandResult): AutomationView {
  if (result.status === 'rejected') {
    const message = typeof result.payload.message === 'string'
      ? result.payload.message
      : result.code === 'command.version_conflict'
        ? '任务已在其他位置更新。请选择重新载入，或确认保留当前草稿后重试。'
        : '任务保存失败，请重试。'
    throw new AutomationCommandError(result.code, message)
  }
  return result.payload as unknown as AutomationView
}

export function projectValue(project: AutomationProjectRef): string {
  return project.kind === 'quick_chat' ? 'quick-chat' : project.path
}

export function projectFromValue(value: string): AutomationProjectRef {
  return value === 'quick-chat' ? { kind: 'quick_chat' } : { kind: 'directory', path: value }
}

export function scheduleWithKind(kind: AutomationSchedule['kind']): AutomationSchedule {
  switch (kind) {
    case 'daily': return { kind, at: '09:00' }
    case 'weekdays': return { kind, at: '09:00' }
    case 'weekly': return { kind, weekday: 'monday', at: '09:00' }
    case 'once': {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const date = [
        tomorrow.getFullYear(),
        String(tomorrow.getMonth() + 1).padStart(2, '0'),
        String(tomorrow.getDate()).padStart(2, '0')
      ].join('-')
      return { kind, date, at: '09:00' }
    }
    case 'cron': return { kind, expression: '0 9 * * 1-5' }
    case 'manual': return { kind }
  }
}

export function scheduleLabel(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case 'daily': return `每天 ${schedule.at}`
    case 'weekdays': return `工作日 ${schedule.at}`
    case 'weekly': return `每${weekdays.find((day) => day.value === schedule.weekday)?.label ?? '每周'} ${schedule.at}`
    case 'once': return `${schedule.date} ${schedule.at}`
    case 'cron': return `Cron · ${schedule.expression}`
    case 'manual': return '手动触发'
  }
}

export function dateTimeLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

export function runStatus(run: AutomationRunSummary | null): { label: string; tone: string; detail: string | null } {
  if (!run) return { label: '尚未运行', tone: 'idle', detail: null }
  if (run.status === 'completed' && ['failed', 'partial'].includes(run.notificationStatus)) {
    return { label: '运行成功 · 通知失败', tone: 'attention', detail: '任务结果已保留，可在运行对话中查看。' }
  }
  if (run.status === 'completed') return { label: '运行成功', tone: 'success', detail: null }
  if (run.status === 'running') return { label: '运行中', tone: 'running', detail: null }
  if (run.status === 'cancelling') return { label: '正在停止', tone: 'attention', detail: null }
  if (run.status === 'skipped') {
    return {
      label: '已跳过',
      tone: 'idle',
      detail: run.reason === 'overlap' ? '到点时上一次运行尚未结束。' : '应用退出或电脑休眠期间错过了触发时间。'
    }
  }
  const reasons: Record<string, string> = {
    interaction_required: '运行需要用户输入或权限审批，已停止。',
    timeout: '运行超过后台时限，已停止。',
    interrupted: '应用退出中断了本次运行。',
    no_result: '运行结束，但没有发布公共结果。',
    runtime_not_ready: '所选队员的 Runtime 当前不可用。',
    execution_failed: '运行对话执行失败。'
  }
  return { label: '运行失败', tone: 'danger', detail: run.reason ? reasons[run.reason] ?? run.reason : null }
}

export type AutomationFilter = 'all' | 'enabled' | 'closed'

export function filterAutomations(automations: AutomationView[], filter: AutomationFilter, query: string): AutomationView[] {
  const needle = query.trim().toLocaleLowerCase()
  return automations.filter((item) => (filter === 'all' || item.enabled === (filter === 'enabled'))
    && (!needle || [item.name, item.prompt, scheduleLabel(item.schedule)].some((value) => value.toLocaleLowerCase().includes(needle))))
}

export const AUTOMATION_MIN_LIST_WIDTH = 208

export function automationListWidth(requested: number, available: number): number {
  return Math.round(Math.max(AUTOMATION_MIN_LIST_WIDTH, Math.min(requested, available - 327)))
}
