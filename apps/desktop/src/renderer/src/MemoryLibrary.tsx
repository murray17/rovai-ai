import { useCallback, useEffect, useMemo, useState } from 'react'
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

type Section = 'hearth' | 'companion' | 'relationship' | 'provisional' | 'review' | 'history'
type Editor =
  | { kind: 'create' }
  | { kind: 'revise'; memory: MemoryRecord }
  | { kind: 'proposal'; proposal: MemoryProposal }
  | null
type Confirmation =
  | { kind: 'forget'; memory: MemoryRecord }
  | { kind: 'undo'; memory: MemoryRecord }
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

export function MemoryLibrary({
  agents,
  onPendingCountChange
}: {
  agents: AgentProfile[]
  onPendingCountChange?(count: number): void
}): React.JSX.Element {
  const [library, setLibrary] = useState<MemoryLibraryView | null>(null)
  const [autoPolicy, setAutoPolicy] = useState<MemoryAutoPolicy | null>(null)
  const [proposals, setProposals] = useState<MemoryProposal[]>([])
  const [issues, setIssues] = useState<MemoryProjectionIssue[]>([])
  const [section, setSection] = useState<Section>('hearth')
  const [editor, setEditor] = useState<Editor>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      if (params.status === 'ready') void load().catch((nextError) => setError(errorMessage(nextError)))
    }
  }), [load])

  const pending = proposals.filter((proposal) => proposal.status === 'pending')
  const resolvedProposals = proposals.filter((proposal) => proposal.status !== 'pending')
  const visibleMemories = useMemo(() => {
    const memories = library?.memories ?? []
    if (section === 'provisional') {
      return memories.filter((memory) =>
        memory.lifecycle === 'active' && memory.currentAuthority === 'provisional'
      )
    }
    if (section === 'review') return memories.filter((memory) => memory.lifecycle === 'active' && memory.reviewDue)
    if (section === 'history') return memories.filter((memory) => memory.lifecycle !== 'active')
    return memories.filter((memory) => memory.lifecycle === 'active' && memory.scope === section)
  }, [library, section])
  const activeMemoryCount = library?.memories.filter((memory) => memory.lifecycle === 'active').length ?? 0
  const retiredMemoryCount = library?.memories.filter((memory) => memory.lifecycle === 'retired').length ?? 0
  const provisionalMemoryCount = library?.memories.filter((memory) =>
    memory.lifecycle === 'active' && memory.currentAuthority === 'provisional'
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
        if (!revisionId) throw new Error('当前记忆没有可修订的 Revision。')
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

  const lifecycle = (method: 'memory.retire' | 'memory.reactivate', memory: MemoryRecord): Promise<void> =>
    run(`${method}-${memory.id}`, async () => {
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
        companionLessonAutoApplyEnabled: enabled
      }
    })
    assertApplied(result)
  })

  const confirmMemory = (memory: MemoryRecord): Promise<void> => run(
    `confirm-${memory.id}`,
    async () => {
      if (!memory.currentRevisionId) throw new Error('当前记忆没有可确认的 Revision。')
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

  const undoAutoApplied = (memory: MemoryRecord): Promise<void> => run(
    `undo-${memory.id}`,
    async () => {
      if (!memory.currentRevisionId) throw new Error('当前记忆没有可撤销的 Revision。')
      const result = await window.rovai.request<StoredCommandResult>('memory.autoApply.undo', {
        commandId: crypto.randomUUID(),
        command: {
          memoryId: memory.id,
          expectedVersion: memory.version,
          revisionId: memory.currentRevisionId
        }
      })
      assertApplied(result)
      setConfirmation(null)
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

  const canUndoAuto = (memory: MemoryRecord): boolean =>
    memory.lifecycle === 'active'
    && memory.currentAuthority === 'provisional'
    && memory.version === 1
    && memory.currentRevisionId !== null
    && memory.outgoingSuccessorIds.length === 0
    && memory.incomingPredecessorIds.length === 0
    && proposals.some((proposal) =>
      proposal.status === 'accepted'
      && proposal.action === 'add'
      && proposal.resolutionMode === 'policy_auto'
      && proposal.acceptedMemoryId === memory.id
      && proposal.acceptedRevisionId === memory.currentRevisionId
    )

  return (
    <section className="memory-library" aria-labelledby="memory-library-title">
      <header className="memory-library-header">
        <div>
          <p className="eyebrow">家园 · 伙伴 · 共同成长</p>
          <h2 id="memory-library-title">长期记忆</h2>
          <p>你治理的长期偏好、协作约定与经验。只有符合策略的伙伴经验可先作为“未确认”生效，其他提案仍需逐条接受。</p>
        </div>
        <div className="memory-header-actions">
          <button className="quiet-button" type="button" onClick={() => setConfirmation({ kind: 'export' })}>导出…</button>
          <button className="quiet-button" type="button" onClick={openCreate}>＋ 新增记忆</button>
        </div>
      </header>

      {error && <div className="memory-error" role="alert"><strong>操作未完成</strong><span>{error}</span></div>}

      {autoPolicy && (
        <section className="memory-auto-policy" aria-labelledby="memory-auto-policy-title">
          <div>
            <div className="memory-policy-heading">
              <strong id="memory-auto-policy-title">自动形成伙伴经验</strong>
              <span className={`status-badge status-${autoPolicy.companionLessonAutoApplyEnabled ? 'completed' : 'pending'}`}><i />{autoPolicy.companionLessonAutoApplyEnabled ? '已开启' : '已关闭'}</span>
            </div>
            <p>默认关闭，需在此主动开启。开启后仅限当前 Agent 的 `新增 + 伙伴 + 经验`；每次运行最多 1 条、每位伙伴最多 8 条未确认记忆。经验可能包含普通个人上下文；凭据过滤不是通用个人数据分类。偏好、约定、家园、协作默契和全部修订始终等待你确认。</p>
            <small>关闭只阻止未来自动形成；已有未确认记忆继续沿用，需单独处理。</small>
          </div>
          <button className={autoPolicy.companionLessonAutoApplyEnabled ? 'quiet-button' : 'primary-button'} type="button" onClick={() => void setPolicy(!autoPolicy.companionLessonAutoApplyEnabled)} disabled={busy !== null}>
            {busy === 'auto-policy' ? '正在保存…' : autoPolicy.companionLessonAutoApplyEnabled ? '关闭' : '开启'}
          </button>
        </section>
      )}

      {pending.length > 0 && (
        <section className="memory-pending-card" aria-labelledby="memory-pending-title">
          <div className="memory-pending-head">
            <strong id="memory-pending-title">◆ {pending.length} 条提案等待你确认</strong>
            <span>逐条决定；批量操作仅支持拒绝</span>
          </div>
          {pending.length > 1 && (
            <div className="memory-batch-bar">
              <span>可批量拒绝；接受始终逐条确认。</span>
              <button className="quiet-button compact" type="button" onClick={() => void rejectSelected()} disabled={selectedProposalIds.size === 0 || busy !== null}>拒绝已选 ({selectedProposalIds.size})</button>
            </div>
          )}
          {pending.map((proposal) => (
            <article className="memory-row proposal" key={proposal.id}>
              <label className="memory-select"><input type="checkbox" checked={selectedProposalIds.has(proposal.id)} onChange={(event) => setSelectedProposalIds((current) => {
                const next = new Set(current)
                if (event.target.checked) next.add(proposal.id)
                else next.delete(proposal.id)
                return next
              })} /><span className="sr-only">选择提案</span></label>
              <div className="memory-row-main">
                <div className="memory-meta">
                  <KindBadge kind={proposal.kind} />
                  <span>{proposal.action === 'add' ? '新增' : '修订'}</span>
                  <span>{scopeLabel(proposal.scope)}</span>
                  {proposal.direction && <span>{directionLabel(proposal)}</span>}
                  {proposal.stale && <strong className="memory-stale">基准已变化</strong>}
                </div>
                <p>{proposal.body ?? '候选内容已清除'}</p>
                <small>{agentName(proposal.proposedByAgentProfileId, agents)} 提议 · {proposal.action === 'add' ? '新增' : '修订'} · {scopeLabel(proposal.scope)} · {formatTime(proposal.proposedAt)} · {proposal.sourceUnavailable ? '来源运行已不可用' : `来源 Camp ${shortId(proposal.sourceCampId)}`}</small>
              </div>
              <div className="memory-actions">
                <button className="quiet-button compact" type="button" onClick={() => void rejectProposal(proposal)} disabled={busy !== null}>拒绝</button>
                <button className="quiet-button compact" type="button" onClick={() => openProposalEdit(proposal)} disabled={proposal.stale || busy !== null}>编辑后接受</button>
                <button className="primary-button compact" type="button" onClick={() => void acceptProposal(proposal)} disabled={proposal.stale || busy !== null} title={proposal.stale ? '基准已变化，需先拒绝或等待新的提案' : undefined}>接受</button>
              </div>
            </article>
          ))}
        </section>
      )}
      {pending.length === 0 && (
        <div className="memory-pending-empty">
          <strong>没有等待确认的提案。</strong>
          <span>新的普通提案会出现在这里；策略自动形成的伙伴经验会进入“未确认”分类。</span>
        </div>
      )}

      <nav className="memory-tabs" aria-label="记忆分类">
        {([
          ['hearth', '家园记忆'],
          ['companion', '伙伴记忆'],
          ['relationship', '协作默契'],
          ['provisional', `未确认 (${provisionalMemoryCount})`],
          ['review', '建议复核'],
          ['history', '已停止沿用']
        ] as Array<[Section, string]>).map(([value, label]) => (
          <button key={value} type="button" aria-current={section === value ? 'page' : undefined} className={section === value ? 'active' : ''} onClick={() => setSection(value)}>{label}</button>
        ))}
        <span className="memory-tabs-stat">active {activeMemoryCount} · provisional {provisionalMemoryCount} · retired {retiredMemoryCount}</span>
      </nav>

      <div className="memory-summary">
        {(library?.capacities ?? []).map((capacity) => (
          <span key={capacity.scopeKey}>
            <strong>{capacityLabel(capacity.scopeKey, agents)}</strong>
            {capacity.activeCount}/{capacity.maxCount} 条 · {formatBytes(capacity.activeBodyBytes)}/{formatBytes(capacity.maxBodyBytes)}
          </span>
        ))}
        {(library?.provisionalCounts ?? []).filter((count) => count.activeCount > 0).map((count) => (
          <span key={`provisional:${count.companionAgentProfileId}`}>
            <strong>{agentName(count.companionAgentProfileId, agents)} 未确认</strong>
            {count.activeCount}/{count.maxCount} 条
          </span>
        ))}
      </div>

      {issues.length > 0 && (
        <section className="memory-projection-issues" aria-labelledby="memory-projection-title">
          <div><strong id="memory-projection-title">读取投影需要处理</strong><span>{issues.length} 个位置不可用；SQLite 正式记忆不受影响。</span></div>
          <button className="quiet-button compact" type="button" onClick={() => void reconcile()} disabled={busy === 'reconcile'}>{busy === 'reconcile' ? '正在重建…' : '重建投影'}</button>
          {issues.map((issue) => <code key={issue.logicalKey}>{issue.path} · {issue.state}</code>)}
        </section>
      )}

      <div className="memory-list">
          {visibleMemories.length === 0 && <EmptyMemory text={section === 'review' ? '当前没有到期的复核建议。' : '这个分类还没有记忆。'} />}
          {visibleMemories.map((memory) => (
            <article className={`memory-row ${memory.lifecycle}`} key={memory.id}>
              <div className="memory-row-main">
                <div className="memory-meta">
                  <KindBadge kind={memory.kind} />
                  <span className={`status-badge status-${memory.lifecycle === 'active' ? 'completed' : 'pending'}`}><i />{lifecycleLabel(memory.lifecycle)}</span>
                  <AuthorityBadge authority={memory.currentAuthority} />
                  <span>{scopeLabel(memory.scope)}</span>
                  {memory.direction && <span>{directionLabel(memory)}</span>}
                  {memory.reviewDue && <strong className="memory-review-due">建议复核</strong>}
                </div>
                <p>{memory.currentBody ?? '正文已遗忘'}</p>
                <small><code>{memory.id}</code> · Revision {shortId(memory.currentRevisionId)} · v{memory.version}{memory.reviewAfter ? ` · 复核 ${formatTime(memory.reviewAfter)}` : ''}</small>
                {(memory.outgoingSuccessorIds.length > 0 || memory.incomingPredecessorIds.length > 0) && <small>替代关系：前项 {memory.incomingPredecessorIds.map(shortId).join(', ') || '无'}；后项 {memory.outgoingSuccessorIds.map(shortId).join(', ') || '无'}</small>}
              </div>
              <div className="memory-actions">
                {memory.lifecycle === 'active' && <>
                  {memory.currentAuthority === 'provisional' && <button className="primary-button compact" type="button" onClick={() => void confirmMemory(memory)} disabled={busy !== null}>确认</button>}
                  {canUndoAuto(memory) && <button className="danger-button compact" type="button" onClick={() => setConfirmation({ kind: 'undo', memory })} disabled={busy !== null}>撤销并删除</button>}
                  <button className="quiet-button compact" type="button" onClick={() => void scheduleReview(memory)} disabled={busy !== null}>复核时间</button>
                  <button className="quiet-button compact" type="button" onClick={() => void supersede(memory)} disabled={busy !== null}>替代…</button>
                  <button className="quiet-button compact" type="button" onClick={() => openRevise(memory)} disabled={busy !== null}>{memory.currentAuthority === 'provisional' ? '编辑并确认' : '修订'}</button>
                  <button className="quiet-button compact" type="button" onClick={() => void lifecycle('memory.retire', memory)} disabled={busy !== null}>停止沿用</button>
                </>}
                {memory.lifecycle === 'retired' && memory.outgoingSuccessorIds.length === 0 && <button className="quiet-button compact" type="button" onClick={() => void lifecycle('memory.reactivate', memory)} disabled={busy !== null}>重新沿用</button>}
                {memory.lifecycle !== 'forgotten' && <button className="danger-button compact" type="button" onClick={() => setConfirmation({ kind: 'forget', memory })} disabled={busy !== null}>遗忘</button>}
              </div>
            </article>
          ))}
          {section === 'history' && resolvedProposals.length > 0 && (
            <section className="memory-proposal-history" aria-labelledby="memory-proposal-history-title">
              <h3 id="memory-proposal-history-title">提案记录</h3>
              <p>已处理的提案只用于用户审计，不会进入 Agent 的记忆文件。</p>
              {resolvedProposals.map((proposal) => (
                <article className="memory-row proposal resolved" key={proposal.id}>
                  <div className="memory-row-main">
                    <div className="memory-meta">
                      <span className={`status-badge status-${proposal.status === 'accepted' ? 'completed' : 'pending'}`}><i />{proposal.status === 'accepted' ? proposal.resolutionMode === 'policy_auto' ? '策略自动形成' : '用户接受' : '用户拒绝'}</span>
                      <span>{proposal.action === 'add' ? '新增' : '修订'}</span>
                      <span>{scopeLabel(proposal.scope)}</span>
                      <span>{kindLabel(proposal.kind)}</span>
                      {proposal.resolutionMode === 'policy_auto' && <span className="memory-authority provisional">未确认</span>}
                    </div>
                    <p>{proposal.body ?? (proposal.status === 'rejected' ? '候选正文已清除' : '关联记忆已遗忘')}</p>
                    <small>由 {agentName(proposal.proposedByAgentProfileId, agents)} 于 {formatTime(proposal.proposedAt)} 提出{proposal.resolvedAt ? ` · ${formatTime(proposal.resolvedAt)}处理` : ''}</small>
                  </div>
                </article>
              ))}
            </section>
          )}
      </div>

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
                <Dialog.Description>这会清除该 Memory 的全部 Revision 正文和相关已接受候选，不能恢复。它不会删除原始 Camp 消息、Task、Runtime 历史或用户控制的备份。</Dialog.Description>
                <div className="memory-confirm-preview">{confirmation.memory.currentBody}</div>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" autoFocus>取消</button></Dialog.Close><button className="danger-button" type="button" onClick={() => void forget(confirmation.memory)} disabled={busy !== null}>永久遗忘</button></div>
              </>
            ) : confirmation?.kind === 'undo' ? (
              <>
                <Dialog.Title>撤销并从长期记忆中删除该自动记忆？</Dialog.Title>
                <Dialog.Description>仅当它仍是最初自动形成、且从未被确认、修订、停止沿用或加入替代关系时才能完成。已经被 Runtime、导出文件或外部备份读取的副本不会被删除。</Dialog.Description>
                <div className="memory-confirm-preview">{confirmation.memory.currentBody}</div>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" autoFocus>取消</button></Dialog.Close><button className="danger-button" type="button" onClick={() => void undoAutoApplied(confirmation.memory)} disabled={busy !== null}>撤销并删除自动记忆</button></div>
              </>
            ) : confirmation?.kind === 'export' ? (
              <>
                <Dialog.Title>导出长期记忆副本？</Dialog.Title>
                <Dialog.Description>导出的 JSON 包含 active/retired Memory、Revision 权威历史和提案决议元数据；pending/rejected 候选正文不会导出。外部副本不再受 Rovai-ai 后续“遗忘”操作控制，请自行安全保管或删除。</Dialog.Description>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" autoFocus>取消</button></Dialog.Close><button className="primary-button" type="button" onClick={() => void exportMemory()} disabled={busy !== null}>选择保存位置</button></div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
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
            <Dialog.Title>{editor?.kind === 'create' ? '新增长期记忆' : editor?.kind === 'proposal' ? '编辑后接受提案' : editor?.memory.currentAuthority === 'provisional' ? '编辑并确认未确认记忆' : '修订长期记忆'}</Dialog.Title>
            <Dialog.Description>保持原子、面向未来且不含秘密。Scope、Kind 和 Direction 在正式创建后不能由 Revision 修改。</Dialog.Description>
            <div className="memory-editor-grid">
              <label className="field-label">作用域<select value={draft.scope} disabled={identityLocked || busy} onChange={(event) => {
                const scope = event.target.value as MemoryScopeKind
                const firstAgentId = draft.firstAgentId || agents[0]?.id || ''
                const secondAgentId = draft.secondAgentId !== firstAgentId
                  ? draft.secondAgentId
                  : agents.find((agent) => agent.id !== firstAgentId)?.id ?? ''
                onDraft({
                  ...draft,
                  scope,
                  kind: scope === 'relationship' && draft.kind === 'preference' ? 'agreement' : draft.kind,
                  firstAgentId,
                  secondAgentId,
                  directedActorAgentProfileId: draft.directedActorAgentProfileId || firstAgentId
                })
              }}><option value="hearth">家园记忆</option><option value="companion">伙伴记忆</option><option value="relationship">协作默契</option></select></label>
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

function assertApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') {
    const message = typeof result.payload.message === 'string' ? result.payload.message : result.code
    throw new Error(message)
  }
}

function scopeLabel(scope: MemoryScopeKind | null): string {
  return scope === 'hearth' ? '家园' : scope === 'companion' ? '伙伴' : scope === 'relationship' ? '协作默契' : '已遗忘'
}

function kindLabel(kind: MemoryKind | null): string {
  return kind === 'preference' ? '偏好' : kind === 'agreement' ? '约定' : kind === 'lesson' ? '经验' : '—'
}

function KindBadge({ kind }: { kind: MemoryKind | null }): React.JSX.Element {
  const shape = kind === 'preference' ? '○' : kind === 'lesson' ? '◇' : '□'
  return (
    <span className={`memory-kind kind-${kind ?? 'agreement'}`}>
      {kindLabel(kind)} <i aria-hidden="true">{shape}</i>
    </span>
  )
}

function AuthorityBadge({
  authority
}: {
  authority: MemoryRecord['currentAuthority']
}): React.JSX.Element | null {
  if (!authority) return null
  return (
    <span className={`memory-authority ${authority === 'provisional' ? 'provisional' : 'confirmed'}`}>
      {authority === 'provisional' ? '未确认' : '用户确认'}
    </span>
  )
}

function lifecycleLabel(lifecycle: MemoryRecord['lifecycle']): string {
  return lifecycle === 'active' ? '正在沿用' : lifecycle === 'retired' ? '已停止沿用' : '已遗忘'
}

function directionLabel(memory: Pick<MemoryRecord, 'direction' | 'directedActorAgentProfileId' | 'relationshipAgentProfileIds'> | Pick<MemoryProposal, 'direction' | 'directedActorAgentProfileId' | 'relationshipAgentProfileIds'>): string {
  if (memory.direction === 'mutual') return '双方共同'
  if (memory.direction === 'directed') {
    const actor = memory.directedActorAgentProfileId
    const counterparty = memory.relationshipAgentProfileIds.find((id) => id !== actor)
    return `${shortId(actor)} → ${shortId(counterparty)}`
  }
  return ''
}

function capacityLabel(scopeKey: string, agents: AgentProfile[]): string {
  if (scopeKey === 'hearth') return '家园'
  const ids = scopeKey.split(':').slice(1)
  return ids.map((id) => agentName(id, agents)).join(' × ')
}

function agentName(id: string | null | undefined, agents: AgentProfile[]): string {
  if (!id) return '未知伙伴'
  return agents.find((agent) => agent.id === id)?.displayName ?? shortId(id)
}

function shortId(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 10 ? `${value.slice(0, 8)}…` : value
}

function formatBytes(value: number): string {
  return value >= 1024 ? `${(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} KiB` : `${value} B`
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
