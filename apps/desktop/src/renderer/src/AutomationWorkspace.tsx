import { useThreadClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type {
  AgentProfile,
  AutomationListPage,
  AutomationView,
  ProjectNavigationGroup,
  StoredCommandResult
} from '@contracts'
import { readErrorMessage } from './error-message'
import { useAutomationAction } from './useAutomationAction'
import { AutomationListRow } from './AutomationListRow'
import { changeAutomationList, emptyAutomationList, type AutomationListChange } from './automation-list'
import { AutomationEditor } from './AutomationEditor'
import { automationScheduleError } from './automation-schedule-validation'
import { AutomationGlyph, AutomationRunOnce, AutomationRunSwitch, AutomationTemplates } from './AutomationControls'
import {
  AUTOMATION_DEFAULT_LIST_WIDTH, AUTOMATION_MIN_LIST_WIDTH, AutomationCommandError, automationFromResult, automationListWidth, defaultDraft,
  describeAutomationPlan, draftFingerprint, draftFromAutomation, localizedAutomationTemplate,
  type AutomationDraft, type AutomationIssue, type SaveState, type TemplateId
} from './automation-workspace-model'
import { UiText, uiAttribute } from './interface-language'
import { splitterScale, useCollapsibleSplitter } from './useCollapsibleSplitter'
import { SplitterFeedback } from './SplitterFeedback'


export type AutomationLeaveGuard = () => Promise<boolean>

export function AutomationWorkspace({
  agents,
  projects,
  defaultMemberId,
  topNotices,
  onOpenThread,
  onLeaveGuardChange
}: {
  agents: AgentProfile[]
  projects: ProjectNavigationGroup[]
  defaultMemberId: string
  topNotices?: React.ReactNode
  onOpenThread(threadId: string): void
  onLeaveGuardChange?(guard: AutomationLeaveGuard | null): void
}): React.JSX.Element {
  const client = useThreadClient()
  const [list, setList] = useState(emptyAutomationList)
  const listRef = useRef(list)
  const changeList = useCallback((change: AutomationListChange) => {
    const next = changeAutomationList(listRef.current, change)
    listRef.current = next
    setList(next)
    return next
  }, [])
  const { filter, query } = list
  const refreshGeneration = useRef(0)
  useEffect(() => () => { refreshGeneration.current++ }, [client])
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
  const { action, runAction } = useAutomationAction(nextError => {
    setIssue({ kind: 'action', message: readErrorMessage(nextError) })
  })
  const busy = action?.kind ?? null
  const [listWidth, setListWidth] = useState(AUTOMATION_DEFAULT_LIST_WIDTH)
  const [editorClosed, setEditorClosed] = useState(false)
  const [heldFold, setHeldFold] = useState(false)
  const editorHidden = editorClosed || heldFold
  const [createChooserOpen, setCreateChooserOpen] = useState(false)
  const createChooserId = useId()
  const createChooserRef = useRef<HTMLElement>(null)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const [availableWidth, setAvailableWidth] = useState(1100)
  const splitRef = useRef<HTMLDivElement>(null)
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState

  useEffect(() => {
    const element = splitRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setCreateChooserOpen(false)
  }, [selectedId])

  useEffect(() => {
    if (!createChooserOpen) return
    const dismissOutside = (event: MouseEvent): void => {
      if (event.target instanceof Node && !createChooserRef.current?.contains(event.target) && !createTriggerRef.current?.contains(event.target)) {
        setCreateChooserOpen(false)
      }
    }
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setCreateChooserOpen(false)
    }
    document.addEventListener('click', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('click', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [createChooserOpen])

  selectedIdRef.current = selectedId
  draftRef.current = draft

  const selected = selectedId && selectedId !== 'new'
    ? list.records.get(selectedId) ?? null
    : null

  const syncSavedDraft = useCallback((task: AutomationView, submittedFingerprint?: string): void => {
    const next = draftFromAutomation(task)
    savedVersions.current.set(task.automationId, task.version)
    savedFingerprints.current.set(task.automationId, draftFingerprint(next))
    // An autosave can finish after the user switches tasks or continues typing.
    if (submittedFingerprint !== undefined && (selectedIdRef.current !== task.automationId ||
        draftFingerprint(draftRef.current) !== submittedFingerprint)) return
    draftRef.current = next
    setDraft(next)
    setSaveState('saved')
  }, [])

  const refresh = useCallback(async (quiet = false): Promise<boolean> => {
    const request = ++refreshGeneration.current
    if (!quiet) setLoadState('loading')
    try {
      const loaded: AutomationView[] = []
      const seenCursors = new Set<string>()
      let cursor: string | null = null
      for (;;) {
        const page: AutomationListPage = await client.request<AutomationListPage>('automations.list', {
          status: 'all', limit: 50, ...(cursor ? { cursor } : {})
        })
        loaded.push(...page.automations)
        if (!page.truncated) break
        if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
          throw new Error(uiAttribute('任务列表分页状态无效，请重试。'))
        }
        seenCursors.add(page.nextCursor)
        cursor = page.nextCursor
      }
      if (request !== refreshGeneration.current) return false
      const latestList = changeList({ type: 'loaded', tasks: loaded })

      const activeId = selectedIdRef.current
      if (activeId && activeId !== 'new') {
        const latest = latestList.records.get(activeId)
        if (latest) {
          const savedFingerprint = savedFingerprints.current.get(activeId)
          const localFingerprint = draftFingerprint(draftRef.current)
          const localDirty = savedFingerprint !== undefined && savedFingerprint !== localFingerprint
          const savedVersion = savedVersions.current.get(activeId)
          if (localDirty && savedVersion !== undefined && savedVersion !== latest.version) {
            setSaveState('conflict')
            setIssue({
              kind: 'conflict',
              message:uiAttribute("任务已在其他位置更新。请重新载入，或确认用当前草稿覆盖最新内容。")
            })
          } else if (!localDirty) {
            syncSavedDraft(latest)
          }
        }
      }
      setSelectedId((current) => {
        if (current === 'new') return current
        if (current && latestList.records.has(current)) return current
        return null
      })
      setLoadState('ready')
      setIssue((current) => current?.kind === 'load' ? null : current)
      return true
    } catch (nextError) {
      if (!quiet && request === refreshGeneration.current) {
        setLoadState('error')
        setIssue({ kind: 'load', message: readErrorMessage(nextError) })
      }
      return false
    }
  }, [client, changeList, syncSavedDraft])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(true), 5_000)
    const unsubscribe = client.onEvent?.((event) => {
      if (event.method === 'automations.updated') void refresh(true)
    })
    const unsubscribeInvalidated = client.onInvalidated?.(() => void refresh(true))
    return () => {
      window.clearInterval(interval)
      unsubscribe?.()
      unsubscribeInvalidated?.()
    }
  }, [client, refresh])

  useEffect(() => {
    if (selectedId === 'new') {
      setSaveState('idle')
      setIssue((current) => current?.kind === 'save' || current?.kind === 'conflict' ? null : current)
      return
    }
    const automation = selectedId ? listRef.current.records.get(selectedId) : null
    if (!automation) return
    syncSavedDraft(automation)
    setIssue((current) => current?.kind === 'save' || current?.kind === 'conflict' ? null : current)
  }, [selectedId, syncSavedDraft])

  const applyReceipt = useCallback((change: AutomationListChange) => {
    // A list read started before this command can still contain its old definition or a deleted row.
    refreshGeneration.current++
    const next = changeList(change)
    if (!next.initialized) void refresh(true)
    return next
  }, [changeList, refresh])

  const recordTaskReceipt = useCallback((type: 'created' | 'saved', next: AutomationView): AutomationView => {
    const current = applyReceipt({ type, task: next }).records.get(next.automationId)
    if (!current) throw new AutomationCommandError('automation.not_found', uiAttribute('「{0}」已不存在。', next.name))
    if (type === 'saved' && current.version > next.version) {
      throw new AutomationCommandError('command.version_conflict', uiAttribute('任务已在其他位置更新。请选择重新载入，或确认保留当前草稿后重试。'))
    }
    savedVersions.current.set(current.automationId, current.version)
    return current
  }, [applyReceipt])

  const queueSave = useCallback((automationId: string, snapshot: AutomationDraft): Promise<void> => {
    const validation = automationScheduleError(snapshot.schedule)
    if (validation) return Promise.reject(new Error(validation))
    const fingerprint = draftFingerprint(snapshot)
    if (savedFingerprints.current.get(automationId) === fingerprint) return Promise.resolve()
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const current = listRef.current.records.get(automationId)
      if (!current || savedFingerprints.current.get(automationId) === fingerprint) return
      if (selectedIdRef.current === automationId) {
        setSaveState('saving')
        setIssue((active) => active?.kind === 'save' || active?.kind === 'conflict' ? null : active)
      }
      try {
        const result = await client.request<StoredCommandResult>('automations.update', {
          commandId: newCommandId(),
          command: {
            automationId,
            expectedVersion: savedVersions.current.get(automationId) ?? current.version,
            name: snapshot.name,
            prompt: snapshot.prompt,
            memberId: snapshot.memberId,
            projectRef: snapshot.projectRef,
            schedule: snapshot.schedule,
            threadNaming: snapshot.threadNaming,
            notifyChannels: snapshot.notifyChannels
          }
        })
        syncSavedDraft(recordTaskReceipt('saved', automationFromResult(result)), fingerprint)
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
  }, [client, recordTaskReceipt, syncSavedDraft])

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

  const openTask = async (automationId: string): Promise<void> => {
    if (!(await flushBeforeLeave())) return
    setSelectedId(automationId)
    setEditorClosed(false)
  }

  const showOverview = async (): Promise<void> => {
    if (!(await flushBeforeLeave())) return
    setSelectedId(null)
    setEditorClosed(false)
  }

  const beginNew = async (templateId?: TemplateId): Promise<void> => {
    if (!(await flushBeforeLeave())) return
    setCreateChooserOpen(false)
    const context = selectedIdRef.current === 'new' ? draftRef.current : defaultDraft(defaultMemberId)
    const template = templateId ? localizedAutomationTemplate(templateId) : null
    const next = { ...context, name: template?.name ?? '', prompt: template?.prompt ?? '', schedule: template?.schedule ?? context.schedule }
    draftRef.current = next
    setDraft(next)
    setSelectedId('new')
    setSaveState('idle')
    setIssue(null)
    setEditorClosed(false)
  }

  const prepareAction = async (automationId: string): Promise<AutomationView | null> => {
    if (!(await flushBeforeLeave())) return null
    return listRef.current.records.get(automationId) ?? null
  }

  const retrySave = async (): Promise<void> => {
    if (!selected) return
    if (saveState === 'conflict') {
      const loaded = await refresh()
      if (!loaded) return
      const latest = listRef.current.records.get(selected.automationId)
      if (!latest || selectedIdRef.current !== selected.automationId) return
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
    const latest = listRef.current.records.get(automationId)
    if (!latest || selectedIdRef.current !== automationId) return
    syncSavedDraft(latest)
    setIssue(null)
  }

  const create = async (): Promise<void> => {
    if (!draft.prompt.trim() || !draft.memberId || automationScheduleError(draft.schedule)) return
    await runAction({ kind: 'create' }, async () => {
      setIssue(null)
      const result = await client.request<StoredCommandResult>('automations.create', {
        commandId: newCommandId(), command: draft
      })
      const created = recordTaskReceipt('created', automationFromResult(result))
      setSelectedId(created.automationId)
      syncSavedDraft(created)
    })
  }

  const runNow = (automationId: string) => runAction({ kind: 'run', id: automationId }, async () => {
    const current = await prepareAction(automationId)
    if (!current) return
    setIssue(null)
    const result = await client.request<StoredCommandResult>('automations.run', {
      commandId: newCommandId(), command: { automationId: current.automationId }
    })
    if (result.status === 'rejected') throw new Error(String(result.payload.message ?? uiAttribute('任务未能开始。')))
    await refresh(true)
  })

  const setEnabled = (automationId: string, enabled: boolean) => runAction({ kind: 'enabled', id: automationId }, async () => {
    const current = await prepareAction(automationId)
    if (!current) return
    setIssue(null)
    const method = enabled ? 'automations.update' : 'automations.close'
    const command = enabled
      ? { automationId, expectedVersion: current.version, enabled: true }
      : { automationId, expectedVersion: current.version }
    const result = await client.request<StoredCommandResult>(method, {
      commandId: newCommandId(), command
    })
    recordTaskReceipt('saved', automationFromResult(result))
  })

  const remove = (automationId: string) => runAction({ kind: 'delete', id: automationId }, async () => {
    const current = await prepareAction(automationId)
    if (!current) return
    setIssue(null)
    const result = await client.request<StoredCommandResult>('automations.delete', {
      commandId: newCommandId(), command: { automationId, expectedVersion: current.version }
    })
    if (result.status === 'rejected') throw new Error(String(result.payload.message ?? uiAttribute('任务删除失败。')))
    savedFingerprints.current.delete(automationId)
    savedVersions.current.delete(automationId)
    applyReceipt({ type: 'deleted', id: automationId })
    if (selectedIdRef.current === automationId) setSelectedId(null)
  })

  const selectedDirty = selected
    ? savedFingerprints.current.get(selected.automationId) !== draftFingerprint(draft)
    : false
  const saveLabel = automationScheduleError(draft.schedule) ? uiAttribute('未保存，请修正运行时间') : saveState === 'saving'
    ? uiAttribute('正在保存…')
    : saveState === 'failed'
      ? uiAttribute('保存失败')
      : saveState === 'conflict'
        ? uiAttribute('需要确认版本')
        : selectedDirty
          ? uiAttribute('等待自动保存…')
          : uiAttribute('已保存')

  const overview = selectedId === null
  const width = automationListWidth(listWidth, availableWidth)
  const selectedPlan = selected && describeAutomationPlan(selected)
  const selectedRunning = action?.kind === 'run' && action.id === selectedId
  const selectedSwitching = action?.kind === 'enabled' && action.id === selectedId
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

  const paintDetailWidth = (size: number): void => {
    splitRef.current?.style.setProperty('--automation-list-width', `${availableWidth - size - 7}px`)
  }
  const previewDetailWidth = (size: number): void => {
    paintDetailWidth(size)
    setEditorClosed(false)
    setListWidth(availableWidth - size - 7)
  }
  const splitter = useCollapsibleSplitter({
    size: editorClosed ? 0 : Math.max(0, availableWidth - width - 7), collapsed: editorClosed,
    minimum: 320, maximum: Math.max(320, availableWidth - 7 - AUTOMATION_MIN_LIST_WIDTH), direction: -1,
    disabled: overview, scopeKey: selectedId,
    scale: () => splitterScale(splitRef.current),
    capture: () => ({ listWidth, editorClosed }),
    onPreview: previewDetailWidth,
    onCommit: previewDetailWidth,
    onCollapseFrame: paintDetailWidth,
    onFoldPreview: edge => setHeldFold(edge === 'minimum'),
    onCollapse: before => { paintDetailWidth(0); setListWidth(before.listWidth); setEditorClosed(true) },
    onCancel: before => {
      paintDetailWidth(before.editorClosed ? 0 : availableWidth - automationListWidth(before.listWidth, availableWidth) - 7)
      setListWidth(before.listWidth)
      setEditorClosed(before.editorClosed)
    },
    prepareCollapse: flushBeforeLeave
  })

  const filters = (
    <div className="automation-filter-tabs" role="group" aria-label={uiAttribute("筛选定时任务")}>
      {(['all', 'enabled', 'closed'] as const).map((value, index) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeList({ type: 'criteria', filter: value, query })}>{uiAttribute(['全部', '开启', '关闭'][index])}</button>)}
    </div>
  )

  return (
    <div className={`automation-workspace ${overview ? 'overview' : 'detail'} ${editorHidden ? 'editor-closed' : ''}`}>
      {topNotices}
      {issue && (
        <div className="automation-error" role="alert">
          <div><strong><UiText zh={"操作未完成"} /></strong><span>{issue.message}</span></div>
          <div className="automation-error-actions">
            {issue.kind === 'load' && <button type="button" className="quiet-button compact" onClick={() => void refresh()}><UiText zh={"重试读取"} /></button>}
            {issue.kind === 'save' && selected && <button type="button" className="quiet-button compact" onClick={() => void retrySave()}><UiText zh={"重试保存"} /></button>}
            {issue.kind === 'conflict' && selected && <>
              <button type="button" className="quiet-button compact" onClick={() => void reloadSelected()}><UiText zh={"重新载入"} /></button>
              <button type="button" className="quiet-button compact" onClick={() => void retrySave()}><UiText zh={"保留草稿并重试"} /></button>
            </>}
            {issue.kind === 'action' && <button type="button" className="quiet-button compact" onClick={() => setIssue(null)}><UiText zh={"关闭提示"} /></button>}
          </div>
        </div>
      )}
      <div ref={splitRef} className="automation-split" style={{ '--automation-list-width': `${width}px` } as CSSProperties}>
        <aside className="automation-list" aria-label={uiAttribute("定时任务列表")}>
          {overview && <header className="automation-page-header">
            <div><h1><UiText zh={"定时任务"} /></h1><p><UiText zh={"安排一次，按时执行。"} /></p></div>
            <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void beginNew()}><AutomationGlyph name="plus" /><UiText zh={"新建"} /></button>
          </header>}
          {(!overview || list.records.size > 0) && <div className="automation-list-controls">
            {overview && filters}
            {!overview && <h2 className="automation-list-title"><UiText zh={"定时任务"} /><span>{list.records.size}</span></h2>}
            {!overview && <div className="automation-list-navigation">
              <button ref={createTriggerRef} className="primary-button" type="button" disabled={busy !== null}
                aria-expanded={createChooserOpen} aria-controls={createChooserId}
                onClick={() => setCreateChooserOpen((open) => !open)}><AutomationGlyph name="plus" /><UiText zh={"新建"} /></button>
            </div>}
            <label className="automation-search"><AutomationGlyph name="search" /><input type="search" aria-label={uiAttribute("搜索定时任务")} placeholder={uiAttribute("搜索定时任务")} value={query} onChange={event => changeList({ type: 'criteria', filter, query: event.target.value })} /></label>
            {!overview && filters}
          </div>}
          {!overview && <section ref={createChooserRef} id={createChooserId} className="automation-create-choices" aria-label={uiAttribute("选择创建方式")} hidden={!createChooserOpen}>
            <p><UiText zh={"从空白或模板开始"} /></p>
            <AutomationTemplates compact onChoose={(id) => void beginNew(id)} />
          </section>}
          <div className="automation-list-scroll" aria-busy={loadState === 'loading'}>
            {loadState === 'loading' && list.records.size === 0 && <p className="automation-list-message" role="status"><UiText zh={"正在读取任务…"} /></p>}
            {loadState === 'error' && list.records.size === 0 && <p className="automation-list-message"><UiText zh={"任务列表暂时不可用。"} /></p>}
            {loadState === 'ready' && list.records.size === 0 && <p className="automation-list-message automation-empty-message">{overview ? uiAttribute("还没有定时任务，从空白或下面的模板开始。") : uiAttribute("还没有定时任务，创建后会显示在这里。")}</p>}
            {list.records.size > 0 && list.visibleIds.length === 0 && <p className="automation-list-message"><UiText zh={"没有匹配的定时任务"} /></p>}
            {list.visibleIds.map(id => {
              const task = list.records.get(id)!
              return <AutomationListRow key={id} task={task} member={agents.find(agent => agent.agentId === task.memberId)}
                selected={selectedId === id} overview={overview} disabled={busy !== null} switching={action?.kind === 'enabled' && action.id === id}
                onOpen={() => void openTask(id)} onToggle={() => void setEnabled(id, !task.enabled)}
                onRun={() => void runNow(id)} onDelete={() => void remove(id)} />
            })}
          </div>
          {overview && <section className="automation-template-library" aria-labelledby="automation-templates-heading">
            <div><h2 id="automation-templates-heading"><UiText zh={"模板"} /></h2><p><UiText zh={"选择后可在任务页继续调整"} /></p></div>
            <AutomationTemplates onChoose={(id) => void beginNew(id)} />
          </section>}
        </aside>
        {!overview && <>
          <div className="automation-splitter" role="separator" tabIndex={0} aria-label={uiAttribute("调整任务列表宽度")} aria-orientation="vertical" aria-valuemin={AUTOMATION_MIN_LIST_WIDTH} aria-valuemax={Math.max(AUTOMATION_MIN_LIST_WIDTH, availableWidth - 7)} aria-valuenow={editorHidden ? Math.max(AUTOMATION_MIN_LIST_WIDTH, availableWidth - 7) : width} aria-valuetext={editorHidden ? uiAttribute("详情已收起，向左调整可重新打开") : uiAttribute("任务列表宽度 {0} 像素", String(width))} title={editorClosed ? uiAttribute("向左拖动打开任务页") : uiAttribute("拖动调整宽度，详情最窄处继续向右内推直接收起；Escape 取消拖动")}
            {...splitter.handlers}
            onDoubleClick={() => { splitter.cancel(); setListWidth(AUTOMATION_DEFAULT_LIST_WIDTH); setEditorClosed(false) }}
            onKeyDown={(event) => {
              if (splitter.active) return
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize((editorClosed ? availableWidth - 327 : width) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 24 : 8)) }
              else if (event.key === 'Home') { event.preventDefault(); setListWidth(AUTOMATION_MIN_LIST_WIDTH); setEditorClosed(false) }
              else if (event.key === 'End') { event.preventDefault(); void closeEditor() }
              else if (event.key === 'Enter') { event.preventDefault(); setEditorClosed(false); setListWidth(AUTOMATION_DEFAULT_LIST_WIDTH) }
            }}><span /><SplitterFeedback phase={splitter.phase} target={splitter.target} label={uiAttribute('继续拖动收起任务详情')} /></div>
          <section className="automation-editor" aria-label={selectedId === 'new' ? uiAttribute("新建定时任务") : uiAttribute("定时任务详情")} hidden={editorHidden}>
            <header className="automation-editor-toolbar">
              <span>{selectedId === 'new' ? uiAttribute('新建') : uiAttribute('详情')}</span>
              <small role="status" data-state={saveState}>{selected ? saveLabel : ''}</small>
              {selected && selectedPlan?.toolbar === 'switch' && <AutomationRunSwitch enabled={selected.enabled} disabled={busy !== null} switching={selectedSwitching}
                onChange={() => void setEnabled(selected.automationId, !selected.enabled)} />}
              {selected && selectedPlan?.toolbar === 'run-once' && <AutomationRunOnce disabled={busy !== null} running={selectedRunning} onRun={() => void runNow(selected.automationId)} />}
              {selected && <span className="automation-toolbar-divider" aria-hidden="true" />}
              <button type="button" className="automation-icon-button" aria-label={uiAttribute('返回定时任务总览')} onClick={() => void showOverview()}><AutomationGlyph name="close" /></button>
            </header>
            <AutomationEditor key={selectedId} draft={draft} onChange={setDraft} agents={agents} projects={projects} automation={selected} busy={busy !== null} onOpenThread={onOpenThread} onCreate={() => void create()} />
          </section>
        </>}
      </div>
    </div>
  )
}
