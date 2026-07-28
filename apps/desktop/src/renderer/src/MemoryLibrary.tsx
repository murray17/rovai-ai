import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AcceptMemoryProposalCommand,
  AgentProfile,
  CreateMemoryCommand,
  MemoryAutoPolicy,
  MemoryDirection,
  MemoryKind,
  MemoryLibraryView,
  MemoryProposal,
  MemoryProjectionIssue,
  MemoryRecord,
  MemoryScopeKind,
  StoredCommandResult
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { localizeExecutionEngineTerms } from './product-copy'

type GovernanceFilter = 'all' | 'automatic' | 'review' | 'stopped'
type Editor =
  | { kind: 'create' }
  | { kind: 'revise'; memory: MemoryRecord }
  | { kind: 'proposal'; proposal: MemoryProposal }
  | null
type Confirmation =
  | { kind: 'forget'; memory: MemoryRecord }
  | { kind: 'export' }
  | null

interface Draft {
  scope: MemoryScopeKind
  kind: MemoryKind
  body: string
  firstAgentId: string
  secondAgentId: string
  direction: MemoryDirection
  directedActorAgentProfileId: string
}

const initialDraft: Draft = {
  scope: 'hearth',
  kind: 'preference',
  body: '',
  firstAgentId: '',
  secondAgentId: '',
  direction: 'mutual',
  directedActorAgentProfileId: ''
}

const scopeTabs: Array<[MemoryScopeKind, string]> = [
  ['hearth', '家园共识'],
  ['companion', '伙伴经验'],
  ['relationship', '协作默契']
]

const governanceTabs: Array<[GovernanceFilter, string]> = [
  ['all', '全部'],
  ['automatic', '自动形成'],
  ['review', '建议复核'],
  ['stopped', '已停止沿用']
]

export function MemoryLibrary({
  agents,
  refreshSignal = 0,
  focusMemoryId = null,
  proposalDrawerSignal = 0,
  onProposalDrawerSignalConsumed,
  onPendingCountChange
}: {
  agents: AgentProfile[]
  refreshSignal?: number
  focusMemoryId?: string | null
  proposalDrawerSignal?: number
  onProposalDrawerSignalConsumed?(): void
  onPendingCountChange?(count: number): void
}): React.JSX.Element {
  const [library, setLibrary] = useState<MemoryLibraryView | null>(null)
  const [autoPolicy, setAutoPolicy] = useState<MemoryAutoPolicy | null>(null)
  const [proposals, setProposals] = useState<MemoryProposal[]>([])
  const [issues, setIssues] = useState<MemoryProjectionIssue[]>([])
  const [scope, setScope] = useState<MemoryScopeKind>(() => storedScope())
  const [governance, setGovernance] = useState<GovernanceFilter>(() => storedGovernance())
  const [search, setSearch] = useState(() => storedMemoryValue('rovai.memory.search'))
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(
    () => storedMemoryValue('rovai.memory.selected') || null
  )
  const [proposalDrawerOpen, setProposalDrawerOpen] = useState(false)
  const [editor, setEditor] = useState<Editor>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const catalogListRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (): Promise<void> => {
    const [nextLibrary, nextProposals, nextIssues, nextAutoPolicy] = await Promise.all([
      window.rovai.request<MemoryLibraryView>('memory.list'),
      window.rovai.request<MemoryProposal[]>('memory.proposals.list'),
      window.rovai.request<MemoryProjectionIssue[]>('memory.projections.listIssues'),
      window.rovai.request<MemoryAutoPolicy>('memory.autoPolicy.get')
    ])
    setLibrary(nextLibrary)
    setProposals(nextProposals)
    setIssues(nextIssues)
    setAutoPolicy(nextAutoPolicy)
    onPendingCountChange?.(nextProposals.filter((proposal) => proposal.status === 'pending').length)
  }, [onPendingCountChange])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.rovai.request<MemoryLibraryView>('memory.list'),
      window.rovai.request<MemoryProposal[]>('memory.proposals.list'),
      window.rovai.request<MemoryProjectionIssue[]>('memory.projections.listIssues'),
      window.rovai.request<MemoryAutoPolicy>('memory.autoPolicy.get')
    ]).then(([nextLibrary, nextProposals, nextIssues, nextAutoPolicy]) => {
      if (cancelled) return
      setLibrary(nextLibrary)
      setProposals(nextProposals)
      setIssues(nextIssues)
      setAutoPolicy(nextAutoPolicy)
      onPendingCountChange?.(nextProposals.filter((proposal) => proposal.status === 'pending').length)
    }).catch((nextError) => {
      if (!cancelled) setError(errorMessage(nextError))
    })
    return () => { cancelled = true }
  }, [onPendingCountChange])

  useEffect(() => window.rovai.onEvent((event) => {
    if (event.method === 'runtime.state') {
      const params = event.params !== null && typeof event.params === 'object'
        ? event.params as Record<string, unknown>
        : {}
      if (params.status === 'ready') {
        void load().catch((nextError) => setError(errorMessage(nextError)))
      }
    }
  }), [load])

  useEffect(() => {
    if (refreshSignal > 0) void load().catch((nextError) => setError(errorMessage(nextError)))
  }, [load, refreshSignal])

  useEffect(() => {
    storeMemoryViewState(scope, governance, search, selectedMemoryId)
  }, [governance, scope, search, selectedMemoryId])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = setTimeout(() => setFeedback(null), 3_200)
    return () => clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    if (catalogListRef.current) {
      catalogListRef.current.scrollTop = Number(storedMemoryValue('rovai.memory.scroll')) || 0
    }
  }, [governance, scope])

  useEffect(() => {
    if (proposalDrawerSignal <= 0) return
    setProposalDrawerOpen(true)
    onProposalDrawerSignalConsumed?.()
  }, [onProposalDrawerSignalConsumed, proposalDrawerSignal])

  useEffect(() => {
    if (!focusMemoryId || !library) return
    const memory = library.memories.find((candidate) => candidate.id === focusMemoryId)
    if (!memory?.scope) return
    setScope(memory.scope)
    setGovernance(memory.lifecycle === 'active'
      ? memory.currentAuthority === 'provisional' ? 'automatic' : 'all'
      : 'stopped')
    setSelectedMemoryId(memory.id)
  }, [focusMemoryId, library])

  const pending = proposals.filter((proposal) => proposal.status === 'pending')
  const visibleMemories = useMemo(() => (library?.memories ?? []).filter((memory) => {
    if (memory.scope !== scope) return false
    if (memory.lifecycle === 'forgotten') return false
    if (governance === 'automatic') {
      return memory.lifecycle === 'active' && memory.currentAuthority === 'provisional'
    }
    if (governance === 'review') {
      return memory.lifecycle === 'active' && memory.reviewDue
    }
    if (governance === 'stopped') return memory.lifecycle === 'retired'
    return true
  }).filter((memory) => {
    const query = search.trim().toLocaleLowerCase('zh-CN')
    if (!query) return true
    return [
      memory.currentBody,
      kindLabel(memory.kind),
      memoryPeopleLabel(memory, agents),
      directionLabel(memory, agents),
      memory.currentAuthority === 'provisional' ? '自动形成' : '已确认'
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query)
  }), [agents, governance, library, scope, search])

  useEffect(() => {
    if (visibleMemories.some((memory) => memory.id === selectedMemoryId)) return
    setSelectedMemoryId(visibleMemories[0]?.id ?? null)
  }, [selectedMemoryId, visibleMemories])

  const selectedMemory = visibleMemories.find((memory) => memory.id === selectedMemoryId) ?? null
  const activeMemoryCount = library?.memories.filter((memory) => memory.lifecycle === 'active').length ?? 0
  const automaticMemoryCount = library?.memories.filter((memory) =>
    memory.lifecycle === 'active' && memory.currentAuthority === 'provisional'
  ).length ?? 0
  const reviewMemoryCount = library?.memories.filter((memory) =>
    memory.lifecycle === 'active' && memory.reviewDue
  ).length ?? 0

  const run = async (key: string, operation: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await operation()
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const openCreate = (): void => {
    setDraft({
      ...initialDraft,
      scope,
      kind: scope === 'relationship' ? 'agreement' : 'preference',
      firstAgentId: agents[0]?.id ?? '',
      secondAgentId: agents[1]?.id ?? ''
    })
    setEditor({ kind: 'create' })
  }

  const openRevise = (memory: MemoryRecord): void => {
    setDraft({
      scope: memory.scope ?? 'hearth',
      kind: memory.kind ?? 'agreement',
      body: memory.currentBody ?? '',
      firstAgentId: memory.companionAgentProfileId ?? memory.relationshipAgentProfileIds[0] ?? '',
      secondAgentId: memory.relationshipAgentProfileIds[1] ?? '',
      direction: memory.direction ?? 'mutual',
      directedActorAgentProfileId: memory.directedActorAgentProfileId ?? ''
    })
    setEditor({ kind: 'revise', memory })
  }

  const openProposalEdit = (proposal: MemoryProposal): void => {
    setDraft({
      scope: proposal.scope ?? 'hearth',
      kind: proposal.kind ?? 'agreement',
      body: proposal.body ?? '',
      firstAgentId: proposal.companionAgentProfileId ?? proposal.relationshipAgentProfileIds[0] ?? '',
      secondAgentId: proposal.relationshipAgentProfileIds[1] ?? '',
      direction: proposal.direction ?? 'mutual',
      directedActorAgentProfileId: proposal.directedActorAgentProfileId ?? ''
    })
    setEditor({ kind: 'proposal', proposal })
  }

  const createCommand = (): CreateMemoryCommand => ({
    scope: draft.scope,
    kind: draft.kind,
    body: draft.body.trim(),
    companionAgentProfileId: draft.scope === 'companion' ? draft.firstAgentId : null,
    relationshipAgentProfileIds: draft.scope === 'relationship'
      ? [draft.firstAgentId, draft.secondAgentId]
      : [],
    direction: draft.scope === 'relationship' ? draft.direction : null,
    directedActorAgentProfileId: draft.scope === 'relationship' && draft.direction === 'directed'
      ? draft.directedActorAgentProfileId
      : null,
    reviewAfter: null
  })

  const submitEditor = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!editor || !draft.body.trim()) return
    await run(`editor-${editor.kind}`, async () => {
      let result: StoredCommandResult
      if (editor.kind === 'create') {
        result = await window.rovai.request('memory.create', {
          commandId: crypto.randomUUID(),
          command: createCommand()
        })
      } else if (editor.kind === 'revise') {
        const revisionId = editor.memory.currentRevisionId
        if (!revisionId) throw new Error('当前记忆没有可修订的版本。')
        result = await window.rovai.request('memory.revise', {
          commandId: crypto.randomUUID(),
          command: {
            memoryId: editor.memory.id,
            expectedVersion: editor.memory.version,
            baseRevisionId: revisionId,
            body: draft.body.trim(),
            reviewAfter: editor.memory.reviewAfter
          }
        })
      } else {
        const command: AcceptMemoryProposalCommand = {
          proposalId: editor.proposal.id,
          expectedVersion: editor.proposal.version,
          finalCandidate: editor.proposal.action === 'add' ? createCommand() : null,
          finalBody: editor.proposal.action === 'revise' ? draft.body.trim() : null
        }
        result = await window.rovai.request('memory.proposals.accept', {
          commandId: crypto.randomUUID(),
          command
        })
      }
      assertApplied(result)
      setEditor(null)
    })
  }

  const acceptProposal = (proposal: MemoryProposal): Promise<void> => run(
    `accept-${proposal.id}`,
    async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.proposals.accept', {
        commandId: crypto.randomUUID(),
        command: {
          proposalId: proposal.id,
          expectedVersion: proposal.version,
          finalCandidate: null,
          finalBody: null
        }
      })
      assertApplied(result)
    }
  )

  const rejectProposal = (proposal: MemoryProposal): Promise<void> => run(
    `reject-${proposal.id}`,
    async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.proposals.reject', {
        commandId: crypto.randomUUID(),
        command: { proposalId: proposal.id, expectedVersion: proposal.version }
      })
      assertApplied(result)
      setSelectedProposalIds((current) => {
        const next = new Set(current)
        next.delete(proposal.id)
        return next
      })
    }
  )

  const rejectSelected = (): Promise<void> => run('reject-batch', async () => {
    const selected = pending.filter((proposal) => selectedProposalIds.has(proposal.id))
    if (selected.length === 0) return
    const result = await window.rovai.request<StoredCommandResult>('memory.proposals.rejectBatch', {
      commandId: crypto.randomUUID(),
      command: {
        proposals: selected.map((proposal) => ({
          proposalId: proposal.id,
          expectedVersion: proposal.version
        }))
      }
    })
    assertApplied(result)
    setSelectedProposalIds(new Set())
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

  const setPolicy = (enabled: boolean): Promise<void> => run('auto-policy', async () => {
    if (!autoPolicy) return
    const result = await window.rovai.request<StoredCommandResult>('memory.autoPolicy.set', {
      commandId: crypto.randomUUID(),
      command: {
        expectedVersion: autoPolicy.version,
        automaticPartnerMemoryEnabled: enabled
      }
    })
    assertApplied(result)
    setFeedback(enabled
      ? '已开启自动形成伙伴经验与协作默契。'
      : '已关闭；之后的新提案将等待你确认，已有记忆仍会继续沿用。')
  })

  const confirmMemory = (memory: MemoryRecord): Promise<void> => run(
    `confirm-${memory.id}`,
    async () => {
      if (!memory.currentRevisionId) throw new Error('当前记忆没有可确认的版本。')
      const result = await window.rovai.request<StoredCommandResult>('memory.confirm', {
        commandId: crypto.randomUUID(),
        command: {
          memoryId: memory.id,
          expectedVersion: memory.version,
          baseRevisionId: memory.currentRevisionId
        }
      })
      assertApplied(result)
    }
  )

  const forget = (memory: MemoryRecord): Promise<void> => run(`forget-${memory.id}`, async () => {
    const result = await window.rovai.request<StoredCommandResult>('memory.forget', {
      commandId: crypto.randomUUID(),
      command: { memoryId: memory.id, expectedVersion: memory.version }
    })
    assertApplied(result)
    setConfirmation(null)
  })

  const scheduleReview = (memory: MemoryRecord): Promise<void> => {
    const value = window.prompt(
      '输入 RFC 3339 复核时间；留空表示清除复核提醒。',
      memory.reviewAfter ?? ''
    )
    if (value === null) return Promise.resolve()
    return run(`review-${memory.id}`, async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.review.schedule', {
        commandId: crypto.randomUUID(),
        command: {
          memoryId: memory.id,
          expectedVersion: memory.version,
          reviewAfter: value.trim() || null
        }
      })
      assertApplied(result)
    })
  }

  const supersede = (memory: MemoryRecord): Promise<void> => {
    const successorId = window.prompt('输入作为替代项的现有 Memory ID。')
    if (!successorId?.trim()) return Promise.resolve()
    const successor = library?.memories.find((candidate) => candidate.id === successorId.trim())
    if (!successor) {
      setError('找不到该替代 Memory ID。')
      return Promise.resolve()
    }
    return run(`supersede-${memory.id}`, async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.supersede', {
        commandId: crypto.randomUUID(),
        command: {
          predecessors: [{ memoryId: memory.id, expectedVersion: memory.version }],
          successor: {
            mode: 'existing',
            memoryId: successor.id,
            expectedVersion: successor.version
          }
        }
      })
      assertApplied(result)
    })
  }

  const reconcile = (): Promise<void> => run('reconcile', async () => {
    const result = await window.rovai.request<StoredCommandResult>('memory.reconcile', {
      commandId: crypto.randomUUID(),
      command: {}
    })
    assertApplied(result)
  })

  const exportMemory = (): Promise<void> => run('export', async () => {
    await window.rovai.exportMemory()
    setConfirmation(null)
  })

  return (
    <section className="memory-library" aria-labelledby="memory-library-title">
      <header className="memory-library-header">
        <div>
          <p className="eyebrow">可回看 · 可修订 · 可遗忘</p>
          <h2 id="memory-library-title">长期记忆</h2>
          <p>应用级 · 由你治理，伙伴可以提出或自动形成。</p>
        </div>
        <div className="memory-header-actions">
          <button className="quiet-button" type="button" onClick={() => setConfirmation({ kind: 'export' })}>导出…</button>
          <button className="primary-button" type="button" onClick={openCreate}>＋ 新增记忆</button>
        </div>
      </header>

      {error && <div className="memory-error" role="alert"><strong>操作未完成</strong><span>{error}</span></div>}

      <div className="memory-summary-strip" aria-label="长期记忆概览">
        <div><strong>{activeMemoryCount}</strong><span>正在沿用</span></div>
        <div className={pending.length > 0 ? 'attention' : ''}><strong>{pending.length}</strong><span>等待确认普通提案</span></div>
        <div><strong>{automaticMemoryCount}</strong><span>自动形成</span></div>
        <div><strong>{reviewMemoryCount}</strong><span>建议复核</span></div>
      </div>

      {autoPolicy && (
        <section className="memory-auto-policy" aria-labelledby="memory-auto-policy-title">
          <div>
            <strong id="memory-auto-policy-title">自动形成伙伴经验与协作默契</strong>
            <p>开启后，伙伴可以自动新增伙伴经验和协作默契，并立即用于后续协作；家园共识和对已有记忆的修订仍需你确认。自动形成的内容优先级低于你明确确认的记忆。</p>
          </div>
          <button
            className={`memory-policy-switch ${autoPolicy.automaticPartnerMemoryEnabled ? 'enabled' : ''}`}
            type="button"
            role="switch"
            aria-checked={autoPolicy.automaticPartnerMemoryEnabled}
            aria-label={`自动形成伙伴经验与协作默契：${autoPolicy.automaticPartnerMemoryEnabled ? '已开启' : '已关闭'}`}
            onClick={() => void setPolicy(!autoPolicy.automaticPartnerMemoryEnabled)}
            disabled={busy !== null}
          >
            <i aria-hidden="true" />
            <span>{busy === 'auto-policy' ? '正在保存…' : autoPolicy.automaticPartnerMemoryEnabled ? '已开启' : '已关闭'}</span>
          </button>
        </section>
      )}

      {pending.length > 0 && (
        <button className="memory-pending-banner" type="button" onClick={() => setProposalDrawerOpen(true)}>
          <span><strong>{pending.length} 条普通提案等待确认</strong><small>这些提案尚未生效，你可以逐条接受、编辑后接受或拒绝。</small></span>
          <b>查看提案 <span aria-hidden="true">→</span></b>
        </button>
      )}

      <nav className="memory-scope-tabs" aria-label="记忆范围">
        {scopeTabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scope === value ? 'active' : ''}
            aria-current={scope === value ? 'page' : undefined}
            onClick={() => {
              if (value !== scope) setSearch('')
              setScope(value)
            }}
          >
            {label}
            <span>{library?.memories.filter((memory) => memory.scope === value && memory.lifecycle !== 'forgotten').length ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="memory-filter-row">
        <nav className="memory-governance-tabs" aria-label="记忆治理状态">
          {governanceTabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={governance === value ? 'active' : ''}
              aria-pressed={governance === value}
              onClick={() => setGovernance(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="memory-search">
          <span>搜索{scopeLabel(scope)}</span>
          <input value={search} placeholder={`搜索${scopeLabel(scope)}`} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>

      {issues.length > 0 && (
        <section className="memory-projection-issues" aria-labelledby="memory-projection-title">
          <div><strong id="memory-projection-title">读取投影需要处理</strong><span>{issues.length} 个位置不可用；SQLite 中的正式记忆不受影响。</span></div>
          <button className="quiet-button compact" type="button" onClick={() => void reconcile()} disabled={busy === 'reconcile'}>{busy === 'reconcile' ? '正在重建…' : '重建投影'}</button>
          {issues.map((issue) => <code key={issue.logicalKey}>{issue.path} · {issue.state}</code>)}
        </section>
      )}

      <div className="memory-workbench">
        <div className="memory-catalog" aria-label={`${scopeLabel(scope)}列表`}>
          <div className="memory-catalog-heading">
            <strong>{scopeLabel(scope)}</strong>
            <span>{visibleMemories.length} 条</span>
          </div>
          <div
            className="memory-catalog-list"
            ref={catalogListRef}
            onScroll={(event) => storeMemoryValue('rovai.memory.scroll', String(event.currentTarget.scrollTop))}
          >
            {visibleMemories.length === 0 && (
              <EmptyMemory text={governance === 'review' ? '当前没有到期的复核建议。' : '这个分类还没有记忆。'} />
            )}
            {visibleMemories.map((memory) => (
              <button
                key={memory.id}
                className={`memory-catalog-item ${selectedMemoryId === memory.id ? 'selected' : ''}`}
                type="button"
                aria-pressed={selectedMemoryId === memory.id}
                onClick={() => setSelectedMemoryId(memory.id)}
              >
                <span className="memory-catalog-meta">
                  <KindBadge kind={memory.kind} />
                  <AuthorityBadge authority={memory.currentAuthority} />
                  {memory.lifecycle === 'retired' && <span className="status-badge status-pending"><i />已停止沿用</span>}
                  {memory.reviewDue && <strong className="memory-review-due">建议复核</strong>}
                </span>
                <strong>{memory.currentBody ?? '正文已遗忘'}</strong>
                <small>{memoryPeopleLabel(memory, agents)} · {formatTime(memory.updatedAt)}</small>
              </button>
            ))}
          </div>
        </div>

        <MemoryDetail
          memory={selectedMemory}
          library={library}
          agents={agents}
          busy={busy}
          onConfirm={confirmMemory}
          onRevise={openRevise}
          onReview={scheduleReview}
          onSupersede={supersede}
          onRetire={(memory) => lifecycle('memory.retire', memory)}
          onReactivate={(memory) => lifecycle('memory.reactivate', memory)}
          onForget={(memory) => setConfirmation({ kind: 'forget', memory })}
        />
      </div>

      <ProposalDrawer
        open={proposalDrawerOpen}
        proposals={pending}
        agents={agents}
        busy={busy}
        selectedProposalIds={selectedProposalIds}
        onOpenChange={setProposalDrawerOpen}
        onSelectionChange={setSelectedProposalIds}
        onAccept={acceptProposal}
        onEdit={openProposalEdit}
        onReject={rejectProposal}
        onRejectSelected={rejectSelected}
      />

      {feedback && (
        <div className="app-toast" role="status" aria-live="polite">
          <span>{feedback}</span>
          <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setFeedback(null)}>×</button>
        </div>
      )}

      <MemoryEditorDialog
        editor={editor}
        draft={draft}
        agents={agents}
        busy={busy?.startsWith('editor-') ?? false}
        onDraft={setDraft}
        onClose={() => setEditor(null)}
        onSubmit={submitEditor}
      />

      <Dialog.Root open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content memory-confirm-dialog">
            {confirmation?.kind === 'forget' ? (
              <>
                <Dialog.Title>从长期记忆中永久遗忘？</Dialog.Title>
                <Dialog.Description>这会清除该记忆的全部正文和相关已接受候选，不能恢复。原始对话、任务、执行历史和用户控制的备份不会被删除。</Dialog.Description>
                <div className="memory-confirm-preview">{confirmation.memory.currentBody}</div>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" autoFocus>取消</button></Dialog.Close><button className="danger-button" type="button" onClick={() => void forget(confirmation.memory)} disabled={busy !== null}>永久遗忘</button></div>
              </>
            ) : confirmation?.kind === 'export' ? (
              <>
                <Dialog.Title>导出长期记忆副本？</Dialog.Title>
                <Dialog.Description>导出的 JSON 包含正在沿用和已停止沿用的记忆、版本权威历史与提案决议元数据。外部副本不再受后续“遗忘”操作控制，请自行安全保管。</Dialog.Description>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" autoFocus>取消</button></Dialog.Close><button className="primary-button" type="button" onClick={() => void exportMemory()} disabled={busy !== null}>选择保存位置</button></div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

function MemoryDetail({
  memory,
  library,
  agents,
  busy,
  onConfirm,
  onRevise,
  onReview,
  onSupersede,
  onRetire,
  onReactivate,
  onForget
}: {
  memory: MemoryRecord | null
  library: MemoryLibraryView | null
  agents: AgentProfile[]
  busy: string | null
  onConfirm(memory: MemoryRecord): Promise<void>
  onRevise(memory: MemoryRecord): void
  onReview(memory: MemoryRecord): Promise<void>
  onSupersede(memory: MemoryRecord): Promise<void>
  onRetire(memory: MemoryRecord): Promise<void>
  onReactivate(memory: MemoryRecord): Promise<void>
  onForget(memory: MemoryRecord): void
}): React.JSX.Element {
  if (!memory) {
    return <aside className="memory-detail empty"><span aria-hidden="true">⌁</span><strong>选择一条记忆查看详情</strong><p>这里会显示正文、适用伙伴、权威状态、版本历史和治理操作。</p></aside>
  }
  const people = memoryPeople(memory, agents)
  const wasAutomaticallyFormed = memory.revisions.some((revision) => revision.authority === 'provisional')
  const scopeKey = memory.scope === 'companion'
    ? `companion:${memory.companionAgentProfileId ?? ''}`
    : memory.scope === 'relationship'
      ? `relationship:${memory.relationshipAgentProfileIds.slice().sort().join(':')}`
      : 'hearth'
  const automaticCount = library?.provisionalCounts.find((count) => count.scopeKey === scopeKey)

  return (
    <aside className="memory-detail" aria-labelledby={`memory-detail-${memory.id}`}>
      <header>
        <div className="memory-detail-badges">
          <KindBadge kind={memory.kind} />
          <AuthorityBadge authority={memory.currentAuthority} />
          <span className={`status-badge status-${memory.lifecycle === 'active' ? 'completed' : 'pending'}`}><i />{lifecycleLabel(memory.lifecycle)}</span>
        </div>
        <h3 id={`memory-detail-${memory.id}`}>{memory.currentBody ?? '正文已遗忘'}</h3>
        <small>{scopeLabel(memory.scope)} · 更新于 {formatTime(memory.updatedAt)}</small>
      </header>

      {people.length > 0 && (
        <section className="memory-detail-section">
          <h4>适用伙伴</h4>
          <div className="memory-people">
            {people.map((agent) => (
              <span key={agent.id}>
                <MemberAvatar agentProfileId={agent.id} avatarRef={agent.avatarRef} displayName={agent.displayName} size="list" decorative />
                <strong>{agent.displayName}</strong>
              </span>
            ))}
            {memory.direction && <small>{directionLabel(memory, agents)}</small>}
          </div>
        </section>
      )}

      <section className="memory-detail-section memory-detail-facts">
        <h4>治理信息</h4>
        <dl>
          <div><dt>形成方式</dt><dd>{wasAutomaticallyFormed ? memory.currentAuthority === 'provisional' ? '自动形成' : '自动形成 · 已标记确认' : '用户明确确认'}</dd></div>
          <div><dt>建议复核</dt><dd>{memory.reviewAfter ? formatTime(memory.reviewAfter) : '未设置'}</dd></div>
          <div><dt>当前版本</dt><dd>v{memory.version} · {shortId(memory.currentRevisionId)}</dd></div>
          {automaticCount && <div><dt>自动形成额度</dt><dd>{automaticCount.activeCount}/{automaticCount.maxCount} 条</dd></div>}
        </dl>
      </section>

      {(memory.outgoingSuccessorIds.length > 0 || memory.incomingPredecessorIds.length > 0) && (
        <section className="memory-detail-section">
          <h4>替代关系</h4>
          <p>前项：{memory.incomingPredecessorIds.map(shortId).join('、') || '无'}；后项：{memory.outgoingSuccessorIds.map(shortId).join('、') || '无'}</p>
        </section>
      )}

      <section className="memory-detail-section memory-revisions">
        <h4>版本记录</h4>
        {memory.revisions.map((revision) => (
          <article key={revision.id}>
            <span className={`memory-authority ${revision.authority === 'provisional' ? 'provisional' : 'confirmed'}`}>{revision.authority === 'provisional' ? '自动形成' : '已确认'}</span>
            <strong>{revision.body ?? '正文已清除'}</strong>
            <small>{formatTime(revision.createdAt)} · {shortId(revision.id)}</small>
          </article>
        ))}
      </section>

      <div className="memory-detail-actions">
        {memory.lifecycle === 'active' && <>
          {memory.currentAuthority === 'provisional' && <button className="primary-button" type="button" onClick={() => void onConfirm(memory)} disabled={busy !== null}>标记为已确认</button>}
          <button className="quiet-button" type="button" onClick={() => onRevise(memory)} disabled={busy !== null}>{memory.currentAuthority === 'provisional' ? '修订并确认' : '修订'}</button>
          <button className="quiet-button" type="button" onClick={() => void onReview(memory)} disabled={busy !== null}>设置复核时间</button>
          <button className="quiet-button" type="button" onClick={() => void onSupersede(memory)} disabled={busy !== null}>设为被替代</button>
          <button className="quiet-button" type="button" onClick={() => void onRetire(memory)} disabled={busy !== null}>停止沿用</button>
        </>}
        {memory.lifecycle === 'retired' && memory.outgoingSuccessorIds.length === 0 && <button className="primary-button" type="button" onClick={() => void onReactivate(memory)} disabled={busy !== null}>重新沿用</button>}
        {memory.lifecycle !== 'forgotten' && <button className="danger-button" type="button" onClick={() => onForget(memory)} disabled={busy !== null}>永久遗忘</button>}
      </div>
    </aside>
  )
}

function ProposalDrawer({
  open,
  proposals,
  agents,
  busy,
  selectedProposalIds,
  onOpenChange,
  onSelectionChange,
  onAccept,
  onEdit,
  onReject,
  onRejectSelected
}: {
  open: boolean
  proposals: MemoryProposal[]
  agents: AgentProfile[]
  busy: string | null
  selectedProposalIds: Set<string>
  onOpenChange(open: boolean): void
  onSelectionChange(value: Set<string>): void
  onAccept(proposal: MemoryProposal): Promise<void>
  onEdit(proposal: MemoryProposal): void
  onReject(proposal: MemoryProposal): Promise<void>
  onRejectSelected(): Promise<void>
}): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay memory-drawer-overlay" />
        <Dialog.Content className="memory-proposal-drawer">
          <header>
            <div><Dialog.Title>等待确认的提案</Dialog.Title><Dialog.Description>接受后才会成为已确认的长期记忆。</Dialog.Description></div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="关闭提案抽屉">×</button></Dialog.Close>
          </header>
          {proposals.length > 0 && (
            <div className="memory-drawer-batch">
              <label><input type="checkbox" checked={selectedProposalIds.size === proposals.length} onChange={(event) => onSelectionChange(event.target.checked ? new Set(proposals.map((proposal) => proposal.id)) : new Set())} /> 全选</label>
              <button className="quiet-button compact" type="button" disabled={selectedProposalIds.size === 0 || busy !== null} onClick={() => void onRejectSelected()}>拒绝所选</button>
            </div>
          )}
          <div className="memory-proposal-drawer-list">
            {proposals.length === 0 && <EmptyMemory text="没有等待确认的普通提案。" />}
            {proposals.map((proposal) => (
              <article key={proposal.id} className="memory-proposal-item">
                <label className="memory-select"><input type="checkbox" checked={selectedProposalIds.has(proposal.id)} onChange={(event) => {
                  const next = new Set(selectedProposalIds)
                  if (event.target.checked) next.add(proposal.id)
                  else next.delete(proposal.id)
                  onSelectionChange(next)
                }} /><span className="sr-only">选择提案</span></label>
                <div>
                  <span className="memory-catalog-meta"><KindBadge kind={proposal.kind} /><b>{proposal.action === 'add' ? '新增' : '修订'}</b><b>{scopeLabel(proposal.scope)}</b>{proposal.stale && <strong className="memory-stale">基准已变化</strong>}</span>
                  <p>{proposal.body ?? '候选内容已清除'}</p>
                  <small>{agentName(proposal.proposedByAgentProfileId, agents)} 提议 · {formatTime(proposal.proposedAt)}</small>
                </div>
                <footer>
                  <button className="quiet-button compact" type="button" onClick={() => void onReject(proposal)} disabled={busy !== null}>拒绝</button>
                  <button className="quiet-button compact" type="button" onClick={() => onEdit(proposal)} disabled={proposal.stale || busy !== null}>编辑</button>
                  <button className="primary-button compact" type="button" onClick={() => void onAccept(proposal)} disabled={proposal.stale || busy !== null}>接受</button>
                </footer>
              </article>
            ))}
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
  const identityLocked = editor?.kind === 'revise' || (editor?.kind === 'proposal' && editor.proposal.action === 'revise')
  const identityValid = draft.scope === 'hearth'
    || (draft.scope === 'companion' && draft.firstAgentId !== '')
    || (
      draft.scope === 'relationship'
      && draft.kind !== 'preference'
      && draft.firstAgentId !== ''
      && draft.secondAgentId !== ''
      && draft.firstAgentId !== draft.secondAgentId
      && (draft.direction === 'mutual' || [draft.firstAgentId, draft.secondAgentId].includes(draft.directedActorAgentProfileId))
    )
  const bodyBytes = new TextEncoder().encode(draft.body).length
  return (
    <Dialog.Root open={editor !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content memory-editor-dialog">
          <form onSubmit={onSubmit}>
            <Dialog.Title>{editor?.kind === 'create' ? '新增长期记忆' : editor?.kind === 'proposal' ? '编辑后接受提案' : editor?.memory.currentAuthority === 'provisional' ? '修订并确认自动记忆' : '修订长期记忆'}</Dialog.Title>
            <Dialog.Description>写成一条面向未来、可以独立理解且不含秘密的信息。范围、类型和方向在创建后不能通过修订改变。</Dialog.Description>
            <div className="memory-editor-grid">
              <label className="field-label">范围<select value={draft.scope} disabled={identityLocked || busy} onChange={(event) => {
                const nextScope = event.target.value as MemoryScopeKind
                const firstAgentId = draft.firstAgentId || agents[0]?.id || ''
                const secondAgentId = draft.secondAgentId !== firstAgentId
                  ? draft.secondAgentId
                  : agents.find((agent) => agent.id !== firstAgentId)?.id ?? ''
                onDraft({
                  ...draft,
                  scope: nextScope,
                  kind: nextScope === 'relationship' && draft.kind === 'preference' ? 'agreement' : draft.kind,
                  firstAgentId,
                  secondAgentId,
                  directedActorAgentProfileId: draft.directedActorAgentProfileId || firstAgentId
                })
              }}><option value="hearth">家园共识</option><option value="companion">伙伴经验</option><option value="relationship">协作默契</option></select></label>
              <label className="field-label">类型<select value={draft.kind} disabled={identityLocked || busy} onChange={(event) => onDraft({ ...draft, kind: event.target.value as MemoryKind })}><option value="preference" disabled={draft.scope === 'relationship'}>偏好</option><option value="agreement">约定</option><option value="lesson">经验</option></select></label>
              {draft.scope === 'companion' && <AgentSelect label="伙伴" value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />}
              {draft.scope === 'relationship' && <>
                <AgentSelect label="伙伴 A" value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({
                  ...draft,
                  firstAgentId,
                  secondAgentId: draft.secondAgentId === firstAgentId ? '' : draft.secondAgentId,
                  directedActorAgentProfileId: [firstAgentId, draft.secondAgentId].includes(draft.directedActorAgentProfileId)
                    ? draft.directedActorAgentProfileId
                    : firstAgentId
                })} />
                <AgentSelect label="伙伴 B" value={draft.secondAgentId} agents={agents.filter((agent) => agent.id !== draft.firstAgentId)} disabled={identityLocked || busy} onChange={(secondAgentId) => onDraft({ ...draft, secondAgentId })} />
                <label className="field-label">方向<select value={draft.direction} disabled={identityLocked || busy} onChange={(event) => {
                  const direction = event.target.value as MemoryDirection
                  onDraft({
                    ...draft,
                    direction,
                    directedActorAgentProfileId: direction === 'directed'
                      ? draft.directedActorAgentProfileId || draft.firstAgentId
                      : ''
                  })
                }}><option value="mutual">双方共同</option><option value="directed">单向</option></select></label>
                {draft.direction === 'directed' && <AgentSelect label="责任方" value={draft.directedActorAgentProfileId} agents={agents.filter((agent) => [draft.firstAgentId, draft.secondAgentId].includes(agent.id))} disabled={identityLocked || busy} onChange={(directedActorAgentProfileId) => onDraft({ ...draft, directedActorAgentProfileId })} />}
              </>}
            </div>
            <label className="field-label memory-body-field">正文<textarea autoFocus value={draft.body} maxLength={2048} rows={7} disabled={busy} onChange={(event) => onDraft({ ...draft, body: event.target.value })} /><small>{bodyBytes}/2048 bytes</small></label>
            <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close><button className="primary-button" type="submit" disabled={!draft.body.trim() || bodyBytes > 2048 || !identityValid || busy}>{busy ? '正在保存…' : editor?.kind === 'proposal' ? '接受最终内容' : editor?.kind === 'revise' && editor.memory.currentAuthority === 'provisional' ? '保存并确认' : '保存'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AgentSelect({ label, value, agents, disabled, onChange }: { label: string; value: string; agents: AgentProfile[]; disabled: boolean; onChange(value: string): void }): React.JSX.Element {
  return <label className="field-label">{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</select></label>
}

function EmptyMemory({ text }: { text: string }): React.JSX.Element {
  return <div className="empty-inline">{text}</div>
}

function KindBadge({ kind }: { kind: MemoryKind | null }): React.JSX.Element {
  const shape = kind === 'preference' ? '○' : kind === 'lesson' ? '◇' : '□'
  return <span className={`memory-kind kind-${kind ?? 'agreement'}`}>{kindLabel(kind)} <i aria-hidden="true">{shape}</i></span>
}

function AuthorityBadge({ authority }: { authority: MemoryRecord['currentAuthority'] }): React.JSX.Element | null {
  if (!authority) return null
  return <span className={`memory-authority ${authority === 'provisional' ? 'provisional' : 'confirmed'}`}>{authority === 'provisional' ? '自动形成' : '已确认'}</span>
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') {
    const message = typeof result.payload.message === 'string' ? result.payload.message : result.code
    throw new Error(message)
  }
}

function scopeLabel(scope: MemoryScopeKind | null): string {
  return scope === 'hearth' ? '家园共识' : scope === 'companion' ? '伙伴经验' : scope === 'relationship' ? '协作默契' : '已遗忘'
}

function kindLabel(kind: MemoryKind | null): string {
  return kind === 'preference' ? '偏好' : kind === 'agreement' ? '约定' : kind === 'lesson' ? '经验' : '—'
}

function lifecycleLabel(lifecycle: MemoryRecord['lifecycle']): string {
  return lifecycle === 'active' ? '正在沿用' : lifecycle === 'retired' ? '已停止沿用' : '已遗忘'
}

function memoryPeople(memory: MemoryRecord, agents: AgentProfile[]): AgentProfile[] {
  const ids = memory.scope === 'companion'
    ? [memory.companionAgentProfileId]
    : memory.scope === 'relationship'
      ? memory.relationshipAgentProfileIds
      : []
  return ids.flatMap((id) => {
    const agent = agents.find((candidate) => candidate.id === id)
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
    const actor = agentName(memory.directedActorAgentProfileId, agents)
    const counterparty = agentName(
      memory.relationshipAgentProfileIds.find((id) => id !== memory.directedActorAgentProfileId),
      agents
    )
    return `${actor} → ${counterparty}`
  }
  return ''
}

function agentName(id: string | null | undefined, agents: AgentProfile[]): string {
  if (!id) return '未知伙伴'
  return agents.find((agent) => agent.id === id)?.displayName ?? shortId(id)
}

function shortId(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 10 ? `${value.slice(0, 8)}…` : value
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function storedScope(): MemoryScopeKind {
  if (typeof window === 'undefined') return 'hearth'
  const value = storedMemoryValue('rovai.memory.scope')
  return value === 'companion' || value === 'relationship' ? value : 'hearth'
}

function storedGovernance(): GovernanceFilter {
  if (typeof window === 'undefined') return 'all'
  const value = storedMemoryValue('rovai.memory.governance')
  return value === 'automatic' || value === 'review' || value === 'stopped' ? value : 'all'
}

function storeMemoryViewState(
  scope: MemoryScopeKind,
  governance: GovernanceFilter,
  search: string,
  selectedMemoryId: string | null
): void {
  if (typeof window === 'undefined') return
  storeMemoryValue('rovai.memory.scope', scope)
  storeMemoryValue('rovai.memory.governance', governance)
  storeMemoryValue('rovai.memory.search', search)
  storeMemoryValue('rovai.memory.selected', selectedMemoryId ?? '')
}

function storedMemoryValue(key: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage?.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function storeMemoryValue(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage?.setItem(key, value)
  } catch {
    // Session retention is best-effort; Memory truth remains in Core.
  }
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
