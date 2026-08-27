import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AcceptHearthReviewItemCommand,
  AgentProfile,
  CreateMemoryCommand,
  HearthReviewItem,
  MemoryCapacity,
  MemoryDirection,
  MemoryKind,
  MemoryLibraryView,
  MemoryRecord,
  MemoryScopeKind,
  StoredCommandResult
} from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogGlyph,
  AppDialogHeader
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import {
  addLocalCalendarDays,
  createReviewScheduleDraft,
  formatReviewPresetDate,
  localTimeZoneName,
  nextLocalMinute,
  parseLocalDateTimeValue,
  reviewScheduleMatchesValue,
  reviewSchedulePresetModes,
  selectedReviewScheduleDate,
  toLocalDateTimeValue,
  validateReviewScheduleDraft,
  type ReviewScheduleDraft,
  type ReviewScheduleMode
} from './memory-review-schedule'
import { localizeExecutionEngineTerms } from './product-copy'

type GovernanceFilter = 'all' | 'agent' | 'review' | 'stopped'
type Editor =
  | { kind: 'create' }
  | { kind: 'revise'; memory: MemoryRecord }
  | { kind: 'reviewItem'; reviewItem: HearthReviewItem }
  | null

interface Draft {
  scope: MemoryScopeKind
  kind: MemoryKind
  body: string
  retrievalKeys: string
  firstAgentId: string
  secondAgentId: string
  direction: MemoryDirection
  directedActorAgentId: string
}

interface MemorySnapshot {
  library: MemoryLibraryView
  reviewItems: HearthReviewItem[]
}

type ReviewScheduleAction = 'save' | 'clear'
type ReviewScheduleBusyAction = ReviewScheduleAction | 'refresh'

interface ReviewScheduleEditor extends ReviewScheduleDraft {
  phase: 'ready' | 'authority-unknown' | 'applied-refresh-failed'
  appliedAction: ReviewScheduleAction | null
  attemptedAction: ReviewScheduleAction | null
  notice: {
    tone: 'error' | 'info'
    message: string
  } | null
}

const initialDraft: Draft = {
  scope: 'hearth',
  kind: 'preference',
  body: '',
  retrievalKeys: '',
  firstAgentId: '',
  secondAgentId: '',
  direction: 'mutual',
  directedActorAgentId: ''
}

const scopeTabs: Array<[MemoryScopeKind, string]> = [
  ['hearth', '共同记忆'],
  ['companion', '队员记忆'],
  ['relationship', '队员间记忆']
]

const governanceTabs: Array<[GovernanceFilter, string]> = [
  ['all', '全部'],
  ['agent', '队员形成'],
  ['review', '待复核'],
  ['stopped', '已停止沿用']
]

export function MemoryLibrary({
  agents,
  topNotices,
  refreshSignal = 0,
  focusMemoryId = null,
  reviewDrawerSignal = 0,
  onReviewDrawerSignalConsumed,
  onPendingCountChange,
  onReady,
  startupFeedbackVisible = true
}: {
  agents: AgentProfile[]
  topNotices?: ReactNode
  refreshSignal?: number
  focusMemoryId?: string | null
  reviewDrawerSignal?: number
  onReviewDrawerSignalConsumed?(): void
  onPendingCountChange?(count: number): void
  onReady?(): void
  startupFeedbackVisible?: boolean
}): React.JSX.Element {
  const [library, setLibrary] = useState<MemoryLibraryView | null>(null)
  const [reviewItems, setReviewItems] = useState<HearthReviewItem[]>([])
  const [scope, setScope] = useState<MemoryScopeKind>('hearth')
  const [governance, setGovernance] = useState<GovernanceFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null)
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false)
  const [editor, setEditor] = useState<Editor>(null)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [forgetTarget, setForgetTarget] = useState<MemoryRecord | null>(null)
  const [reviewScheduleEditor, setReviewScheduleEditor] = useState<ReviewScheduleEditor | null>(null)
  const [reviewScheduleBusyAction, setReviewScheduleBusyAction] = useState<ReviewScheduleBusyAction | null>(null)
  const reviewScheduleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const startupContentVisible = startupFeedbackVisible || Boolean(error)

  const loadMemoryLibrary = useCallback(async (): Promise<MemoryLibraryView> => {
    const nextLibrary = await window.rovai.request<MemoryLibraryView>('memory.list')
    setLibrary(nextLibrary)
    return nextLibrary
  }, [])

  const load = useCallback(async (): Promise<MemorySnapshot> => {
    const [nextLibrary, nextReviewItems] = await Promise.all([
      window.rovai.request<MemoryLibraryView>('memory.list'),
      window.rovai.request<HearthReviewItem[]>('memory.hearthReviewItems.list')
    ])
    setLibrary(nextLibrary)
    setReviewItems(nextReviewItems)
    onPendingCountChange?.(nextReviewItems.filter((reviewItem) => reviewItem.status === 'pending').length)
    return { library: nextLibrary, reviewItems: nextReviewItems }
  }, [onPendingCountChange])

  useEffect(() => {
    if (library) onReady?.()
  }, [library, onReady])

  useEffect(() => {
    void load().catch((nextError) => setError(errorMessage(nextError)))
  }, [load])

  useEffect(() => window.rovai.onEvent((event) => {
    if (event.method !== 'runtime.state') return
    const params = typeof event.params === 'object' && event.params !== null
      ? event.params as Record<string, unknown>
      : {}
    if (params.status === 'ready') void load().catch((nextError) => setError(errorMessage(nextError)))
  }), [load])

  useEffect(() => {
    if (refreshSignal > 0) void load().catch((nextError) => setError(errorMessage(nextError)))
  }, [load, refreshSignal])

  useEffect(() => {
    if (reviewDrawerSignal <= 0) return
    setReviewDrawerOpen(true)
    onReviewDrawerSignalConsumed?.()
  }, [onReviewDrawerSignalConsumed, reviewDrawerSignal])

  useEffect(() => {
    if (!focusMemoryId || !library) return
    const memory = library.memories.find((candidate) => candidate.id === focusMemoryId)
    if (!memory?.scope) return
    setScope(memory.scope)
    setGovernance(memory.lifecycle === 'active'
      ? memory.creationOrigin === 'agent' ? 'agent' : 'all'
      : 'stopped')
    setSelectedMemoryId(memory.id)
  }, [focusMemoryId, library])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 3_200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const pending = reviewItems.filter((reviewItem) => reviewItem.status === 'pending')
  const visibleMemories = useMemo(() => (library?.memories ?? [])
    .filter((memory) => memory.scope === scope && memory.lifecycle !== 'forgotten')
    .filter((memory) => {
      if (governance === 'agent') return memory.lifecycle === 'active' && memory.creationOrigin === 'agent'
      if (governance === 'review') return memory.lifecycle === 'active' && memory.reviewDue
      if (governance === 'stopped') return memory.lifecycle === 'retired'
      return true
    })
    .filter((memory) => {
      const query = search.trim().toLocaleLowerCase('zh-CN')
      if (!query) return true
      return [
        memory.currentBody,
        memory.currentRetrievalKeys.join(' '),
        kindLabel(memory.kind),
        memoryPeopleLabel(memory, agents),
        originLabel(memory.creationOrigin)
      ].join(' ').toLocaleLowerCase('zh-CN').includes(query)
    }), [agents, governance, library, scope, search])

  useEffect(() => {
    if (visibleMemories.some((memory) => memory.id === selectedMemoryId)) return
    setSelectedMemoryId(visibleMemories[0]?.id ?? null)
  }, [selectedMemoryId, visibleMemories])

  const selectedMemory = visibleMemories.find((memory) => memory.id === selectedMemoryId) ?? null
  const activeCount = library?.memories.filter((memory) => memory.lifecycle === 'active').length ?? 0
  const agentCount = library?.memories.filter((memory) =>
    memory.lifecycle === 'active' && memory.creationOrigin === 'agent'
  ).length ?? 0
  const reviewCount = library?.memories.filter((memory) =>
    memory.lifecycle === 'active' && memory.reviewDue
  ).length ?? 0
  const loading = library === null && error === null

  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await operation()
      await load()
    } catch (nextError) {
      if (nextError instanceof CommandRejectedError && isMemoryConflict(nextError.code)) {
        try {
          const snapshot = await load()
          setEditor((current) => refreshEditorAuthority(current, snapshot))
          setError('审核状态或记忆版本已经变化。已刷新权威状态并保留当前草稿，请核对后明确重试。')
        } catch (refreshError) {
          setError(`状态冲突，且刷新失败：${errorMessage(refreshError)}`)
        }
      } else {
        setError(errorMessage(nextError))
      }
    } finally {
      setBusy(null)
    }
  }

  const openCreate = (): void => {
    const firstAgentId = agents[0]?.agentId ?? ''
    setDraft({
      ...initialDraft,
      scope,
      kind: scope === 'relationship' ? 'agreement' : 'preference',
      firstAgentId,
      secondAgentId: agents.find((agent) => agent.agentId !== firstAgentId)?.agentId ?? '',
      directedActorAgentId: firstAgentId
    })
    setEditor({ kind: 'create' })
  }

  const openRevise = (memory: MemoryRecord): void => {
    setDraft({
      scope: memory.scope ?? 'hearth',
      kind: memory.kind ?? 'agreement',
      body: memory.currentBody ?? '',
      retrievalKeys: memory.currentRetrievalKeys.join(', '),
      firstAgentId: memory.companionAgentId ?? memory.relationshipAgentIds[0] ?? '',
      secondAgentId: memory.relationshipAgentIds[1] ?? '',
      direction: memory.direction ?? 'mutual',
      directedActorAgentId: memory.directedActorAgentId ?? ''
    })
    setEditor({ kind: 'revise', memory })
  }

  const openReviewEdit = (reviewItem: HearthReviewItem): void => {
    if (reviewItem.status !== 'pending' || reviewItem.stale) return
    setDraft({
      ...initialDraft,
      scope: 'hearth',
      kind: reviewItem.candidateKind ?? 'agreement',
      body: reviewItem.candidateBody ?? '',
      retrievalKeys: (reviewItem.candidateRetrievalKeys ?? []).join(', ')
    })
    setEditor({ kind: 'reviewItem', reviewItem })
  }

  const retrievalKeys = (): string[] => draft.retrievalKeys
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const createCommand = (): CreateMemoryCommand => ({
    scope: draft.scope,
    kind: draft.kind,
    body: draft.body.trim(),
    retrievalKeys: retrievalKeys(),
    companionAgentId: draft.scope === 'companion' ? draft.firstAgentId : null,
    relationshipAgentIds: draft.scope === 'relationship'
      ? [draft.firstAgentId, draft.secondAgentId]
      : [],
    direction: draft.scope === 'relationship' ? draft.direction : null,
    directedActorAgentId: draft.scope === 'relationship' && draft.direction === 'directed'
      ? draft.directedActorAgentId
      : null,
    reviewAfter: null
  })

  const submitEditor = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!editor) return
    await run(`editor-${editor.kind}`, async () => {
      let result: StoredCommandResult
      if (editor.kind === 'create') {
        result = await window.rovai.request('memory.create', {
          commandId: crypto.randomUUID(),
          command: createCommand()
        })
      } else if (editor.kind === 'revise') {
        if (!editor.memory.currentRevisionId) throw new Error('当前记忆没有可修订的版本。')
        result = await window.rovai.request('memory.revise', {
          commandId: crypto.randomUUID(),
          command: {
            memoryId: editor.memory.id,
            expectedVersion: editor.memory.version,
            baseRevisionId: editor.memory.currentRevisionId,
            body: draft.body.trim(),
            retrievalKeys: retrievalKeys(),
            reviewAfter: editor.memory.reviewAfter
          }
        })
      } else {
        const command: AcceptHearthReviewItemCommand = {
          reviewItemId: editor.reviewItem.reviewItemId,
          expectedReviewItemVersion: editor.reviewItem.version,
          finalBody: draft.body.trim(),
          finalRetrievalKeys: retrievalKeys()
        }
        result = await window.rovai.request('memory.hearthReviewItems.accept', {
          commandId: crypto.randomUUID(),
          command
        })
      }
      assertApplied(result)
      setEditor(null)
      setFeedback(editor.kind === 'reviewItem'
        ? '已按最终内容接受，候选内容现在成为正式共同记忆。'
        : '记忆已保存。')
    })
  }

  const acceptReview = (reviewItem: HearthReviewItem): Promise<void> =>
    run(`accept-${reviewItem.reviewItemId}`, async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.hearthReviewItems.accept', {
        commandId: crypto.randomUUID(),
        command: {
          reviewItemId: reviewItem.reviewItemId,
          expectedReviewItemVersion: reviewItem.version
        }
      })
      assertApplied(result)
      setFeedback('已接受，候选内容现在成为正式共同记忆。')
    })

  const rejectReview = (reviewItem: HearthReviewItem): Promise<void> =>
    run(`reject-${reviewItem.reviewItemId}`, async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.hearthReviewItems.reject', {
        commandId: crypto.randomUUID(),
        command: {
          reviewItemId: reviewItem.reviewItemId,
          expectedReviewItemVersion: reviewItem.version
        }
      })
      assertApplied(result)
      setFeedback('已拒绝这条审核项；候选内容已清除。')
    })

  const lifecycle = (
    method: 'memory.retire' | 'memory.reactivate',
    memory: MemoryRecord
  ): Promise<void> => run(`${method}-${memory.id}`, async () => {
    const result = await window.rovai.request<StoredCommandResult>(method, {
      commandId: crypto.randomUUID(),
      command: { memoryId: memory.id, expectedVersion: memory.version }
    })
    assertApplied(result)
  })

  const forget = (memory: MemoryRecord): Promise<void> => run(`forget-${memory.id}`, async () => {
    const result = await window.rovai.request<StoredCommandResult>('memory.forget', {
      commandId: crypto.randomUUID(),
      command: { memoryId: memory.id, expectedVersion: memory.version }
    })
    assertApplied(result)
    setForgetTarget(null)
  })

  const openReviewSchedule = (memory: MemoryRecord, trigger: HTMLButtonElement): void => {
    reviewScheduleTriggerRef.current = trigger
    setReviewScheduleEditor({
      ...createReviewScheduleDraft(memory),
      phase: 'ready',
      appliedAction: null,
      attemptedAction: null,
      notice: null
    })
  }

  const submitReviewSchedule = async (action: ReviewScheduleAction): Promise<void> => {
    const current = reviewScheduleEditor
    if (!current || reviewScheduleBusyAction !== null) return

    let desiredReviewAfter: string | null = null
    if (action === 'save') {
      const validation = validateReviewScheduleDraft(current)
      if (!validation.selectedDate || validation.code !== null) {
        setReviewScheduleEditor((editorState) => editorState && {
          ...editorState,
          notice: validation.code === 'unchanged'
            ? editorState.notice
            : { tone: 'error', message: validation.message ?? '请选择有效的下次复核时间。' }
        })
        return
      }
      desiredReviewAfter = validation.selectedDate.toISOString()
    }

    setReviewScheduleBusyAction(action)
    setBusy(`review-${current.memory.id}`)
    setReviewScheduleEditor((editorState) => editorState && {
      ...editorState,
      attemptedAction: action,
      notice: null
    })

    try {
      const result = await window.rovai.request<StoredCommandResult>('memory.review.schedule', {
        commandId: crypto.randomUUID(),
        command: {
          memoryId: current.memory.id,
          expectedVersion: current.memory.version,
          reviewAfter: desiredReviewAfter
        }
      })
      assertApplied(result)

      try {
        await loadMemoryLibrary()
      } catch (refreshError) {
        const completion = action === 'clear' ? '复核提醒已清除' : '下次复核已设置'
        setReviewScheduleEditor((editorState) => editorState && {
          ...editorState,
          phase: 'applied-refresh-failed',
          appliedAction: action,
          attemptedAction: null,
          notice: {
            tone: 'error',
            message: `${completion}，但列表刷新失败：${errorMessage(refreshError)}。请只重试刷新，不要重复提交设置。`
          }
        })
        return
      }

      setReviewScheduleEditor(null)
      setFeedback(action === 'clear' ? '复核提醒已清除' : '下次复核已设置')
    } catch (nextError) {
      if (nextError instanceof CommandRejectedError && isMemoryConflict(nextError.code)) {
        try {
          const nextLibrary = await loadMemoryLibrary()
          const latest = nextLibrary.memories.find((memory) => memory.id === current.memory.id)
          if (!latest) {
            setReviewScheduleEditor((editorState) => editorState && {
              ...editorState,
              phase: 'authority-unknown',
              appliedAction: null,
              attemptedAction: action,
              notice: {
                tone: 'error',
                message: '记忆版本已变化，但最新列表中找不到这条记忆。当前选择仍保留；请重新获取最新状态后再决定。'
              }
            })
            return
          }

          const selectedDate = desiredReviewAfter ? new Date(desiredReviewAfter) : null
          const desiredAlreadyApplied = reviewScheduleMatchesValue(selectedDate, latest.reviewAfter)
          setReviewScheduleEditor((editorState) => editorState && {
            ...editorState,
            memory: latest,
            phase: 'ready',
            appliedAction: null,
            attemptedAction: null,
            notice: reviewScheduleConflictNotice(latest, desiredAlreadyApplied, action)
          })
        } catch (refreshError) {
          setReviewScheduleEditor((editorState) => editorState && {
            ...editorState,
            phase: 'authority-unknown',
            appliedAction: null,
            attemptedAction: action,
            notice: {
              tone: 'error',
              message: `记忆版本已变化，但无法刷新最新状态：${errorMessage(refreshError)}。当前选择仍保留；请先重新获取最新状态，不要在版本未知时重试提交。`
            }
          })
        }
      } else {
        setReviewScheduleEditor((editorState) => editorState && {
          ...editorState,
          phase: 'ready',
          appliedAction: null,
          attemptedAction: null,
          notice: {
            tone: 'error',
            message: `设置未完成：${errorMessage(nextError)}。当前选择已保留，请核对后重试。`
          }
        })
      }
    } finally {
      setReviewScheduleBusyAction(null)
      setBusy(null)
    }
  }

  const retryReviewScheduleRefresh = async (): Promise<void> => {
    const current = reviewScheduleEditor
    if (!current || reviewScheduleBusyAction !== null || current.phase === 'ready') return
    setReviewScheduleBusyAction('refresh')
    setBusy(`review-refresh-${current.memory.id}`)
    try {
      const nextLibrary = await loadMemoryLibrary()
      if (current.phase === 'applied-refresh-failed') {
        setReviewScheduleEditor(null)
        setFeedback(current.appliedAction === 'clear' ? '复核提醒已清除' : '下次复核已设置')
        return
      }

      const latest = nextLibrary.memories.find((memory) => memory.id === current.memory.id)
      if (!latest) throw new Error('最新列表中找不到这条记忆。')
      const attemptedAction = current.attemptedAction ?? 'save'
      const selectedDate = attemptedAction === 'clear' ? null : selectedReviewScheduleDate(current)
      const desiredAlreadyApplied = reviewScheduleMatchesValue(selectedDate, latest.reviewAfter)
      setReviewScheduleEditor((editorState) => editorState && {
        ...editorState,
        memory: latest,
        phase: 'ready',
        appliedAction: null,
        attemptedAction: null,
        notice: reviewScheduleConflictNotice(latest, desiredAlreadyApplied, attemptedAction)
      })
    } catch (refreshError) {
      setReviewScheduleEditor((editorState) => editorState && {
        ...editorState,
        notice: {
          tone: 'error',
          message: `${editorState.phase === 'applied-refresh-failed' ? '设置已经生效，但' : ''}仍无法刷新最新状态：${errorMessage(refreshError)}。请稍后只重试刷新。`
        }
      })
    } finally {
      setReviewScheduleBusyAction(null)
      setBusy(null)
    }
  }

  const exportMemory = (): Promise<void> => run('export', async () => {
    await window.rovai.exportMemory()
  })

  return (
    <section
      className={`memory-library${startupContentVisible ? '' : ' startup-feedback-suppressed'}`}
      aria-labelledby="memory-library-title"
      aria-busy={loading}
      aria-hidden={startupContentVisible ? undefined : true}
      data-startup-route="memory"
      data-startup-status={loading ? 'loading' : error && !library ? 'waiting' : 'ready'}
    >
      <header className="memory-library-header">
        <div>
          <p className="eyebrow">Memory / Library</p>
          <h2 id="memory-library-title">记忆</h2>
          <p>查看、搜索和管理长期记忆。</p>
        </div>
        <div className="memory-header-actions">
          <button className="quiet-button" type="button" onClick={() => void exportMemory()} disabled={!library}>导出…</button>
          <button className="primary-button" type="button" onClick={openCreate} disabled={!library}>新增记忆</button>
        </div>
      </header>

      {topNotices && <div className="memory-page-notices">{topNotices}</div>}

      {error && <div className="memory-error" role="alert"><strong>操作未完成</strong><span>{error}</span>{!library && <button className="quiet-button compact" type="button" onClick={() => { setError(null); void load().catch((nextError) => setError(errorMessage(nextError))) }}>重试</button>}</div>}
      {feedback && <div className="memory-feedback" role="status">{feedback}</div>}

      <div className="memory-summary-strip" aria-label="记忆概览">
        <div><strong>{loading ? '—' : activeCount}</strong><span>正在沿用</span></div>
        <div className={pending.length > 0 ? 'attention' : ''}><strong>{loading ? '—' : pending.length}</strong><span>待审核</span></div>
        <div><strong>{loading ? '—' : agentCount}</strong><span>队员形成</span></div>
        <div><strong>{loading ? '—' : reviewCount}</strong><span>待复核</span></div>
      </div>

      {pending.length > 0 && (
        <button className="memory-pending-banner" type="button" onClick={() => setReviewDrawerOpen(true)}>
          <span><strong>{pending.length} 条共同记忆审核项等待处理</strong><small>候选内容与正式记忆隔离，只有接受后才会生效。</small></span>
          <b>查看审核 →</b>
        </button>
      )}

      <div className="memory-library-heading">
        <h3>记忆库</h3>
      </div>

      <nav className="memory-scope-tabs" aria-label="记忆范围">
        {scopeTabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scope === value ? 'active' : ''}
            aria-current={scope === value ? 'page' : undefined}
            disabled={loading}
            onClick={() => setScope(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="memory-filter-row">
        <div className="memory-governance-tabs">
          {governanceTabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={governance === value ? 'active' : ''}
              aria-pressed={governance === value}
              disabled={loading}
              onClick={() => setGovernance(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="memory-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">搜索记忆</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索正文、Retrieval Keys 或队员" disabled={loading} />
        </label>
      </div>

      <CapacityStrip library={library} scope={scope} agents={agents} />

      <div className="memory-workbench">
        <div className="memory-catalog">
          <div className="memory-catalog-heading"><strong>{scopeTabs.find(([value]) => value === scope)?.[1]}</strong><span>{visibleMemories.length} 条</span></div>
          <div className="memory-catalog-list">
            {loading && <EmptyMemory text="正在读取记忆…" />}
            {!library && !loading && <EmptyMemory text="暂时无法读取记忆。" />}
            {library && visibleMemories.length === 0 && <EmptyMemory text="当前筛选下没有记忆。" />}
            {visibleMemories.map((memory) => (
              <button key={memory.id} type="button" className={`memory-catalog-item ${selectedMemoryId === memory.id ? 'selected' : ''}`} onClick={() => setSelectedMemoryId(memory.id)}>
                <span className="memory-catalog-meta"><KindBadge kind={memory.kind} /><OriginBadge origin={memory.creationOrigin} /></span>
                <strong>{memory.currentBody ?? '正文已清除'}</strong>
                <small>{memory.currentRetrievalKeys.join(' · ') || '无 Retrieval Keys'} · {memoryPeopleLabel(memory, agents)}</small>
              </button>
            ))}
          </div>
        </div>
        <MemoryDetail
          memory={selectedMemory}
          loading={loading}
          agents={agents}
          busy={busy}
          onRevise={openRevise}
          onReview={openReviewSchedule}
          onRetire={(memory) => lifecycle('memory.retire', memory)}
          onReactivate={(memory) => lifecycle('memory.reactivate', memory)}
          onForget={setForgetTarget}
        />
      </div>

      <ReviewDrawer
        open={reviewDrawerOpen}
        reviewItems={reviewItems}
        memories={library?.memories ?? []}
        agents={agents}
        busy={busy}
        onOpenChange={setReviewDrawerOpen}
        onAccept={acceptReview}
        onEdit={openReviewEdit}
        onReject={rejectReview}
      />

      <ReviewScheduleDialog
        editor={reviewScheduleEditor}
        busyAction={reviewScheduleBusyAction}
        onChange={(nextEditor) => setReviewScheduleEditor(nextEditor)}
        onClose={() => {
          if (reviewScheduleBusyAction === null) setReviewScheduleEditor(null)
        }}
        onSubmit={submitReviewSchedule}
        onRetryRefresh={retryReviewScheduleRefresh}
        onRestoreFocus={() => {
          const trigger = reviewScheduleTriggerRef.current
          const fallback = document.querySelector<HTMLButtonElement>('.memory-catalog-item.selected')
          if (trigger?.isConnected) trigger.focus()
          else fallback?.focus()
        }}
      />

      <MemoryEditorDialog editor={editor} draft={draft} agents={agents} busy={busy !== null} onDraft={setDraft} onClose={() => setEditor(null)} onSubmit={submitEditor} />

      <Dialog.Root open={forgetTarget !== null} onOpenChange={(open) => { if (!open) setForgetTarget(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="memory-confirm-dialog" tone="danger">
            <AppDialogHeader
              title="永久遗忘这条记忆？"
              description="当前正文、Retrieval Keys 与受控候选内容会被清除，操作不可撤销。"
              icon="brain"
              kicker="不可撤销"
              closeDisabled={busy !== null}
            />
            <AppDialogFooter note="清除后无法恢复。">
              <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={busy !== null}>取消</button></Dialog.Close>
              <button className="danger-button" type="button" onClick={() => forgetTarget && void forget(forgetTarget)} disabled={busy !== null}>{busy?.startsWith('forget-') ? '正在遗忘…' : '永久遗忘'}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

export function CapacityStrip({
  library,
  scope,
  agents
}: {
  library: MemoryLibraryView | null
  scope: MemoryScopeKind
  agents: AgentProfile[]
}): React.JSX.Element | null {
  const capacities = library?.capacities.filter((capacity) => capacity.scope === scope) ?? []
  if (capacities.length === 0) return null
  return (
    <ul className="memory-capacity-strip" aria-label="当前范围容量，可横向滚动查看全部" tabIndex={0}>
      {capacities.map((capacity) => (
        <li key={capacity.scopeKey} className="memory-capacity-item">
          <span className="memory-capacity-name">{memoryCapacityLabel(capacity, agents)}</span>
          <span className="memory-capacity-metrics">
            <span><strong>{capacity.activeCount}/{capacity.maxCount}</strong><small>总量</small></span>
            <span><strong>{capacity.agentOriginCount}/{capacity.agentOriginMaxCount}</strong><small>队员形成</small></span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function memoryCapacityLabel(capacity: MemoryCapacity, agents: AgentProfile[]): string {
  const companionPrefix = 'companion:'
  const relationshipPrefix = 'relationship:'
  const applicablePrefix = 'relationship-applicable:'

  if (capacity.scopeKey === 'hearth') return '共同记忆'
  if (capacity.scopeKey.startsWith(companionPrefix)) {
    return agentName(capacity.scopeKey.slice(companionPrefix.length), agents)
  }
  if (capacity.scopeKey.startsWith(applicablePrefix)) {
    return `适用于 ${agentName(capacity.scopeKey.slice(applicablePrefix.length), agents)}`
  }
  if (capacity.scopeKey.startsWith(relationshipPrefix)) {
    for (let first = 0; first < agents.length; first += 1) {
      for (let second = first + 1; second < agents.length; second += 1) {
        const left = agents[first]
        const right = agents[second]
        if (capacity.scopeKey === `${relationshipPrefix}${left.agentId}:${right.agentId}`
          || capacity.scopeKey === `${relationshipPrefix}${right.agentId}:${left.agentId}`) {
          return `${left.displayName} × ${right.displayName}`
        }
      }
    }
    const agentIds = capacity.scopeKey.slice(relationshipPrefix.length).split(':')
    if (agentIds.length === 2) return agentIds.map((id) => agentName(id, agents)).join(' × ')
    return '队员组合'
  }
  return scopeLabel(capacity.scope)
}

function MemoryDetail({
  memory,
  loading,
  agents,
  busy,
  onRevise,
  onReview,
  onRetire,
  onReactivate,
  onForget
}: {
  memory: MemoryRecord | null
  loading: boolean
  agents: AgentProfile[]
  busy: string | null
  onRevise(memory: MemoryRecord): void
  onReview(memory: MemoryRecord, trigger: HTMLButtonElement): void
  onRetire(memory: MemoryRecord): Promise<void>
  onReactivate(memory: MemoryRecord): Promise<void>
  onForget(memory: MemoryRecord): void
}): React.JSX.Element {
  if (!memory) {
    return <aside className="memory-detail empty"><span aria-hidden="true">⌁</span><strong>{loading ? '正在读取记忆' : '选择一条记忆查看详情'}</strong><p>{loading ? '列表与治理状态会在本地数据就绪后显示。' : '这里会显示正文、来源、Retrieval Keys、版本历史和治理操作。'}</p></aside>
  }
  const people = memoryPeople(memory, agents)
  return (
    <aside className="memory-detail" aria-labelledby={`memory-detail-${memory.id}`}>
      <header>
        <div className="memory-detail-badges"><KindBadge kind={memory.kind} /><OriginBadge origin={memory.creationOrigin} /><span className={`status-badge status-${memory.lifecycle === 'active' ? 'completed' : 'pending'}`}><i />{lifecycleLabel(memory.lifecycle)}</span></div>
        <h3 id={`memory-detail-${memory.id}`}>{memory.currentBody ?? '正文已遗忘'}</h3>
        <small>{scopeLabel(memory.scope)} · 更新于 {formatTime(memory.updatedAt)}</small>
      </header>

      {people.length > 0 && (
        <section className="memory-detail-section">
          <h4>适用队员</h4>
          <div className="memory-people">
            {people.map((agent) => <span key={agent.agentId}><MemberAvatar agentId={agent.agentId} avatarRef={agent.avatarRef} displayName={agent.displayName} size="list" decorative /><strong>{agent.displayName}</strong></span>)}
            {memory.direction && <small>{directionLabel(memory, agents)}</small>}
          </div>
        </section>
      )}

      <section className="memory-detail-section memory-detail-facts">
        <h4>治理信息</h4>
        <dl>
          <div><dt>形成来源</dt><dd>{originLabel(memory.creationOrigin)}</dd></div>
          <div><dt>Retrieval Keys</dt><dd>{memory.currentRetrievalKeys.join('、') || '—'}</dd></div>
          <div><dt>下次复核</dt><dd>{memory.reviewAfter ? formatTime(memory.reviewAfter) : '未设置'}</dd></div>
          <div><dt>当前版本</dt><dd>v{memory.version} · {shortId(memory.currentRevisionId)}</dd></div>
        </dl>
      </section>

      <section className="memory-detail-section memory-revisions">
        <h4>版本记录</h4>
        {memory.revisions.map((revision) => (
          <article key={revision.id}>
            <span className={`memory-authority ${revision.actorKind === 'agent' ? 'agent-origin' : 'user-origin'}`}>{revision.actorKind === 'agent' ? '队员修订' : revision.actorKind === 'user' ? '用户修订' : '已清除'}</span>
            <strong>{revision.body ?? '正文已清除'}</strong>
            {revision.retrievalKeys.length > 0 && <small>{revision.retrievalKeys.join(' · ')}</small>}
            <small>{formatTime(revision.createdAt)} · {shortId(revision.id)}</small>
          </article>
        ))}
      </section>

      <div className="memory-detail-actions">
        {memory.lifecycle === 'active' && <>
          <button className="quiet-button" type="button" onClick={() => onRevise(memory)} disabled={busy !== null}>修订</button>
          <button className="quiet-button" type="button" onClick={(event) => onReview(memory, event.currentTarget)} disabled={busy !== null}>设置下次复核</button>
          <button className="quiet-button" type="button" onClick={() => void onRetire(memory)} disabled={busy !== null}>停止沿用</button>
        </>}
        {memory.lifecycle === 'retired' && memory.outgoingSuccessorIds.length === 0 && <button className="primary-button" type="button" onClick={() => void onReactivate(memory)} disabled={busy !== null}>重新沿用</button>}
        {memory.lifecycle !== 'forgotten' && <button className="danger-button" type="button" onClick={() => onForget(memory)} disabled={busy !== null}>永久遗忘</button>}
      </div>
    </aside>
  )
}

function ReviewScheduleDialog({
  editor,
  busyAction,
  onChange,
  onClose,
  onSubmit,
  onRetryRefresh,
  onRestoreFocus
}: {
  editor: ReviewScheduleEditor | null
  busyAction: ReviewScheduleBusyAction | null
  onChange(editor: ReviewScheduleEditor): void
  onClose(): void
  onSubmit(action: ReviewScheduleAction): Promise<void>
  onRetryRefresh(): Promise<void>
  onRestoreFocus(): void
}): React.JSX.Element {
  const lastEditor = useRef<ReviewScheduleEditor | null>(null)
  const customInputRef = useRef<HTMLInputElement>(null)
  const choiceGroupRef = useRef<HTMLDivElement>(null)
  if (editor) lastEditor.current = editor
  const renderedEditor = editor ?? lastEditor.current

  if (!renderedEditor) return <></>

  const busy = busyAction !== null
  const openedAt = new Date(renderedEditor.openedAt)
  const referenceDate = Number.isNaN(openedAt.getTime()) ? new Date() : openedAt
  const validation = validateReviewScheduleDraft(renderedEditor)
  const customDate = parseLocalDateTimeValue(renderedEditor.localDateTime)
  const memoryAvailable = renderedEditor.memory.lifecycle === 'active'
  const controlsDisabled = busy || renderedEditor.phase !== 'ready' || !memoryAvailable
  const saveDisabled = controlsDisabled || validation.code !== null || !validation.selectedDate
  const hasReminder = renderedEditor.memory.reviewAfter !== null
  const validationId = 'memory-review-schedule-validation'
  const noticeId = 'memory-review-schedule-notice'
  const timezoneId = 'memory-review-schedule-timezone'
  const radioModes: ReviewScheduleMode[] = [...reviewSchedulePresetModes, 'custom']

  const changeEditor = (changes: Partial<ReviewScheduleEditor>): void => {
    if (!editor || controlsDisabled) return
    onChange({ ...editor, ...changes })
  }

  const selectMode = (mode: ReviewScheduleMode, focusCustom = false): void => {
    changeEditor({ mode })
    if (focusCustom) window.requestAnimationFrame(() => customInputRef.current?.focus())
  }

  const handleRadioKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    mode: ReviewScheduleMode
  ): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = radioModes.indexOf(mode)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radioModes.length - 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (currentIndex - 1 + radioModes.length) % radioModes.length
          : (currentIndex + 1) % radioModes.length
    const nextMode = radioModes[nextIndex]
    selectMode(nextMode)
    window.requestAnimationFrame(() => {
      choiceGroupRef.current
        ?.querySelector<HTMLElement>(`[data-review-schedule-mode="${nextMode}"]`)
        ?.focus()
    })
  }

  const lifecycleMessage = renderedEditor.memory.lifecycle === 'forgotten'
    ? '这条记忆已被永久遗忘，不能再设置复核提醒。请关闭弹窗查看最新列表。'
    : renderedEditor.memory.lifecycle === 'retired'
      ? '这条记忆已停止沿用，不能设置复核提醒。请关闭弹窗，重新沿用后再设置。'
      : null

  return (
    <Dialog.Root
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent
          className="memory-review-schedule-dialog"
          aria-busy={busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onRestoreFocus()
          }}
        >
          <AppDialogHeader
            title="设置下次复核"
            description="选择一个未来时间。到期后，这条记忆会进入“待复核”，但仍会继续沿用。"
            icon="clock"
            closeLabel="关闭设置下次复核弹窗"
            closeDisabled={busy}
          />
          <form className="app-dialog-form" onSubmit={(event) => {
            event.preventDefault()
            void onSubmit('save')
          }}>
            <AppDialogBody>
              <div className="memory-review-schedule-heading">
                <strong>选择下次复核</strong>
                <span>快捷日期按当前设备的本地日历计算。</span>
              </div>

              <div
                ref={choiceGroupRef}
                className="memory-review-schedule-choice-group"
                role="radiogroup"
                aria-label="下次复核选项"
                aria-describedby={`${validationId}${renderedEditor.notice || lifecycleMessage ? ` ${noticeId}` : ''}`}
              >
                <div className="memory-review-schedule-options">
                  {reviewSchedulePresetModes.map((mode) => {
                    const date = addLocalCalendarDays(referenceDate, Number(mode))
                    const selected = renderedEditor.mode === mode
                    return (
                      <button
                        key={mode}
                        className="memory-review-schedule-option"
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        data-review-schedule-mode={mode}
                        data-dialog-autofocus={selected ? '' : undefined}
                        disabled={controlsDisabled}
                        onClick={() => selectMode(mode)}
                        onKeyDown={(event) => handleRadioKeyDown(event, mode)}
                      >
                        <strong>{mode} 天后</strong>
                        <small>{formatReviewPresetDate(date, referenceDate)}</small>
                      </button>
                    )
                  })}
                </div>

                <button
                  className="memory-review-schedule-custom-trigger"
                  type="button"
                  role="radio"
                  aria-checked={renderedEditor.mode === 'custom'}
                  tabIndex={renderedEditor.mode === 'custom' ? 0 : -1}
                  data-review-schedule-mode="custom"
                  data-dialog-autofocus={renderedEditor.mode === 'custom' ? '' : undefined}
                  disabled={controlsDisabled}
                  onClick={() => selectMode('custom', true)}
                  onKeyDown={(event) => handleRadioKeyDown(event, 'custom')}
                >
                  <span>
                    <strong>自定义时间</strong>
                    <small>{renderedEditor.mode === 'custom' && customDate
                      ? formatTime(customDate.toISOString())
                      : '选择日期和时间'}</small>
                  </span>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5v3M15 3.5v3M3 8h14" /><rect x="3" y="5" width="14" height="12" rx="2" /></svg>
                </button>
              </div>

              {renderedEditor.mode === 'custom' && (
                <div className="memory-review-schedule-custom-field">
                  <div>
                    <label htmlFor="memory-review-schedule-time">下次复核时间</label>
                    <small id={timezoneId}>当前设备时区 · {localTimeZoneName()}</small>
                  </div>
                  <input
                    ref={customInputRef}
                    id="memory-review-schedule-time"
                    type="datetime-local"
                    value={renderedEditor.localDateTime}
                    min={toLocalDateTimeValue(nextLocalMinute())}
                    disabled={controlsDisabled}
                    aria-invalid={validation.invalid || undefined}
                    aria-describedby={`${timezoneId} ${validationId}${renderedEditor.notice || lifecycleMessage ? ` ${noticeId}` : ''}`}
                    onChange={(event) => changeEditor({
                      mode: 'custom',
                      localDateTime: event.target.value
                    })}
                  />
                </div>
              )}

              <div
                id={validationId}
                className={`memory-review-schedule-validation${validation.invalid ? ' is-error' : ''}`}
                role={validation.invalid ? 'alert' : 'status'}
              >
                {validation.message}
              </div>

              {(renderedEditor.notice || lifecycleMessage) && (
                <div
                  id={noticeId}
                  className={`memory-review-schedule-alert ${renderedEditor.notice?.tone === 'info' && !lifecycleMessage ? 'is-info' : 'is-error'}`}
                  role={renderedEditor.notice?.tone === 'info' && !lifecycleMessage ? 'status' : 'alert'}
                >
                  <AppDialogGlyph name={renderedEditor.notice?.tone === 'info' && !lifecycleMessage ? 'info' : 'warning'} />
                  <div>
                    <strong>{renderedEditor.phase === 'applied-refresh-failed'
                      ? '设置已生效，列表尚未刷新'
                      : lifecycleMessage
                        ? '无法设置复核提醒'
                        : renderedEditor.notice?.tone === 'info'
                          ? '已刷新权威状态'
                          : '操作未完成'}</strong>
                    <p>{lifecycleMessage ?? renderedEditor.notice?.message}</p>
                    {renderedEditor.phase !== 'ready' && (
                      <button
                        className="quiet-button compact"
                        type="button"
                        disabled={busy}
                        onClick={() => void onRetryRefresh()}
                      >
                        {busyAction === 'refresh'
                          ? '正在刷新…'
                          : renderedEditor.phase === 'applied-refresh-failed'
                            ? '只重试刷新'
                            : '重新获取最新状态'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="memory-review-schedule-note">
                <AppDialogGlyph name="info" />
                <div>
                  <strong>到期后仍会继续沿用</strong>
                  <p>保存只更新复核提醒，不会修改记忆正文、沿用状态或适用范围。</p>
                </div>
              </div>
            </AppDialogBody>
            <AppDialogFooter
              leading={(
                <div className="memory-review-schedule-footer-leading">
                  {hasReminder && (
                    <button
                      className="quiet-button compact"
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => void onSubmit('clear')}
                    >
                      {busyAction === 'clear' ? '正在清除…' : '清除提醒'}
                    </button>
                  )}
                  <span>时间精确到分钟，且必须晚于当前时间。</span>
                </div>
              )}
            >
              <Dialog.Close asChild>
                <button className="quiet-button" type="button" disabled={busy}>
                  {renderedEditor.phase === 'applied-refresh-failed' ? '关闭' : '取消'}
                </button>
              </Dialog.Close>
              <button className="primary-button" type="submit" disabled={saveDisabled}>
                {busyAction === 'save' ? '正在保存…' : '保存设置'}
              </button>
            </AppDialogFooter>
          </form>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReviewDrawer({
  open,
  reviewItems,
  memories,
  agents,
  busy,
  onOpenChange,
  onAccept,
  onEdit,
  onReject
}: {
  open: boolean
  reviewItems: HearthReviewItem[]
  memories: MemoryRecord[]
  agents: AgentProfile[]
  busy: string | null
  onOpenChange(open: boolean): void
  onAccept(reviewItem: HearthReviewItem): Promise<void>
  onEdit(reviewItem: HearthReviewItem): void
  onReject(reviewItem: HearthReviewItem): Promise<void>
}): React.JSX.Element {
  const pending = reviewItems.filter((reviewItem) => reviewItem.status === 'pending')
  const history = reviewItems.filter((reviewItem) => reviewItem.status !== 'pending')
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay memory-drawer-overlay" />
        <Dialog.Content className="memory-review-drawer">
          <header>
            <div><Dialog.Title>共同记忆审核</Dialog.Title><Dialog.Description>待审核候选与正式记忆隔离；接受后才会进入共同记忆。关闭抽屉不会改变审核状态。</Dialog.Description></div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="关闭共同记忆审核">×</button></Dialog.Close>
          </header>
          <div className="memory-review-drawer-list">
            <section className="memory-review-section" aria-labelledby="pending-review-items-title">
              <div className="memory-review-section-heading"><strong id="pending-review-items-title">待审核</strong><span>{pending.length}</span></div>
              {pending.length === 0 && <EmptyMemory text="没有等待处理的共同记忆审核项。" />}
              {pending.map((reviewItem) => (
                <article key={reviewItem.reviewItemId} className={`memory-review-item ${reviewItem.stale ? 'is-stale' : ''}`}>
                  <div>
                    <span className="memory-catalog-meta"><KindBadge kind={reviewItem.candidateKind} /><b>{reviewItem.requestedAction === 'add' ? '新增' : '修订'}</b>{reviewItem.stale && <strong className="memory-stale">基准已变化</strong>}</span>
                    <p>{reviewItem.candidateBody}</p>
                    {(reviewItem.candidateRetrievalKeys?.length ?? 0) > 0 && <small>Retrieval Keys：{reviewItem.candidateRetrievalKeys?.join(' · ')}</small>}
                    <small>{agentName(reviewItem.sourceAgentId, agents)} 提交 · {formatTime(reviewItem.createdAt)}</small>
                    {reviewItem.requestedAction === 'revise' && <small>目标：{reviewTargetLabel(reviewItem, memories)} · 基准 {shortId(reviewItem.baseRevisionId)}</small>}
                    {reviewItem.stale && <p className="memory-review-warning">目标记忆已变化，不能再接受或编辑；你仍可以明确拒绝并结束这条审核。</p>}
                  </div>
                  <footer>
                    <button className="quiet-button compact" type="button" onClick={() => void onReject(reviewItem)} disabled={busy !== null}>拒绝</button>
                    {!reviewItem.stale && <button className="quiet-button compact" type="button" onClick={() => onEdit(reviewItem)} disabled={busy !== null}>编辑后接受</button>}
                    {!reviewItem.stale && <button className="primary-button compact" type="button" onClick={() => void onAccept(reviewItem)} disabled={busy !== null}>接受</button>}
                  </footer>
                </article>
              ))}
            </section>
            <section className="memory-review-section memory-review-history" aria-labelledby="review-history-title">
              <div className="memory-review-section-heading"><strong id="review-history-title">处理记录</strong><span>{history.length}</span></div>
              {history.length === 0 && <EmptyMemory text="还没有已处理的审核记录。" />}
              {history.map((reviewItem) => (
                <article key={reviewItem.reviewItemId} className="memory-review-item is-terminal">
                  <div>
                    <span className="memory-catalog-meta"><span className={`status-badge status-${reviewStatusTone(reviewItem.status)}`}><i />{reviewStatusLabel(reviewItem.status)}</span><b>{reviewItem.requestedAction === 'add' ? '新增' : '修订'}</b></span>
                    <p className="memory-review-terminal-copy">候选内容已从审核区清除，不在历史记录中保留或重建。</p>
                    <small>{agentName(reviewItem.sourceAgentId, agents)} 提交 · {formatTime(reviewItem.createdAt)}</small>
                    <small>{reviewResolutionLabel(reviewItem)}{reviewItem.resolvedAt ? ` · ${formatTime(reviewItem.resolvedAt)}` : ''}</small>
                    {reviewItem.status === 'accepted' && <small>正式记忆 {shortId(reviewItem.acceptedMemoryId)} · 版本 {shortId(reviewItem.acceptedRevisionId)}{reviewItem.editedBeforeAcceptance ? ' · 接受前已编辑' : ''}</small>}
                  </div>
                </article>
              ))}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MemoryEditorDialog({
  editor,
  draft,
  agents,
  busy,
  onDraft,
  onClose,
  onSubmit
}: {
  editor: Editor
  draft: Draft
  agents: AgentProfile[]
  busy: boolean
  onDraft(value: Draft): void
  onClose(): void
  onSubmit(event: React.FormEvent): void
}): React.JSX.Element {
  const identityLocked = editor?.kind === 'revise' || editor?.kind === 'reviewItem'
  const keys = draft.retrievalKeys.split(',').map((key) => key.trim()).filter(Boolean)
  const keyBytes = keys.reduce((total, key) => total + new TextEncoder().encode(key).length, 0)
  const identityValid = draft.scope === 'hearth'
    || (draft.scope === 'companion' && draft.firstAgentId !== '')
    || (draft.scope === 'relationship' && draft.kind !== 'preference' && draft.firstAgentId !== '' && draft.secondAgentId !== '' && draft.firstAgentId !== draft.secondAgentId && (draft.direction === 'mutual' || [draft.firstAgentId, draft.secondAgentId].includes(draft.directedActorAgentId)))
  const keysValid = keys.length >= 1 && keys.length <= 3 && keys.every((key) => new TextEncoder().encode(key).length >= 2 && new TextEncoder().encode(key).length <= 24) && keyBytes <= 48
  const bodyBytes = new TextEncoder().encode(draft.body).length
  const reviewItemEditable = editor?.kind !== 'reviewItem'
    || (editor.reviewItem.status === 'pending' && !editor.reviewItem.stale)
  return (
    <Dialog.Root open={editor !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="memory-editor-dialog" width="wide">
          <AppDialogHeader
            title={editor?.kind === 'create' ? '新增记忆' : editor?.kind === 'reviewItem' ? '编辑后接受共同记忆审核项' : '修订记忆'}
            description="正文应面向未来、可独立理解且不包含秘密。Retrieval Keys 只用于检索，不代替正文。"
            icon="brain"
            closeDisabled={busy}
          />
          <form className="app-dialog-form" onSubmit={onSubmit}>
            <AppDialogBody>
              <div className="memory-editor-grid">
                <label className="field-label">范围<select value={draft.scope} disabled={identityLocked || busy} onChange={(event) => onDraft({ ...draft, scope: event.target.value as MemoryScopeKind })}><option value="hearth">共同记忆</option><option value="companion">队员记忆</option><option value="relationship">队员间记忆</option></select></label>
                <label className="field-label">类型<select value={draft.kind} disabled={identityLocked || busy} onChange={(event) => onDraft({ ...draft, kind: event.target.value as MemoryKind })}><option value="preference" disabled={draft.scope === 'relationship'}>偏好</option><option value="agreement">约定</option><option value="lesson">经验</option></select></label>
                {draft.scope === 'companion' && <AgentSelect label="队员" value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />}
                {draft.scope === 'relationship' && <>
                  <AgentSelect label="队员 A" value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />
                  <AgentSelect label="队员 B" value={draft.secondAgentId} agents={agents.filter((agent) => agent.agentId !== draft.firstAgentId)} disabled={identityLocked || busy} onChange={(secondAgentId) => onDraft({ ...draft, secondAgentId })} />
                  <label className="field-label">方向<select value={draft.direction} disabled={identityLocked || busy} onChange={(event) => onDraft({ ...draft, direction: event.target.value as MemoryDirection })}><option value="mutual">双方共同</option><option value="directed">单向</option></select></label>
                  {draft.direction === 'directed' && <AgentSelect label="责任方" value={draft.directedActorAgentId} agents={agents.filter((agent) => [draft.firstAgentId, draft.secondAgentId].includes(agent.agentId))} disabled={identityLocked || busy} onChange={(directedActorAgentId) => onDraft({ ...draft, directedActorAgentId })} />}
                </>}
              </div>
              <label className="field-label memory-body-field">Retrieval Keys<input value={draft.retrievalKeys} disabled={busy} placeholder="1–3 个关键词，使用逗号分隔" onChange={(event) => onDraft({ ...draft, retrievalKeys: event.target.value })} /><small>{keys.length}/3 项 · {keyBytes}/48 bytes</small></label>
              <label className="field-label memory-body-field">正文<textarea autoFocus data-dialog-autofocus value={draft.body} rows={7} disabled={busy} onChange={(event) => onDraft({ ...draft, body: event.target.value })} /><small>{bodyBytes}/2048 bytes</small></label>
              {!reviewItemEditable && <div className="memory-review-warning" role="status">权威审核状态已变化。草稿仍保留，但这条审核不能再接受；请关闭后查看最新记录。</div>}
            </AppDialogBody>
            <AppDialogFooter>
              <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close>
              <button className="primary-button" type="submit" disabled={!draft.body.trim() || bodyBytes > 2048 || !identityValid || !keysValid || !reviewItemEditable || busy}>{busy ? '正在保存…' : editor?.kind === 'reviewItem' ? '接受最终内容' : editor?.kind === 'revise' ? '保存修订' : '保存记忆'}</button>
            </AppDialogFooter>
          </form>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AgentSelect({ label, value, agents, disabled, onChange }: { label: string; value: string; agents: AgentProfile[]; disabled: boolean; onChange(value: string): void }): React.JSX.Element {
  return <label className="field-label">{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.displayName}</option>)}</select></label>
}

function EmptyMemory({ text }: { text: string }): React.JSX.Element {
  return <div className="empty-inline">{text}</div>
}

function KindBadge({ kind }: { kind: MemoryKind | null }): React.JSX.Element {
  const shape = kind === 'preference' ? '○' : kind === 'lesson' ? '◇' : '□'
  return <span className={`memory-kind kind-${kind ?? 'agreement'}`}>{kindLabel(kind)} <i aria-hidden="true">{shape}</i></span>
}

function OriginBadge({ origin }: { origin: MemoryRecord['creationOrigin'] }): React.JSX.Element | null {
  if (!origin) return null
  return <span className={`memory-authority ${origin === 'agent' ? 'agent-origin' : 'user-origin'}`}>{originLabel(origin)}</span>
}

function reviewScheduleConflictNotice(
  memory: MemoryRecord,
  desiredAlreadyApplied: boolean,
  action: ReviewScheduleAction
): NonNullable<ReviewScheduleEditor['notice']> {
  if (memory.lifecycle === 'forgotten') {
    return {
      tone: 'error',
      message: '这条记忆已被永久遗忘，不能再设置复核提醒。当前选择仍保留，请关闭弹窗查看最新列表。'
    }
  }
  if (memory.lifecycle === 'retired') {
    return {
      tone: 'error',
      message: '这条记忆已停止沿用，不能设置复核提醒。当前选择仍保留，请关闭弹窗或重新沿用后再设置。'
    }
  }
  if (desiredAlreadyApplied) {
    return {
      tone: 'info',
      message: action === 'clear'
        ? '复核提醒已经由另一项操作清除，无需再次提交。'
        : '下次复核已经是你选择的时间，无需重复保存。'
    }
  }
  return {
    tone: 'info',
    message: '记忆版本已变化。已刷新到最新版本并保留当前选择，请核对后再次保存。'
  }
}

class CommandRejectedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CommandRejectedError'
  }
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') {
    const message = typeof result.payload.message === 'string' ? result.payload.message : result.code
    throw new CommandRejectedError(result.code, message)
  }
}

function isMemoryConflict(code: string): boolean {
  return code === 'memory.version_conflict'
    || code === 'memory.revision_conflict'
    || code === 'memory.lifecycle_conflict'
    || code === 'memory.review_version_conflict'
    || code === 'memory.review_conflict'
    || code === 'memory.review_stale'
}

function refreshEditorAuthority(editor: Editor, snapshot: MemorySnapshot): Editor {
  if (editor?.kind === 'revise') {
    const memory = snapshot.library.memories.find((candidate) => candidate.id === editor.memory.id)
    return memory ? { kind: 'revise', memory } : editor
  }
  if (editor?.kind === 'reviewItem') {
    const reviewItem = snapshot.reviewItems.find((candidate) =>
      candidate.reviewItemId === editor.reviewItem.reviewItemId
    )
    return reviewItem ? { kind: 'reviewItem', reviewItem } : editor
  }
  return editor
}

function scopeLabel(scope: MemoryScopeKind | null): string {
  return scope === 'hearth' ? '共同记忆' : scope === 'companion' ? '队员记忆' : scope === 'relationship' ? '队员间记忆' : '已遗忘'
}

function kindLabel(kind: MemoryKind | null): string {
  return kind === 'preference' ? '偏好' : kind === 'agreement' ? '约定' : kind === 'lesson' ? '经验' : '—'
}

function originLabel(origin: MemoryRecord['creationOrigin']): string {
  return origin === 'agent' ? '队员形成' : origin === 'accepted_hearth_review' ? '队员提交 · 用户采纳' : origin === 'user' ? '用户创建' : '—'
}

function reviewStatusLabel(status: HearthReviewItem['status']): string {
  return status === 'accepted' ? '已接受' : status === 'rejected' ? '已拒绝' : status === 'invalidated' ? '已失效' : '待审核'
}

function reviewStatusTone(status: HearthReviewItem['status']): string {
  return status === 'accepted' ? 'completed' : status === 'rejected' ? 'failed' : 'pending'
}

function reviewResolutionLabel(reviewItem: HearthReviewItem): string {
  if (reviewItem.status === 'accepted') return '已由用户接受'
  if (reviewItem.status === 'rejected') return '已由用户拒绝'
  if (reviewItem.invalidationReason === 'target_forgotten') return '目标记忆已永久遗忘，审核项自动失效'
  if (reviewItem.invalidationReason === 'exact_candidate_published') return '同一候选已经成为正式记忆，审核项自动失效'
  return '审核项已失效'
}

function reviewTargetLabel(reviewItem: HearthReviewItem, memories: MemoryRecord[]): string {
  const memory = memories.find((candidate) => candidate.id === reviewItem.targetMemoryId)
  if (!memory) return shortId(reviewItem.targetMemoryId)
  return memory.currentBody ? `${shortId(memory.id)} · ${memory.currentBody}` : shortId(memory.id)
}

function lifecycleLabel(lifecycle: MemoryRecord['lifecycle']): string {
  return lifecycle === 'active' ? '正在沿用' : lifecycle === 'retired' ? '已停止沿用' : '已遗忘'
}

function memoryPeople(memory: MemoryRecord, agents: AgentProfile[]): AgentProfile[] {
  const ids = memory.scope === 'companion'
    ? [memory.companionAgentId]
    : memory.scope === 'relationship' ? memory.relationshipAgentIds : []
  return ids.flatMap((id) => {
    const agent = agents.find((candidate) => candidate.agentId === id)
    return agent ? [agent] : []
  })
}

function memoryPeopleLabel(memory: MemoryRecord, agents: AgentProfile[]): string {
  const people = memoryPeople(memory, agents)
  return people.length > 0 ? people.map((agent) => agent.displayName).join(' × ') : scopeLabel(memory.scope)
}

function directionLabel(memory: MemoryRecord, agents: AgentProfile[]): string {
  if (memory.direction === 'mutual') return '双方共同'
  if (memory.direction === 'directed') {
    const actor = agentName(memory.directedActorAgentId, agents)
    const counterparty = agentName(memory.relationshipAgentIds.find((id) => id !== memory.directedActorAgentId), agents)
    return `${actor} → ${counterparty}`
  }
  return ''
}

function agentName(id: string | null | undefined, agents: AgentProfile[]): string {
  if (!id) return '未知队员'
  return agents.find((agent) => agent.agentId === id)?.displayName ?? shortId(id)
}

function shortId(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 10 ? `${value.slice(0, 8)}…` : value
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
