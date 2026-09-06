import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import type { AgentRunExecutionEvidenceView, AgentRunView } from '@contracts'
import { ExecutionStatusGlyph } from './ExecutionStatusGlyph'
import { useOptionalFilePreview } from './FilePreviewContext'
import { exactMutationDiffLines, inlineDiffLines } from './file-changes-presentation'
import { readErrorMessage } from './error-message'
import {
  activityStatusForAgentRun,
  executionEvidenceResultText,
  executionStepPublicTitle,
  runtimeCompactionDetailText,
  runtimeCompactionIsExpandable,
  runtimeCompactionTitle,
  type ActivityIconKind,
  type LiveExecutionProgress,
  type RuntimeCompactionDisplayItem,
  type RuntimeDiagnostic
} from './ui-model'
import {
  runtimeCompactionActivityStatus,
  toolActivityGroupPresentation,
  type ToolProgressItem
} from './execution-tool-grouping'

export type PresentableExecutionEvidence = AgentRunExecutionEvidenceView & {
  kind: Exclude<AgentRunExecutionEvidenceView['kind'], 'reasoning_summary'>
}

export function isPresentableExecutionEvidence(
  evidence: AgentRunExecutionEvidenceView
): evidence is PresentableExecutionEvidence {
  return evidence.kind !== 'reasoning_summary'
}

type ToolResultLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface ToolResultViewState {
  evidenceId: string | null
  status: ToolResultLoadStatus
  text: string
  error: string | null
}

function toolResultErrorMessage(error: unknown): string {
  const detail = readErrorMessage(error, '').trim()
  return detail ? `读取完整结果失败：${detail}` : '读取完整结果失败：未知错误'
}

function handleToolResultKeyDown(
  event: ReactKeyboardEvent<HTMLPreElement>,
  summary: HTMLElement | null
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    summary?.focus({ preventScroll: true })
    return
  }

  const result = event.currentTarget
  const lineHeight = Number.parseFloat(window.getComputedStyle(result).lineHeight) || 16
  const page = Math.max(lineHeight * 4, result.clientHeight * 0.85)
  let nextScrollTop: number | null = null
  switch (event.key) {
    case 'ArrowDown':
      nextScrollTop = result.scrollTop + lineHeight
      break
    case 'ArrowUp':
      nextScrollTop = result.scrollTop - lineHeight
      break
    case 'PageDown':
      nextScrollTop = result.scrollTop + page
      break
    case 'PageUp':
      nextScrollTop = result.scrollTop - page
      break
    case ' ':
      nextScrollTop = result.scrollTop + (event.shiftKey ? -page : page)
      break
    case 'Home':
      nextScrollTop = 0
      break
    case 'End':
      nextScrollTop = result.scrollHeight
      break
    default:
      return
  }
  event.preventDefault()
  const maximum = Math.max(0, result.scrollHeight - result.clientHeight)
  result.scrollTop = Math.min(maximum, Math.max(0, nextScrollTop))
}

function ToolCallDetail({
  campId,
  detail,
  completeEvidence,
  expanded,
  resultKey,
  title,
  summaryRef
}: {
  campId: string
  detail: string
  completeEvidence?: PresentableExecutionEvidence
  expanded: boolean
  resultKey: string
  title: string
  summaryRef: RefObject<HTMLElement | null>
}): JSX.Element {
  const evidenceId = completeEvidence?.id ?? null
  const [result, setResult] = useState<ToolResultViewState>(() => ({
    evidenceId,
    status: evidenceId ? 'idle' : 'ready',
    text: evidenceId ? '' : detail,
    error: null
  }))
  const requestSequence = useRef(0)
  const previousEvidenceId = useRef(evidenceId)
  const restoreFocusAfterLoad = useRef(false)
  const resultRef = useRef<HTMLPreElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const scrollHelpId = useId()

  useEffect(() => {
    if (previousEvidenceId.current === evidenceId) return
    previousEvidenceId.current = evidenceId
    requestSequence.current += 1
    restoreFocusAfterLoad.current = false
    setResult({
      evidenceId,
      status: evidenceId ? 'idle' : 'ready',
      text: evidenceId ? '' : detail,
      error: null
    })
  }, [detail, evidenceId])

  useEffect(() => {
    if (evidenceId !== null) return
    setResult((current) => current.text === detail && current.status === 'ready'
      ? current
      : { evidenceId: null, status: 'ready', text: detail, error: null })
  }, [detail, evidenceId])

  useEffect(() => () => {
    requestSequence.current += 1
  }, [])

  const loadCompleteResult = useCallback(async (restoreFocus: boolean): Promise<void> => {
    if (!completeEvidence) return
    const sequence = ++requestSequence.current
    restoreFocusAfterLoad.current = restoreFocus
    setResult({
      evidenceId: completeEvidence.id,
      status: 'loading',
      text: '',
      error: null
    })
    try {
      const response = await window.rovai.request<{ payload: unknown }>(
        'agentRunEvidence.getContent',
        { campId, evidenceId: completeEvidence.id }
      )
      const fullText = executionEvidenceResultText(
        completeEvidence.eventType,
        response.payload,
        completeEvidence.canonical
      )
      if (fullText === null) {
        throw new Error('证据中没有可展示的公开结果')
      }
      if (requestSequence.current !== sequence) return
      setResult({
        evidenceId: completeEvidence.id,
        status: 'ready',
        text: fullText,
        error: null
      })
    } catch (error) {
      if (requestSequence.current !== sequence) return
      setResult({
        evidenceId: completeEvidence.id,
        status: 'failed',
        text: '',
        error: toolResultErrorMessage(error)
      })
    }
  }, [campId, completeEvidence])

  useEffect(() => {
    if (
      expanded
      && completeEvidence
      && result.evidenceId === completeEvidence.id
      && result.status === 'idle'
    ) {
      void loadCompleteResult(false)
    }
  }, [completeEvidence, expanded, loadCompleteResult, result.evidenceId, result.status])

  useLayoutEffect(() => {
    if (!restoreFocusAfterLoad.current) return undefined
    const target = result.status === 'ready'
      ? resultRef.current
      : result.status === 'failed'
        ? retryRef.current
        : null
    if (!target) return undefined
    restoreFocusAfterLoad.current = false
    const frame = window.requestAnimationFrame(() => target.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [result.status])

  return (
    <div className="tool-call-detail" aria-busy={result.status === 'loading'}>
      {result.status === 'ready' && (
        <>
          <span className="sr-only" id={scrollHelpId}>
            结果区域获得焦点后，可使用方向键、Page Up、Page Down、空格、Home 和 End 滚动；按 Escape 返回对应指令行。
          </span>
          <pre
            ref={resultRef}
            className="tool-call-result-scroll"
            data-tool-result-key={resultKey}
            tabIndex={0}
            role="region"
            aria-label={`${title}的完整结果，可滚动`}
            aria-describedby={scrollHelpId}
            onKeyDown={(event) => handleToolResultKeyDown(event, summaryRef.current)}
          >
            {result.text}
          </pre>
        </>
      )}
      {result.status === 'idle' && (
        <div className="tool-result-state" role="status">
          <span>展开后读取完整结果。</span>
        </div>
      )}
      {result.status === 'loading' && (
        <div className="tool-result-state" role="status" aria-live="polite">
          <span className="tool-result-spinner" aria-hidden="true" />
          <span>正在读取完整结果…</span>
        </div>
      )}
      {result.status === 'failed' && (
        <div className="tool-result-state is-error" role="alert">
          <span className="tool-result-state-copy">
            <strong>未能读取完整结果</strong>
            <span>{result.error}</span>
          </span>
          <button
            ref={retryRef}
            className="quiet-button compact tool-result-retry"
            type="button"
            onClick={() => void loadCompleteResult(true)}
          >
            重试
          </button>
        </div>
      )}
    </div>
  )
}

export type ToolCallStep = Extract<LiveExecutionProgress['items'][number], { kind: 'tool' }>['step']


export function ModifiedFileRow({ campId, change, semanticKind, onFileOpenError }: {
  campId: string
  change: NonNullable<ToolCallStep['fileChanges']>[number]
  semanticKind: ToolCallStep['fileChangeSemantics']
  onFileOpenError(message: string): void
}): JSX.Element {
  const filePreview = useOptionalFilePreview()
  const [expanded, setExpanded] = useState(false)
  const diffId = useId()
  const fileName = change.path.split('/').filter(Boolean).at(-1) ?? change.path
  const verb = change.changeKind === 'add' ? '新增' : '编辑'
  const exactMutation = semanticKind === 'exact_mutation'
  const lines = useMemo(
    () => exactMutation ? exactMutationDiffLines(change.diff) : inlineDiffLines(change.diff),
    [change.diff, exactMutation]
  )
  const openFile = async (): Promise<void> => {
    if (!filePreview) {
      onFileOpenError('无法打开该文件')
      return
    }
    const outcome = await filePreview.open({
      kind: 'camp_workspace',
      campId,
      rawReference: change.path
    }, undefined, undefined, { commitOnSuccess: true, previewOnly: true })
    if (outcome.kind !== 'preview') onFileOpenError('无法打开该文件')
  }
  return (
    <div className={`process-action modified-file-row${expanded ? ' is-expanded' : ''}`} data-activity-domain="file">
      <div
        className="modified-file-summary"
        role="group"
        aria-label={`${verb} ${change.path}，新增 ${change.additions} 行，删除 ${change.deletions} 行`}
      >
        <ToolCallIcon iconKind="file-write" />
        <span className="modified-file-title">
          <span>{verb}</span>
          <button
            className="tool-file-link"
            type="button"
            aria-label={`打开文件预览：${change.path}`}
            title={`${change.path} · 打开文件预览`}
            onClick={() => void openFile()}
          >
            {fileName}
          </button>
        </span>
        <span className="modified-file-stats" aria-hidden="true">
          <span className="diff-addition">+{change.additions}</span>
          <span className="diff-deletion">−{change.deletions}</span>
        </span>
        <button
          className="tool-call-disclosure-slot"
          type="button"
          aria-controls={diffId}
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'} ${change.path} 的文件差异`}
          title={`${expanded ? '收起' : '展开'}文件差异`}
          onClick={() => setExpanded((current) => !current)}
        >
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
          </svg>
        </button>
      </div>
      <div
        id={diffId}
        className={`modified-file-diff${exactMutation ? ' is-exact-mutation' : ''}`}
        tabIndex={expanded ? 0 : -1}
        hidden={!expanded}
        aria-label={`${change.path} 的${exactMutation ? '修改片段' : '文件差异'}`}
      >
          {lines.map((line, index) => exactMutation
            ? (
                <div className={`modified-file-diff-line is-${line.kind}`} key={`${index}:${line.text}`}>
                  <span aria-hidden="true">{line.kind === 'addition' ? '+' : '-'}</span>
                  <code>{line.text || ' '}</code>
                </div>
              )
            : line.kind === 'hunk' || line.kind === 'metadata'
            ? (
                <div className={`modified-file-diff-line is-${line.kind}`} key={`${index}:${line.text}`}>
                  <code>{line.text}</code>
                </div>
              )
            : (
                <div className={`modified-file-diff-line is-${line.kind}`} key={`${index}:${line.text}`}>
                  <span aria-hidden="true">{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ''}</span>
                  <span aria-hidden="true">{line.oldLine ?? ''}</span>
                  <span aria-hidden="true">{line.newLine ?? ''}</span>
                  <code>{line.text || ' '}</code>
                </div>
              ))}
      </div>
    </div>
  )
}

export function FileOperationRow({ campId, step, runStatus, onFileOpenError }: {
  campId: string
  step: ToolCallStep & { fileOperation: NonNullable<ToolCallStep['fileOperation']> }
  runStatus: AgentRunView['status']
  onFileOpenError(message: string): void
}): JSX.Element {
  const filePreview = useOptionalFilePreview()
  const { operationKind, path, changeKind } = step.fileOperation
  const fileName = path.split('/').filter(Boolean).at(-1) ?? path
  const verb = operationKind === 'read' ? '阅读' : changeKind === 'add' ? '新增' : '编辑'
  const status = activityStatusForAgentRun(step.status, runStatus)
  const openFile = async (): Promise<void> => {
    if (!filePreview) {
      onFileOpenError('无法打开该文件')
      return
    }
    const outcome = await filePreview.open(
      { kind: 'camp_workspace', campId, rawReference: path },
      undefined,
      undefined,
      { commitOnSuccess: true, previewOnly: true }
    )
    if (outcome.kind !== 'preview') onFileOpenError('无法打开该文件')
  }
  return (
    <div
      className={`process-action tool-call-summary tool-call-static file-operation-row status-${status}`}
      data-activity-domain="file"
      role="group"
      aria-label={`${verb} ${path}，${toolCallStatusLabel(status)}`}
    >
      <ToolCallIcon iconKind={operationKind === 'read' ? 'file-read' : 'file-write'} />
      <span className="tool-call-title file-operation-title">
        <span>{verb}</span>
        <button
          className="tool-file-link"
          type="button"
          aria-label={`打开文件预览：${path}`}
          title={`${path} · 打开文件预览`}
          onClick={() => void openFile()}
        >
          {fileName}
        </button>
      </span>
      <ToolCallState status={status} />
      <span className="tool-call-disclosure-slot is-placeholder" aria-hidden="true" />
    </div>
  )
}

export function ToolCallRow({
  campId,
  step,
  runId,
  runStatus,
  completeEvidence,
  onFileOpenError
}: {
  campId: string
  step: ToolCallStep
  runId: string
  runStatus: AgentRunView['status']
  completeEvidence?: PresentableExecutionEvidence
  onFileOpenError(message: string): void
}): JSX.Element {
  const filePreview = useOptionalFilePreview()
  const [expanded, setExpanded] = useState(false)
  const [activated, setActivated] = useState(false)
  const summaryRef = useRef<HTMLElement>(null)
  const status = activityStatusForAgentRun(step.status, runStatus)
  const publicTitle = executionStepPublicTitle(step)
  const hasDetail = Boolean(step.detail) || completeEvidence !== undefined
  const openReadFile = async (path: string): Promise<void> => {
    if (!filePreview) {
      onFileOpenError('无法打开该文件')
      return
    }
    const outcome = await filePreview.open(
      { kind: 'camp_workspace', campId, rawReference: path },
      undefined,
      undefined,
      { commitOnSuccess: true, previewOnly: true }
    )
    if (outcome.kind !== 'preview') onFileOpenError('无法打开该文件')
  }
  const readSummary = step.shellReadSummary
  const readFileLink = (path: string, label: string): JSX.Element => (
    <button
      className="tool-file-link shell-read-file-link"
      type="button"
      aria-label={`打开文件预览：${path}`}
      title={`${path} · 打开文件预览`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void openReadFile(path)
      }}
    >
      {label}
    </button>
  )
  const summary = (
    <>
      <ToolCallIcon iconKind={step.iconKind} />
      {readSummary ? (
        <span className="tool-call-title shell-read-summary-copy">
          <span className="shell-read-summary-title">
            {readSummary.paths.length === 1
              ? <><span>Read</span>{readFileLink(readSummary.paths[0], readSummary.displayPaths[0])}</>
              : readSummary.title}
          </span>
          {readSummary.paths.length > 1 && (
            <span className="shell-read-file-list" role="list" aria-label="读取的文件">
              {readSummary.paths.map((path, index) => (
                <span role="listitem" key={path}>
                  {readFileLink(path, readSummary.displayPaths[index])}
                </span>
              ))}
            </span>
          )}
        </span>
      ) : (
        <span className="tool-call-title" title={publicTitle}>{publicTitle}</span>
      )}
      <ToolCallState status={status} />
      <span
        className={`tool-call-disclosure-slot${hasDetail ? '' : ' is-placeholder'}`}
        aria-hidden="true"
      >
        {hasDetail && (
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
          </svg>
        )}
      </span>
    </>
  )

  if (!hasDetail) {
    return (
      <div
        className={`process-action tool-call-summary tool-call-static status-${status}${readSummary ? ' has-shell-read-summary' : ''}`}
        data-activity-domain={step.activityDomain}
      >
        {summary}
      </div>
    )
  }

  return (
    <details
      className={`process-action tool-call-disclosure status-${status}`}
      data-activity-domain={step.activityDomain}
      onToggle={(event) => {
        const nextExpanded = event.currentTarget.open
        setExpanded(nextExpanded)
        if (nextExpanded) setActivated(true)
      }}
    >
      <summary ref={summaryRef} className={`tool-call-summary${readSummary ? ' has-shell-read-summary' : ''}`}>{summary}</summary>
      {activated && (
        <ToolCallDetail
          campId={campId}
          detail={step.detail}
          completeEvidence={completeEvidence}
          expanded={expanded}
          resultKey={`${runId}:${step.id}`}
          title={publicTitle}
          summaryRef={summaryRef}
        />
      )}
    </details>
  )
}

function CompactionEventIcon(): JSX.Element {
  return (
    <span className="tool-call-icon" data-icon-domain="compaction" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <path d="M3 2.5h10M3 13.5h10" />
        <path d="M8 3.75v3M6.25 5.25 8 7l1.75-1.75" />
        <path d="M8 12.25v-3M6.25 10.75 8 9l1.75 1.75" />
      </svg>
    </span>
  )
}

export function CompactionEventRow({
  campId,
  compaction,
  runId,
  runStatus,
  completeEvidence
}: {
  campId: string
  compaction: RuntimeCompactionDisplayItem
  runId: string
  runStatus: AgentRunView['status']
  completeEvidence?: PresentableExecutionEvidence
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [activated, setActivated] = useState(false)
  const summaryRef = useRef<HTMLElement>(null)
  const title = runtimeCompactionTitle(compaction)
  const detail = runtimeCompactionDetailText(compaction) ?? ''
  const expandable = runtimeCompactionIsExpandable(compaction)
  const status = runtimeCompactionActivityStatus(compaction, runStatus)
  const summary = (
    <>
      <CompactionEventIcon />
      <span className="tool-call-title" title={title}>{title}</span>
      <ToolCallState status={status} />
      <span
        className={`tool-call-disclosure-slot${expandable ? '' : ' is-placeholder'}`}
        aria-hidden="true"
      >
        {expandable && (
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
          </svg>
        )}
      </span>
    </>
  )

  if (!expandable) {
    return (
      <div className={`process-action tool-call-summary tool-call-static compaction-event status-${status}`}>
        {summary}
      </div>
    )
  }

  return (
    <details
      className={`process-action tool-call-disclosure compaction-event status-${status}`}
      onToggle={(event) => {
        const nextExpanded = event.currentTarget.open
        setExpanded(nextExpanded)
        if (nextExpanded) setActivated(true)
      }}
    >
      <summary ref={summaryRef} className="tool-call-summary">{summary}</summary>
      {activated && (
        <ToolCallDetail
          campId={campId}
          detail={detail}
          completeEvidence={completeEvidence}
          expanded={expanded}
          resultKey={`${runId}:compaction:${compaction.id}`}
          title={title}
          summaryRef={summaryRef}
        />
      )}
    </details>
  )
}

function ToolActivityGroupIcon(): JSX.Element {
  return (
    <span className="tool-group-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <circle cx="2.25" cy="4" r="0.65" />
        <circle cx="2.25" cy="8" r="0.65" />
        <circle cx="2.25" cy="12" r="0.65" />
        <path d="M5 4h8M5 8h8M5 12h8" />
      </svg>
    </span>
  )
}

function ToolActivityGroupState({ status, label }: { status: string; label: string }): JSX.Element {
  return (
    <span
      className={`tool-group-state status-${status}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <ExecutionStatusGlyph status={status} />
    </span>
  )
}

export function ToolActivityGroup({
  campId,
  items,
  liveTail,
  cancelling,
  runId,
  runStatus,
  completeEvidence,
  onFileOpenError
}: {
  campId: string
  items: ToolProgressItem[]
  liveTail: boolean
  cancelling: boolean
  runId: string
  runStatus: AgentRunView['status']
  completeEvidence: {
    byToolId: Map<string, PresentableExecutionEvidence>
  }
  onFileOpenError(message: string): void
}): JSX.Element {
  const settledPresentation = toolActivityGroupPresentation(items, runStatus, liveTail)
  const presentation = cancelling
    ? {
        ...settledPresentation,
        status: 'stopped' as const,
        statusLabel: '正在停止',
        primary: '正在停止',
        currentTitle: '等待执行结束',
        countLabel: null,
        accessibleLabel: '正在停止：等待执行结束'
      }
    : settledPresentation
  return (
    <details className={`tool-activity-group status-${presentation.status}`}>
      <summary
        className="tool-group-summary"
        aria-label={presentation.accessibleLabel}
        aria-live="polite"
        aria-atomic="true"
      >
        <ToolActivityGroupIcon />
        <span className="tool-group-copy" aria-hidden="true">
          <span className="tool-group-line">
            <strong>{presentation.primary}</strong>
            {presentation.currentTitle && (
              <>
                <span className="tool-group-separator">·</span>
                <span className="tool-group-current" title={presentation.currentTitle}>
                  {presentation.currentTitle}
                </span>
              </>
            )}
            {presentation.countLabel && (
              <>
                <span className="tool-group-separator">·</span>
                <span className="tool-group-count">{presentation.countLabel}</span>
              </>
            )}
          </span>
        </span>
        {presentation.status === 'running' || presentation.status === 'waiting'
          ? <ToolActivityGroupState status={presentation.status} label={presentation.statusLabel} />
          : <span className="tool-group-state is-placeholder" aria-hidden="true" />}
        <span className="tool-group-disclosure" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
          </svg>
        </span>
      </summary>
      <div className="tool-group-items">
        {items.flatMap((item) => {
          const step = item.step
          if (step.fileChanges?.length) {
            return step.fileChanges.map((change, index) => (
              <ModifiedFileRow
                campId={campId}
                change={change}
                key={`${item.key}:file:${index}:${change.path}`}
                onFileOpenError={onFileOpenError}
                semanticKind={step.fileChangeSemantics}
              />
            ))
          }
          if (step.fileOperation) {
            return (
              <FileOperationRow
                key={item.key}
                campId={campId}
                step={step as ToolCallStep & { fileOperation: NonNullable<ToolCallStep['fileOperation']> }}
                runStatus={runStatus}
                onFileOpenError={onFileOpenError}
              />
            )
          }
          return (
            <ToolCallRow
              key={item.key}
              campId={campId}
              step={step}
              runId={runId}
              runStatus={runStatus}
              completeEvidence={completeEvidence.byToolId.get(step.id)}
              onFileOpenError={onFileOpenError}
            />
          )
        })}
      </div>
    </details>
  )
}

export function RuntimeRetryNotice({ diagnostic }: {
  diagnostic: RuntimeDiagnostic
}): JSX.Element {
  const retryTiming = diagnostic.retryAfterSeconds === 0
    ? '正在立即重试'
    : `将在 ${diagnostic.retryAfterSeconds} 秒后重试`
  return (
    <section
      className="runtime-retry-notice"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Claude Code API 暂时不可用"
    >
      <strong>Claude Code API 暂时不可用</strong>
      <p>
        {retryTiming}（第 {diagnostic.attempt}/{diagnostic.maxAttempts} 次）。
        本次执行尚未结束，可继续等待或停止执行。
      </p>
    </section>
  )
}

function ToolCallIcon({ iconKind }: { iconKind: ActivityIconKind }): JSX.Element {
  const icon = ({
    terminal: (
      <>
        <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
        <path d="M4.25 6 6.1 7.8 4.25 9.6M8 10h3.2" />
      </>
    ),
    file: (
      <>
        <path d="M4 1.75h5.1L12.5 5v9.25H4z" />
        <path d="M9 1.9V5h3.2M6 8h4.4M6 10.5h3.3" />
      </>
    ),
    'file-read': (
      <>
        <path d="M2.25 3.25c1.85-.6 3.45-.35 5.75.85v9.05c-2.3-1.2-3.9-1.45-5.75-.85z" />
        <path d="M13.75 3.25c-1.85-.6-3.45-.35-5.75.85v9.05c2.3-1.2 3.9-1.45 5.75-.85zM8 4.1v9.05" />
      </>
    ),
    'file-write': (
      <>
        <path d="m3 11.55-.45 2 2-.45 7.55-7.55-1.55-1.55z" />
        <path d="m9.75 4.8 1.55 1.55M3.1 11.45l1.55 1.55M9.9 3.85l.85-.85a1.1 1.1 0 0 1 1.55 0l.7.7a1.1 1.1 0 0 1 0 1.55l-.85.85" />
      </>
    ),
    web: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.5 8h11M8 2.25c1.45 1.55 2.15 3.45 2.15 5.75S9.45 12.2 8 13.75M8 2.25C6.55 3.8 5.85 5.7 5.85 8s.7 4.2 2.15 5.75" />
      </>
    ),
    runtime: (
      <>
        <rect x="3.15" y="3.15" width="9.7" height="9.7" rx="1.45" />
        <rect x="5.5" y="5.5" width="5" height="5" rx=".75" />
        <path d="M5.25 1.5v1.65M8 1.5v1.65M10.75 1.5v1.65M5.25 12.85v1.65M8 12.85v1.65M10.75 12.85v1.65M1.5 5.25h1.65M1.5 8h1.65M1.5 10.75h1.65M12.85 5.25h1.65M12.85 8h1.65M12.85 10.75h1.65" />
      </>
    ),
    rovai: (
      <>
        <path
          d="M8 1.25 8.78 4.8 11.84 5.82 8.78 6.84 8 10.39 7.22 6.84 4.16 5.82 7.22 4.8 8 1.25Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M2 14.03Q8 10.7 14 14.03" strokeWidth="1.4" />
      </>
    ),
    tool: (
      <>
        <path d="M9.65 2.35a3.15 3.15 0 0 0-3.2 3.85L2.8 9.85a1.85 1.85 0 0 0 2.62 2.62l3.65-3.65a3.15 3.15 0 0 0 3.85-3.2L10.8 7.74l-2.5-.45-.45-2.5z" />
        <path d="M4.2 11.05h.01" />
      </>
    ),
    unknown: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M6.45 6.1a1.75 1.75 0 1 1 2.45 1.6c-.6.28-.9.72-.9 1.3M8 11.3h.01" />
      </>
    )
  } satisfies Record<ActivityIconKind, JSX.Element>)[iconKind]
  return (
    <span className="tool-call-icon" data-icon-domain={iconKind} aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">{icon}</svg>
    </span>
  )
}

function ToolCallState({ status }: { status: string }): JSX.Element {
  const label = toolCallStatusLabel(status)
  return (
    <span
      className={`tool-call-state status-${status}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <ExecutionStatusGlyph status={status} />
    </span>
  )
}

function toolCallStatusLabel(status: string): string {
  return ({
    running: '执行中',
    completed: '成功',
    failed: '失败',
    waiting: '等待审批',
    stopped: '已停止',
    skipped: '未执行',
    recorded: '结果未知'
  } as Record<string, string>)[status] ?? status
}

