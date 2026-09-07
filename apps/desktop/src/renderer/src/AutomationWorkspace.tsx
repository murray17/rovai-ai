import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AgentProfile,
  AutomationListPage,
  AutomationView,
  ProjectNavigationGroup,
  StoredCommandResult
} from '@contracts'
import { readErrorMessage } from './error-message'
import { MemberAvatar } from './MemberAvatar'
import { AutomationEditor } from './AutomationEditor'
import { automationScheduleError } from './automation-schedule-validation'
import { AutomationGlyph, AutomationTemplates } from './AutomationControls'
import {
  AUTOMATION_DEFAULT_LIST_WIDTH, AUTOMATION_MIN_LIST_WIDTH, AutomationCommandError, automationFromResult, automationListWidth, defaultDraft,
  draftFingerprint, draftFromAutomation, filterAutomations, scheduleLabel, templates,
  type AutomationDraft, type AutomationFilter, type AutomationIssue, type SaveState, type TemplateId
} from './automation-workspace-model'


export type AutomationLeaveGuard = () => Promise<boolean>

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
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const [filter, setFilter] = useState<AutomationFilter>('all')
  const [query, setQuery] = useState('')
  const [listWidth, setListWidth] = useState(AUTOMATION_DEFAULT_LIST_WIDTH)
  const [editorClosed, setEditorClosed] = useState(false)
  const [availableWidth, setAvailableWidth] = useState(1100)
  const splitRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const overviewRef = useRef<HTMLHeadingElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState

  useEffect(() => {
    const element = splitRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

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
        return null
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
    setDeleteArmed(null)
    if (selectedId === 'new') {
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
  }, [selectedId])

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
    const validation = automationScheduleError(snapshot.schedule)
    if (validation) return Promise.reject(new Error(validation))
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
    if (saveStateRef.current === 'conflict') return false
    try {
      for (;;) {
        await saveQueue.current.catch(() => undefined)
        if (selectedIdRef.current !== automationId) return false
        const snapshot = draftRef.current
        if (automationScheduleError(snapshot.schedule)) return false
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
    if (!selected || !draft.prompt.trim() || automationScheduleError(draft.schedule) || saveState === 'conflict' || saveState === 'failed') return undefined
    const fingerprint = draftFingerprint(draft)
    if (savedFingerprints.current.get(selected.automationId) === fingerprint) return undefined
    const timer = window.setTimeout(() => {
      void queueSave(selected.automationId, draft).catch(() => undefined)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, queueSave, saveState, selected])

  const choose = async (automationId: string): Promise<void> => {
    if (!(await flushBeforeLeave())) return
    setSelectedId(automationId)
    setEditorClosed(false)
  }

  const showOverview = async (): Promise<void> => {
    if (!(await flushBeforeLeave())) return
    setSelectedId(null)
    setEditorClosed(false)
    requestAnimationFrame(() => overviewRef.current?.focus())
  }

  const beginNew = async (templateId?: TemplateId): Promise<void> => {
    if (!(await flushBeforeLeave())) return
    const context = selectedIdRef.current === 'new' ? draftRef.current : defaultDraft(defaultMemberId)
    const template = templateId ? templates[templateId] : null
    const next = { ...context, name: template?.name ?? '', prompt: template?.prompt ?? '', schedule: template?.schedule ?? context.schedule }
    draftRef.current = next
    setDraft(next)
    setSelectedId('new')
    setSaveState('idle')
    setIssue(null)
    setEditorClosed(false)
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const prepareAction = async (automationId: string): Promise<AutomationView | null> => {
    if (!(await flushBeforeLeave())) return null
    return automationsRef.current.find((item) => item.automationId === automationId) ?? null
  }

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
    if (!draft.prompt.trim() || !draft.memberId || automationScheduleError(draft.schedule)) return
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
      onNotify('定时任务已保存')
    } catch (nextError) {
      setIssue({ kind: 'action', message: readErrorMessage(nextError) })
    } finally {
      setBusy(null)
    }
  }

  const runNow = async (automationId: string): Promise<void> => {
    const current = await prepareAction(automationId)
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

  const setEnabled = async (automationId: string, enabled: boolean): Promise<void> => {
    const current = await prepareAction(automationId)
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

  const remove = async (automationId: string): Promise<void> => {
    const current = await prepareAction(automationId)
    if (!current) return
    setBusy('delete')
    setIssue(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('automations.delete', {
        commandId: crypto.randomUUID(),
        command: { automationId: current.automationId, expectedVersion: current.version }
      })
      if (result.status === 'rejected') throw new Error(String(result.payload.message ?? '任务删除失败。'))
      savedFingerprints.current.delete(automationId)
      savedVersions.current.delete(automationId)
      const next = automationsRef.current.filter((item) => item.automationId !== automationId)
      setAutomations(next)
      automationsRef.current = next
      if (selectedIdRef.current === automationId) setSelectedId(null)
      onNotify('定时任务已删除')
    } catch (nextError) {
      setIssue({ kind: 'action', message: readErrorMessage(nextError) })
    } finally {
      setBusy(null)
      setDeleteArmed(null)
    }
  }

  const selectedDirty = selected
    ? savedFingerprints.current.get(selected.automationId) !== draftFingerprint(draft)
    : false
  const saveLabel = automationScheduleError(draft.schedule) ? '未保存，请修正运行时间' : saveState === 'saving'
    ? '正在保存…'
    : saveState === 'failed'
      ? '保存失败'
      : saveState === 'conflict'
        ? '需要确认版本'
        : selectedDirty
          ? '等待自动保存…'
          : '已保存'

  const overview = selectedId === null
  const width = automationListWidth(listWidth, availableWidth)
  const visibleAutomations = useMemo(() => filterAutomations(automations, filter, query), [automations, filter, query])
  const closeEditor = async (): Promise<void> => {
    if (await flushBeforeLeave()) setEditorClosed(true)
  }
  const resize = (requested: number): void => {
    if (requested > availableWidth - 295) {
      void closeEditor()
    } else {
      setEditorClosed(false)
      setListWidth(automationListWidth(requested, availableWidth))
    }
  }

  return (
    <div className={`automation-workspace ${overview ? 'overview' : 'detail'} ${editorClosed ? 'editor-closed' : ''}`}>
      {topNotices}
      {issue && (
        <div className="automation-error" role="alert">
          <div><strong>操作未完成</strong><span>{issue.message}</span></div>
          <div className="automation-error-actions">
            {issue.kind === 'load' && <button type="button" className="quiet-button compact" onClick={() => void refresh()}>重试读取</button>}
            {issue.kind === 'save' && selected && <button type="button" className="quiet-button compact" onClick={() => void retrySave()}>重试保存</button>}
            {issue.kind === 'conflict' && selected && <>
              <button type="button" className="quiet-button compact" onClick={() => void reloadSelected()}>重新载入</button>
              <button type="button" className="quiet-button compact" onClick={() => void retrySave()}>保留草稿并重试</button>
            </>}
            {issue.kind === 'action' && <button type="button" className="quiet-button compact" onClick={() => setIssue(null)}>关闭提示</button>}
          </div>
        </div>
      )}
      <div ref={splitRef} className="automation-split" style={{ '--automation-list-width': `${width}px` } as CSSProperties}>
        <aside className="automation-list" aria-label="定时任务列表">
          {overview && <header className="automation-page-header">
            <div><p className="eyebrow">Automation / Scheduled</p><h1 ref={overviewRef} tabIndex={-1}>定时任务</h1><p>让队员按计划创建新对话并完成工作。</p></div>
            <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void beginNew()}>新建</button>
          </header>}
          {(!overview || automations.length > 0) && <div className="automation-list-controls">
            <div className="automation-filter-tabs" role="group" aria-label="筛选定时任务">
              {(['all', 'enabled', 'closed'] as const).map((value, index) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{['全部', '开启', '关闭'][index]}</button>)}
            </div>
            {!overview && <div className="automation-list-navigation">
              <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void beginNew()}>新建</button>
            </div>}
            <label className="automation-search"><AutomationGlyph name="search" /><input type="search" aria-label="搜索定时任务" placeholder="搜索定时任务" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>}
          <div className="automation-list-scroll" aria-busy={loadState === 'loading'}>
            {loadState === 'loading' && automations.length === 0 && <p className="automation-list-message" role="status">正在读取任务…</p>}
            {loadState === 'error' && automations.length === 0 && <p className="automation-list-message">任务列表暂时不可用。</p>}
            {loadState === 'ready' && automations.length === 0 && <p className="automation-list-message automation-empty-message">{overview ? '还没有定时任务，从空白或下面的模板开始。' : '还没有定时任务，创建后会显示在这里。'}</p>}
            {automations.length > 0 && visibleAutomations.length === 0 && <p className="automation-list-message">没有匹配的定时任务</p>}
            {visibleAutomations.map((automation) => {
              const member = agents.find((agent) => agent.agentId === automation.memberId)
              return <div key={automation.automationId} className={`automation-list-item ${selectedId === automation.automationId ? 'active' : ''}`}>
                <button type="button" className="automation-task-open" onClick={() => void choose(automation.automationId)} aria-current={selectedId === automation.automationId ? 'true' : undefined}>
                  <span className={`automation-state-icon ${automation.enabled ? 'enabled' : 'closed'}`} role="img" aria-label={automation.enabled ? '已开启' : '已关闭'} title={automation.enabled ? '已开启' : '已关闭'}><AutomationGlyph name={automation.enabled ? 'clock' : 'pause'} /></span>
                  <span className="automation-list-copy"><strong>{automation.name}</strong><small>{scheduleLabel(automation.schedule)}</small></span>
                  <span title={member?.displayName ?? '队员不可用'}><MemberAvatar agentId={automation.memberId} avatarRef={member?.avatarRef ?? null} displayName={member?.displayName ?? '未知队员'} size="mention" /></span>
                </button>
                <DropdownMenu.Root onOpenChange={(open) => { if (!open) setDeleteArmed(null) }}>
                  <DropdownMenu.Trigger asChild><button className="automation-icon-button automation-task-more" type="button" aria-label={`${automation.name}的操作`} disabled={busy !== null}><AutomationGlyph name="more" /></button></DropdownMenu.Trigger>
                  <DropdownMenu.Portal><DropdownMenu.Content className="automation-menu" align="end" sideOffset={4} collisionPadding={12} loop>
                    <DropdownMenu.Item className="automation-menu-item" onSelect={() => void runNow(automation.automationId)}><AutomationGlyph name="play" />运行一次</DropdownMenu.Item>
                    <DropdownMenu.Item className="automation-menu-item" onSelect={() => void setEnabled(automation.automationId, !automation.enabled)}><AutomationGlyph name={automation.enabled ? 'pause' : 'clock'} />{automation.enabled ? '关闭' : '开启'}</DropdownMenu.Item>
                    <DropdownMenu.Separator className="automation-menu-separator" />
                    <DropdownMenu.Item className="automation-menu-item danger" onSelect={(event) => {
                      if (deleteArmed === automation.automationId) void remove(automation.automationId)
                      else { event.preventDefault(); setDeleteArmed(automation.automationId) }
                    }}><AutomationGlyph name="trash" />{deleteArmed === automation.automationId ? '确认删除任务' : '删除'}</DropdownMenu.Item>
                    {deleteArmed === automation.automationId && <p className="automation-menu-note">删除定义，保留已有运行与对话。</p>}
                  </DropdownMenu.Content></DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            })}
          </div>
          {overview && <section className="automation-template-library" aria-labelledby="automation-templates-heading">
            <div><h2 id="automation-templates-heading">模板</h2><p>选择后可在任务页继续调整</p></div>
            <AutomationTemplates onChoose={(id) => void beginNew(id)} />
            <p className="automation-scheduler-note">Rovai 运行且电脑唤醒时按计划触发，错过的任务不会补跑。</p>
          </section>}
        </aside>
        {!overview && <>
          <div className="automation-splitter" role="separator" tabIndex={0} aria-label="调整任务列表宽度" aria-orientation="vertical" aria-valuemin={AUTOMATION_MIN_LIST_WIDTH} aria-valuemax={Math.max(AUTOMATION_MIN_LIST_WIDTH, availableWidth - 7)} aria-valuenow={editorClosed ? Math.max(AUTOMATION_MIN_LIST_WIDTH, availableWidth - 7) : width} aria-valuetext={editorClosed ? '详情已收起，向左调整可重新打开' : `任务列表宽度 ${width} 像素`} title={editorClosed ? '向左拖动打开任务页' : '拖动调整宽度，拖到最右侧收起详情'}
            onPointerDown={(event) => { if (event.button !== 0) return; dragRef.current = { pointerId: event.pointerId, x: event.clientX, width: editorClosed ? availableWidth - 7 : width }; event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={(event) => { const drag = dragRef.current; if (drag?.pointerId === event.pointerId) resize(drag.width + event.clientX - drag.x) }}
            onPointerUp={(event) => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
            onPointerCancel={() => { dragRef.current = null }} onLostPointerCapture={() => { dragRef.current = null }}
            onDoubleClick={() => { setListWidth(AUTOMATION_DEFAULT_LIST_WIDTH); setEditorClosed(false) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize((editorClosed ? availableWidth - 327 : width) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 24 : 8)) }
              else if (event.key === 'Home') { event.preventDefault(); setListWidth(AUTOMATION_MIN_LIST_WIDTH); setEditorClosed(false) }
              else if (event.key === 'End') { event.preventDefault(); void closeEditor() }
              else if (event.key === 'Enter') { event.preventDefault(); setEditorClosed(false); setListWidth(AUTOMATION_DEFAULT_LIST_WIDTH) }
            }}><span /></div>
          <section className="automation-editor" aria-label={selectedId === 'new' ? '新建定时任务' : '定时任务详情'} hidden={editorClosed}>
            <header className="automation-editor-toolbar"><span>{selectedId === 'new' ? '新建' : '详情'}</span><small role="status">{selected ? saveLabel : ''}</small><button type="button" className="automation-icon-button" aria-label="返回定时任务总览" onClick={() => void showOverview()}><AutomationGlyph name="close" /></button></header>
            <AutomationEditor key={selectedId} draft={draft} onChange={setDraft} agents={agents} projects={projects} automation={selected} titleRef={titleRef} busy={busy !== null} onOpenCamp={onOpenCamp} onCreate={() => void create()} />
          </section>
        </>}
      </div>
    </div>
  )
}
