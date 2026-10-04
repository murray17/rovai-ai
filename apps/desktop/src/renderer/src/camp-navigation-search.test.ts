import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationThreadTarget } from '@contracts'
import { navigationThreadSearch, startNavigationThreadLookup } from './camp-navigation-search'
import { changeInterfaceLanguage } from './interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'
import type { GeneralPreferencesApi } from '@contracts'

const threadId = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'
const target: NavigationThreadTarget = {
  id: threadId,
  title: 'Earlier conversation',
  activationState: 'active',
  projectBindingKind: 'directory',
  projectPath: '/repo'
}
const projects = new Map([['/repo', 'Rovai']])

afterEach(() => vi.useRealTimers())

describe('navigation search routing', () => {
  it('routes only canonical complete IDs to exact lookup before inspecting titles', () => {
    const title = vi.fn(() => threadId)
    const decoy = { ...target, get title() { return title() } }
    expect(navigationThreadSearch(` \n${threadId}  `, [decoy], projects)).toEqual({ kind: 'id', threadId })
    expect(title).not.toHaveBeenCalled()
    for (const query of [
      threadId.slice(0, -1), threadId.toUpperCase(), `${threadId} extra`,
      'rvcamp_01h47kvsy5fk1hhh6w1g60eecf',
      'rvcamp_01h47kvsy5fk11hh6w1g60eecf',
      '01890f3d-e7c5-7cc3-98c4-dc0c0c07398f'
    ]) {
      expect(navigationThreadSearch(query, [], projects).kind).toBe('text')
    }
  })

  it('preserves case-insensitive title/project search and the twelve-result limit', () => {
    for (const query of ['EARLIER', '  roVAI  ']) {
      expect(navigationThreadSearch(query, [target], projects)).toEqual({ kind: 'text', threads: [target] })
    }
    expect(navigationThreadSearch('unmatched', [target], projects)).toEqual({ kind: 'text', threads: [] })
    const quickChat = { ...target, projectBindingKind: 'quick_chat' as const }
    expect(navigationThreadSearch('快速对话', [quickChat], projects)).toEqual({ kind: 'text', threads: [quickChat] })
    const channelThread = { ...target, channelSource: { provider: 'feishu' as const, conversationKind: 'group' as const } }
    expect(navigationThreadSearch('飞书群聊', [channelThread], projects)).toEqual({ kind: 'text', threads: [channelThread] })
    const larkThread = { ...target, channelSource: { provider: 'lark' as const, conversationKind: 'topic' as const } }
    expect(navigationThreadSearch('lArK话题', [channelThread, larkThread], projects)).toEqual({ kind: 'text', threads: [larkThread] })
    const threads = Array.from({ length: 13 }, (_, index) => ({ ...target, id: String(index) }))
    expect(navigationThreadSearch('  ', threads, projects)).toEqual({ kind: 'text', threads: threads.slice(0, 12) })
  })

  it('finds the first-run Thread by its displayed or saved title and returns original data', async () => {
    const languageApi = {
      setInterfaceLanguage: async (interfaceLanguage: 'zh-CN' | 'en') =>
        ({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage })
    } as GeneralPreferencesApi
    const firstRunThread = { ...target, title: '初次集结' }
    const userThread = { ...firstRunThread, id: 'camp-user' }
    await changeInterfaceLanguage(languageApi, 'en')
    try {
      const result = navigationThreadSearch('FIRST CHAT', [firstRunThread, userThread], projects, threadId)
      expect(result).toEqual({ kind: 'text', threads: [firstRunThread] })
      if (result.kind !== 'text') throw new Error('Expected title search')
      expect(result.threads[0]).toBe(firstRunThread)
      expect(result.threads[0].title).toBe('初次集结')
      expect(navigationThreadSearch('初次集结', [firstRunThread, userThread], projects, threadId))
        .toEqual({ kind: 'text', threads: [firstRunThread, userThread] })
      expect(navigationThreadSearch(threadId, [], projects, threadId)).toEqual({ kind: 'id', threadId })
      firstRunThread.title = '我的新会话'
      expect(navigationThreadSearch('First Chat', [firstRunThread], projects, threadId))
        .toEqual({ kind: 'text', threads: [] })
    } finally {
      await changeInterfaceLanguage(languageApi, 'zh-CN')
    }
  })
})

describe('navigation exact lookup', () => {
  it('makes one debounced request and returns a Thread absent from the loaded list', async () => {
    vi.useFakeTimers()
    const find = vi.fn().mockResolvedValue(target)
    const publish = vi.fn()
    const search = navigationThreadSearch(threadId, [], projects)
    if (search.kind !== 'id') throw new Error('Expected ID lookup')
    const cancel = startNavigationThreadLookup(search.threadId, publish, find)
    expect(find).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(find).toHaveBeenCalledExactlyOnceWith(threadId)
    expect(publish).toHaveBeenCalledExactlyOnceWith({ threadId, thread: target, error: null })
    cancel()
  })

  it('cancels superseded input and ignores in-flight results after query change or close', async () => {
    vi.useFakeTimers()
    let resolve!: (value: NavigationThreadTarget) => void
    const find = vi.fn(() => new Promise<NavigationThreadTarget>((done) => { resolve = done }))
    const publish = vi.fn()
    startNavigationThreadLookup(threadId, publish, find)()
    await vi.advanceTimersByTimeAsync(150)
    expect(find).not.toHaveBeenCalled()
    const cancel = startNavigationThreadLookup(threadId, publish, find)
    await vi.advanceTimersByTimeAsync(150)
    cancel()
    resolve(target)
    await Promise.resolve()
    expect(publish).not.toHaveBeenCalled()
  })

  it('distinguishes a missing ID from a failed lookup without falling back to title search', async () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    startNavigationThreadLookup(threadId, publish, vi.fn().mockResolvedValue(null))
    await vi.advanceTimersByTimeAsync(150)
    expect(publish).toHaveBeenLastCalledWith({ threadId, thread: null, error: null })
    startNavigationThreadLookup(threadId, publish, vi.fn().mockRejectedValue(new Error('offline')))
    await vi.advanceTimersByTimeAsync(150)
    expect(publish).toHaveBeenLastCalledWith({ threadId, thread: null, error: '暂时无法查询会话，请重试。' })
  })
})
