import { useEffect, useRef, useState, type JSX } from 'react'
import type { AgentRunFileChangesDetailView, AgentRunFileChangesView } from '@contracts'
import { useFilePreview, type FileChangesPreviewTabModel } from './FilePreviewContext'
import { agentRunFileChangesSummaryLabel, agentRunFileChangeModeLabel, agentRunFileChangeKindMark, agentRunFilePathParts, agentRunFilePathIsAbsolute, inlineDiffLines, exactMutationDiffLines } from './file-changes-presentation'

type AgentRunFileChangesDetailStatus = 'loading' | 'ready' | 'error'

export function FileChangesPreview({ tab }: { tab: FileChangesPreviewTabModel }): JSX.Element {
  const { campId, changes, selectedEvidenceFileId } = tab
  const filePreview = useFilePreview()
  const [detail, setDetail] = useState<AgentRunFileChangesDetailView | null>(null)
  const [detailStatus, setDetailStatus] = useState<AgentRunFileChangesDetailStatus>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [openCurrentStatus, setOpenCurrentStatus] = useState<'idle' | 'opening'>('idle')
  const [openCurrentError, setOpenCurrentError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => setOpenCurrentError(null), [selectedEvidenceFileId])

  useEffect(() => {
    const currentRequest = ++requestId.current
    setDetail(null)
    setDetailStatus('loading')
    void window.rovai.request<AgentRunFileChangesDetailView>(
      'agentRunFileChanges.get',
      {
        campId,
        agentRunId: changes.agentRunId,
        executionEpoch: changes.executionEpoch
      }
    ).then((result) => {
      if (currentRequest !== requestId.current) return
      if (
        result.schemaVersion !== 2
        || result.card.agentRunId !== changes.agentRunId
        || result.card.executionEpoch !== changes.executionEpoch
      ) {
        setDetailStatus('error')
        return
      }
      setDetail(result)
      setDetailStatus('ready')
    }).catch(() => {
      if (currentRequest === requestId.current) setDetailStatus('error')
    })
    return () => {
      requestId.current += 1
    }
  }, [campId, changes.agentRunId, changes.executionEpoch, loadAttempt])

  const openCurrentFile = async (): Promise<void> => {
    const file = changes.files.find((candidate) =>
      candidate.evidenceFileId === selectedEvidenceFileId
    )
    if (!file || openCurrentStatus === 'opening') return
    setOpenCurrentStatus('opening')
    setOpenCurrentError(null)
    const outcome = await filePreview.open({
      kind: 'run_evidence',
      campId,
      agentRunId: changes.agentRunId,
      executionEpoch: changes.executionEpoch,
      evidenceFileId: file.evidenceFileId,
      action: 'open_current'
    }, undefined, { fileName: file.path })
    setOpenCurrentStatus('idle')
    if (outcome.kind === 'preview') {
      return
    }
    setOpenCurrentError(outcome.kind === 'error'
      ? outcome.error.message
      : outcome.kind === 'system'
        ? '这个文件已使用系统默认应用打开。'
        : '当前文件暂时无法打开。')
  }

  return (
    <AgentRunFileChangesReviewSurface
      changes={changes}
      detail={detail}
      detailStatus={detailStatus}
      selectedEvidenceFileId={selectedEvidenceFileId}
      onSelectEvidenceFileId={(evidenceFileId) => filePreview.selectChangedFile(tab.id, evidenceFileId)}
      onOpenCurrent={() => void openCurrentFile()}
      openCurrentStatus={openCurrentStatus}
      openCurrentError={openCurrentError}
      onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
    />
  )
}

export function AgentRunFileChangesReviewSurface({
  changes,
  detail,
  detailStatus,
  selectedEvidenceFileId,
  onSelectEvidenceFileId,
  onOpenCurrent,
  openCurrentStatus,
  openCurrentError,
  onRetry
}: {
  changes: AgentRunFileChangesView
  detail: AgentRunFileChangesDetailView | null
  detailStatus: AgentRunFileChangesDetailStatus
  selectedEvidenceFileId: string | null
  onSelectEvidenceFileId(evidenceFileId: string): void
  onOpenCurrent(): void
  openCurrentStatus: 'idle' | 'opening'
  openCurrentError: string | null
  onRetry(): void
}): JSX.Element {
  const selectedIndex = Math.max(0, changes.files.findIndex((file) =>
    file.evidenceFileId === selectedEvidenceFileId
  ))
  const selectedFile = changes.files[selectedIndex] ?? null
  const selectedDetail = selectedFile
    ? detail?.files.find((file) => file.evidenceFileId === selectedFile.evidenceFileId) ?? null
    : null
  const truthNote = selectedFile ? agentRunFileChangeTruthNote(selectedFile.presentationKind) : null
  return (
    <section className={`agent-run-file-review${changes.files.length <= 1 ? ' has-single-file' : ''}`} aria-label="File Change 详情">
      <header className="agent-run-file-review-header">
        <div className="agent-run-file-review-heading">
          <h2>File Change</h2>
          <span>{agentRunFileChangesSummaryLabel(changes)}</span>
        </div>
        {changes.files.length > 1 && <div className="agent-run-file-review-navigation" aria-label="切换变更文件">
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => onSelectEvidenceFileId(
              changes.files[selectedIndex - 1]?.evidenceFileId ?? selectedFile?.evidenceFileId ?? ''
            )}
          >
            上一文件
          </button>
          <button
            type="button"
            disabled={selectedIndex < 0 || selectedIndex >= changes.files.length - 1}
            onClick={() => onSelectEvidenceFileId(
              changes.files[selectedIndex + 1]?.evidenceFileId ?? selectedFile?.evidenceFileId ?? ''
            )}
          >
            下一文件
          </button>
        </div>}
      </header>

      {changes.files.length > 1 && <label className="agent-run-file-review-file-picker">
        <span>变更文件</span>
        <select aria-label="变更文件" value={selectedFile?.evidenceFileId ?? ''}
          onChange={(event) => onSelectEvidenceFileId(event.target.value)}>
          {changes.files.map((file) => <option key={file.evidenceFileId} value={file.evidenceFileId}>{file.path}</option>)}
        </select>
        <small>{selectedIndex + 1} / {changes.files.length}</small>
      </label>}

      <div className="agent-run-file-review-content">
        <aside className="agent-run-file-review-sidebar" aria-label="变更文件">
          <header><strong>变更文件</strong><span>{changes.fileCount} files</span></header>
          <div className="agent-run-file-review-file-list">
            {changes.files.map((file) => {
              const pathParts = agentRunFilePathParts(file.path)
              return (
                <button
                  className="agent-run-file-review-file"
                  type="button"
                  key={file.evidenceFileId}
                  aria-current={file.evidenceFileId === selectedFile?.evidenceFileId ? 'true' : undefined}
                  title={file.path}
                  onClick={() => onSelectEvidenceFileId(file.evidenceFileId)}
                >
                  <span className="agent-run-file-review-kind" aria-hidden="true">
                    {agentRunFileChangeKindMark(file.changeKind)}
                  </span>
                  <span className="agent-run-file-review-file-copy">
                    <strong>{pathParts.basename}</strong>
                    <small>{pathParts.directory}</small>
                  </span>
                  <span className="agent-run-file-review-file-aside" aria-hidden="true">
                    <span>
                      {file.additions !== undefined && file.deletions !== undefined
                        ? <><i className="addition">+{file.additions}</i><i className="deletion">−{file.deletions}</i></>
                        : `${file.operationCount} 次`}
                    </span>
                    <small className={agentRunFilePathIsAbsolute(file.path) ? 'is-outside' : undefined}>
                      {agentRunFileChangeModeLabel(file.presentationKind)}
                    </small>
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="agent-run-file-review-pane" aria-label="当前文件变化">
          {selectedFile
            ? <>
                <header className="agent-run-file-review-pane-header">
                  <div>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h10l6 6v10H4Z" /><path d="M14 4v6h6" /></svg>
                    <code title={selectedFile.path}>{selectedFile.path}</code>
                  </div>
                  <div className="agent-run-file-review-pane-actions">
                    <span className="agent-run-file-review-pane-meta">
                      <small>{agentRunFileChangeModeLabel(selectedFile.presentationKind)}</small>
                      <span aria-hidden="true">
                        {selectedFile.additions !== undefined && selectedFile.deletions !== undefined
                          ? <><i className="addition">+{selectedFile.additions}</i><i className="deletion">−{selectedFile.deletions}</i></>
                          : `${selectedFile.operationCount} 次修改`}
                      </span>
                    </span>
                    <button
                      className="agent-run-file-review-open-current"
                      type="button"
                      disabled={openCurrentStatus === 'opening'}
                      onClick={onOpenCurrent}
                    >
                      {openCurrentStatus === 'opening' ? '正在打开…' : '打开当前文件'}
                    </button>
                  </div>
                </header>
                {openCurrentError && (
                  <div className="agent-run-file-review-current-error" role="status">
                    {openCurrentError}
                  </div>
                )}
                {truthNote && (
                  <div className="agent-run-file-review-truth-note">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                    <span>{truthNote}</span>
                  </div>
                )}
                <div
                  className="agent-run-file-review-scroll"
                  key={selectedFile.evidenceFileId}
                  tabIndex={0}
                  aria-label={`${selectedFile.path} 的文件变化内容`}
                >
                  {detailStatus === 'loading' && (
                    <div className="agent-run-file-review-state" role="status">
                      <span className="tool-result-spinner" aria-hidden="true" />
                      <strong>正在读取文件变化…</strong>
                    </div>
                  )}
                  {detailStatus === 'error' && (
                    <div className="agent-run-file-review-state is-error" role="alert">
                      <strong>文件变化暂时无法读取</strong>
                      <span>历史记录仍然保留，可以重新读取。</span>
                      <button type="button" onClick={onRetry}>重试</button>
                    </div>
                  )}
                  {detailStatus === 'ready' && selectedDetail && (
                    <AgentRunFileReviewBlocks file={selectedDetail} />
                  )}
                  {detailStatus === 'ready' && !selectedDetail && (
                    <div className="agent-run-file-review-state is-error" role="alert">
                      <strong>这个文件的详情不可用</strong>
                      <span>摘要仍可查看，但没有找到匹配的不可变详情。</span>
                    </div>
                  )}
                </div>
              </>
            : (
                <div className="agent-run-file-review-state">
                  <strong>没有文件变化</strong>
                </div>
              )}
        </section>
      </div>
    </section>
  )
}

function agentRunFileChangeTruthNote(
  presentationKind: AgentRunFileChangesView['files'][number]['presentationKind']
): string | null {
  if (presentationKind === 'operation_only') {
    return 'Runtime 只可靠报告了成功文件操作与路径，没有提供可审查的 old/new 或标准差异。'
  }
  return null
}

function AgentRunFileReviewBlocks({
  file
}: {
  file: AgentRunFileChangesDetailView['files'][number]
}): JSX.Element {
  const blocks = file.blocks.slice().sort((left, right) => left.sequence - right.sequence)
  const reviewableBlocks = blocks.filter((block) => Boolean(block.diff))
  if (file.presentationKind === 'operation_only' || reviewableBlocks.length === 0) {
    return (
      <div className="agent-run-file-review-empty">
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 4h10l6 6v10H4Z" /><path d="M14 4v6h6M8 14h8" /></svg>
        </span>
        <strong>没有可审查的差异内容</strong>
        <p>这条记录只证明 Runtime 成功操作了该文件；Rovai 不读取当前文件，也不推测修改内容。</p>
      </div>
    )
  }
  return (
    <div className="agent-run-file-review-blocks">
      {reviewableBlocks.map((block, reviewIndex) => (
        <AgentRunFileReviewBlock
          key={`${block.sequence}:${reviewIndex}`}
          block={block}
          index={reviewIndex}
          showLabel={file.presentationKind !== 'full_net_diff' || blocks.length > 1}
        />
      ))}
    </div>
  )
}

function AgentRunFileReviewBlock({
  block,
  index,
  showLabel
}: {
  block: AgentRunFileChangesDetailView['files'][number]['blocks'][number]
  index: number
  showLabel: boolean
}): JSX.Element | null {
  const exactMutation = block.semantics === 'exact_mutation'
  if (!block.diff) {
    return null
  }
  const lines = exactMutation ? exactMutationDiffLines(block.diff) : inlineDiffLines(block.diff)
  return (
    <section className={`agent-run-file-review-block${exactMutation ? ' is-exact-mutation' : ''}`}>
      {showLabel && (
        <header>
          <strong>修改 {index + 1}</strong>
          <span>{exactMutation ? '精确替换 · 无行号' : '完整文件差异'}</span>
        </header>
      )}
      <div className="agent-run-file-review-diff-code">
        {lines.map((line, lineIndex) => exactMutation
          ? (
              <div className={`agent-run-file-review-diff-line is-${line.kind}`} key={`${lineIndex}:${line.text}`}>
                <span aria-hidden="true">{line.kind === 'addition' ? '+' : '−'}</span>
                <code>{line.text || ' '}</code>
              </div>
            )
          : line.kind === 'hunk' || line.kind === 'metadata'
          ? (
              <div className={`agent-run-file-review-diff-line is-${line.kind}`} key={`${lineIndex}:${line.text}`}>
                <code>{line.text}</code>
              </div>
            )
          : (
              <div className={`agent-run-file-review-diff-line is-${line.kind}`} key={`${lineIndex}:${line.text}`}>
                <span aria-hidden="true">{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ''}</span>
                <span aria-hidden="true">{line.oldLine ?? ''}</span>
                <span aria-hidden="true">{line.newLine ?? ''}</span>
                <code>{line.text || ' '}</code>
              </div>
            ))}
      </div>
    </section>
  )
}
