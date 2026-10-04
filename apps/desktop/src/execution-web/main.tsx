import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ThreadClientProvider, type ThreadClient } from '../renderer/src/camp-client'
import { ExecutionContentContext } from '../renderer/src/ExecutionVirtualList'
import { ExecutionContentCache } from '../renderer/src/execution-content-cache'
import { ExecutionStatusGlyph } from '../renderer/src/ExecutionStatusGlyph'
import { ExecutionToolGroupStateContext, ToolActivityGroup } from '../renderer/src/ExecutionToolGroup'
import { SafeMarkdown } from '../renderer/src/SafeMarkdown'
import { identityColorToken } from '../renderer/src/theme'
import type { ToolProgressItem } from '../shared/execution-presentation/tool-grouping'
import type {
  PublicExecutionActivity,
  PublicExecutionRun,
  PublicExecutionSnapshot
} from '../shared/execution-presentation/web-snapshot'
import '../renderer/src/styles.css'
import './web.css'

// Shared presentation components may ask for the desktop client only when a
// private Evidence or file action is present. The public projection supplies
// neither; fail closed if that boundary is accidentally crossed.
const readonlyClient = {
  platform: 'web',
  request: async () => { throw new Error('只读执行台不能读取私有内容') }
} as unknown as ThreadClient
const emptyEvidence = { byToolId: new Map() }
const nonTerminal = (run: PublicExecutionRun): boolean =>
  run.status === 'queued' || run.status === 'running' || run.status === 'waiting'
const statePresentation: Record<PublicExecutionRun['status'], { shape: string; tone: string; label: string }> = {
  queued: { shape: 'queued', tone: 'neutral', label: '排队中' },
  running: { shape: 'running', tone: 'info', label: '执行中' },
  waiting: { shape: 'waiting', tone: 'attention', label: '等待处理' },
  succeeded: { shape: 'completed', tone: 'success', label: '已完成' },
  failed: { shape: 'failed', tone: 'danger', label: '执行失败' },
  cancelled: { shape: 'stopped', tone: 'neutral', label: '已停止' }
}

function Chevron({ open = false }: { open?: boolean }): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d={open
    ? 'm4.5 9.5 3.5-3.5 3.5 3.5'
    : 'm4.5 6.5 3.5 3.5 3.5-3.5'} /></svg>
}

function Mark(): React.JSX.Element {
  return <svg data-brand-mark="horizon" className="brand-mark" viewBox="0 0 24 24"
    aria-label="Rovai AI" role="img">
    <path d="M12 2 L13.16 7.3 L17.76 8.84 L13.16 10.38 L12 15.68 L10.84 10.38 L6.24 8.84 L10.84 7.3 Z" fill="currentColor" />
    <path d="M3 20.96 Q12 15.96 21 20.96" fill="none" stroke="currentColor" strokeWidth="2.08" strokeLinecap="round" />
    <circle cx="12" cy="18.46" r="1.05" fill="var(--ember)" stroke="var(--surface)" strokeWidth=".65" />
  </svg>
}

function Avatar({ id, name, user = false }: { id: string; name: string; user?: boolean }): React.JSX.Element {
  const accent = user ? 'var(--brand)' : identityColorToken(id)
  return <span className="member-avatar" aria-hidden="true"
    style={{ '--member-avatar-size': '32px', '--member-avatar-accent': accent } as React.CSSProperties}>
    <span className="member-avatar-fallback">{Array.from(name.trim())[0] || (user ? '你' : '队')}</span>
  </span>
}

function toToolItems(
  activities: PublicExecutionActivity[], run: PublicExecutionRun, groupIndex: number, firstIndex: number
): ToolProgressItem[] {
  return activities.map((activity, offset) => {
    const index = firstIndex + offset
    return {
      kind: 'tool',
      key: `g${groupIndex}-t${index}`,
      step: {
        id: `${run.id}-g${groupIndex}-t${index}`,
        title: activity.title,
        currentInstruction: activity.title,
        publicCommand: null,
        publicResult: activity.result,
        detail: activity.result ?? (activity.status === 'running' ? '正在执行'
          : activity.status === 'waiting' ? '等待处理' : '暂无公开结果'),
        status: activity.status,
        activityDomain: activity.iconKind === 'terminal' ? 'shell' : 'tool',
        iconKind: activity.iconKind,
        toolName: null,
        credibility: 'exact'
      }
    }
  })
}

function PublicFileGroup({
  activities, stateKey, expanded, setExpanded
}: {
  activities: PublicExecutionActivity[]
  stateKey: string
  expanded: ReadonlySet<string>
  setExpanded: (key: string, open: boolean) => void
}): React.JSX.Element {
  const files = activities.flatMap((activity) => activity.files)
  const open = expanded.has(stateKey)
  return <details className="tool-activity-group" open={open}
    onToggle={(event) => { if (event.target === event.currentTarget) setExpanded(stateKey, event.currentTarget.open) }}>
    <summary className="tool-group-summary" aria-expanded={open}>
      <span className="tool-group-icon" aria-hidden="true"><svg viewBox="0 0 16 16">
        <circle cx="2.25" cy="4" r=".65" /><circle cx="2.25" cy="8" r=".65" />
        <circle cx="2.25" cy="12" r=".65" /><path d="M5 4h8M5 8h8M5 12h8" />
      </svg></span>
      <span className="tool-group-copy"><span className="tool-group-line">
        <strong>已记录 {files.length} 个文件修改</strong>
      </span></span>
      <span className="tool-group-disclosure" aria-hidden="true"><Chevron /></span>
    </summary>
    {open && <div className="tool-group-items">{files.map((file, index) => {
      const key = `${stateKey}:file:${index}`
      const fileOpen = expanded.has(key)
      const name = file.path.split('/').filter(Boolean).at(-1) ?? file.path
      return <details className="process-action modified-file-row" key={key} open={fileOpen}
        onToggle={(event) => setExpanded(key, event.currentTarget.open)}>
        <summary className="modified-file-summary" aria-expanded={fileOpen}
          aria-label={`修改 ${file.path}${file.additions === null ? '' : `，新增 ${file.additions} 行`}${file.deletions === null ? '' : `，删除 ${file.deletions} 行`}`}>
          <span className="tool-call-icon" aria-hidden="true"><svg viewBox="0 0 16 16">
            <path d="M4 1.75h5.1L12.5 5v9.25H4zM9 1.9V5h3.2M6 8h4.4M6 10.5h3.3" />
          </svg></span>
          <span className="modified-file-title"><span>修改</span><span className="web-file-name">{name}</span></span>
          <span className="modified-file-stats" aria-hidden="true">
            {file.additions !== null && <span className="diff-addition">+{file.additions}</span>}
            {file.deletions !== null && <span className="diff-deletion">−{file.deletions}</span>}
          </span>
          <span className="tool-call-disclosure-slot" aria-hidden="true"><Chevron /></span>
        </summary>
        {fileOpen && <div className="web-public-file">{file.path}</div>}
      </details>
    })}</div>}
  </details>
}

function RunBody({
  run, expanded, setExpanded, theme
}: {
  run: PublicExecutionRun
  expanded: ReadonlySet<string>
  setExpanded: (key: string, open: boolean) => void
  theme: 'day' | 'night'
}): React.JSX.Element {
  const content = run.items.flatMap((item, groupIndex) => {
    if (item.kind === 'narration') return [<div className="process-copy" key={`n:${groupIndex}`}>
      <SafeMarkdown theme={theme}>{item.body}</SafeMarkdown>
    </div>]
    const parts: React.JSX.Element[] = []
    let start = 0
    while (start < item.activities.length) {
      const file = item.activities[start].files.length > 0
      let end = start + 1
      while (end < item.activities.length && (item.activities[end].files.length > 0) === file) end += 1
      const activities = item.activities.slice(start, end)
      if (file) {
        parts.push(<PublicFileGroup key={`f:${groupIndex}:${start}`} activities={activities}
          stateKey={`${run.id}:files:${groupIndex}:${start}`} expanded={expanded} setExpanded={setExpanded} />)
      } else {
        parts.push(<ToolActivityGroup key={`t:${groupIndex}:${start}`} threadId="public-execution"
          runId={run.id} runStatus={run.status}
          items={toToolItems(activities, run, groupIndex, start)}
          liveTail={groupIndex === run.items.length - 1 && end === item.activities.length}
          cancelling={false} completeEvidence={emptyEvidence} onFileOpenError={() => undefined} />)
      }
      start = end
    }
    return parts
  })
  return <div className="execution-disclosure"><div className="process-content">
    {content.length ? content : <p className="process-action current">
      {run.status === 'queued' ? '连接中' : '暂无公开执行记录'}
    </p>}
  </div></div>
}

function isSnapshot(value: unknown, runId: string): value is PublicExecutionSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Partial<PublicExecutionSnapshot>
  return snapshot.schemaVersion === 1 && snapshot.focusRunId === runId
    && Array.isArray(snapshot.runs) && typeof snapshot.thread?.title === 'string'
    && typeof snapshot.agent?.displayName === 'string'
}

function grantFromLocation(): { runId: string; token: string } {
  const runId = location.pathname.match(/^\/execution\/([A-Za-z0-9_-]{1,200})$/u)?.[1] ?? ''
  const token = new URLSearchParams(location.hash.slice(1)).get('t') ?? ''
  if (location.hash) history.replaceState(null, '', location.pathname)
  return { runId, token }
}

const grant = grantFromLocation()

function elapsedLabel(run: PublicExecutionRun, now: number): string {
  if (run.status === 'queued') return '排队中'
  if (run.status === 'waiting') return '等待处理'
  if (run.status === 'failed') return '执行失败'
  if (run.status === 'cancelled') return '已停止'
  const start = Date.parse(run.startedAt ?? run.createdAt)
  const end = nonTerminal(run) ? now : Date.parse(run.endedAt ?? run.createdAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '处理过程'
  const seconds = Math.max(1, Math.floor((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}分 ${seconds % 60}秒` : `${seconds}秒`
}

function RunMetric({ run }: { run: PublicExecutionRun }): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (run.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [run.status])
  return <span className={`execution-run-metric${run.status === 'running' ? ' is-live' : ''}`}>
    {elapsedLabel(run, now)}
  </span>
}

function App(): React.JSX.Element {
  const [theme, setTheme] = useState<'day' | 'night'>(() =>
    document.documentElement.dataset.theme === 'night' ? 'night' : 'day')
  const [snapshot, setSnapshot] = useState<PublicExecutionSnapshot | null>(null)
  const snapshotRef = useRef<PublicExecutionSnapshot | null>(null)
  const initialized = useRef(false)
  const [error, setError] = useState<'expired' | 'unavailable' | null>(null)
  const [connection, setConnection] = useState<'live' | 'reconnecting'>('live')
  const [attempt, setAttempt] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState(grant.runId)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const contentCache = useMemo(() => new ExecutionContentCache(), [])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = (): void => {
      const next = media.matches ? 'night' : 'day'
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    if (!grant.runId || !grant.token) {
      setError('expired')
      return
    }
    const controller = new AbortController()
    const auth = { Authorization: `Bearer ${grant.token}` }
    const api = `/api/execution/${encodeURIComponent(grant.runId)}`
    const accept = (value: unknown): PublicExecutionSnapshot => {
      if (!isSnapshot(value, grant.runId)) throw new Error('invalid_projection')
      snapshotRef.current = value
      setSnapshot(value)
      setError(null)
      setSelectedRunId((current) => value.runs.some((run) => run.id === current)
        ? current : value.focusRunId)
      if (!initialized.current) {
        initialized.current = true
        setExpandedRuns(new Set([value.focusRunId]))
        setHistoryOpen(Boolean(value.runs.find((run) => run.id === value.focusRunId && !nonTerminal(run))))
        const focus = value.runs.find((run) => run.id === value.focusRunId)
        const lastGroupIndex = focus?.items.findLastIndex((item) => item.kind === 'activityGroup') ?? -1
        const lastGroup = focus?.items[lastGroupIndex]
        if (lastGroup?.kind === 'activityGroup') {
          setExpandedGroups(new Set(lastGroup.activities.map((_, index) =>
            `${value.focusRunId}:g${lastGroupIndex}-t${index}`)))
        }
      }
      return value
    }
    const readSnapshot = async (): Promise<PublicExecutionSnapshot> => {
      const response = await fetch(`${api}/snapshot`, { headers: auth, cache: 'no-store', signal: controller.signal })
      if (response.status === 401 || response.status === 410) throw new Error('invalid_token')
      if (!response.ok) throw new Error('unavailable')
      return accept(await response.json())
    }
    const stream = async (): Promise<boolean> => {
      const response = await fetch(`${api}/events`, {
        headers: { ...auth, Accept: 'text/event-stream' }, cache: 'no-store', signal: controller.signal
      })
      if (response.status === 401 || response.status === 410) throw new Error('invalid_token')
      if (!response.ok || !response.body) throw new Error('unavailable')
      setConnection('live')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (!controller.signal.aborted) {
          const part = await reader.read()
          if (part.done) throw new Error('disconnected')
          buffer += decoder.decode(part.value, { stream: true })
          let cut: number
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            const data = frame.split('\n').filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim()).join('')
            if (!data) continue
            const message = JSON.parse(data) as { type?: string; snapshot?: unknown }
            if (message.type === 'invalidated') throw new Error('invalid_token')
            if (message.type === 'snapshot' || message.type === 'terminal') {
              accept(message.snapshot)
              if (message.type === 'terminal') return true
            }
          }
        }
      } finally {
        void reader.cancel().catch(() => undefined)
      }
      return false
    }
    const follow = async (): Promise<void> => {
      try {
        let first: PublicExecutionSnapshot
        try {
          first = await readSnapshot()
        } catch (failure) {
          if ((failure as Error).message === 'invalid_token') throw failure
          if (!snapshotRef.current) {
            setError('unavailable')
            return
          }
          first = snapshotRef.current
          setConnection('reconnecting')
        }
        if (first.terminal) return
        while (!controller.signal.aborted) {
          try {
            if (await stream()) return
          } catch (failure) {
            if ((failure as Error).message === 'invalid_token') throw failure
            if (controller.signal.aborted) return
            setConnection('reconnecting')
            await new Promise((resolve) => setTimeout(resolve, 1_200))
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message === 'invalid_token'
          ? 'expired' : 'unavailable')
      }
    }
    void follow()
    return () => controller.abort()
  }, [attempt])

  const setFileExpanded = (key: string, open: boolean): void => setExpandedFiles((current) => {
    if (current.has(key) === open) return current
    const next = new Set(current)
    if (open) next.add(key)
    else next.delete(key)
    return next
  })
  const focus = snapshot?.runs.find((run) => run.id === selectedRunId)
    ?? snapshot?.runs.find((run) => run.id === snapshot.focusRunId) ?? snapshot?.runs[0]
  const current = snapshot?.runs.filter(nonTerminal) ?? []
  const history = snapshot?.runs.filter((run) => !nonTerminal(run)) ?? []
  const renderRun = (run: PublicExecutionRun): React.JSX.Element => {
    const presentation = statePresentation[run.status]
    const expanded = expandedRuns.has(run.id)
    const summary = run.trigger.summary || run.purpose || '这次执行'
    return <li key={run.id} className={`execution-process-stage status-${run.status}${focus?.id === run.id ? ' is-focused' : ''}`}
      data-agent-run-id={run.id} aria-current={focus?.id === run.id ? 'step' : undefined}
      aria-label={`${snapshot?.agent.displayName ?? '队员'}，${presentation.label}，${summary}`}>
      <span className={`execution-process-node tone-${presentation.tone} state-${presentation.shape}`}
        title={presentation.label}>
        <ExecutionStatusGlyph status={presentation.shape} /><span className="sr-only">{presentation.label}</span>
      </span>
      <article className="execution-process-card">
        <header className="execution-run-card-header">
          <h3 className="execution-run-heading"><button className="execution-run-toggle" type="button"
            title={summary} aria-label={`查看触发消息：${summary}`} aria-pressed={focus?.id === run.id}
            onClick={() => setSelectedRunId(run.id)}>
            <span className="execution-run-summary">{summary}</span>
          </button></h3>
          <span className="execution-run-trailing">
            <RunMetric run={run} />
            <span className="execution-run-operations"><button type="button"
              aria-label={expanded ? '收起卡片' : '展开卡片'} aria-expanded={expanded}
              aria-controls={`execution-run-content-${run.id}`}
              onClick={() => setExpandedRuns((previous) => {
                const next = new Set(previous)
                if (next.has(run.id)) next.delete(run.id)
                else next.add(run.id)
                return next
              })}>
              <Chevron open={expanded} />
            </button></span>
          </span>
        </header>
        <div id={`execution-run-content-${run.id}`} hidden={!expanded}>
          {expanded && <RunBody run={run} expanded={expandedFiles} setExpanded={setFileExpanded} theme={theme} />}
        </div>
      </article>
    </li>
  }

  return <ThreadClientProvider client={readonlyClient}>
    <ExecutionContentContext.Provider value={contentCache}>
      <ExecutionToolGroupStateContext.Provider value={{
        expanded: expandedGroups,
        change: (keys, open) => setExpandedGroups((previous) => {
          const next = new Set(previous)
          keys.forEach((key) => { if (open) next.add(key); else next.delete(key) })
          return next
        })
      }}>
        <a className="skip-link" href="#execution-records">跳到执行记录</a>
        <header className="web-app-bar"><div><Mark /><h1>{snapshot?.thread.title || '执行台'}</h1>
          <span className="web-readonly">只读</span></div></header>
        {!snapshot && <main className="web-state" id="execution-records"
          role={error ? 'alert' : 'status'}><div>
          {!error && <span className="process-spinner" />}
          <h2>{error === 'expired' ? '此执行台链接已失效'
            : error === 'unavailable' ? '暂时无法读取执行记录' : '正在读取执行记录'}</h2>
          {error && <p>{error === 'expired' ? '请回到渠道会话，重新打开执行台。'
            : '确认与 Rovai 位于同一局域网后重试。'}</p>}
          {error === 'unavailable' && <button className="web-retry" type="button"
            onClick={() => { setError(null); setAttempt((value) => value + 1) }}>重新读取</button>}
        </div></main>}
        {snapshot && <main className="web-content" id="execution-records">
          {focus && <section className="web-trigger" aria-label="触发消息" aria-live="polite">
            <Avatar id={focus.trigger.authorKind === 'agent' ? focus.trigger.authorDisplayName : 'current-user'}
              name={focus.trigger.authorKind === 'agent' ? focus.trigger.authorDisplayName : '你'}
              user={focus.trigger.authorKind !== 'agent'} />
            <div><div className="web-message-meta">
              <strong>{focus.trigger.authorKind === 'agent' ? focus.trigger.authorDisplayName : '你'}</strong>
              <time>{new Date(focus.trigger.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit', minute: '2-digit', hour12: false
              })}</time>
            </div><p>{focus.trigger.summary || focus.purpose || '这次执行没有可显示的触发消息摘要。'}</p></div>
          </section>}
          <section className="execution-drawer execution-drawer-inspector web-console"
            aria-label={`${snapshot.agent.displayName}的执行记录`}>
            <header className="execution-drawer-header">
              <div className="execution-drawer-agent"><Avatar id={snapshot.agent.id}
                name={snapshot.agent.displayName} /><div><div className="execution-drawer-title-line">
                  <h2>{snapshot.agent.displayName || '队员'}</h2>
                </div></div></div>
              <span className={`web-connection${connection === 'reconnecting' || error === 'expired' ? ' is-reconnecting' : ''}`}
                role="status">{error === 'expired' ? '链接已失效' : connection === 'reconnecting' ? '正在重连'
                  : current.length ? '实时更新' : snapshot.runs.length ? '执行已结束' : ''}</span>
            </header>
            {connection === 'reconnecting' && !error && <div className="web-reconnect" role="alert">
              <span>连接中断，已保留最近输出</span><button type="button"
                onClick={() => setAttempt((value) => value + 1)}>重新连接</button>
            </div>}
            {error === 'expired' && <div className="web-reconnect" role="alert">
              此执行台链接已失效。请回到渠道会话，重新打开执行台。
            </div>}
            <div className="execution-drawer-body">
              {current.length > 0 && <section aria-label="当前执行"><ol className="execution-process-timeline">
                {current.map(renderRun)}
              </ol></section>}
              {history.length > 0 && <section className="execution-history-section">
                <button className="execution-history-toggle" type="button" aria-expanded={historyOpen}
                  aria-controls="web-history" onClick={() => setHistoryOpen((value) => !value)}>
                  <Chevron open={historyOpen} /><span>执行历史</span>
                  <span className="execution-history-count">{history.length}</span>
                </button>
                <div className="execution-history-list" id="web-history" hidden={!historyOpen}>
                  <ol className="execution-process-timeline">{history.map(renderRun)}</ol>
                </div>
              </section>}
              {snapshot.runs.length === 0 && <div className="execution-current-empty">暂无公开执行记录</div>}
            </div>
          </section>
        </main>}
      </ExecutionToolGroupStateContext.Provider>
    </ExecutionContentContext.Provider>
  </ThreadClientProvider>
}

createRoot(document.getElementById('root')!).render(<App />)
