import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationMessageSearchPage, NavigationSearchResult, NavigationSearchTarget } from '@contracts'
import { createNavigationSearchSession, navigationSearchHints } from './camp-navigation-search'
import { changeInterfaceLanguage } from './interface-language'
import { languageTestApi } from './interface-language-test-api'

const threadId = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'

function target(id: string): NavigationSearchTarget {
  return {
    kind: 'thread', mission: null, lastActivityAt: '', match: null,
    thread: { id, title: id, activationState: 'active', projectBindingKind: 'directory', projectPath: '/repo' }
  }
}

function names(query: string, ...ids: string[]): NavigationSearchResult {
  return { schemaVersion: 1, throughGlobalSequence: 1, query, items: ids.map(target), truncated: false }
}

function page(query: string, nextCursor: string | null, ...ids: string[]): NavigationMessageSearchPage {
  return {
    schemaVersion: 1, throughGlobalSequence: 1, query, nextCursor,
    items: ids.map(id => ({
      target: target(id), snippet: query,
      message: { id: 'message-' + id, authorId: 'user', authorType: 'user', authorName: '', createdAt: '', sequence: 1 }
    }))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

function session() {
  const readNames = vi.fn(async ({ query }: { query: string }) => names(query))
  const readMessages = vi.fn(async ({ query }: { query: string; cursor?: string | null }) => page(query, null))
  const choose = vi.fn()
  const owner = createNavigationSearchSession({ names: readNames, messages: readMessages, choose, hints: () => undefined })
  owner.start()
  return { owner, readNames, readMessages, choose }
}

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

afterEach(() => vi.useRealTimers())

describe('window navigation search', () => {
  it('uses recent mode, keeps complete IDs and one character on the name path, and rejects oversized input', async () => {
    vi.useFakeTimers()
    const { owner, readNames, readMessages } = session()
    await settle()
    expect(readNames).toHaveBeenLastCalledWith({ query: '', hints: undefined })
    for (const query of ['部', threadId]) {
      owner.input('  ' + query + '  ')
      await settle(200)
      expect(readNames).toHaveBeenLastCalledWith({ query, hints: undefined })
      expect(readMessages).not.toHaveBeenCalled()
    }
    owner.input(threadId.slice(0, -1))
    await settle(200)
    expect(readMessages).toHaveBeenLastCalledWith({ query: threadId.slice(0, -1), cursor: null })
    owner.input('中'.repeat(201))
    await settle(200)
    expect(owner.getSnapshot().phase).toBe('invalid')
    expect(readMessages).toHaveBeenCalledTimes(1)
    owner.stop()
  })

  it('carries localized project, channel and first-run aliases only as name hints', async () => {
    const projects = new Map([['/repo', 'Rovai']])
    expect(navigationSearchHints('ROVAI', projects, threadId)?.groupKeys).toEqual(['directory:/repo'])
    expect(navigationSearchHints('lArK话题', projects, threadId)?.channelKinds).toEqual(['lark:topic'])
    expect(navigationSearchHints('快速对话', projects, threadId)?.groupKeys).toEqual(['quick-chat'])
    await changeInterfaceLanguage(languageTestApi, 'en')
    try {
      expect(navigationSearchHints('FIRST CHAT', projects, threadId)?.threadIds).toEqual([threadId])
      expect(navigationSearchHints(threadId, projects, threadId)).toBeUndefined()
      expect(navigationSearchHints('', projects, threadId)).toBeUndefined()
    } finally {
      await changeInterfaceLanguage(languageTestApi, 'zh-CN')
    }
  })

  it('keeps message snippets attached to their originating query while showing previous results', async () => {
    vi.useFakeTimers()
    const { owner, choose, readMessages } = session()
    readMessages.mockResolvedValueOnce(page('部署', null, 'matched'))
    owner.input('部署')
    await settle(200)
    owner.input('灰度')
    const [old] = owner.getSnapshot().rows
    owner.choose(old)
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ query: '部署', hit: expect.anything() }))
    await settle(200)
    expect(readMessages).toHaveBeenCalledTimes(1)
  })

  it('waits through empty names for Enter, then cancels the next pending input on IME start', async () => {
    vi.useFakeTimers()
    const { owner, choose, readNames, readMessages } = session()
    const body = deferred<NavigationMessageSearchPage>()
    readMessages.mockReturnValueOnce(body.promise)
    owner.input('签名')
    owner.enter()
    await settle(200)
    expect(choose).not.toHaveBeenCalled()
    body.resolve(page('签名', null, 'matched'))
    await settle()
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ query: '签名' }))

    owner.start()
    owner.input('灰度')
    owner.enter()
    owner.compositionStart()
    owner.input('灰度候选')
    await settle(300)
    expect(readNames).not.toHaveBeenCalledWith(expect.objectContaining({ query: '灰度' }))
    owner.compositionEnd('灰度新词')
    await settle(200)
    expect(readNames).toHaveBeenLastCalledWith(expect.objectContaining({ query: '灰度新词' }))
    expect(choose).toHaveBeenCalledTimes(1)
    owner.stop()
  })

  it('waits across dialog reopen and discards intermediate queued versions', async () => {
    vi.useFakeTimers()
    const first = session()
    const old = deferred<NavigationMessageSearchPage>()
    first.readMessages.mockReturnValueOnce(old.promise)
    first.owner.input('第一次')
    await settle(200)
    first.owner.stop()

    const second = session()
    second.owner.input('中间词')
    await settle(200)
    second.owner.input('最终词')
    await settle(200)
    expect(second.readMessages).not.toHaveBeenCalled()
    old.resolve(page('第一次', null))
    await settle()
    expect(second.readMessages.mock.calls).toEqual([[{ query: '最终词', cursor: null }]])
    second.owner.stop()
  })

  it('cancels pending Enter when arrows select another row while names are pending', async () => {
    vi.useFakeTimers()
    const { owner, choose, readNames } = session()
    readNames.mockResolvedValueOnce(names('旧关键词', 'old-first', 'old-second'))
    owner.input('旧关键词')
    await settle(200)

    const newer = deferred<NavigationSearchResult>()
    readNames.mockReturnValueOnce(newer.promise)
    owner.input('新关键词')
    owner.enter()
    await settle(200)
    expect(owner.move(1)).toBe(1)
    expect(owner.getSnapshot().activeId).toBe('old-second')
    newer.resolve(names('新关键词', 'new-first'))
    await settle()
    expect(owner.getSnapshot().activeId).toBe('new-first')
    expect(choose).not.toHaveBeenCalled()
    owner.enter()
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ query: '新关键词' }))
  })

  it('exhausts the current query with no rows and no navigation when Enter is pending', async () => {
    vi.useFakeTimers()
    const { owner, choose, readMessages } = session()
    const firstPage = deferred<NavigationMessageSearchPage>()
    readMessages.mockReturnValueOnce(firstPage.promise).mockResolvedValueOnce(page('零结果', null))
    owner.input('零结果')
    owner.enter()
    await settle(200)
    expect(owner.getSnapshot().messages).toBe('loading')
    firstPage.resolve(page('零结果', 'older'))
    await settle()
    expect(owner.getSnapshot().messages).toBe('more')
    owner.more('automatic')
    expect(owner.getSnapshot().messages).toBe('loadingEarlier')
    await settle()

    expect(owner.getSnapshot()).toMatchObject({ query: '零结果', messages: 'done', rows: [], activeId: null })
    owner.enter()
    owner.more('automatic')
    expect(readMessages).toHaveBeenCalledTimes(2)
    expect(choose).not.toHaveBeenCalled()
    owner.stop()
  })

  it('retains the previous query rows when the new name request fails', async () => {
    vi.useFakeTimers()
    const { owner, choose, readNames, readMessages } = session()
    readMessages.mockResolvedValueOnce(page('部署', null, 'old-hit'))
      .mockResolvedValueOnce(page('灰度', null, 'new-hit'))
    owner.input('部署')
    await settle(200)
    const previous = owner.getSnapshot().rows
    readNames.mockRejectedValueOnce(new Error('read failed'))
    owner.input('灰度')
    owner.enter()
    await settle(200)

    expect(owner.getSnapshot()).toMatchObject({ phase: 'nameError', query: '灰度', displayedQuery: '部署' })
    expect(owner.getSnapshot().rows).toBe(previous)
    expect(choose).not.toHaveBeenCalled()
    owner.choose(previous[0])
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({
      query: '部署',
      hit: expect.objectContaining({ message: expect.objectContaining({ id: 'message-old-hit' }) })
    }))
  })

  it('appends only new threads, retains selection, and exposes full continuation after five automatic pages', async () => {
    vi.useFakeTimers()
    const { owner, choose, readNames, readMessages } = session()
    readNames.mockImplementation(async ({ query }) => names(query, 'visible-name'))
    readMessages.mockImplementation(async ({ query, cursor }) => {
      const next = Number(cursor ?? 0) + 1
      return next <= 6 ? page(query, String(next), 'visible-name') : page(query, null, 'oldest')
    })
    owner.input('关键字')
    await settle(200)
    for (let i = 0; i < 5; i++) {
      owner.more('automatic')
      await settle()
    }
    owner.more('automatic')
    owner.more('navigation')
    await settle()
    expect(readMessages).toHaveBeenCalledTimes(6)
    expect(owner.getSnapshot().messages).toBe('paused')
    expect(owner.getSnapshot().rows.map(row => row.target.thread.id)).toEqual(['visible-name'])
    owner.more('action')
    await settle()
    expect(owner.getSnapshot().activeId).toBe('visible-name')
    expect(owner.getSnapshot().rows.map(row => row.target.thread.id)).toEqual(['visible-name', 'oldest'])
    expect(choose).not.toHaveBeenCalled()
    owner.stop()
  })

  it('cancels pending Enter when five empty automatic pages pause the scan', async () => {
    vi.useFakeTimers()
    const { owner, choose, readMessages } = session()
    readMessages.mockImplementation(async ({ query, cursor }) => {
      const next = Number(cursor ?? 0) + 1
      return next <= 6 ? page(query, String(next)) : page(query, null, 'oldest')
    })
    owner.input('早期命中')
    owner.enter()
    await settle(200)
    for (let i = 0; i < 5; i++) {
      owner.more('automatic')
      await settle()
    }
    expect(owner.getSnapshot()).toMatchObject({ messages: 'paused', rows: [] })
    expect(choose).not.toHaveBeenCalled()
    owner.more('action')
    await settle()
    expect(owner.getSnapshot()).toMatchObject({ messages: 'done', activeId: 'oldest' })
    expect(choose).not.toHaveBeenCalled()
    owner.enter()
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ query: '早期命中' }))
  })

  it('retries a failed page with the same cursor and treats a repeated cursor as a recoverable read error', async () => {
    vi.useFakeTimers()
    const { owner, readMessages } = session()
    readMessages.mockResolvedValueOnce(page('关键字', 'next', 'first'))
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(page('关键字', 'next', 'first'))
      .mockResolvedValueOnce(page('关键字', null, 'second'))
    owner.input('关键字')
    await settle(200)
    owner.more('navigation')
    await settle()
    expect(owner.getSnapshot().messages).toBe('error')
    owner.retry()
    await settle()
    expect(owner.getSnapshot().messages).toBe('error')
    owner.retry()
    await settle()
    expect(readMessages).toHaveBeenLastCalledWith({ query: '关键字', cursor: 'next' })
    expect(owner.getSnapshot().rows.map(row => row.target.thread.id)).toEqual(['first', 'second'])
    owner.stop()
  })
})
