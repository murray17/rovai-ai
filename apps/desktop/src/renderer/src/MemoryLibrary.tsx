import { useMemoryCapability } from './MemoryCapabilityProvider'
import { useThreadClient } from './camp-client'
import { MobileBack, useMobileLayout } from './MobileLayout'
import { newCommandId } from '../../shared/command-id'
import { readErrorMessage } from './error-message'
import type { MemoryNavigationTarget } from './desktop-navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AgentProfile,
  CreateMemoryCommand,
  HearthReviewItem,
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
  AppDialogHeader,
  DialogControlIcon
} from './AppDialog'
import { MemoryContentFields, splitRetrievalKeys, validateMemoryContent } from './MemoryContentFields'
import { MemoryReviewDialog, type ReviewResolution } from './MemoryReviewDialog'
import { MemoryAvatar, scopeLabel, kindLabel, originLabel, memoryPeopleLabel, directionLabel, formatTime } from './memory-presentation'
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
import { UiText, uiAttribute } from './interface-language'

type LibraryScope = MemoryScopeKind | 'all'
type Editor =
  | { kind: 'create'; scope: MemoryScopeKind }
  | { kind: 'revise'; memory: MemoryRecord }
  | null

interface Draft {
  scope: MemoryScopeKind
  kind: MemoryKind
  body: string
  retrievalKeys: string
  keyInput: string
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
  keyInput: '',
  firstAgentId: '',
  secondAgentId: '',
  direction: 'mutual',
  directedActorAgentId: ''
}

const scopeTabs: Array<[LibraryScope, string]> = [
  ['all', '全部'],
  ['hearth', '共同'],
  ['companion', '队员'],
  ['relationship', '队员间']
]

function MemoryCapabilitySwitch(): React.JSX.Element {
  const memory = useMemoryCapability()
  return <button
    className="memory-capability-switch"
    type="button"
    role="switch"
    aria-label={uiAttribute('Rovai 长期记忆')}
    aria-checked={memory.enabled}
    aria-busy={memory.saving}
    disabled={!memory.ready || memory.error === 'read' || memory.saving}
    onClick={() => void memory.setEnabled(!memory.enabled)}
  >
    <span><UiText zh="Rovai 长期记忆" /></span>
    <span className="memory-capability-switch-track" aria-hidden="true" />
  </button>
}

export function MemoryLibrary({
  agents,
  topNotices,
  refreshSignal = 0,
  focusMemoryId = null,
  navigationTarget,
  onNavigate,
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
  navigationTarget?: MemoryNavigationTarget
  onNavigate?(target: MemoryNavigationTarget, mode: 'push' | 'replace'): void
  reviewDrawerSignal?: number
  onReviewDrawerSignalConsumed?(): void
  onPendingCountChange?(count: number): void
  onReady?(): void
  startupFeedbackVisible?: boolean
}): React.JSX.Element {
  const client = useThreadClient()
  const memory = useMemoryCapability()
  const memoryActive = useRef(memory.active)
  const previousActive = memoryActive.current
  memoryActive.current = memory.active
  const libraryGeneration = useRef(0)
  const reviewGeneration = useRef(0)
  if (previousActive !== memory.active) { libraryGeneration.current++; reviewGeneration.current++ }
  const memoryRequest = useCallback(<T,>(method: Parameters<typeof client.request>[0], params?: unknown): Promise<T> => {
    if (!memoryActive.current) return Promise.reject(new Error(uiAttribute('Rovai 长期记忆状态暂不可用，请重试。')))
    return client.request<T>(method, params)
  }, [client])
  useEffect(() => () => { libraryGeneration.current++; reviewGeneration.current++ }, [client])
  const [library, setLibrary] = useState<MemoryLibraryView | null>(null)
  const mobile = useMobileLayout()
  const [reviewItems, setReviewItems] = useState<HearthReviewItem[]>([])
  const [localScope, setLocalScope] = useState<LibraryScope>('all')
  const [localSearch, setLocalSearch] = useState('')
  const [localMemoryId, setLocalMemoryId] = useState<string | null>(null)
  const scope = navigationTarget?.scope ?? localScope
  const governance = 'all' as const
  const search = navigationTarget?.search ?? localSearch
  const selectedMemoryId = navigationTarget ? navigationTarget.memoryId : localMemoryId
  const navigateMemory = (patch: Partial<MemoryNavigationTarget>, mode: 'push' | 'replace'): void => {
    if (onNavigate) onNavigate({ kind: 'memory', memoryId: selectedMemoryId, scope, governance, search, ...patch }, mode)
    else {
      if ('memoryId' in patch) setLocalMemoryId(patch.memoryId ?? null)
      if (patch.scope !== undefined) setLocalScope(patch.scope)
      if (patch.search !== undefined) setLocalSearch(patch.search)
    }
  }
  const setScope = (value: LibraryScope): void => navigateMemory({ scope: value, memoryId: null }, 'replace')
  const setSearch = (value: string): void => navigateMemory({ search: value }, 'replace')
  const setSelectedMemoryId = (value: string | null): void => navigateMemory({ memoryId: value }, 'push')
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewNeedsRefresh, setReviewNeedsRefresh] = useState(false)
  const reviewActionPending = useRef(false)
  const reviewTrigger = useRef<HTMLElement | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const editorDrafts = useRef(new Map<string, Draft>())
  const updateDraft = (value: Draft): void => {
    setDraft(value)
    if (editor) editorDrafts.current.set(editorKey(editor), value)
  }
  const [forgetTarget, setForgetTarget] = useState<MemoryRecord | null>(null)
  const [reviewScheduleEditor, setReviewScheduleEditor] = useState<ReviewScheduleEditor | null>(null)
  const [reviewScheduleBusyAction, setReviewScheduleBusyAction] = useState<ReviewScheduleBusyAction | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const startupContentVisible = startupFeedbackVisible || Boolean(error)

  const loadMemoryLibrary = useCallback(async (): Promise<MemoryLibraryView> => {
    const request = ++libraryGeneration.current
    const nextLibrary = await memoryRequest<MemoryLibraryView>('memory.list')
    if (memoryActive.current && request === libraryGeneration.current) setLibrary(nextLibrary)
    return nextLibrary
  }, [memoryRequest])

  const load = useCallback(async (): Promise<MemorySnapshot> => {
    const libraryRequest = ++libraryGeneration.current
    const reviewRequest = ++reviewGeneration.current
    const [nextLibrary, nextReviewItems] = await Promise.all([
      memoryRequest<MemoryLibraryView>('memory.list'),
      memoryRequest<HearthReviewItem[]>('memory.hearthReviewItems.list')
    ])
    if (memoryActive.current && libraryRequest === libraryGeneration.current) setLibrary(nextLibrary)
    if (memoryActive.current && reviewRequest === reviewGeneration.current) {
      setReviewItems(nextReviewItems)
      onPendingCountChange?.(nextReviewItems.filter((reviewItem) => reviewItem.status === 'pending').length)
    }
    return { library: nextLibrary, reviewItems: nextReviewItems }
  }, [memoryRequest, onPendingCountChange])

  useEffect(() => {
    if (memory.active ? library : memory.ready || memory.error) onReady?.()
  }, [library, memory.ready, memory.error, onReady])

  useEffect(() => {
    if (!memory.active) return
    setError(null)
    void load().catch((nextError) => { if (memoryActive.current) setError(errorMessage(nextError)) })
  }, [load, memory.active])

  useEffect(() => client.onEvent?.((event) => {
    if (event.method !== 'runtime.state') return
    const params = typeof event.params === 'object' && event.params !== null
      ? event.params as Record<string, unknown>
      : {}
    if (memoryActive.current && params.status === 'ready') void load().catch((nextError) => setError(errorMessage(nextError)))
  }), [client, load])

  useEffect(() => client.onInvalidated?.(() => {
    if (!memoryActive.current) return
    void load().catch((nextError) => setError(errorMessage(nextError)))
  }), [client, load])

  useEffect(() => {
    if (memoryActive.current && refreshSignal > 0) void load().catch((nextError) => setError(errorMessage(nextError)))
  }, [load, refreshSignal])

  useEffect(() => {
    if (!memory.active || reviewDrawerSignal <= 0) return
    setReviewDialogOpen(true)
    onReviewDrawerSignalConsumed?.()
  }, [memory.active, onReviewDrawerSignalConsumed, reviewDrawerSignal])

  useEffect(() => {
    if (navigationTarget || !focusMemoryId || !library) return
    const memory = library.memories.find((candidate) => candidate.id === focusMemoryId)
    if (!memory?.scope) return
    setLocalScope(memory.scope)
    setLocalMemoryId(memory.id)
  }, [focusMemoryId, library, navigationTarget])

  useEffect(() => {
    if (!memory.active) setFeedback(null)
  }, [memory.active])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 3_200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const pending = reviewItems.filter((reviewItem) => reviewItem.status === 'pending')
  const visibleMemories = useMemo(() => (library?.memories ?? [])
    .filter((memory) => (scope === 'all' || memory.scope === scope) && memory.lifecycle !== 'forgotten')
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
    }), [agents, library, scope, search])

  useEffect(() => {
    if (!library) return
    // Resolve deep links before applying the list's normal default-selection rule.
    if (navigationTarget?.memoryId && navigationTarget.scope === undefined) {
      const memory = library.memories.find((item) => item.id === navigationTarget.memoryId && item.lifecycle !== 'forgotten')
      if (memory?.scope) {
        onNavigate?.({ ...navigationTarget, scope: memory.scope, governance: 'all' }, 'replace')
        return
      }
    }
    if (visibleMemories.some((memory) => memory.id === selectedMemoryId)) return
    // A phone opens details only after an explicit selection. Auto-selecting the
    // first row also undoes Back immediately and makes the catalog unreachable.
    const memoryId = mobile ? null : visibleMemories[0]?.id ?? null
    if (memoryId === selectedMemoryId) return
    if (onNavigate) onNavigate({ kind: 'memory', memoryId, scope, governance, search }, 'replace')
    else setLocalMemoryId(memoryId)
  }, [library, mobile, navigationTarget, onNavigate, selectedMemoryId, visibleMemories, scope, governance, search])

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
      if (memoryActive.current) await load()
    } catch (nextError) {
      if (!memoryActive.current) return
      if (nextError instanceof CommandRejectedError && isMemoryConflict(nextError.code)) {
        try {
          const snapshot = await load()
          setEditor((current) => refreshEditorAuthority(current, snapshot))
          setError(uiAttribute('审核状态或记忆版本已经变化。已刷新权威状态并保留当前草稿，请核对后明确重试。'))
        } catch (refreshError) {
          setError(uiAttribute("状态冲突，且刷新失败：{0}", String(errorMessage(refreshError))))
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
    const creationScope = scope === 'all' ? 'hearth' : scope
    const nextEditor: NonNullable<Editor> = { kind: 'create', scope: creationScope }
    setDraft(editorDrafts.current.get(editorKey(nextEditor)) ?? {
      ...initialDraft,
      scope: scope === 'all' ? 'hearth' : scope,
      kind: scope === 'relationship' ? 'agreement' : 'preference',
      firstAgentId,
      secondAgentId: agents.find((agent) => agent.agentId !== firstAgentId)?.agentId ?? '',
      directedActorAgentId: firstAgentId
    })
    setError(null)
    setEditor(nextEditor)
  }

  const openRevise = (memory: MemoryRecord): void => {
    const nextEditor: NonNullable<Editor> = { kind: 'revise', memory }
    setDraft(editorDrafts.current.get(editorKey(nextEditor)) ?? {
      scope: memory.scope ?? 'hearth',
      kind: memory.kind ?? 'agreement',
      body: memory.currentBody ?? '',
      retrievalKeys: memory.currentRetrievalKeys.join(', '),
      keyInput: '',
      firstAgentId: memory.companionAgentId ?? memory.relationshipAgentIds[0] ?? '',
      secondAgentId: memory.relationshipAgentIds[1] ?? '',
      direction: memory.direction ?? 'mutual',
      directedActorAgentId: memory.directedActorAgentId ?? ''
    })
    setError(null)
    setEditor(nextEditor)
  }

  const retrievalKeys = (): string[] => splitRetrievalKeys([draft.retrievalKeys, draft.keyInput].join(','))

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
    if (!editor || busy) return
    let createdMemoryId: string | null = null
    await run(`editor-${editor.kind}`, async () => {
      let result: StoredCommandResult
      if (editor.kind === 'create') {
        result = await memoryRequest('memory.create', {
          commandId: newCommandId(),
          command: createCommand()
        })
      } else {
        if (!editor.memory.currentRevisionId) throw new Error(uiAttribute('当前记忆没有可修订的版本。'))
        result = await memoryRequest('memory.revise', {
          commandId: newCommandId(),
          command: {
            memoryId: editor.memory.id,
            expectedVersion: editor.memory.version,
            baseRevisionId: editor.memory.currentRevisionId,
            body: draft.body.trim(),
            retrievalKeys: retrievalKeys(),
            reviewAfter: editor.memory.reviewAfter
          }
        })
      }
      assertApplied(result)
      editorDrafts.current.delete(editorKey(editor))
      if (editor.kind === 'create' && typeof result.payload.memoryId === 'string') createdMemoryId = result.payload.memoryId
      setEditor(null)
      if (memoryActive.current) setFeedback(uiAttribute('记忆已保存。'))
    })
    // Select after the refreshed library contains the new identity.
    if (createdMemoryId && memoryActive.current) navigateMemory({ scope: draft.scope, search: '', memoryId: createdMemoryId }, 'replace')
  }

  const refreshReview = async (): Promise<void> => {
    if (reviewActionPending.current) return
    reviewActionPending.current = true
    setBusy('review-refresh')
    try {
      await load()
      setReviewNeedsRefresh(false)
      setReviewError(null)
    } catch (nextError) {
      setReviewError(uiAttribute('无法确认最新审核状态，请刷新后再处理。{0}', errorMessage(nextError)))
    } finally {
      reviewActionPending.current = false
      setBusy(null)
    }
  }

  const resolveReview: ReviewResolution = async (reviewItem, action, content) => {
    if (reviewActionPending.current || busy || reviewNeedsRefresh || reviewItem.status !== 'pending'
      || (action === 'accept' && reviewItem.stale)) return false
    reviewActionPending.current = true
    setBusy(`review-${action}-${reviewItem.reviewItemId}`)
    setReviewError(null)
    let applied = false
    try {
      const result = await memoryRequest<StoredCommandResult>(`memory.hearthReviewItems.${action}`, {
        commandId: newCommandId(),
        command: {
          reviewItemId: reviewItem.reviewItemId,
          expectedReviewItemVersion: reviewItem.version,
          ...(action === 'accept' && content ? { finalBody: content.body.trim(), finalRetrievalKeys: content.keys } : {})
        }
      })
      assertApplied(result)
      applied = true
      // Only Core's acknowledgement clears the candidate. Do not reconstruct a
      // terminal record or leave its body editable if the following read fails.
      reviewGeneration.current++
      setReviewItems((items) => items.filter((item) => item.reviewItemId !== reviewItem.reviewItemId))
      if (!memoryActive.current) return true
      await load()
      setFeedback(action === 'accept'
        ? uiAttribute('已接受，候选内容现在成为正式共同记忆。')
        : uiAttribute('已拒绝这条审核项；候选内容已清除。'))
    } catch (nextError) {
      if (applied) {
        setReviewNeedsRefresh(true)
        setReviewError(uiAttribute('处理已完成，但列表刷新失败。请刷新列表，无需再次提交。'))
      } else if (nextError instanceof CommandRejectedError && isMemoryConflict(nextError.code)) {
        try {
          await load()
          setReviewError(uiAttribute('审核状态或记忆版本已经变化。已刷新权威状态并保留当前草稿，请核对后明确重试。'))
        } catch {
          setReviewNeedsRefresh(true)
          setReviewError(uiAttribute('无法确认最新审核状态，请刷新后再处理。{0}', errorMessage(nextError)))
        }
      } else {
        // A lost response may already have committed. Read authority before
        // allowing another explicit command; closing never resubmits it.
        setReviewNeedsRefresh(true)
        setReviewError(uiAttribute('无法确认最新审核状态，请刷新后再处理。{0}', errorMessage(nextError)))
      }
    } finally {
      reviewActionPending.current = false
      setBusy(null)
    }
    return applied
  }

  const lifecycle = (
    method: 'memory.retire' | 'memory.reactivate',
    memory: MemoryRecord
  ): Promise<void> => run(`${method}-${memory.id}`, async () => {
    const result = await memoryRequest<StoredCommandResult>(method, {
      commandId: newCommandId(),
      command: { memoryId: memory.id, expectedVersion: memory.version }
    })
    assertApplied(result)
  })

  const forget = (memory: MemoryRecord): Promise<void> => run(`forget-${memory.id}`, async () => {
    const result = await memoryRequest<StoredCommandResult>('memory.forget', {
      commandId: newCommandId(),
      command: { memoryId: memory.id, expectedVersion: memory.version }
    })
    assertApplied(result)
    setForgetTarget(null)
  })

  const reviewScheduleTrigger = useRef<HTMLElement | null>(null)
  const openReviewSchedule = (memory: MemoryRecord): void => {
    reviewScheduleTrigger.current = document.activeElement?.getAttribute('role') === 'menuitem'
      ? document.querySelector<HTMLElement>('.memory-more-button')
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
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
            : { tone: 'error', message: validation.message ?? uiAttribute('请选择有效的下次复核时间。') }
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
      const result = await memoryRequest<StoredCommandResult>('memory.review.schedule', {
        commandId: newCommandId(),
        command: {
          memoryId: current.memory.id,
          expectedVersion: current.memory.version,
          reviewAfter: desiredReviewAfter
        }
      })
      assertApplied(result)
      if (!memoryActive.current) { setReviewScheduleEditor(null); return }

      try {
        await loadMemoryLibrary()
      } catch (refreshError) {
        const completion = action === 'clear' ? uiAttribute('复核提醒已清除') : uiAttribute('下次复核已设置')
        setReviewScheduleEditor((editorState) => editorState && {
          ...editorState,
          phase: 'applied-refresh-failed',
          appliedAction: action,
          attemptedAction: null,
          notice: {
            tone: 'error',
            message: uiAttribute("{0}，但列表刷新失败：{1}。请只重试刷新，不要重复提交设置。", String(completion), String(errorMessage(refreshError)))
          }
        })
        return
      }

      setReviewScheduleEditor(null)
      setFeedback(action === 'clear' ? uiAttribute('复核提醒已清除') : uiAttribute('下次复核已设置'))
    } catch (nextError) {
      if (!memoryActive.current) return
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
                message:uiAttribute("记忆版本已变化，但最新列表中找不到这条记忆。当前选择仍保留；请重新获取最新状态后再决定。")
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
              message: uiAttribute("记忆版本已变化，但无法刷新最新状态：{0}。当前选择仍保留；请先重新获取最新状态，不要在版本未知时重试提交。", String(errorMessage(refreshError)))
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
            message: uiAttribute("设置未完成：{0}。当前选择已保留，请核对后重试。", String(errorMessage(nextError)))
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
        setFeedback(current.appliedAction === 'clear' ? uiAttribute('复核提醒已清除') : uiAttribute('下次复核已设置'))
        return
      }

      const latest = nextLibrary.memories.find((memory) => memory.id === current.memory.id)
      if (!latest) throw new Error(uiAttribute('最新列表中找不到这条记忆。'))
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
          message: uiAttribute("{0}仍无法刷新最新状态：{1}。请稍后只重试刷新。", String(editorState.phase === 'applied-refresh-failed' ? uiAttribute('设置已经生效，但') : ''), String(errorMessage(refreshError)))
        }
      })
    } finally {
      setReviewScheduleBusyAction(null)
      setBusy(null)
    }
  }

  // Keep local review drafts while the capability hides all business UI.
  const reviewDialog = <MemoryReviewDialog
    key="hearth-review"
    open={memory.active && reviewDialogOpen}
    reviewItems={reviewItems}
    memories={library?.memories ?? []}
    agents={agents}
    busy={busy}
    onOpenChange={setReviewDialogOpen}
    error={reviewError}
    needsRefresh={reviewNeedsRefresh}
    onResolve={resolveReview}
    onRefresh={refreshReview}
    onRestoreFocus={() => {
      const trigger = reviewTrigger.current?.isConnected ? reviewTrigger.current : document.querySelector<HTMLElement>('.memory-review-entry')
      trigger?.focus()
    }}
  />

  const capabilityFeedback = <>
    <span className="sr-only" role="status">{memory.saving && <UiText zh="正在保存…" />}</span>
    {memory.error && <div className="memory-capability-error" role="alert">
      <span><UiText zh={memory.error === 'read' ? 'Rovai 长期记忆状态暂不可用，请重试。' : '未能保存，请重试。'} /></span>
      <button className="quiet-button compact" type="button" disabled={memory.saving} onClick={() => void memory.retry()}><UiText zh="重试" /></button>
    </div>}
  </>

  if (!memory.active) return (
    <section className="memory-library memory-workspace memory-workspace-inactive" aria-labelledby="memory-library-title" data-startup-route="memory" data-startup-status={memory.ready || memory.error ? 'ready' : 'loading'}>
      <div className="memory-capability-state">
        <AppDialogGlyph name="brain" />
        <h2 id="memory-library-title"><UiText zh={memory.ready && !memory.enabled && memory.error !== 'read' ? 'Rovai 长期记忆已关闭' : 'Rovai 长期记忆'} /></h2>
        {memory.ready && !memory.enabled && memory.error !== 'read' ? <p><UiText zh="已保存的记忆会保留，重新开启后可继续使用和管理。" /></p>
          : !memory.error && <p role="status"><UiText zh="正在读取记忆设置…" /></p>}
        <MemoryCapabilitySwitch />
        {capabilityFeedback}
      </div>
      {reviewDialog}
    </section>
  )

  return (
    <section
      className={`memory-library memory-workspace${startupContentVisible ? '' : ' startup-feedback-suppressed'}`}
      data-mobile-detail={mobile && selectedMemory !== null || undefined}
      aria-labelledby="memory-library-title"
      aria-busy={loading}
      aria-hidden={startupContentVisible ? undefined : true}
      data-startup-route="memory"
      data-startup-status={loading ? 'loading' : error && !library ? 'waiting' : 'ready'}
    >
      {mobile && selectedMemory && <div className="mobile-memory-back"><MobileBack label={uiAttribute("返回记忆列表")} onClick={() => setSelectedMemoryId(null)} /><span><UiText zh={"记忆"} /></span></div>}
      <header className="memory-library-header">
        <div>
          <div className="memory-title-line">
            <h2 id="memory-library-title"><UiText zh={"记忆"} /></h2>
            <MemoryCapabilitySwitch />
          </div>
          <p><UiText zh={"查看、搜索和管理长期记忆。"} /></p>
        </div>
        <div className="memory-header-actions">
          <button className="memory-review-entry" data-pending={pending.length > 0} type="button" onClick={(event) => { reviewTrigger.current = event.currentTarget; setReviewDialogOpen(true) }} disabled={!library}>
            {pending.length > 0 ? <><UiText zh="待审核" /><span>{pending.length}</span></> : <UiText zh="审核记录" />}
            <DialogControlIcon name="chevron" />
          </button>
          <button className="primary-button" type="button" onClick={openCreate} disabled={!library}><DialogControlIcon name="plus" /><UiText zh="新增" /></button>
        </div>
      </header>

      {capabilityFeedback}

      <div className="memory-summary-strip" aria-label={uiAttribute("记忆概览")}>
        <div><span><UiText zh="正在沿用" /></span><strong>{library ? activeCount : '—'}</strong></div>
        <div><span><UiText zh="队员形成" /></span><strong>{library ? agentCount : '—'}</strong></div>
        <div><span><UiText zh="待复核" /></span><strong>{library ? reviewCount : '—'}</strong></div>
      </div>
      {topNotices && <div className="memory-page-notices">{topNotices}</div>}
      {error && <div className="memory-error" role="alert"><strong><UiText zh="操作未完成" /></strong><span>{error}</span>{!library && <button className="quiet-button compact" type="button" onClick={() => { setError(null); void load().catch((nextError) => setError(errorMessage(nextError))) }}><UiText zh="重试" /></button>}</div>}
      {feedback && <div className="memory-feedback" role="status">{feedback}</div>}
      <div className="memory-library-tools">
        <nav className="memory-scope-tabs" aria-label={uiAttribute("记忆范围")}>
          {scopeTabs.map(([value, label]) => <button key={value} type="button" data-memory-scope={value} className={scope === value ? 'active' : ''} aria-pressed={scope === value} disabled={loading} onClick={() => setScope(value)}>{uiAttribute(label)}</button>)}
        </nav>
        <label className="memory-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="sr-only"><UiText zh="搜索记忆" /></span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={uiAttribute("搜索记忆")} disabled={loading} />
        </label>
      </div>

      <div className="memory-workbench">
        <div className="memory-catalog">
          <div className="memory-catalog-list">
            {loading && <EmptyMemory text={uiAttribute("正在读取记忆…")} />}
            {!library && !loading && <EmptyMemory text={uiAttribute("暂时无法读取记忆。")} />}
            {library && visibleMemories.length === 0 && <EmptyMemory text={search ? uiAttribute("没有找到匹配的记忆。") : uiAttribute("还没有记忆，可以新增一条。")} />}
            {visibleMemories.map((memory) => (
              <button key={memory.id} type="button" className={`memory-catalog-item ${selectedMemoryId === memory.id ? 'selected' : ''}`} aria-pressed={selectedMemoryId === memory.id} onClick={() => setSelectedMemoryId(memory.id)}>
                <MemoryAvatar memory={memory} agents={agents} />
                <span className="memory-catalog-copy"><strong>{memory.currentBody ?? uiAttribute('正文已清除')}</strong>
                <span className="memory-catalog-context"><span>{memoryPeopleLabel(memory, agents)} · {kindLabel(memory.kind)}</span>{memory.lifecycle === 'retired' ? <span className="memory-stopped"><UiText zh="已停止" /></span> : memory.reviewDue ? <span className="memory-review-due"><UiText zh="待复核" /></span> : null}</span></span>
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

      {reviewDialog}

      <ReviewScheduleDialog
        editor={reviewScheduleEditor}
        busyAction={reviewScheduleBusyAction}
        onChange={(nextEditor) => setReviewScheduleEditor(nextEditor)}
        onClose={() => {
          if (reviewScheduleBusyAction === null) setReviewScheduleEditor(null)
        }}
        onSubmit={submitReviewSchedule}
        onRetryRefresh={retryReviewScheduleRefresh}
        onRestoreFocus={() => { if (reviewScheduleTrigger.current?.isConnected) reviewScheduleTrigger.current.focus() }}
      />

      <MemoryEditorDialog editor={editor} draft={draft} agents={agents} error={error} busy={busy !== null} onDraft={updateDraft} onClose={() => setEditor(null)} onSubmit={submitEditor} />

      <Dialog.Root open={forgetTarget !== null} onOpenChange={(open) => { if (!open) setForgetTarget(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay memory-dialog-overlay" />
          <AppDialogContent className="memory-confirm-dialog" tone="danger">
            <AppDialogHeader
              title={uiAttribute("永久遗忘这条记忆？")}
              description={uiAttribute("将清除正文、检索词与受控候选内容，且无法恢复。")}
              icon="brain"
              kicker={uiAttribute("不可撤销")}
              closeDisabled={busy !== null}
            />
            <AppDialogFooter>
              <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={busy !== null}><UiText zh={"取消"} /></button></Dialog.Close>
              <button className="danger-button" type="button" onClick={() => forgetTarget && void forget(forgetTarget)} disabled={busy !== null}>{busy?.startsWith('forget-') ? uiAttribute("正在遗忘…") : uiAttribute("永久遗忘")}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
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
  onReview(memory: MemoryRecord): void
  onRetire(memory: MemoryRecord): Promise<void>
  onReactivate(memory: MemoryRecord): Promise<void>
  onForget(memory: MemoryRecord): void
}): React.JSX.Element {
  const openingDialog = useRef(false)
  if (!memory) {
    return <aside className="memory-detail empty"><AppDialogGlyph name="brain" /><strong>{loading ? uiAttribute("正在读取记忆") : uiAttribute("选择一条记忆查看详情")}</strong></aside>
  }
  return (
    <aside className="memory-detail" aria-labelledby={`memory-detail-${memory.id}`}>
      <h3 className="sr-only" id={`memory-detail-${memory.id}`}><UiText zh="记忆详情" /></h3>
      <header className="memory-detail-top">
        <div className="memory-detail-context">
          <MemoryAvatar memory={memory} agents={agents} />
          <div className="memory-detail-owner"><strong>{memoryPeopleLabel(memory, agents)}</strong>
            <span>{scopeLabel(memory.scope)} · {kindLabel(memory.kind)}
              {memory.direction === 'mutual' && <> · {directionLabel(memory, agents)}</>}
              {memory.lifecycle === 'retired' ? <span className="memory-stopped"> · <UiText zh="已停止" /></span> : memory.reviewDue ? <span className="memory-review-due"> · <UiText zh="待复核" /></span> : null}
            </span>
          </div>
        </div>
        <div className="memory-detail-actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button type="button" className="memory-more-button" aria-label={uiAttribute("更多记忆操作")} disabled={busy !== null}><svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor"><circle cx="4" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="16" cy="10" r="1.4" /></svg></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="memory-actions-menu" align="end" sideOffset={5} onCloseAutoFocus={(event) => { if (openingDialog.current) { event.preventDefault(); openingDialog.current = false } }}>
              {memory.lifecycle === 'active' && <>
                <DropdownMenu.Item onSelect={() => { openingDialog.current = true; onReview(memory) }}><UiText zh="设置下次复核" /></DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => void onRetire(memory)}><UiText zh="停止沿用" /></DropdownMenu.Item>
              </>}
              <DropdownMenu.Item className="memory-danger-action" onSelect={() => { openingDialog.current = true; onForget(memory) }}><UiText zh="永久遗忘" /></DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
          {memory.lifecycle === 'active' && <button className="primary-button" data-memory-revise type="button" onClick={() => onRevise(memory)} disabled={busy !== null}><AppDialogGlyph name="pencil" /><UiText zh="修订" /></button>}
          {memory.lifecycle === 'retired' && memory.outgoingSuccessorIds.length === 0 && <button className="primary-button" type="button" onClick={() => void onReactivate(memory)} disabled={busy !== null}><UiText zh="重新沿用" /></button>}
        </div>
      </header>
      <div className="memory-detail-scroll" key={memory.id}><div className="memory-reading-sheet">
      <div className="memory-detail-body" aria-label={uiAttribute("记忆正文")}>{memory.currentBody ?? uiAttribute("正文已遗忘")}</div>
      <div className="memory-retrieval-keys" role="group" aria-label={uiAttribute("检索词")}>{memory.currentRetrievalKeys.map((key) => <span key={key}>{key}</span>)}</div>
      </div>
      <details className="memory-detail-disclosure" key={memory.id}>
        <summary><UiText zh="详情与版本" /><DialogControlIcon name="chevron" /></summary>
        <dl className="memory-detail-facts">
          <div><dt><UiText zh="形成来源" /></dt><dd>{originLabel(memory.creationOrigin)}</dd></div>
          <div><dt><UiText zh="最近更新" /></dt><dd>{formatTime(memory.updatedAt)}</dd></div>
          <div><dt><UiText zh="下次复核" /></dt><dd><button type="button" className={memory.reviewDue ? 'memory-review-due' : ''} disabled={memory.lifecycle !== 'active' || busy !== null} onClick={() => onReview(memory)}>{memory.reviewAfter ? formatTime(memory.reviewAfter) : uiAttribute("未设置")}<DialogControlIcon name="chevron" /></button></dd></div>
          <div><dt><UiText zh="当前版本" /></dt><dd>v{memory.version}</dd></div>
        </dl>
        <details className="memory-revisions">
          <summary><span><UiText zh="版本记录" /> <span>{memory.revisions.length}</span></span><DialogControlIcon name="chevron" /></summary>
          {memory.revisions.map((revision) => <details key={revision.id} className="memory-revision">
            <summary><span>{revision.actorKind === 'agent' ? uiAttribute("队员修订") : revision.actorKind === 'user' ? uiAttribute("用户修订") : uiAttribute("已清除")}{revision.id === memory.currentRevisionId && <small><UiText zh="当前版本" /></small>}</span><time>{formatTime(revision.createdAt)}</time><DialogControlIcon name="chevron" /></summary>
            <p>{revision.body ?? uiAttribute('正文已清除')}</p>
            {revision.retrievalKeys.length > 0 && <small>{revision.retrievalKeys.join(' · ')}</small>}
          </details>)}
        </details>
      </details></div>
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
    ? uiAttribute('这条记忆已被永久遗忘，不能再设置复核提醒。请关闭弹窗查看最新列表。')
    : renderedEditor.memory.lifecycle === 'retired'
      ? uiAttribute('这条记忆已停止沿用，不能设置复核提醒。请关闭弹窗，重新沿用后再设置。')
      : null

  return (
    <Dialog.Root
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay memory-dialog-overlay" />
        <AppDialogContent
          className="memory-review-schedule-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus() }}
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
        >
          <AppDialogHeader
            title={uiAttribute("设置下次复核")}
            description={uiAttribute("到期后进入“待复核”，记忆仍会继续沿用。")}
            icon="clock"
            closeLabel={uiAttribute("关闭设置下次复核弹窗")}
            closeDisabled={busy}
          />
          <form className="app-dialog-form" onSubmit={(event) => {
            event.preventDefault()
            void onSubmit('save')
          }}>
            <AppDialogBody>
              <div className="memory-review-schedule-heading">
                <strong><UiText zh={"选择下次复核"} /></strong>
                <span><UiText zh={"快捷日期按当前设备的本地日历计算。"} /></span>
              </div>

              <div
                ref={choiceGroupRef}
                className="memory-review-schedule-choice-group"
                role="radiogroup"
                aria-label={uiAttribute("下次复核选项")}
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
                        <strong>{mode}<UiText zh={" 天后"} /></strong>
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
                    <strong><UiText zh={"自定义时间"} /></strong>
                    <small>{renderedEditor.mode === 'custom' && customDate
                      ? formatTime(customDate.toISOString())
                      : uiAttribute("选择日期和时间")}</small>
                  </span>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5v3M15 3.5v3M3 8h14" /><rect x="3" y="5" width="14" height="12" rx="2" /></svg>
                </button>
              </div>

              {renderedEditor.mode === 'custom' && (
                <div className="memory-review-schedule-custom-field">
                  <div>
                    <label htmlFor="memory-review-schedule-time"><UiText zh={"下次复核时间"} /></label>
                    <small id={timezoneId}><UiText zh={"当前设备时区 · "} />{localTimeZoneName()}</small>
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
                      ? uiAttribute("设置已生效，列表尚未刷新")
                      : lifecycleMessage
                        ? uiAttribute("无法设置复核提醒")
                        : renderedEditor.notice?.tone === 'info'
                          ? uiAttribute("已刷新权威状态")
                          : uiAttribute("操作未完成")}</strong>
                    <p>{lifecycleMessage ?? renderedEditor.notice?.message}</p>
                    {renderedEditor.phase !== 'ready' && (
                      <button
                        className="quiet-button compact"
                        type="button"
                        disabled={busy}
                        onClick={() => void onRetryRefresh()}
                      >
                        {busyAction === 'refresh'
                          ? uiAttribute("正在刷新…")
                          : renderedEditor.phase === 'applied-refresh-failed'
                            ? uiAttribute("只重试刷新")
                            : uiAttribute("重新获取最新状态")}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="memory-review-schedule-note">
                <AppDialogGlyph name="info" />
                <div>
                  <strong><UiText zh={"到期后仍会继续沿用"} /></strong>
                  <p><UiText zh={"保存只更新复核提醒，不会修改记忆正文、沿用状态或适用范围。"} /></p>
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
                      {busyAction === 'clear' ? uiAttribute("正在清除…") : uiAttribute("清除提醒")}
                    </button>
                  )}
                  <span><UiText zh={"时间精确到分钟，且必须晚于当前时间。"} /></span>
                </div>
              )}
            >
              <Dialog.Close asChild>
                <button className="quiet-button" type="button" disabled={busy}>
                  {renderedEditor.phase === 'applied-refresh-failed' ? uiAttribute("关闭") : uiAttribute("取消")}
                </button>
              </Dialog.Close>
              <button className="primary-button" type="submit" disabled={saveDisabled}>
                {busyAction === 'save' ? uiAttribute("正在保存…") : uiAttribute("保存设置")}
              </button>
            </AppDialogFooter>
          </form>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MemoryEditorDialog({
  editor,
  draft,
  agents,
  busy,
  error,
  onDraft,
  onClose,
  onSubmit
}: {
  editor: Editor
  draft: Draft
  agents: AgentProfile[]
  busy: boolean
  error: string | null
  onDraft(value: Draft): void
  onClose(): void
  onSubmit(event: React.FormEvent): void
}): React.JSX.Element {
  const identityLocked = editor?.kind === 'revise'
  const contentValid = validateMemoryContent(draft).valid
  const identityValid = draft.scope === 'hearth'
    || (draft.scope === 'companion' && draft.firstAgentId !== '')
    || (draft.scope === 'relationship' && draft.kind !== 'preference' && draft.firstAgentId !== '' && draft.secondAgentId !== '' && draft.firstAgentId !== draft.secondAgentId && (draft.direction === 'mutual' || [draft.firstAgentId, draft.secondAgentId].includes(draft.directedActorAgentId)))
  return (
    <Dialog.Root open={editor !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay memory-dialog-overlay" />
        <AppDialogContent className="memory-editor-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
          <AppDialogHeader
            title={editor?.kind === 'create' ? uiAttribute("新增记忆") : uiAttribute("修订记忆")}
            description={uiAttribute("正文应面向未来、可独立理解且不包含秘密。Retrieval Keys 只用于检索，不代替正文。")}
            icon="brain"
            closeDisabled={busy}
            hideDescription
          />
          <form className="app-dialog-form" onSubmit={onSubmit}>
            <AppDialogBody>
              {identityLocked ? <div className="memory-editor-context"><AppDialogGlyph name="brain" /><span>{scopeLabel(draft.scope)}</span><span>·</span><span>{editor?.kind === 'revise' ? memoryPeopleLabel(editor.memory, agents) : uiAttribute('所有队员')}</span><span>{kindLabel(draft.kind)}</span></div> : <div className="memory-editor-grid">
                <MemoryChoiceField label={uiAttribute('范围')} value={draft.scope} disabled={busy} options={(['hearth', 'companion', 'relationship'] as const).map((value) => ({ value, label: scopeLabel(value) }))} onChange={(scope) => onDraft({ ...draft, scope, kind: scope === 'relationship' && draft.kind === 'preference' ? 'agreement' : draft.kind })} />
                <MemoryChoiceField label={uiAttribute('类型')} value={draft.kind} disabled={busy} options={(['preference', 'agreement', 'lesson'] as const).filter((value) => draft.scope !== 'relationship' || value !== 'preference').map((value) => ({ value, label: kindLabel(value) }))} onChange={(kind) => onDraft({ ...draft, kind })} />
                {draft.scope === 'companion' && <AgentSelect label={uiAttribute("队员")} value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />}
                {draft.scope === 'relationship' && <>
                  <AgentSelect label={uiAttribute("队员 A")} value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />
                  <AgentSelect label={uiAttribute("队员 B")} value={draft.secondAgentId} agents={agents.filter((agent) => agent.agentId !== draft.firstAgentId)} disabled={identityLocked || busy} onChange={(secondAgentId) => onDraft({ ...draft, secondAgentId })} />
                  <MemoryChoiceField label={uiAttribute('方向')} value={draft.direction} disabled={busy} options={[{ value: 'mutual', label: uiAttribute('双方共同') }, { value: 'directed', label: uiAttribute('单向') }]} onChange={(direction) => onDraft({ ...draft, direction })} />
                  {draft.direction === 'directed' && <AgentSelect label={uiAttribute("责任方")} value={draft.directedActorAgentId} agents={agents.filter((agent) => [draft.firstAgentId, draft.secondAgentId].includes(agent.agentId))} disabled={identityLocked || busy} onChange={(directedActorAgentId) => onDraft({ ...draft, directedActorAgentId })} />}
                </>}
              </div>}
              <MemoryContentFields draft={draft} disabled={busy} onChange={(content) => onDraft({ ...draft, ...content })} />
              {error && <div className="memory-editor-error" role="alert">{error}</div>}
            </AppDialogBody>
            <AppDialogFooter>
              <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}><UiText zh={"取消"} /></button></Dialog.Close>
              <button className="primary-button" type="submit" disabled={!contentValid || !identityValid || busy}>{busy ? uiAttribute("正在保存…") : editor?.kind === 'revise' ? uiAttribute("保存修订") : uiAttribute("保存记忆")}</button>
            </AppDialogFooter>
          </form>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function editorKey(editor: NonNullable<Editor>): string {
  return editor.kind === 'create' ? `create:${editor.scope}` : `revise:${editor.memory.id}`
}

function AgentSelect({ label, value, agents, disabled, onChange }: { label: string; value: string; agents: AgentProfile[]; disabled: boolean; onChange(value: string): void }): React.JSX.Element {
  return <MemoryChoiceField label={label} value={value} disabled={disabled} onChange={onChange} options={[{ value: '', label: uiAttribute('请选择') }, ...agents.map((agent) => ({ value: agent.agentId, label: agent.displayName }))]} />
}

function MemoryChoiceField<Value extends string>({ label, value, options, disabled, onChange }: {
  label: string
  value: Value
  options: ReadonlyArray<{ value: Value; label: string }>
  disabled: boolean
  onChange(value: Value): void
}): React.JSX.Element {
  const id = useId()
  const labelId = `${id}-label`
  const valueId = `${id}-value`
  return (
    <div className="memory-choice-field">
      <label id={labelId} htmlFor={id}>{label}</label>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger id={id} className="memory-choice-trigger" type="button" aria-labelledby={`${labelId} ${valueId}`} disabled={disabled}>
          <span id={valueId}>{options.find((option) => option.value === value)?.label ?? uiAttribute('请选择')}</span>
          <DialogControlIcon name="chevron" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="memory-choice-menu" aria-labelledby={labelId} align="start" sideOffset={6} collisionPadding={12}>
            <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => {
              const option = options.find((candidate) => candidate.value === nextValue)
              if (option) onChange(option.value)
            }}>
              {options.map((option) => <DropdownMenu.RadioItem className="memory-choice-option" key={option.value} value={option.value}>
                <span>{option.label}</span>
                <DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function EmptyMemory({ text }: { text: string }): React.JSX.Element {
  return <div className="empty-inline">{text}</div>
}

function reviewScheduleConflictNotice(
  memory: MemoryRecord,
  desiredAlreadyApplied: boolean,
  action: ReviewScheduleAction
): NonNullable<ReviewScheduleEditor['notice']> {
  if (memory.lifecycle === 'forgotten') {
    return {
      tone: 'error',
      message:uiAttribute("这条记忆已被永久遗忘，不能再设置复核提醒。当前选择仍保留，请关闭弹窗查看最新列表。")
    }
  }
  if (memory.lifecycle === 'retired') {
    return {
      tone: 'error',
      message:uiAttribute("这条记忆已停止沿用，不能设置复核提醒。当前选择仍保留，请关闭弹窗或重新沿用后再设置。")
    }
  }
  if (desiredAlreadyApplied) {
    return {
      tone: 'info',
      message: action === 'clear'
        ? uiAttribute('复核提醒已经由另一项操作清除，无需再次提交。')
        : uiAttribute('下次复核已经是你选择的时间，无需重复保存。')
    }
  }
  return {
    tone: 'info',
    message:uiAttribute("记忆版本已变化。已刷新到最新版本并保留当前选择，请核对后再次保存。")
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
  return editor
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
