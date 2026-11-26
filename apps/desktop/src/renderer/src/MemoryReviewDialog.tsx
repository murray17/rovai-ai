import { BusyLabel } from './BusyLabel'
import { useEffect, useId, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AgentProfile, HearthReviewItem, MemoryRecord } from '@contracts'
import { AppDialogContent, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { MemoryContentFields, validateMemoryContent, type MemoryContentDraft } from './MemoryContentFields'
import { agentName, formatTime, kindLabel, reviewResolutionLabel, reviewStatusLabel, shortId } from './memory-presentation'
import { UiText, uiAttribute } from './interface-language'

export type ReviewResolution = (
  item: HearthReviewItem,
  action: 'accept' | 'reject',
  content?: { body: string; keys: string[] }
) => Promise<boolean>

interface ReviewDraft extends MemoryContentDraft {
  editing: boolean
}

export function MemoryReviewDialog({
  open, reviewItems, memories, agents, busy, error, needsRefresh,
  onOpenChange, onResolve, onRefresh, onRestoreFocus
}: {
  open: boolean
  reviewItems: HearthReviewItem[]
  memories: MemoryRecord[]
  agents: AgentProfile[]
  busy: string | null
  error: string | null
  needsRefresh: boolean
  onOpenChange(open: boolean): void
  onResolve: ReviewResolution
  onRefresh(): Promise<void>
  onRestoreFocus(): void
}): React.JSX.Element {
  const descriptionId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const pending = reviewItems.filter((item) => item.status === 'pending')
  const history = reviewItems.filter((item) => item.status !== 'pending')
  const selected = pending.find((item) => item.reviewItemId === selectedId) ?? pending[0] ?? null
  const index = selected ? pending.indexOf(selected) : -1
  const disabled = busy !== null || needsRefresh

  useEffect(() => {
    // A terminal candidate must not survive in an off-screen editing draft.
    const pendingIds = new Set(reviewItems.filter((item) => item.status === 'pending').map((item) => item.reviewItemId))
    setDrafts((current) => Object.keys(current).some((id) => !pendingIds.has(id))
      ? Object.fromEntries(Object.entries(current).filter(([id]) => pendingIds.has(id)))
      : current)
  }, [reviewItems])

  const draft = selected ? drafts[selected.reviewItemId] ?? {
    editing: false,
    body: selected.candidateBody ?? '',
    retrievalKeys: (selected.candidateRetrievalKeys ?? []).join(', '),
    keyInput: ''
  } : null
  const editing = Boolean(draft?.editing && !selected?.stale)
  const validation = draft ? validateMemoryContent(draft) : null
  const target = memories.find((memory) => memory.id === selected?.targetMemoryId)
  const updateDraft = (changes: Partial<ReviewDraft>): void => {
    if (selected && draft) setDrafts((current) => ({ ...current, [selected.reviewItemId]: { ...draft, ...changes } }))
  }
  const resolve = async (action: 'accept' | 'reject'): Promise<void> => {
    if (!selected || disabled || (action === 'accept' && (selected.stale || (editing && !validation?.valid)))) return
    const nextId = pending[index + 1]?.reviewItemId ?? pending[index - 1]?.reviewItemId ?? null
    const applied = await onResolve(selected, action, action === 'accept' && editing && draft && validation
      ? { body: draft.body, keys: validation.keys } : undefined)
    if (applied) {
      setDrafts((current) => {
        const next = { ...current }
        delete next[selected.reviewItemId]
        return next
      })
      setSelectedId(nextId)
    }
  }
  const avatar = (item: HearthReviewItem): React.JSX.Element => {
    const agent = agents.find((candidate) => candidate.agentId === item.sourceAgentId)
    return <MemberAvatar agentId={item.sourceAgentId} avatarRef={agent?.avatarRef ?? null} displayName={agentName(item.sourceAgentId, agents)} size="mention" decorative />
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay app-dialog-overlay memory-dialog-overlay memory-review-overlay" />
      <AppDialogContent className="memory-review-dialog" tone="neutral" aria-describedby={descriptionId}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.target instanceof HTMLElement ? event.target : null
          content?.querySelector<HTMLButtonElement>('.app-dialog-close')?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus() }}>
        <AppDialogHeader title={uiAttribute('共同记忆审核')} closeLabel={uiAttribute('关闭共同记忆审核')}
          descriptionId={descriptionId}
          description={pending.length > 0
            ? uiAttribute('{0} 条待审核 · 接受后供所有队员使用', String(pending.length))
            : needsRefresh ? uiAttribute('请刷新以确认最新记录') : uiAttribute('全部处理完成')} />
        {error && <div className="memory-review-error" role="alert">
          <span>{error}</span>
          {needsRefresh && <button className="quiet-button" type="button" disabled={busy !== null} onClick={() => void onRefresh()}><UiText zh="刷新列表" /></button>}
        </div>}
        {selected && <nav className="memory-review-mobile-nav" aria-label={uiAttribute('切换审核项')}>
          <button className="quiet-button" type="button" disabled={disabled || index <= 0} onClick={() => setSelectedId(pending[index - 1].reviewItemId)}><UiText zh="上一条" /></button>
          <span>{index + 1} / {pending.length}</span>
          <button className="quiet-button" type="button" disabled={disabled || index >= pending.length - 1} onClick={() => setSelectedId(pending[index + 1].reviewItemId)}><UiText zh="下一条" /></button>
        </nav>}
        <div className="memory-review-workbench">
          <div className="memory-review-catalog">
            <div className="memory-review-queue-title"><UiText zh={pending.length ? '待审核' : '审核记录'} />{pending.length > 0 && <span>{pending.length}</span>}</div>
            {pending.map((item) => <button key={item.reviewItemId} type="button"
              className={`memory-review-selection${item === selected ? ' selected' : ''}`}
              aria-pressed={item === selected} disabled={disabled} onClick={() => setSelectedId(item.reviewItemId)}>
              {avatar(item)}
              <span className="memory-catalog-copy"><strong>{item.candidateBody}</strong><span className="memory-catalog-context">
                <span>{agentName(item.sourceAgentId, agents)} · {item.requestedAction === 'add' ? uiAttribute('新增') : uiAttribute('修订')}</span>
                {item.stale && <span className="memory-review-due"><UiText zh="基准已变化" /></span>}
              </span></span>
            </button>)}
            <ReviewHistory items={history} agents={agents} expanded={pending.length === 0} />
          </div>
          <div className="memory-review-detail" aria-busy={busy !== null}>
            {selected && draft ? <>
              <header className="memory-detail-context">
                {avatar(selected)}
                <div className="memory-detail-owner"><strong>{agentName(selected.sourceAgentId, agents)}</strong>
                  <span>{selected.requestedAction === 'add' ? uiAttribute('建议新增共同记忆') : uiAttribute('建议修订共同记忆')} · {kindLabel(selected.candidateKind)}</span>
                </div>
              </header>
              <div className="memory-review-scroll" key={selected.reviewItemId}>
                {selected.stale && <p className="memory-review-warning" role="status"><UiText zh="目标记忆已变化，不能再接受或编辑；你仍可以明确拒绝并结束这条审核。" /></p>}
                {selected.requestedAction === 'revise' && <section className="memory-review-existing">
                  <h3><UiText zh="当前记忆" /></h3>
                  <p>{target?.currentBody ?? uiAttribute('目标记忆正文不可用')}</p>
                </section>}
                {editing ? <div className="memory-review-editor">
                  <MemoryContentFields draft={draft} disabled={disabled} idPrefix="memory-review" onChange={updateDraft} />
                </div> : <section className="memory-reading-sheet">
                  {selected.requestedAction === 'revise' && <h3><UiText zh="建议内容" /></h3>}
                  <div className="memory-detail-body">{selected.candidateBody}</div>
                  <div className="memory-retrieval-keys" aria-label={uiAttribute('检索词')}>{selected.candidateRetrievalKeys?.map((key) => <span key={key}>{key}</span>)}</div>
                </section>}
                <details className="memory-detail-disclosure">
                  <summary><UiText zh="提交详情" /><DialogControlIcon name="chevron" /></summary>
                  <dl className="memory-detail-facts">
                    <div><dt><UiText zh="提交时间" /></dt><dd>{formatTime(selected.createdAt)}</dd></div>
                    <div><dt><UiText zh="来源会话" /></dt><dd>{selected.sourceThreadId ? shortId(selected.sourceThreadId) : uiAttribute('聊天')}</dd></div>
                    {selected.requestedAction === 'revise' && <>
                      <div><dt><UiText zh="目标记忆" /></dt><dd>{shortId(selected.targetMemoryId)}</dd></div>
                      <div><dt><UiText zh="基准版本" /></dt><dd>{shortId(selected.baseRevisionId)}</dd></div>
                    </>}
                  </dl>
                </details>
              </div>
            </> : <div className="memory-review-complete">
              <span className="memory-shared-avatar" aria-hidden="true"><DialogControlIcon name="check" /></span>
              <h3><UiText zh={needsRefresh ? '等待刷新' : '已处理完'} /></h3>
              <p><UiText zh={needsRefresh ? '刷新后可查看最新审核记录。' : '可以回到记忆页继续查看。'} /></p>
              <div className="memory-review-mobile-history"><ReviewHistory items={history} agents={agents} expanded /></div>
            </div>}
            <footer className="memory-review-footer">
              <Dialog.Close asChild><button type="button" className={selected ? 'quiet-button memory-review-return' : 'primary-button memory-review-return'}><UiText zh="返回记忆" /></button></Dialog.Close>
              {selected && <div className="memory-review-actions">
                <button className="quiet-button" type="button" disabled={disabled} onClick={() => void resolve('reject')}><UiText zh="拒绝" /></button>
                {!selected.stale && <>
                  <button className="quiet-button" type="button" disabled={disabled} onClick={() => updateDraft({ editing: !editing })}><UiText zh={editing ? '取消编辑' : '编辑后接受'} /></button>
                  <button className="primary-button" type="button" disabled={disabled || (editing && !validation?.valid)} aria-busy={busy?.startsWith('review-accept-') ?? false} onClick={() => void resolve('accept')}>
                    <BusyLabel busy={busy?.startsWith('review-accept-') ?? false}><UiText zh={editing ? '接受最终内容' : '接受'} /></BusyLabel>
                  </button>
                </>}
              </div>}
            </footer>
          </div>
        </div>
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}

function ReviewHistory({ items, agents, expanded }: { items: HearthReviewItem[]; agents: AgentProfile[]; expanded: boolean }): React.JSX.Element {
  return <details className="memory-review-history" key={String(expanded)} open={expanded || undefined}>
    <summary><UiText zh="处理记录" /><span>{items.length}</span><DialogControlIcon name="chevron" /></summary>
    {items.length === 0 && <p><UiText zh="还没有已处理的审核记录。" /></p>}
    {items.map((item) => <details key={item.reviewItemId} className="memory-review-history-item">
      <summary><span>{agentName(item.sourceAgentId, agents)}</span><span>{reviewStatusLabel(item.status)}</span></summary>
      <p>{reviewResolutionLabel(item)}</p>
      <time>{formatTime(item.resolvedAt ?? item.createdAt)}</time>
      {item.status === 'accepted' && <p><UiText zh="正式记忆 " />{shortId(item.acceptedMemoryId)}<UiText zh=" · 版本 " />{shortId(item.acceptedRevisionId)}{item.editedBeforeAcceptance ? uiAttribute(' · 接受前已编辑') : ''}</p>}
    </details>)}
  </details>
}
