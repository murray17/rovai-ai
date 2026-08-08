import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AcceptHearthMemoryProposalCommand,
  AgentProfile,
  CreateMemoryCommand,
  HearthMemoryProposal,
  MemoryDirection,
  MemoryKind,
  MemoryLibraryView,
  MemoryRecord,
  MemoryScopeKind,
  StoredCommandResult
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { localizeExecutionEngineTerms } from './product-copy'

type GovernanceFilter = 'all' | 'agent' | 'review' | 'stopped'
type Editor =
  | { kind: 'create' }
  | { kind: 'revise'; memory: MemoryRecord }
  | { kind: 'proposal'; proposal: HearthMemoryProposal }
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
  ['hearth', '共同约定'],
  ['companion', '伙伴经验'],
  ['relationship', '协作默契']
]

const governanceTabs: Array<[GovernanceFilter, string]> = [
  ['all', '全部'],
  ['agent', '队员形成'],
  ['review', '建议复核'],
  ['stopped', '已停止沿用']
]

export function MemoryLibrary({
  agents,
  topNotices,
  refreshSignal = 0,
  focusMemoryId = null,
  proposalDrawerSignal = 0,
  onProposalDrawerSignalConsumed,
  onPendingCountChange,
  onReady
}: {
  agents: AgentProfile[]
  topNotices?: ReactNode
  refreshSignal?: number
  focusMemoryId?: string | null
  proposalDrawerSignal?: number
  onProposalDrawerSignalConsumed?(): void
  onPendingCountChange?(count: number): void
  onReady?(): void
}): React.JSX.Element {
  const [library, setLibrary] = useState<MemoryLibraryView | null>(null)
  const [proposals, setProposals] = useState<HearthMemoryProposal[]>([])
  const [scope, setScope] = useState<MemoryScopeKind>('hearth')
  const [governance, setGovernance] = useState<GovernanceFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null)
  const [proposalDrawerOpen, setProposalDrawerOpen] = useState(false)
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<Editor>(null)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [forgetTarget, setForgetTarget] = useState<MemoryRecord | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [nextLibrary, nextProposals] = await Promise.all([
      window.rovai.request<MemoryLibraryView>('memory.list'),
      window.rovai.request<HearthMemoryProposal[]>('memory.hearthProposals.list')
    ])
    setLibrary(nextLibrary)
    setProposals(nextProposals)
    onPendingCountChange?.(nextProposals.filter((proposal) => proposal.status === 'pending').length)
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
      ? memory.creationOrigin === 'agent' ? 'agent' : 'all'
      : 'stopped')
    setSelectedMemoryId(memory.id)
  }, [focusMemoryId, library])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 3_200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const pending = proposals.filter((proposal) => proposal.status === 'pending')
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

  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
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

  const openProposalEdit = (proposal: HearthMemoryProposal): void => {
    setDraft({
      ...initialDraft,
      scope: 'hearth',
      kind: proposal.kind ?? 'agreement',
      body: proposal.body ?? '',
      retrievalKeys: proposal.retrievalKeys.join(', ')
    })
    setEditor({ kind: 'proposal', proposal })
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
        const command: AcceptHearthMemoryProposalCommand = {
          proposalId: editor.proposal.id,
          expectedVersion: editor.proposal.version,
          finalKind: editor.proposal.action === 'add' ? draft.kind : null,
          finalBody: draft.body.trim(),
          finalRetrievalKeys: retrievalKeys()
        }
        result = await window.rovai.request('memory.hearthProposals.accept', {
          commandId: crypto.randomUUID(),
          command
        })
      }
      assertApplied(result)
      setEditor(null)
    })
  }

  const acceptProposal = (proposal: HearthMemoryProposal): Promise<void> =>
    run(`accept-${proposal.id}`, async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.hearthProposals.accept', {
        commandId: crypto.randomUUID(),
        command: {
          proposalId: proposal.id,
          expectedVersion: proposal.version,
          finalKind: null,
          finalBody: null,
          finalRetrievalKeys: null
        }
      })
      assertApplied(result)
    })

  const rejectProposal = (proposal: HearthMemoryProposal): Promise<void> =>
    run(`reject-${proposal.id}`, async () => {
      const result = await window.rovai.request<StoredCommandResult>('memory.hearthProposals.reject', {
        commandId: crypto.randomUUID(),
        command: { proposalId: proposal.id, expectedVersion: proposal.version }
      })
      assertApplied(result)
    })

  const rejectSelected = (): Promise<void> => run('reject-batch', async () => {
    const selected = pending.filter((proposal) => selectedProposalIds.has(proposal.id))
    if (selected.length === 0) return
    const result = await window.rovai.request<StoredCommandResult>('memory.hearthProposals.rejectBatch', {
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

  const forget = (memory: MemoryRecord): Promise<void> => run(`forget-${memory.id}`, async () => {
    const result = await window.rovai.request<StoredCommandResult>('memory.forget', {
      commandId: crypto.randomUUID(),
      command: { memoryId: memory.id, expectedVersion: memory.version }
    })
    assertApplied(result)
    setForgetTarget(null)
  })

  const scheduleReview = (memory: MemoryRecord): Promise<void> => {
    const value = window.prompt('输入 RFC 3339 复核时间；留空表示清除复核提醒。', memory.reviewAfter ?? '')
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

  const exportMemory = (): Promise<void> => run('export', async () => {
    await window.rovai.exportMemory()
  })

  return (
    <section className="memory-library" aria-labelledby="memory-library-title">
      <header className="memory-library-header">
        <div>
          <h2 id="memory-library-title">记忆</h2>
          <p>所有 Active Memory 都立即生效；形成来源仅用于说明和审计。</p>
        </div>
        <div className="memory-header-actions">
          <button className="quiet-button" type="button" onClick={() => void exportMemory()}>导出…</button>
          <button className="primary-button" type="button" onClick={openCreate}>＋ 新增记忆</button>
        </div>
      </header>

      {topNotices && <div className="memory-page-notices">{topNotices}</div>}

      {error && <div className="memory-error" role="alert"><strong>操作未完成</strong><span>{error}</span></div>}
      {feedback && <div className="memory-feedback" role="status">{feedback}</div>}

      <div className="memory-summary-strip" aria-label="记忆概览">
        <div><strong>{activeCount}</strong><span>正在沿用</span></div>
        <div className={pending.length > 0 ? 'attention' : ''}><strong>{pending.length}</strong><span>Hearth 待确认</span></div>
        <div><strong>{agentCount}</strong><span>队员形成</span></div>
        <div><strong>{reviewCount}</strong><span>建议复核</span></div>
      </div>

      {pending.length > 0 && (
        <button className="memory-pending-banner" type="button" onClick={() => setProposalDrawerOpen(true)}>
          <span><strong>{pending.length} 条 Hearth Memory 提案等待确认</strong><small>只有接受后才会生效。</small></span>
          <b>查看提案 →</b>
        </button>
      )}

      <nav className="memory-scope-tabs" aria-label="记忆范围">
        {scopeTabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scope === value ? 'active' : ''}
            aria-current={scope === value ? 'page' : undefined}
            onClick={() => setScope(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="memory-toolbar">
        <div className="memory-governance-tabs">
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
        </div>
        <label className="memory-search"><span className="sr-only">搜索记忆</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索正文、Retrieval Keys 或队员" /></label>
      </div>

      <CapacityStrip library={library} scope={scope} />

      <div className="memory-catalog-layout">
        <div className="memory-catalog-list">
          {!library && <EmptyMemory text="正在读取记忆…" />}
          {library && visibleMemories.length === 0 && <EmptyMemory text="当前筛选下没有记忆。" />}
          {visibleMemories.map((memory) => (
            <button key={memory.id} type="button" className={`memory-catalog-item ${selectedMemoryId === memory.id ? 'selected' : ''}`} onClick={() => setSelectedMemoryId(memory.id)}>
              <span className="memory-catalog-meta"><KindBadge kind={memory.kind} /><OriginBadge origin={memory.creationOrigin} /></span>
              <strong>{memory.currentBody ?? '正文已清除'}</strong>
              <small>{memory.currentRetrievalKeys.join(' · ') || '无 Retrieval Keys'} · {memoryPeopleLabel(memory, agents)}</small>
            </button>
          ))}
        </div>
        <MemoryDetail
          memory={selectedMemory}
          agents={agents}
          busy={busy}
          onRevise={openRevise}
          onReview={scheduleReview}
          onRetire={(memory) => lifecycle('memory.retire', memory)}
          onReactivate={(memory) => lifecycle('memory.reactivate', memory)}
          onForget={setForgetTarget}
        />
      </div>

      <ProposalDrawer
        open={proposalDrawerOpen}
        proposals={pending}
        agents={agents}
        busy={busy}
        selected={selectedProposalIds}
        onOpenChange={setProposalDrawerOpen}
        onSelection={setSelectedProposalIds}
        onAccept={acceptProposal}
        onEdit={openProposalEdit}
        onReject={rejectProposal}
        onRejectSelected={rejectSelected}
      />

      <MemoryEditorDialog editor={editor} draft={draft} agents={agents} busy={busy !== null} onDraft={setDraft} onClose={() => setEditor(null)} onSubmit={submitEditor} />

      <Dialog.Root open={forgetTarget !== null} onOpenChange={(open) => { if (!open) setForgetTarget(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content compact-dialog memory-confirm-dialog">
            <Dialog.Title>永久遗忘这条记忆？</Dialog.Title>
            <Dialog.Description>正文、Retrieval Keys 与受控候选内容会被清除，操作不可撤销。Agent 之后调用 memory.read 只会收到已删除提示，不会获得旧正文。</Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild><button className="quiet-button" type="button">取消</button></Dialog.Close>
              <button className="danger-button" type="button" onClick={() => forgetTarget && void forget(forgetTarget)} disabled={busy !== null}>永久遗忘</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

function CapacityStrip({ library, scope }: { library: MemoryLibraryView | null; scope: MemoryScopeKind }): React.JSX.Element | null {
  const capacities = library?.capacities.filter((capacity) => capacity.scope === scope) ?? []
  if (capacities.length === 0) return null
  return (
    <div className="memory-capacity-strip" aria-label="当前范围容量">
      {capacities.slice(0, 6).map((capacity) => (
        <span key={capacity.scopeKey}>
          <strong>{capacity.activeCount}/{capacity.maxCount}</strong> 总量
          <small>{capacity.agentOriginCount}/{capacity.agentOriginMaxCount} 队员形成</small>
        </span>
      ))}
    </div>
  )
}

function MemoryDetail({
  memory,
  agents,
  busy,
  onRevise,
  onReview,
  onRetire,
  onReactivate,
  onForget
}: {
  memory: MemoryRecord | null
  agents: AgentProfile[]
  busy: string | null
  onRevise(memory: MemoryRecord): void
  onReview(memory: MemoryRecord): Promise<void>
  onRetire(memory: MemoryRecord): Promise<void>
  onReactivate(memory: MemoryRecord): Promise<void>
  onForget(memory: MemoryRecord): void
}): React.JSX.Element {
  if (!memory) {
    return <aside className="memory-detail empty"><span aria-hidden="true">⌁</span><strong>选择一条记忆查看详情</strong><p>这里会显示正文、来源、Retrieval Keys、版本历史和治理操作。</p></aside>
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
          <div><dt>建议复核</dt><dd>{memory.reviewAfter ? formatTime(memory.reviewAfter) : '未设置'}</dd></div>
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
          <button className="quiet-button" type="button" onClick={() => void onReview(memory)} disabled={busy !== null}>设置复核时间</button>
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
  selected,
  onOpenChange,
  onSelection,
  onAccept,
  onEdit,
  onReject,
  onRejectSelected
}: {
  open: boolean
  proposals: HearthMemoryProposal[]
  agents: AgentProfile[]
  busy: string | null
  selected: Set<string>
  onOpenChange(open: boolean): void
  onSelection(value: Set<string>): void
  onAccept(proposal: HearthMemoryProposal): Promise<void>
  onEdit(proposal: HearthMemoryProposal): void
  onReject(proposal: HearthMemoryProposal): Promise<void>
  onRejectSelected(): Promise<void>
}): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay memory-drawer-overlay" />
        <Dialog.Content className="memory-proposal-drawer">
          <header>
            <div><Dialog.Title>Hearth Memory 提案</Dialog.Title><Dialog.Description>这些内容尚未生效；接受或编辑后接受才会进入共同约定。</Dialog.Description></div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="关闭提案抽屉">×</button></Dialog.Close>
          </header>
          {proposals.length > 0 && <div className="memory-drawer-batch"><label><input type="checkbox" checked={selected.size === proposals.length} onChange={(event) => onSelection(event.target.checked ? new Set(proposals.map((proposal) => proposal.id)) : new Set())} /> 全选</label><button className="quiet-button compact" type="button" disabled={selected.size === 0 || busy !== null} onClick={() => void onRejectSelected()}>拒绝所选</button></div>}
          <div className="memory-proposal-drawer-list">
            {proposals.length === 0 && <EmptyMemory text="没有等待确认的 Hearth Memory 提案。" />}
            {proposals.map((proposal) => (
              <article key={proposal.id} className="memory-proposal-item">
                <label className="memory-select"><input type="checkbox" checked={selected.has(proposal.id)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(proposal.id); else next.delete(proposal.id); onSelection(next) }} /><span className="sr-only">选择提案</span></label>
                <div>
                  <span className="memory-catalog-meta"><KindBadge kind={proposal.kind} /><b>{proposal.action === 'add' ? '新增' : '修订'}</b>{proposal.stale && <strong className="memory-stale">基准已变化</strong>}</span>
                  <p>{proposal.body ?? '候选内容已清除'}</p>
                  <small>{proposal.retrievalKeys.join(' · ')} · {agentName(proposal.proposedByAgentId, agents)} 提议 · {formatTime(proposal.proposedAt)}</small>
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
  const identityLocked = editor?.kind === 'revise' || editor?.kind === 'proposal'
  const keys = draft.retrievalKeys.split(',').map((key) => key.trim()).filter(Boolean)
  const keyBytes = keys.reduce((total, key) => total + new TextEncoder().encode(key).length, 0)
  const identityValid = draft.scope === 'hearth'
    || (draft.scope === 'companion' && draft.firstAgentId !== '')
    || (draft.scope === 'relationship' && draft.kind !== 'preference' && draft.firstAgentId !== '' && draft.secondAgentId !== '' && draft.firstAgentId !== draft.secondAgentId && (draft.direction === 'mutual' || [draft.firstAgentId, draft.secondAgentId].includes(draft.directedActorAgentId)))
  const keysValid = keys.length >= 1 && keys.length <= 3 && keys.every((key) => new TextEncoder().encode(key).length >= 2 && new TextEncoder().encode(key).length <= 24) && keyBytes <= 48
  const bodyBytes = new TextEncoder().encode(draft.body).length
  return (
    <Dialog.Root open={editor !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content memory-editor-dialog">
          <form onSubmit={onSubmit}>
            <Dialog.Title>{editor?.kind === 'create' ? '新增记忆' : editor?.kind === 'proposal' ? '编辑后接受 Hearth 提案' : '修订记忆'}</Dialog.Title>
            <Dialog.Description>正文写成面向未来、可独立理解且不含秘密的信息。Retrieval Keys 用于搜索，不代替正文。</Dialog.Description>
            <div className="memory-editor-grid">
              <label className="field-label">范围<select value={draft.scope} disabled={identityLocked || busy} onChange={(event) => onDraft({ ...draft, scope: event.target.value as MemoryScopeKind })}><option value="hearth">共同约定</option><option value="companion">伙伴经验</option><option value="relationship">协作默契</option></select></label>
              <label className="field-label">类型<select value={draft.kind} disabled={(identityLocked && editor?.kind !== 'proposal') || busy} onChange={(event) => onDraft({ ...draft, kind: event.target.value as MemoryKind })}><option value="preference" disabled={draft.scope === 'relationship'}>偏好</option><option value="agreement">约定</option><option value="lesson">经验</option></select></label>
              {draft.scope === 'companion' && <AgentSelect label="队员" value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />}
              {draft.scope === 'relationship' && <>
                <AgentSelect label="队员 A" value={draft.firstAgentId} agents={agents} disabled={identityLocked || busy} onChange={(firstAgentId) => onDraft({ ...draft, firstAgentId })} />
                <AgentSelect label="队员 B" value={draft.secondAgentId} agents={agents.filter((agent) => agent.agentId !== draft.firstAgentId)} disabled={identityLocked || busy} onChange={(secondAgentId) => onDraft({ ...draft, secondAgentId })} />
                <label className="field-label">方向<select value={draft.direction} disabled={identityLocked || busy} onChange={(event) => onDraft({ ...draft, direction: event.target.value as MemoryDirection })}><option value="mutual">双方共同</option><option value="directed">单向</option></select></label>
                {draft.direction === 'directed' && <AgentSelect label="责任方" value={draft.directedActorAgentId} agents={agents.filter((agent) => [draft.firstAgentId, draft.secondAgentId].includes(agent.agentId))} disabled={identityLocked || busy} onChange={(directedActorAgentId) => onDraft({ ...draft, directedActorAgentId })} />}
              </>}
            </div>
            <label className="field-label memory-body-field">Retrieval Keys<input value={draft.retrievalKeys} disabled={busy} placeholder="1–3 个关键词，使用逗号分隔" onChange={(event) => onDraft({ ...draft, retrievalKeys: event.target.value })} /><small>{keys.length}/3 项 · {keyBytes}/48 bytes</small></label>
            <label className="field-label memory-body-field">正文<textarea autoFocus value={draft.body} rows={7} disabled={busy} onChange={(event) => onDraft({ ...draft, body: event.target.value })} /><small>{bodyBytes}/2048 bytes</small></label>
            <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close><button className="primary-button" type="submit" disabled={!draft.body.trim() || bodyBytes > 2048 || !identityValid || !keysValid || busy}>{busy ? '正在保存…' : editor?.kind === 'proposal' ? '接受最终内容' : '保存'}</button></div>
          </form>
        </Dialog.Content>
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

function assertApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') {
    const message = typeof result.payload.message === 'string' ? result.payload.message : result.code
    throw new Error(message)
  }
}

function scopeLabel(scope: MemoryScopeKind | null): string {
  return scope === 'hearth' ? '共同约定' : scope === 'companion' ? '伙伴经验' : scope === 'relationship' ? '协作默契' : '已遗忘'
}

function kindLabel(kind: MemoryKind | null): string {
  return kind === 'preference' ? '偏好' : kind === 'agreement' ? '约定' : kind === 'lesson' ? '经验' : '—'
}

function originLabel(origin: MemoryRecord['creationOrigin']): string {
  return origin === 'agent' ? '队员形成' : origin === 'accepted_hearth_proposal' ? '队员提议 · 用户采纳' : origin === 'user' ? '用户创建' : '—'
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
