import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { isThreadId, type ProjectNavigationGroup } from '@contracts'
import { useThreadClient } from './camp-client'
import { conversationFindRanges } from './camp-conversation-find'
import {
  createNavigationSearchSession, navigationSearchHints, NAVIGATION_SEARCH_QUERY_LIMIT, type NavigationSearchRow
} from './camp-navigation-search'
import { formatThreadTitle } from './camp-title'
import { UiText, uiAttribute } from './interface-language'
import { missionDate } from './MissionBoard'
import { StatusIcon, useMissionStatuses } from './MissionControls'
import { NavigationIcon } from './NavigationIcon'
import { NavigationTitle } from './NavigationTitle'

function projectBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function highlightSnippet(text: string, query: string): ReactNode {
  const parts: ReactNode[] = []
  let previous = 0
  for (const { start, end } of conversationFindRanges(text, query)) {
    parts.push(text.slice(previous, start), <mark key={start}>{text.slice(start, end)}</mark>)
    previous = end
  }
  parts.push(text.slice(previous))
  return parts
}

export function NavigationSearchPanel({
  onClose, onChoose, projects, missionProjectPaths, firstRunThreadId
}: {
  onClose(): void
  onChoose(row: NavigationSearchRow): void
  projects?: readonly ProjectNavigationGroup[]
  missionProjectPaths?: readonly string[]
  firstRunThreadId: string | null
}): React.JSX.Element {
  const client = useThreadClient()
  const projectNames = useMemo(() => new Map([
    ...(missionProjectPaths ?? []).map(path => [path, projectBasename(path)] as const),
    ...(projects ?? []).map(project => [project.projectPath, project.name] as const)
  ]), [missionProjectPaths, projects])
  const latest = useRef({ projectNames, firstRunThreadId, onChoose })
  latest.current = { projectNames, firstRunThreadId, onChoose }
  const [session] = useState(() => createNavigationSearchSession({
    names: request => client.request('navigation.search', request),
    messages: request => client.request('navigation.searchMessages', request),
    hints: query => navigationSearchHints(query, latest.current.projectNames, latest.current.firstRunThreadId),
    choose: row => latest.current.onChoose(row)
  }))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const listId = useId()
  const optionId = (threadId: string) => listId + '-' + threadId
  const statuses = useMissionStatuses()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const action = useRef<HTMLButtonElement>(null)
  const actionFocused = useRef(false)
  const current = state.phase === 'results'
  const busy = !state.composing && (state.phase === 'names' || (current && state.messages === 'loading'))
  const loadMore = current && state.messages === 'more'
  const retry = state.phase === 'nameError' || (current && state.messages === 'error')

  useEffect(() => {
    session.start()
    return session.stop
  }, [session])

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [state.displayedQuery])

  useLayoutEffect(() => {
    if (actionFocused.current && !action.current) input.current?.focus({ preventScroll: true })
    const view = list.current
    if (loadMore && view && view.scrollHeight <= view.clientHeight + 1 && !actionFocused.current) {
      session.more('automatic')
    }
  }, [state, loadMore, session])

  let message = ''
  let actionLabel = ''
  if (state.phase === 'names') message = state.composing ? '' : uiAttribute('正在搜索…')
  else if (state.phase === 'invalid') message = uiAttribute('搜索内容不能超过 {0} 个字符。', NAVIGATION_SEARCH_QUERY_LIMIT)
  else if (retry) {
    message = state.phase === 'nameError' ? uiAttribute('搜索失败') : uiAttribute('消息搜索失败')
    actionLabel = uiAttribute('重试')
  } else if (state.messages === 'loading') {
    message = state.rows.some(row => row.hit)
      ? uiAttribute('正在搜索更早的消息…') : uiAttribute('正在搜索消息…')
  } else if (loadMore) actionLabel = uiAttribute('继续搜索更早的消息')
  else if (state.query) {
    if ([...state.query].length === 1) {
      message = state.rows.length
        ? uiAttribute('再输入 1 个字可搜索消息内容')
        : uiAttribute('没有匹配的对话或使命。再输入 1 个字可搜索消息内容')
    } else if (!state.rows.length) {
      message = isThreadId(state.query)
        ? uiAttribute('没有找到这个会话。') : uiAttribute('没有匹配的对话或使命。')
    } else if (state.truncated) message = uiAttribute('名称匹配较多，只列出最近活动的 50 个')
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) { session.stop(); onClose() } }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content
        className="command-palette is-search"
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (session.getSnapshot().composing || event.isComposing) event.preventDefault() }}
      >
        <Dialog.Title className="sr-only"><UiText zh="搜索" /></Dialog.Title>
        <Dialog.Description className="sr-only"><UiText zh="输入关键字或粘贴完整会话 ID。使用方向键选择结果，按回车打开。" /></Dialog.Description>
        <input
          ref={input}
          className="command-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={state.activeId ? optionId(state.activeId) : undefined}
          aria-label={uiAttribute('搜索对话、使命和消息')}
          aria-invalid={state.phase === 'invalid' || undefined}
          placeholder={uiAttribute('搜索对话、使命和消息…')}
          autoComplete="off"
          spellCheck={false}
          value={state.input}
          onFocus={() => { actionFocused.current = false }}
          onChange={event => session.input(event.currentTarget.value)}
          onCompositionStart={session.compositionStart}
          onCompositionEnd={event => session.compositionEnd(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229 || session.getSnapshot().composing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const index = session.move(event.key === 'ArrowDown' ? 1 : -1)
              if (index < 0) return
              const selected = session.getSnapshot().activeId
              if (selected) document.getElementById(optionId(selected))?.scrollIntoView({ block: 'nearest' })
              if (index >= state.rows.length - 3) session.more('navigation')
            } else if (event.key === 'Enter') {
              event.preventDefault()
              session.enter()
            }
          }}
        />
        <div ref={list} className="command-palette-list" onScroll={event => {
          if (actionFocused.current) return
          const area = event.currentTarget
          if (area.scrollHeight - area.scrollTop - area.clientHeight <= 96) session.more('navigation')
        }}>
          <div id={listId} role="listbox" aria-label={uiAttribute('搜索结果')} aria-busy={busy}>
            {state.rows.map(row => {
              const { target, hit } = row
              const title = formatThreadTitle(target.thread, firstRunThreadId)
              const active = state.activeId === target.thread.id
              const snippet = hit?.snippet ?? target.match?.snippet
              const author = hit
                ? hit.message.authorType === 'user' ? uiAttribute('你') : hit.message.authorName || hit.message.authorId
                : target.match?.field === 'description' ? uiAttribute('描述') : uiAttribute('标签')
              const project = target.thread.projectBindingKind === 'directory'
                ? projectNames.get(target.thread.projectPath) ?? projectBasename(target.thread.projectPath)
                : uiAttribute('快速对话')
              const status = statuses.find(item => item.id === target.mission?.status)?.label
              return <button
                type="button"
                tabIndex={-1}
                key={target.thread.id}
                id={optionId(target.thread.id)}
                className={'command-palette-item search-result' + (active ? ' active' : '') + (snippet ? ' has-snippet' : '')}
                role="option"
                aria-selected={active}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => session.select(target.thread.id)}
                onClick={() => session.choose(row)}
              >
                <span className="search-result-glyph">
                  {target.mission ? <><StatusIcon status={target.mission.status} /><span className="sr-only">{status}</span></>
                    : <NavigationIcon name="messages" />}
                </span>
                <span className="search-result-main">
                  <span className="search-result-line">
                    {target.mission && <small className="search-result-number">{'M-' + String(target.mission.number).padStart(3, '0')}</small>}
                    <NavigationTitle>{title}</NavigationTitle>
                    <small className="command-palette-project"><NavigationTitle>{project}</NavigationTitle></small>
                  </span>
                  {snippet && <span className="search-result-snippet-line">
                    <span className="search-result-snippet"><strong>{author}{uiAttribute('：')}</strong>{highlightSnippet(snippet, row.query)}</span>
                    {hit && <small className="search-result-time">{missionDate(hit.message.createdAt)}</small>}
                  </span>}
                </span>
              </button>
            })}
          </div>
          <div className={message || actionLabel ? 'search-status' + (retry ? ' is-error' : '') : 'sr-only'}>
            <span role="status">
              {busy && !state.composing && <i className="conversation-find-spinner" aria-hidden="true" />}
              {message}
            </span>
            {actionLabel && <button
              ref={action}
              className="search-status-action"
              type="button"
              onFocus={() => { actionFocused.current = true }}
              onBlur={event => { if (event.relatedTarget) actionFocused.current = false }}
              onClick={() => {
                input.current?.focus({ preventScroll: true })
                if (retry) session.retry()
                else session.more('action')
              }}
            >{actionLabel}</button>}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
