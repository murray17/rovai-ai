import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ArchiveItem, ArchiveKind, DeleteThreadCommand, MissionRecord } from '@contracts'
import { projectDirectoryName } from '../../shared/project-display-name'
import { DialogControlIcon } from './AppDialog'
import { useThreadClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { uiAttribute, useInterfaceLanguage, UiText } from './interface-language'
import { messageTimeParts, useMessageTimeDate } from './message-time'
import { MissionDelete } from './MissionBoard'
import { CompactDialog, MissionFilter } from './MissionControls'
import { MissionIcon } from './MissionIcon'
import { NavigationIcon } from './NavigationIcon'
import { archiveTargetIsRemoved, archiveView, normalizeArchiveText, requestArchiveCommand, writeArchive } from './thread-archive'
import { useArchiveRecords } from './useArchiveRecords'
import './archive-settings.css'

const kinds: ArchiveKind[] = ['chat', 'mission']
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function highlight(title: string, query: string): ReactNode {
  if (!query) return title
  const graphemes = Array.from(segmenter.segment(title), entry => entry.segment)
  const parts = graphemes.map(normalizeArchiveText)
  const normalized = parts.join('')
  if (normalized !== normalizeArchiveText(title)) return title
  const ranges: Array<[number, number]> = []
  for (let start = normalized.indexOf(query); start >= 0; start = normalized.indexOf(query, start + query.length)) {
    ranges.push([start, start + query.length])
  }
  if (!ranges.length) return title
  let offset = 0
  const runs: Array<{ match: boolean; text: string }> = []
  graphemes.forEach((grapheme, index) => {
    const end = offset + parts[index].length
    const match = ranges.some(([start, stop]) => start < end && stop > offset)
    const previous = runs.at(-1)
    if (previous?.match === match) previous.text += grapheme
    else runs.push({ match, text: grapheme })
    offset = end
  })
  return runs.map(({ match, text }, index) => match ? <mark key={index}>{text}</mark> : text)
}

export function ArchiveSettings({ projectNames, initialKind = 'chat', firstThreadId, onDeleted, onRestored, onNotify, onError }: {
  projectNames: Readonly<Record<string, string>>
  initialKind?: ArchiveKind
  firstThreadId?: string
  onDeleted(threadId: string): void
  onRestored(item: ArchiveItem): void
  onNotify(message: string): void
  onError(message: string): void
}) {
  const client = useThreadClient()
  const language = useInterfaceLanguage()
  const today = useMessageTimeDate()
  const [kind, setKind] = useState<ArchiveKind>(initialKind)
  const [text, setText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [projectKeys, setProjectKeys] = useState<string[]>([])
  const [confirm, setConfirm] = useState<ArchiveItem | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const locks = useRef(new Set<string>())
  const list = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const filters = useRef<HTMLDivElement>(null)
  const tabs = useRef(new Map<ArchiveKind, HTMLButtonElement>())
  const focusAfter = useRef<{ id: string; neighbors: string[]; kind: ArchiveKind } | null>(null)
  const query = normalizeArchiveText(searchQuery)
  const rows = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[data-archive-thread]') ?? [])

  const { items, error, refresh, discardStaleItem } = useArchiveRecords(client)
  const result = useMemo(() => items && archiveView(items, kind, query, projectKeys, firstThreadId),
    [items, kind, query, projectKeys, firstThreadId])
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (confirm || event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey
        || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f'
        || !search.current?.getClientRects().length) return
      event.preventDefault()
      search.current.focus()
      search.current.select()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [confirm])

  useLayoutEffect(() => {
    const visible = new Map(rows().map(element => [element.dataset.archiveThread!, element]))
    const target = focusAfter.current
    if (!target || target.kind !== kind || confirm || visible.has(target.id)) return
    focusAfter.current = null
    if (document.activeElement !== document.body) return
    const next = target.neighbors
      .map(id => visible.get(id)?.querySelector<HTMLButtonElement>('.archive-restore:not(:disabled)'))
      .find(Boolean) ?? list.current?.querySelector<HTMLButtonElement>('.archive-restore:not(:disabled)') ?? tabs.current.get(kind)
    next?.focus({ preventScroll: true })
    next?.scrollIntoView({ block: 'nearest' })
  }, [result, kind, confirm, pending])

  function selectKind(next: ArchiveKind): void {
    if (next === kind) return
    setKind(next)
  }

  function changeProjects(next: string[]): void {
    setProjectKeys([...new Set(next)].sort())
  }

  function clearSearch(): void {
    setText('')
    setSearchQuery('')
    search.current?.focus()
  }

  function name(projectKey: string): string {
    if (projectKey === 'quick-chat') return uiAttribute('快速对话')
    if (projectKey === 'unavailable') return uiAttribute('项目不可用')
    return projectNames[projectKey] ?? projectDirectoryName(projectKey.slice('directory:'.length))
  }

  function rememberFocus(item: ArchiveItem): void {
    const ids = rows().map(row => row.dataset.archiveThread!)
    const index = ids.indexOf(item.threadId)
    focusAfter.current = { id: item.threadId, neighbors: [...ids.slice(index + 1), ...ids.slice(0, index).reverse()], kind }
  }

  async function operate(item: ArchiveItem, action: () => Promise<void>): Promise<void> {
    if (locks.current.has(item.threadId)) return
    rememberFocus(item)
    locks.current.add(item.threadId)
    setPending(new Set(locks.current))
    setActionError(null)
    try {
      await action()
    } finally {
      locks.current.delete(item.threadId)
      setPending(new Set(locks.current))
    }
  }

  async function unarchive(item: ArchiveItem): Promise<void> {
    try {
      await operate(item, async () => {
        const result = await writeArchive(client, false, { threadId: item.threadId })
        if (!result.changed) discardStaleItem(item)
        onRestored(item)
      })
    } catch (error) {
      if (archiveTargetIsRemoved(error)) {
        discardStaleItem(item)
        onError(readErrorMessage(error))
      } else setActionError(readErrorMessage(error))
    }
  }

  async function remove(item: ArchiveItem, workspaceDisposition: 'retain' | 'cleanup' = 'retain'): Promise<void> {
    await operate(item, async () => {
      const command: DeleteThreadCommand = {
        threadId: item.threadId, workspaceDisposition
      }
      try {
        await requestArchiveCommand(client, 'threads.delete', command)
        onDeleted(item.threadId)
        onNotify(uiAttribute('已提交删除'))
      } catch (error) {
        if (!archiveTargetIsRemoved(error)) throw error
        discardStaleItem(item)
        onError(readErrorMessage(error))
      }
      setConfirm(null)
    })
  }

  const projects = [...(result?.projects ?? [])].map(([id, count]) => ({ id, label: name(id), keywords: id, count }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  const otherKind = kind === 'chat' ? 'mission' : 'chat'
  const selectedProjects = projectKeys.map(name)
  return <section className="archive-settings">
    <header className="archive-heading">
      <h1><UiText zh="归档" /></h1>
      <p><UiText zh="已归档的会话和使命保留全部消息与附件，取消归档后回到原来的位置。" /></p>
    </header>
    <div className="archive-toolbar">
      <div role="tablist" aria-label={uiAttribute('归档类型')} className="archive-tabs">
        {kinds.map((item, index) => <button type="button" role="tab" key={item}
          ref={node => { if (node) tabs.current.set(item, node); else tabs.current.delete(item) }}
          id={`archive-tab-${item}`} aria-controls="archive-results" aria-selected={kind === item}
          tabIndex={kind === item ? 0 : -1} onClick={() => selectKind(item)}
          onKeyDown={event => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? kinds[0] : event.key === 'End' ? kinds[1] : kinds[1 - index]
            selectKind(next)
            tabs.current.get(next)?.focus()
          }}>
          {item === 'chat' ? <NavigationIcon name="messages" /> : <MissionIcon />}
          {item === 'chat' ? <UiText zh="会话" /> : <UiText zh="使命" />}
          {result && <span className="archive-count">{result.matchingCounts[item]}</span>}
        </button>)}
      </div>
      <div className="archive-filters" ref={filters}>
        <MissionFilter label={uiAttribute('项目')} icon={<NavigationIcon name="folder-open" />}
          values={projectKeys} onChange={changeProjects}
          options={projects} />
        {projectKeys.length > 0 && <button type="button" className="mission-clear-filters" aria-label={uiAttribute('清除筛选')}
          title={uiAttribute('清除筛选')} onClick={() => {
            changeProjects([])
            filters.current?.querySelector<HTMLButtonElement>('.mission-filter')?.focus()
          }}><DialogControlIcon name="close" /></button>}
        <span className="archive-filter-divider" aria-hidden="true" />
        <div className="mission-search archive-search">
          <NavigationIcon name="search" />
          <input ref={search} type="search" autoComplete="off" spellCheck={false} aria-label={uiAttribute('搜索标题或会话 ID')}
            placeholder={uiAttribute(kind === 'chat' ? '搜索已归档会话…' : '搜索已归档使命…')}
            value={text} onChange={event => {
              setText(event.currentTarget.value)
              if (!composing) setSearchQuery(event.currentTarget.value.trim())
            }}
            onKeyDown={event => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing && !composing && text) {
                event.preventDefault(); event.stopPropagation(); clearSearch()
              }
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={event => { setSearchQuery(event.currentTarget.value.trim()); setComposing(false) }} />
          {text && <button type="button" aria-label={uiAttribute('清除搜索')}
            onClick={clearSearch}><DialogControlIcon name="close" /></button>}
        </div>
      </div>
    </div>
    <div className="archive-results" id="archive-results" role="tabpanel" aria-labelledby={`archive-tab-${kind}`} ref={list}
      aria-busy={!items && !error}>
      {actionError && <p className="compact-inline-error" role="alert">{actionError}</p>}
      {error && <div className="archive-status" role="alert"><p>{error}</p><button type="button" className="quiet-button" onClick={refresh}><UiText zh="重试" /></button></div>}
      {!result && !error && <p className="archive-status" role="status"><UiText zh="正在读取归档…" /></p>}
      {result && !result.groups.length && <div className="archive-empty" role="status">
        {!result.totals[kind] ? <p><UiText zh={kind === 'chat' ? '暂无已归档会话' : '暂无已归档使命'} /></p>
          : <><h2><UiText zh={kind === 'chat' ? '没有匹配的已归档会话' : '没有匹配的已归档使命'} /></h2>
            <p>{[searchQuery && uiAttribute('搜索「{0}」', searchQuery),
              selectedProjects.length > 0 && uiAttribute('项目：{0}', selectedProjects.join(language === 'en' ? ', ' : '、'))]
              .filter(Boolean).join(' · ')}</p>
            <div className="archive-empty-actions">
              {result.matchingCounts[otherKind] > 0 && <button type="button" onClick={() => {
                selectKind(otherKind)
                tabs.current.get(otherKind)?.focus()
              }}>{uiAttribute(otherKind === 'mission' ? '查看 {0} 个匹配的使命' : '查看 {0} 个匹配的会话', String(result.matchingCounts[otherKind]))}</button>}
              <button type="button" onClick={() => { clearSearch(); changeProjects([]) }}><UiText zh="清除搜索和筛选" /></button>
            </div></>}
      </div>}
      {result?.groups.map(([projectKey, items]) => <section className="archive-project" key={projectKey}>
        <h2><NavigationIcon name="folder-open" /><span title={projectKey.startsWith('directory:') ? projectKey.slice(10) : undefined}>
          {name(projectKey)}</span><span className="archive-count">{items.length}</span></h2>
        <ul className="archive-list">
          {items.map(item => {
            const time = item.lastMessageAt && messageTimeParts(item.lastMessageAt, language, today)
            const disabled = pending.has(item.threadId) || confirm?.threadId === item.threadId
            return <li className="archive-row" key={item.threadId} data-archive-thread={item.threadId}>
              <span className="archive-title" title={item.title}>{highlight(item.title, query)}</span>
              {time ? <time dateTime={item.lastMessageAt!} title={time.full} aria-label={time.full}>{time.short}</time>
                : <span className="archive-date"><UiText zh="暂无消息" /></span>}
              <div className="archive-row-actions">
                <button type="button" className="archive-restore" disabled={disabled}
                  aria-label={uiAttribute('取消归档 {0}', item.title)}
                  onClick={() => void unarchive(item)}><UiText zh="取消归档" /></button>
                <button type="button" className="archive-icon-button archive-delete" disabled={disabled}
                  aria-label={uiAttribute('删除 {0}', item.title)} title={uiAttribute('删除')}
                  onClick={() => setConfirm(item)}><NavigationIcon name="trash" /></button>
              </div>
            </li>
          })}
        </ul>
      </section>)}

    </div>
    {confirm && <ArchiveDeleteDialog key={confirm.threadId} item={confirm} busy={pending.has(confirm.threadId)}
      onClose={() => setConfirm(null)} onDelete={disposition => remove(confirm, disposition)} />}
  </section>
}

function ArchiveDeleteDialog({ item, busy, onClose, onDelete }: {
  item: ArchiveItem
  busy: boolean
  onClose(): void
  onDelete(disposition?: 'retain' | 'cleanup'): Promise<void>
}) {
  const client = useThreadClient()
  const [mission, setMission] = useState<MissionRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!item.missionId) return
    let current = true
    setError(null)
    void client.request<MissionRecord>('missions.get', { missionId: item.missionId })
      .then(value => { if (current) setMission(value) })
      .catch(error => { if (current) setError(readErrorMessage(error)) })
    return () => { current = false }
  }, [client, item.missionId, retry])
  if (mission) return <MissionDelete mission={mission} recordTitle={item.title}
    onClose={onClose} onDelete={onDelete} />
  return <CompactDialog title={uiAttribute(item.missionId ? '删除使命' : '删除会话')} onClose={() => { if (!busy) onClose() }}
    footer={<>
      <button type="button" className="compact-cancel" onClick={onClose} disabled={busy}><UiText zh="取消" /></button>
      <button type="button" className="compact-primary archive-delete-confirm"
        disabled={busy || Boolean(item.missionId)}
        onClick={() => {
          setError(null)
          void onDelete().catch(error => setError(readErrorMessage(error)))
        }}><UiText zh={busy ? '正在删除…' : '删除'} /></button>
    </>}>
    <p>{item.title}</p>
    {item.missionId ? <p role={error ? 'alert' : 'status'}>{error ?? uiAttribute('正在读取关联工作区…')}
      {error && <button type="button" className="quiet-button" onClick={() => setRetry(value => value + 1)}><UiText zh="重试" /></button>}</p>
      : <><p><UiText zh="此会话及其中的消息和附件将被永久删除，正在执行的队员会停止。" /></p>
        {error && <p className="compact-inline-error" role="alert">{error}</p>}
      </>}
  </CompactDialog>
}
