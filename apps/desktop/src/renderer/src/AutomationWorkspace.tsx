import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentProfile,
  AutomationListPage,
  AutomationNotifyChannel,
  AutomationProjectRef,
  AutomationSchedule,
  AutomationView,
  AutomationWeekday,
  ProjectNavigationGroup,
  StoredCommandResult
} from '@contracts'
import { readErrorMessage } from './error-message'

type AutomationDraft = {
  name: string
  prompt: string
  memberId: string
  projectRef: AutomationProjectRef
  schedule: AutomationSchedule
  notifyChannels: AutomationNotifyChannel[]
}

type TemplateId = 'issue-pr' | 'weekly-report' | 'release-notes'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'
type AutomationIssue = {
  kind: 'load' | 'save' | 'conflict' | 'action'
  message: string
}
export type AutomationLeaveGuard = () => Promise<boolean>

class AutomationCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const templates: Record<TemplateId, Pick<AutomationDraft, 'name' | 'prompt' | 'schedule'>> = {
  'issue-pr': {
    name: 'Issue / PR 巡检',
    prompt: '检查当前项目新增和更新的 Issue、PR，整理需要我关注的风险、阻塞和下一步行动。',
    schedule: { kind: 'weekdays', at: '09:00' }
  },
  'weekly-report': {
    name: '每周进展汇总',
    prompt: '汇总本周项目进展、已完成事项、未解决风险和下周优先事项，给出一份简洁周报。',
    schedule: { kind: 'weekly', weekday: 'friday', at: '17:30' }
  },
  'release-notes': {
    name: '发布说明整理',
    prompt: '根据当前项目的变更和提交记录，整理面向用户的发布说明，并标出需要人工确认的内容。',
    schedule: { kind: 'manual' }
  }
}

const weekdays: Array<{ value: AutomationWeekday; label: string }> = [
  { value: 'monday', label: '周一' },
  { value: 'tuesday', label: '周二' },
  { value: 'wednesday', label: '周三' },
  { value: 'thursday', label: '周四' },
  { value: 'friday', label: '周五' },
  { value: 'saturday', label: '周六' },
  { value: 'sunday', label: '周日' }
]

const scheduleKinds: Array<{ value: AutomationSchedule['kind']; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'once', label: '仅一次' },
  { value: 'cron', label: 'Cron' },
  { value: 'manual', label: '手动运行' }
]

function defaultDraft(memberId: string): AutomationDraft {
  return {
    name: '',
    prompt: '',
    memberId,
    projectRef: { kind: 'quick_chat' },
    schedule: { kind: 'daily', at: '09:00' },
    notifyChannels: []
  }
}

function draftFromAutomation(automation: AutomationView): AutomationDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    memberId: automation.memberId,
    projectRef: automation.projectRef,
    schedule: automation.schedule,
    notifyChannels: automation.notifyChannels
  }
}

function draftFingerprint(draft: AutomationDraft): string {
  return JSON.stringify(draft)
}

function automationFromResult(result: StoredCommandResult): AutomationView {
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

function resultCampId(automation: AutomationView | null): string | null {
  const run = automation?.lastRun
  return run?.status === 'completed' && run.resultMessageId && run.campId
    ? run.campId
    : null
}

function projectValue(project: AutomationProjectRef): string {
  return project.kind === 'quick_chat' ? 'quick-chat' : project.path
}

function projectFromValue(value: string): AutomationProjectRef {
  return value === 'quick-chat' ? { kind: 'quick_chat' } : { kind: 'directory', path: value }
}

function scheduleWithKind(kind: AutomationSchedule['kind']): AutomationSchedule {
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

function scheduleLabel(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case 'daily': return `每天 ${schedule.at}`
    case 'weekdays': return `工作日 ${schedule.at}`
    case 'weekly': return `${weekdays.find((day) => day.value === schedule.weekday)?.label ?? '每周'} ${schedule.at}`
    case 'once': return `${schedule.date} ${schedule.at}`
    case 'cron': return `Cron · ${schedule.expression}`
    case 'manual': return '手动运行'
  }
}

function dateTimeLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function runStatus(automation: AutomationView): { label: string; tone: string; detail: string | null } {
  const run = automation.lastRun
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

function AutomationGlyph({ name }: { name: 'clock' | 'play' | 'plus' | 'trash' | 'chat' }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === 'clock' && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3.4 2" /></>}
      {name === 'play' && <path d="m9 7 8 5-8 5Z" />}
      {name === 'plus' && <><path d="M12 5v14" /><path d="M5 12h14" /></>}
      {name === 'trash' && <><path d="M5 7h14" /><path d="m9 7 .6-2h4.8l.6 2" /><path d="m7.5 7 .7 12h7.6l.7-12" /></>}
      {name === 'chat' && <><path d="M5 5.5h14v10H9l-4 3Z" /><path d="M8.5 9h7" /><path d="M8.5 12h5" /></>}
    </svg>
  )
}

export function AutomationWorkspace({
  agents,
  projects,
  defaultMemberId,
  topNotices,
  onOpenCamp,
  onNotify,
  onLeaveGuardChange
}: {
  agents: AgentProfile[]
  projects: ProjectNavigationGroup[]
  defaultMemberId: string
  topNotices?: React.ReactNode
  onOpenCamp(campId: string): void
  onNotify(message: string): void
  onLeaveGuardChange?(guard: AutomationLeaveGuard | null): void
}): React.JSX.Element {
  const [automations, setAutomations] = useState<AutomationView[]>([])
  const automationsRef = useRef<AutomationView[]>([])
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const selectedIdRef = useRef(selectedId)
  const [draft, setDraft] = useState<AutomationDraft>(() => defaultDraft(defaultMemberId))
  const draftRef = useRef(draft)
  const savedFingerprints = useRef(new Map<string, string>())
  const savedVersions = useRef(new Map<string, number>())
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [issue, setIssue] = useState<AutomationIssue | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)

  selectedIdRef.current = selectedId
  draftRef.current = draft
  automationsRef.current = automations

  const selected = selectedId && selectedId !== 'new'
    ? automations.find((automation) => automation.automationId === selectedId) ?? null
    : null

  const refresh = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setLoadState('loading')
    try {
      const loaded: AutomationView[] = []
      const seenCursors = new Set<string>()
      let cursor: string | null = null
      for (;;) {
        const page: AutomationListPage = await window.rovai.request<AutomationListPage>('automations.list', {
          status: 'all', limit: 50, ...(cursor ? { cursor } : {})
        })
        loaded.push(...page.automations)
        if (!page.truncated) break
        if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
          throw new Error('任务列表分页状态无效，请重试。')
        }
        seenCursors.add(page.nextCursor)
        cursor = page.nextCursor
      }
      setAutomations(loaded)
      automationsRef.current = loaded

      const activeId = selectedIdRef.current
      if (activeId && activeId !== 'new') {
        const latest = loaded.find((automation) => automation.automationId === activeId)
        if (latest) {
          const savedFingerprint = savedFingerprints.current.get(activeId)
          const localFingerprint = draftFingerprint(draftRef.current)
          const localDirty = savedFingerprint !== undefined && savedFingerprint !== localFingerprint
          const savedVersion = savedVersions.current.get(activeId)
          if (localDirty && savedVersion !== undefined && savedVersion !== latest.version) {
            setSaveState('conflict')
            setIssue({
              kind: 'conflict',
              message: '任务已在其他位置更新。请重新载入，或确认用当前草稿覆盖最新内容。'
            })
          } else if (!localDirty) {
            const latestDraft = draftFromAutomation(latest)
            savedFingerprints.current.set(activeId, draftFingerprint(latestDraft))
            savedVersions.current.set(activeId, latest.version)
            setDraft(latestDraft)
            setSaveState('saved')
          }
        }
      }
      setSelectedId((current) => {
        if (current === 'new') return current
        if (current && loaded.some((automation) => automation.automationId === current)) return current
        return loaded[0]?.automationId ?? null
      })
      setLoadState('ready')
      setIssue((current) => current?.kind === 'load' ? null : current)
      return true
    } catch (nextError) {
      if (!quiet) {
        setLoadState('error')
        setIssue({ kind: 'load', message: readErrorMessage(nextError) })
      }
      return false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(true), 5_000)
    const unsubscribe = window.rovai.onEvent((event) => {
      if (event.method === 'automations.updated') void refresh(true)
    })
    return () => {
      window.clearInterval(interval)
      unsubscribe()
    }
  }, [refresh])

  useEffect(() => {
    setDeleteArmed(false)
    if (selectedId === 'new') {
      setDraft(defaultDraft(defaultMemberId))
      setSaveState('idle')
      setIssue((current) => current?.kind === 'save' || current?.kind === 'conflict' ? null : current)
      return
    }
    const automation = automationsRef.current.find((item) => item.automationId === selectedId)
    if (!automation) return
    const next = draftFromAutomation(automation)
    savedFingerprints.current.set(automation.automationId, draftFingerprint(next))
    savedVersions.current.set(automation.automationId, automation.version)
    setDraft(next)
    setSaveState('saved')
    setIssue((current) => current?.kind === 'save' || current?.kind === 'conflict' ? null : current)
  }, [defaultMemberId, selectedId])

  const replaceAutomation = useCallback((next: AutomationView): void => {
    savedVersions.current.set(next.automationId, next.version)
    setAutomations((current) => {
      const updated = current.some((item) => item.automationId === next.automationId)
        ? current.map((item) => item.automationId === next.automationId ? next : item)
        : [next, ...current]
      automationsRef.current = updated
      return updated
    })
  }, [])

  const queueSave = useCallback((automationId: string, snapshot: AutomationDraft): Promise<void> => {
    const fingerprint = draftFingerprint(snapshot)
    if (savedFingerprints.current.get(automationId) === fingerprint) return Promise.resolve()
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const current = automationsRef.current.find((item) => item.automationId === automationId)
      if (!current || savedFingerprints.current.get(automationId) === fingerprint) return
      if (selectedIdRef.current === automationId) {
        setSaveState('saving')
        setIssue((active) => active?.kind === 'save' || active?.kind === 'conflict' ? null : active)
      }
      try {
        const result = await window.rovai.request<StoredCommandResult>('automations.update', {
          commandId: crypto.randomUUID(),
          command: {
            automationId,
            expectedVersion: savedVersions.current.get(automationId) ?? current.version,
            name: snapshot.name,
            prompt: snapshot.prompt,
            memberId: snapshot.memberId,
            projectRef: snapshot.projectRef,
            schedule: snapshot.schedule,
            notifyChannels: snapshot.notifyChannels
          }
        })
        const updated = automationFromResult(result)
        const normalizedDraft = draftFromAutomation(updated)
        savedFingerprints.current.set(automationId, draftFingerprint(normalizedDraft))
        savedVersions.current.set(automationId, updated.version)
        replaceAutomation(updated)
        if (selectedIdRef.current === automationId && draftFingerprint(draftRef.current) === fingerprint) {
          draftRef.current = normalizedDraft
          setDraft(normalizedDraft)
          setSaveState('saved')
        }
      } catch (nextError) {
        if (selectedIdRef.current === automationId) {
          const conflict = nextError instanceof AutomationCommandError
            && nextError.code === 'command.version_conflict'
          setSaveState(conflict ? 'conflict' : 'failed')
          setIssue({
            kind: conflict ? 'conflict' : 'save',
            message: readErrorMessage(nextError)
          })
        }
        throw nextError
      }
    })
    return saveQueue.current
  }, [replaceAutomation])

  const flushBeforeLeave = useCallback(async (): Promise<boolean> => {
    const automationId = selectedIdRef.current
    if (!automationId || automationId === 'new') return true
    try {
      for (;;) {
        await saveQueue.current.catch(() => undefined)
        if (selectedIdRef.current !== automationId) return false
        const snapshot = draftRef.current
        if (savedFingerprints.current.get(automationId) === draftFingerprint(snapshot)) {
          return true
        }
        await queueSave(automationId, snapshot)
      }
    } catch {
      return false
    }
  }, [queueSave])

  useEffect(() => {
    onLeaveGuardChange?.(flushBeforeLeave)
    return () => onLeaveGuardChange?.(null)
  }, [flushBeforeLeave, onLeaveGuardChange])

  useEffect(() => {
    if (!selected || !draft.prompt.trim() || saveState === 'conflict') return undefined
    const fingerprint = draftFingerprint(draft)
    if (savedFingerprints.current.get(selected.automationId) === fingerprint) return undefined
    const timer = window.setTimeout(() => {
      void queueSave(selected.automationId, draft).catch(() => undefined)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, queueSave, saveState, selected])

  const choose = async (automationId: string): Promise<void> => {
    if (selected?.automationId === automationId) return
    if (selected && savedFingerprints.current.get(selected.automationId) !== draftFingerprint(draftRef.current)) {
      try {
        await queueSave(selected.automationId, draftRef.current)
      } catch {
        return
      }
    }
    setSelectedId(automationId)
  }

  const beginNew = async (): Promise<void> => {
    if (selected && savedFingerprints.current.get(selected.automationId) !== draftFingerprint(draftRef.current)) {
      try {
        await queueSave(selected.automationId, draftRef.current)
      } catch {
        return
      }
    }
    setSelectedId('new')
  }

  const flushSelectedDraft = useCallback(async (automationId: string): Promise<AutomationView | null> => {
    const snapshot = draftRef.current
    if (!snapshot.prompt.trim()) {
      setIssue({ kind: 'action', message: '请先填写交给队员的任务内容。' })
      return null
    }
    try {
      await queueSave(automationId, snapshot)
    } catch {
      return null
    }
    return automationsRef.current.find((item) => item.automationId === automationId) ?? null
  }, [queueSave])

  const retrySave = async (): Promise<void> => {
    if (!selected) return
    if (saveState === 'conflict') {
      const loaded = await refresh()
      if (!loaded) return
      const latest = automationsRef.current.find((item) => item.automationId === selected.automationId)
      if (!latest) return
      savedVersions.current.set(selected.automationId, latest.version)
    }
    try {
      await queueSave(selected.automationId, draftRef.current)
    } catch {
      // queueSave keeps the draft and publishes the actionable error state.
    }
  }

  const reloadSelected = async (): Promise<void> => {
    if (!selected) return
    const automationId = selected.automationId
    const loaded = await refresh()
    if (!loaded) return
    const latest = automationsRef.current.find((item) => item.automationId === automationId)
    if (!latest) return
    const latestDraft = draftFromAutomation(latest)
    savedFingerprints.current.set(automationId, draftFingerprint(latestDraft))
    savedVersions.current.set(automationId, latest.version)
    setDraft(latestDraft)
    setSaveState('saved')
    setIssue(null)
  }

  const create = async (): Promise<void> => {
    if (!draft.prompt.trim() || !draft.memberId) return
    setBusy('create')
    setIssue(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('automations.create', {
        commandId: crypto.randomUUID(), command: draft
      })
      const created = automationFromResult(result)
      replaceAutomation(created)
      const normalizedDraft = draftFromAutomation(created)
      savedFingerprints.current.set(created.automationId, draftFingerprint(normalizedDraft))
      setSelectedId(created.automationId)
      setDraft(normalizedDraft)
      onNotify('定时任务已创建')
    } catch (nextError) {
      setIssue({ kind: 'action', message: readErrorMessage(nextError) })
    } finally {
      setBusy(null)
    }
  }

  const runNow = async (): Promise<void> => {
    if (!selected) return
    const current = await flushSelectedDraft(selected.automationId)
    if (!current) return
    setBusy('run')
    setIssue(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('automations.run', {
        commandId: crypto.randomUUID(), command: { automationId: current.automationId }
      })
      if (result.status === 'rejected') throw new Error(String(result.payload.message ?? '任务未能开始。'))
      const status = String(result.payload.status ?? '')
      onNotify(status === 'skipped'
        ? '已有一次运行正在进行，本次已跳过'
        : status === 'failed' ? '任务未能开始，请查看运行状态' : '任务已开始运行')
      await refresh(true)
    } catch (nextError) {
      setIssue({ kind: 'action', message: readErrorMessage(nextError) })
    } finally {
      setBusy(null)
    }
  }

  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (!selected) return
    const current = await flushSelectedDraft(selected.automationId)
    if (!current) return
    setBusy('enabled')
    setIssue(null)
    try {
      const method = enabled ? 'automations.update' : 'automations.close'
      const command = enabled
        ? { automationId: current.automationId, expectedVersion: current.version, enabled: true }
        : { automationId: current.automationId, expectedVersion: current.version }
      const result = await window.rovai.request<StoredCommandResult>(method, {
        commandId: crypto.randomUUID(), command
      })
      const updated = automationFromResult(result)
      replaceAutomation(updated)
      onNotify(enabled ? '任务已重新开启' : '任务已关闭')
    } catch (nextError) {
      setIssue({ kind: 'action', message: readErrorMessage(nextError) })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    const current = await flushSelectedDraft(selected.automationId)
    if (!current) return
    setBusy('delete')
    setIssue(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('automations.delete', {
        commandId: crypto.randomUUID(),
        command: { automationId: current.automationId, expectedVersion: current.version }
      })
      if (result.status === 'rejected') throw new Error(String(result.payload.message ?? '任务删除失败。'))
      savedFingerprints.current.delete(selected.automationId)
      savedVersions.current.delete(selected.automationId)
      const next = automationsRef.current.filter((item) => item.automationId !== selected.automationId)
      setAutomations(next)
      automationsRef.current = next
      setSelectedId(next[0]?.automationId ?? null)
      onNotify('定时任务已删除')
    } catch (nextError) {
      setIssue({ kind: 'action', message: readErrorMessage(nextError) })
    } finally {
      setBusy(null)
      setDeleteArmed(false)
    }
  }

  const applyTemplate = (id: TemplateId): void => {
    const template = templates[id]
    setDraft((current) => ({ ...current, ...template }))
  }

  const changeScheduleKind = (kind: AutomationSchedule['kind']): void => {
    setDraft((current) => ({ ...current, schedule: scheduleWithKind(kind) }))
  }

  const status = selected ? runStatus(selected) : null
  const openResultCampId = resultCampId(selected)
  const presentAgents = agents.filter((agent) => agent.presence === 'present')
  const selectedDirty = selected
    ? savedFingerprints.current.get(selected.automationId) !== draftFingerprint(draft)
    : false
  const saveLabel = saveState === 'saving'
    ? '正在保存…'
    : saveState === 'failed'
      ? '保存失败'
      : saveState === 'conflict'
        ? '需要确认版本'
        : selectedDirty
          ? '等待自动保存…'
          : '已保存'

  return (
    <div className="automation-workspace">
      <header className="automation-page-header">
        <div>
          <h1>定时任务</h1>
          <p>让队员按计划在新对话中完成一项工作。</p>
        </div>
      </header>
      {topNotices}
      {issue && (
        <div className="automation-error" role="alert">
          <div><strong>操作未完成</strong><span>{issue.message}</span></div>
          <div className="automation-error-actions">
            {issue.kind === 'load' && <button type="button" className="quiet-button compact" onClick={() => void refresh()}>重试读取</button>}
            {issue.kind === 'save' && selected && <button type="button" className="quiet-button compact" onClick={() => void retrySave()}>重试保存</button>}
            {issue.kind === 'conflict' && selected && (
              <>
                <button type="button" className="quiet-button compact" onClick={() => void reloadSelected()}>重新载入</button>
                <button type="button" className="quiet-button compact" onClick={() => void retrySave()}>保留草稿并重试</button>
              </>
            )}
            {issue.kind === 'action' && <button type="button" className="quiet-button compact" onClick={() => setIssue(null)}>关闭</button>}
          </div>
        </div>
      )}
      <div className="automation-split">
        <aside className="automation-list" aria-label="定时任务列表">
          <div className="automation-list-heading">
            <div><strong>全部任务</strong><span>{automations.length}</span></div>
            <button className="quiet-button automation-list-new" type="button" onClick={() => void beginNew()}>
              <AutomationGlyph name="plus" />新建
            </button>
          </div>
          <div className="automation-list-scroll">
            {loadState === 'loading' && automations.length === 0 && <p className="automation-list-message">正在读取任务…</p>}
            {loadState === 'error' && automations.length === 0 && <p className="automation-list-message">任务列表暂时不可用。</p>}
            {loadState === 'ready' && automations.length === 0 && selectedId !== 'new' && (
              <div className="automation-list-empty">
                <AutomationGlyph name="clock" />
                <strong>还没有定时任务</strong>
                <span>创建后，Rovai 会在应用运行且电脑唤醒时准点触发。</span>
              </div>
            )}
            {automations.map((automation) => {
              const itemStatus = runStatus(automation)
              return (
                <button
                  key={automation.automationId}
                  type="button"
                  className={`automation-list-item ${selectedId === automation.automationId ? 'active' : ''}`}
                  onClick={() => void choose(automation.automationId)}
                  aria-current={selectedId === automation.automationId ? 'true' : undefined}
                >
                  <span className={`automation-state-dot ${automation.enabled ? 'enabled' : 'closed'}`} />
                  <span className="automation-list-copy">
                    <strong>{automation.name}</strong>
                    <small>{automation.enabled ? scheduleLabel(automation.schedule) : '已关闭'}</small>
                  </span>
                  <span className={`automation-run-chip ${itemStatus.tone}`}>{itemStatus.label}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="automation-editor" aria-label={selectedId === 'new' ? '新建定时任务' : '定时任务详情'}>
          {!selectedId && (
            <div className="automation-editor-empty">
              <AutomationGlyph name="clock" />
              <h2>安排下一项例行工作</h2>
              <p>选择左侧任务查看详情，或从一个空白任务开始。</p>
              <button className="primary-button" type="button" onClick={() => void beginNew()}>新建任务</button>
            </div>
          )}
          {selectedId && (
            <>
              <div className="automation-editor-toolbar">
                <div>
                  <span className={`automation-state-label ${selectedId === 'new' ? 'new' : selected?.enabled === false ? 'closed' : 'enabled'}`}>
                    {selectedId === 'new' ? '新任务' : selected?.enabled ? '已开启' : '已关闭'}
                  </span>
                  {selected && <small>{saveLabel}</small>}
                </div>
                <div className="automation-editor-actions">
                  {openResultCampId && (
                    <button className="quiet-button" type="button" onClick={() => onOpenCamp(openResultCampId)}>
                      <AutomationGlyph name="chat" />查看最近对话
                    </button>
                  )}
                  {selected && (
                    <button className="quiet-button" type="button" onClick={() => void runNow()} disabled={!selected.enabled || busy !== null}>
                      <AutomationGlyph name="play" />{busy === 'run' ? '正在开始…' : '立即运行'}
                    </button>
                  )}
                </div>
              </div>

              <div className="automation-editor-scroll">
                <div className="automation-form">
                  <label className="automation-field automation-field-name">
                    <span>任务名称</span>
                    <input value={draft.name} maxLength={80} placeholder="留空时从任务内容自动生成" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                  </label>
                  <label className="automation-field automation-field-prompt">
                    <span>交给队员的任务</span>
                    <textarea value={draft.prompt} rows={7} placeholder="清楚说明希望队员完成什么，以及最终需要返回什么。" onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} />
                    <small>每次触发都会创建一个新对话，只执行这份已保存的内容。</small>
                  </label>

                  {selectedId === 'new' && (
                    <div className="automation-template-row">
                      <span>从模板开始</span>
                      <div>
                        <button type="button" onClick={() => applyTemplate('issue-pr')}>Issue / PR 巡检</button>
                        <button type="button" onClick={() => applyTemplate('weekly-report')}>每周进展</button>
                        <button type="button" onClick={() => applyTemplate('release-notes')}>发布说明</button>
                      </div>
                    </div>
                  )}

                  <div className="automation-form-grid">
                    <label className="automation-field">
                      <span>执行队员</span>
                      <select value={draft.memberId} onChange={(event) => setDraft((current) => ({ ...current, memberId: event.target.value }))}>
                        {presentAgents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.displayName}</option>)}
                      </select>
                    </label>
                    <label className="automation-field">
                      <span>项目</span>
                      <select value={projectValue(draft.projectRef)} onChange={(event) => setDraft((current) => ({ ...current, projectRef: projectFromValue(event.target.value) }))}>
                        <option value="quick-chat">快速对话</option>
                        {projects.map((project) => <option key={project.projectKey} value={project.projectPath}>{project.name}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="automation-schedule-panel">
                    <div className="automation-section-heading">
                      <div><strong>运行计划</strong><span>按这台设备的本地时区计算</span></div>
                      {selected?.nextRunAt && <time dateTime={selected.nextRunAt}>下次 {dateTimeLabel(selected.nextRunAt)}</time>}
                    </div>
                    <div className="automation-schedule-controls">
                      <label className="automation-field">
                        <span>重复</span>
                        <select value={draft.schedule.kind} onChange={(event) => changeScheduleKind(event.target.value as AutomationSchedule['kind'])}>
                          {scheduleKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                        </select>
                      </label>
                      {draft.schedule.kind === 'weekly' && (
                        <label className="automation-field"><span>星期</span><select value={draft.schedule.weekday} onChange={(event) => setDraft((current) => ({ ...current, schedule: { kind: 'weekly', weekday: event.target.value as AutomationWeekday, at: current.schedule.kind === 'weekly' ? current.schedule.at : '09:00' } }))}>{weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
                      )}
                      {draft.schedule.kind === 'once' && (
                        <label className="automation-field"><span>日期</span><input type="date" value={draft.schedule.date} onChange={(event) => setDraft((current) => ({ ...current, schedule: { kind: 'once', date: event.target.value, at: current.schedule.kind === 'once' ? current.schedule.at : '09:00' } }))} /></label>
                      )}
                      {['daily', 'weekdays', 'weekly', 'once'].includes(draft.schedule.kind) && (
                        <label className="automation-field"><span>时间</span><input type="time" value={'at' in draft.schedule ? draft.schedule.at : '09:00'} onChange={(event) => setDraft((current) => ({ ...current, schedule: 'at' in current.schedule ? { ...current.schedule, at: event.target.value } : current.schedule }))} /></label>
                      )}
                      {draft.schedule.kind === 'cron' && (
                        <label className="automation-field automation-cron-field"><span>5 段 Cron 表达式</span><input value={draft.schedule.expression} spellCheck={false} onChange={(event) => setDraft((current) => ({ ...current, schedule: { kind: 'cron', expression: event.target.value } }))} /></label>
                      )}
                    </div>
                  </div>

                  <fieldset className="automation-notify-panel">
                    <legend>完成后通知</legend>
                    <p>通过所选队员当前绑定的渠道 Bot 私聊发送给你。通知失败不会重跑任务。</p>
                    <div>
                      {(['feishu', 'dingtalk'] as const).map((channel) => (
                        <label key={channel}>
                          <input
                            type="checkbox"
                            checked={draft.notifyChannels.includes(channel)}
                            onChange={(event) => setDraft((current) => ({
                              ...current,
                              notifyChannels: event.target.checked
                                ? [...new Set([...current.notifyChannels, channel])]
                                : current.notifyChannels.filter((item) => item !== channel)
                            }))}
                          />
                          <span>{channel === 'feishu' ? '飞书' : '钉钉'}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {selected && status && (
                    <section className="automation-last-run" aria-label="最近一次运行">
                      <div>
                        <span className={`automation-status-mark ${status.tone}`} />
                        <div><strong>{status.label}</strong><span>{dateTimeLabel(selected.lastRun?.createdAt ?? null)}{status.detail ? ` · ${status.detail}` : ''}</span></div>
                      </div>
                      {openResultCampId && <button type="button" onClick={() => onOpenCamp(openResultCampId)}>打开结果</button>}
                    </section>
                  )}
                </div>
              </div>

              <footer className="automation-editor-footer">
                {selectedId === 'new'
                  ? <><span>创建后任务立即开启</span><button className="primary-button" type="button" disabled={!draft.prompt.trim() || !draft.memberId || busy !== null} onClick={() => void create()}>{busy === 'create' ? '正在创建…' : '创建任务'}</button></>
                  : <>
                      <button className={`danger-text-button ${deleteArmed ? 'armed' : ''}`} type="button" disabled={busy !== null} onClick={() => void remove()}><AutomationGlyph name="trash" />{deleteArmed ? '再次点击确认删除' : '删除任务'}</button>
                      <button className="quiet-button" type="button" disabled={busy !== null} onClick={() => void setEnabled(!selected?.enabled)}>{selected?.enabled ? '关闭任务' : '重新开启'}</button>
                    </>}
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
