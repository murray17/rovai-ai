import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationCampTarget } from '@contracts'
import { navigationCampSearch, startNavigationCampLookup } from './camp-navigation-search'

const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'
const target: NavigationCampTarget = {
  id: campId,
  title: 'Earlier conversation',
  activationState: 'active',
  projectBindingKind: 'directory',
  projectPath: '/repo'
}
const projects = new Map([['/repo', 'Rovai']])

afterEach(() => vi.useRealTimers())

describe('navigation search routing', () => {
  it('routes only canonical complete IDs to exact lookup before inspecting titles', () => {
    const title = vi.fn(() => campId)
    const decoy = { ...target, get title() { return title() } }
    expect(navigationCampSearch(` \n${campId}  `, [decoy], projects)).toEqual({ kind: 'id', campId })
    expect(title).not.toHaveBeenCalled()
    for (const query of [
      campId.slice(0, -1), campId.toUpperCase(), `${campId} extra`,
      'rvcamp_01h47kvsy5fk1hhh6w1g60eecf',
      'rvcamp_01h47kvsy5fk11hh6w1g60eecf',
      '01890f3d-e7c5-7cc3-98c4-dc0c0c07398f'
    ]) {
      expect(navigationCampSearch(query, [], projects).kind).toBe('text')
    }
  })

  it('preserves case-insensitive title/project search and the twelve-result limit', () => {
    for (const query of ['EARLIER', '  roVAI  ']) {
      expect(navigationCampSearch(query, [target], projects)).toEqual({ kind: 'text', camps: [target] })
    }
    expect(navigationCampSearch('unmatched', [target], projects)).toEqual({ kind: 'text', camps: [] })
    const quickChat = { ...target, projectBindingKind: 'quick_chat' as const }
    expect(navigationCampSearch('快速对话', [quickChat], projects)).toEqual({ kind: 'text', camps: [quickChat] })
    const channelCamp = { ...target, channelSource: { provider: 'feishu' as const, conversationKind: 'group' as const } }
    expect(navigationCampSearch('飞书群聊', [channelCamp], projects)).toEqual({ kind: 'text', camps: [channelCamp] })
    const larkCamp = { ...target, channelSource: { provider: 'lark' as const, conversationKind: 'topic' as const } }
    expect(navigationCampSearch('lArK话题', [channelCamp, larkCamp], projects)).toEqual({ kind: 'text', camps: [larkCamp] })
    const camps = Array.from({ length: 13 }, (_, index) => ({ ...target, id: String(index) }))
    expect(navigationCampSearch('  ', camps, projects)).toEqual({ kind: 'text', camps: camps.slice(0, 12) })
  })
})

describe('navigation exact lookup', () => {
  it('makes one debounced request and returns a Camp absent from the loaded list', async () => {
    vi.useFakeTimers()
    const find = vi.fn().mockResolvedValue(target)
    const publish = vi.fn()
    const search = navigationCampSearch(campId, [], projects)
    if (search.kind !== 'id') throw new Error('Expected ID lookup')
    const cancel = startNavigationCampLookup(search.campId, publish, find)
    expect(find).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(find).toHaveBeenCalledExactlyOnceWith(campId)
    expect(publish).toHaveBeenCalledExactlyOnceWith({ campId, camp: target, error: null })
    cancel()
  })

  it('cancels superseded input and ignores in-flight results after query change or close', async () => {
    vi.useFakeTimers()
    let resolve!: (value: NavigationCampTarget) => void
    const find = vi.fn(() => new Promise<NavigationCampTarget>((done) => { resolve = done }))
    const publish = vi.fn()
    startNavigationCampLookup(campId, publish, find)()
    await vi.advanceTimersByTimeAsync(150)
    expect(find).not.toHaveBeenCalled()
    const cancel = startNavigationCampLookup(campId, publish, find)
    await vi.advanceTimersByTimeAsync(150)
    cancel()
    resolve(target)
    await Promise.resolve()
    expect(publish).not.toHaveBeenCalled()
  })

  it('distinguishes a missing ID from a failed lookup without falling back to title search', async () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    startNavigationCampLookup(campId, publish, vi.fn().mockResolvedValue(null))
    await vi.advanceTimersByTimeAsync(150)
    expect(publish).toHaveBeenLastCalledWith({ campId, camp: null, error: null })
    startNavigationCampLookup(campId, publish, vi.fn().mockRejectedValue(new Error('offline')))
    await vi.advanceTimersByTimeAsync(150)
    expect(publish).toHaveBeenLastCalledWith({ campId, camp: null, error: '暂时无法查询会话，请重试。' })
  })
})
