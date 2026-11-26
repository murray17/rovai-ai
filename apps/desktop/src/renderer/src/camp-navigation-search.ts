import {
  isThreadId, type NavigationMessageHit, type NavigationMessageSearchPage, type NavigationMessageSearchRequest,
  type NavigationSearchHints, type NavigationSearchRequest, type NavigationSearchResult, type NavigationSearchTarget
} from '@contracts'
import { FIRST_RUN_CAMP_TITLE, threadChannelNameMatches } from './camp-title'
import { conversationFindRanges } from './camp-conversation-find'
import { getInterfaceLanguage, uiAttribute } from './interface-language'

const AUTO_PAGE_LIMIT = 5
export const NAVIGATION_SEARCH_QUERY_LIMIT = 200

export interface NavigationFindIntent {
  threadId: string
  query: string
  anchorMessageId: string
}

export type NavigationSearchRow = { chat: import('@contracts').NavigationChatSearchItem; query: string; target?: never; hit?: never } | {
  chat?: never
  target: NavigationSearchTarget
  query: string
  hit?: NavigationMessageHit
}

export const searchRowId = (row: NavigationSearchRow) => row.chat ? row.chat.chatId : row.target.thread.id

interface SearchState {
  input: string
  query: string
  displayedQuery: string
  rows: readonly NavigationSearchRow[]
  activeId: string | null
  phase: 'names' | 'results' | 'nameError' | 'invalid'
  messages: 'off' | 'loading' | 'loadingEarlier' | 'more' | 'paused' | 'done' | 'error'
  truncated: boolean
  composing: boolean
}

interface SearchDependencies {
  names(request: NavigationSearchRequest): Promise<NavigationSearchResult>
  messages(request: NavigationMessageSearchRequest): Promise<NavigationMessageSearchPage>
  hints(query: string): NavigationSearchHints | undefined
  choose(row: NavigationSearchRow): void
}

function contains(label: string, query: string): boolean {
  return conversationFindRanges(label, query).length > 0
}

export function navigationSearchHints(
  query: string, projects: ReadonlyMap<string, string>, firstRunThreadId: string | null
): NavigationSearchHints | undefined {
  if (!query || isThreadId(query)) return undefined
  const channelKinds = threadChannelNameMatches(query, contains)
  const threadIds = firstRunThreadId && getInterfaceLanguage() === 'en'
    && contains(uiAttribute(FIRST_RUN_CAMP_TITLE), query) ? [firstRunThreadId] : []
  const quickChat = contains(uiAttribute('快速对话'), query) ? ['quick-chat'] : []
  const groupKeys = [...quickChat, ...Array.from(projects).flatMap(([path, label]) =>
    contains(label, query) ? [`directory:${path}`] : [])].slice(0, 200 - channelKinds.length - threadIds.length)
  return { groupKeys, channelKinds, threadIds }
}

// A Renderer module belongs to a window/tab. Disposing a dialog only invalidates
// its queued work; an already submitted message page retains this slot.
let messageFlight: Promise<void> = Promise.resolve()

function windowMessagePage(
  stillCurrent: () => boolean,
  fetch: () => Promise<NavigationMessageSearchPage>
) {
  const request = messageFlight.then(() => stillCurrent() ? fetch() : null)
  messageFlight = request.then(() => undefined, () => undefined)
  return request.then(page => ({ page, error: null }), (error: unknown) => ({ page: null, error }))
}

export function createNavigationSearchSession(dependencies: SearchDependencies) {
  const listeners = new Set<() => void>()
  let state: SearchState = {
    input: '', query: '', displayedQuery: '', rows: [], activeId: null,
    phase: 'names', messages: 'off', truncated: false, composing: false
  }
  let version = 0
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingEnter = false
  let cursor: string | null = null
  let automaticPages = 0

  function update(patch: Partial<SearchState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function invalidate(): number {
    clearTimeout(timer)
    pendingEnter = false
    return ++version
  }

  const current = (generation: number) => active && generation === version

  function choose(row: NavigationSearchRow): void {
    if (!active) return
    stop()
    dependencies.choose(row)
  }

  function resolveEnter(): void {
    if (!pendingEnter || state.phase !== 'results') return
    const first = state.rows[0]
    if (first) choose(first)
    else if (state.messages === 'done' || state.messages === 'off'
      || state.messages === 'error' || state.messages === 'paused') pendingEnter = false
  }

  function messagePage(generation: number, query: string, after: string | null) {
    return windowMessagePage(() => current(generation), () => dependencies.messages({ query, cursor: after }))
  }

  async function applyMessagePage(generation: number, after: string | null, request: ReturnType<typeof messagePage>): Promise<void> {
    const { page, error } = await request
    if (!current(generation)) return
    if (after && (error as { code?: string } | null)?.code === 'navigation.invalid_search_cursor') {
      search(state.input)
      return
    }
    if (!page || page.schemaVersion !== 1 || page.query !== state.query || (after && page.nextCursor === after)) {
      update({ messages: 'error' })
      resolveEnter()
      return
    }
    const seen = new Set(state.rows.map(row => searchRowId(row)))
    const added: NavigationSearchRow[] = []
    for (const hit of page.items) {
      const id = hit.target.thread.id
      if (seen.has(id)) continue
      seen.add(id)
      added.push({ target: hit.target, query: page.query, hit })
    }
    cursor = page.nextCursor
    update({
      rows: [...state.rows, ...added],
      activeId: state.activeId ?? (added[0] ? searchRowId(added[0]) : null),
      messages: !cursor ? 'done' : automaticPages >= AUTO_PAGE_LIMIT ? 'paused' : 'more'
    })
    resolveEnter()
  }

  async function run(generation: number, query: string): Promise<void> {
    if (!current(generation)) return
    const messages = [...query].length >= 2 && !isThreadId(query) ? messagePage(generation, query, null) : null
    let result: NavigationSearchResult
    try {
      result = await dependencies.names({ query, hints: dependencies.hints(query) })
      if (result.schemaVersion !== 1 || result.query !== query) throw new Error('Invalid navigation search response')
    } catch {
      if (current(generation)) {
        pendingEnter = false
        update({ phase: 'nameError' })
      }
      return
    }
    if (!current(generation)) return
    const rows: NavigationSearchRow[] = [...result.items.map(target => ({ target, query })), ...(result.chats ?? []).map(chat => ({ chat, query }))]
    update({
      phase: 'results', displayedQuery: query, rows,
      activeId: rows.length ? searchRowId(rows[0]) : null, truncated: result.truncated,
      messages: messages ? 'loading' : 'off'
    })
    resolveEnter()
    if (messages && current(generation)) await applyMessagePage(generation, null, messages)
  }

  function search(input: string): void {
    const generation = invalidate()
    const query = input.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    const valid = [...query].length <= NAVIGATION_SEARCH_QUERY_LIMIT
    cursor = null
    automaticPages = 0
    update({ input, query, composing: false, phase: valid ? 'names' : 'invalid' })
    if (!valid) return
    if (query) timer = setTimeout(() => void run(generation, query), 200)
    else void run(generation, query)
  }

  function stop(): void {
    active = false
    invalidate()
  }

  function more(source: 'automatic' | 'navigation' | 'action'): void {
    if (state.composing || state.phase !== 'results') return
    if (source === 'action') {
      if (state.messages !== 'paused' && state.messages !== 'error') return
    } else if (state.messages !== 'more') return
    if (source === 'automatic') {
      automaticPages++
    } else {
      automaticPages = 0
    }
    const generation = version
    const after = cursor
    update({ messages: after === null ? 'loading' : 'loadingEarlier' })
    void applyMessagePage(generation, after, messagePage(generation, state.query, after))
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => state,
    start() {
      active = true
      search('')
    },
    stop,
    input(value: string) {
      if (value === state.input) return
      if (state.composing) update({ input: value })
      else search(value)
    },
    compositionStart() {
      invalidate()
      update({ composing: true, phase: 'names' })
    },
    compositionEnd(value: string) { search(value) },
    choose,
    more,
    retry() {
      if (state.phase === 'nameError') search(state.input)
      else more('action')
    },
    select(id: string) {
      if (state.activeId !== id) update({ activeId: id })
    },
    move(direction: -1 | 1): number {
      pendingEnter = false
      if (!state.rows.length) return -1
      const index = state.rows.findIndex(row => searchRowId(row) === state.activeId)
      const next = Math.max(0, Math.min(state.rows.length - 1, index + direction))
      update({ activeId: searchRowId(state.rows[next]) })
      return next
    },
    enter(): void {
      if (state.phase === 'results' && state.rows.length) {
        const selected = state.rows.find(row => searchRowId(row) === state.activeId) ?? state.rows[0]
        choose(selected)
      } else if (state.phase === 'names' || (state.phase === 'results'
        && (state.messages === 'loading' || state.messages === 'loadingEarlier' || state.messages === 'more'))) {
        pendingEnter = true
      }
    }
  }
}
