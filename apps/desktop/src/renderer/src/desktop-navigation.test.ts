import { describe, expect, it } from 'vitest'
import { createDesktopNavigation, type NavigationTarget, type NavigationTransaction } from './desktop-navigation'

const thread = (threadId: string): NavigationTarget => ({ kind: 'camp', threadId })
const create = () => createDesktopNavigation(async (_target, transaction) => { transaction.commit() })

describe('window navigation history', () => {
  it('keeps one initial page and only ignores the current destination', async () => {
    const navigation = create()
    navigation.reset(thread('A'))
    await navigation.push(thread('A'))
    await navigation.push(thread('B'))
    await navigation.push(thread('A'))
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), thread('B'), thread('A')], index: 2 })
    await navigation.back()
    await navigation.back()
    await navigation.back()
    expect(navigation.getSnapshot().index).toBe(0)
    await navigation.forward()
    expect(navigation.getSnapshot().entries).toHaveLength(3)
  })

  it('trims the forward branch before imposing the 50-entry cap, including the current page', async () => {
    const navigation = create()
    navigation.reset(thread('0'))
    for (let id = 1; id <= 60; id++) await navigation.push(thread(String(id)))
    expect(navigation.getSnapshot()).toMatchObject({ index: 49 })
    expect(navigation.getSnapshot().entries).toHaveLength(50)
    expect(navigation.getSnapshot().entries[0]).toEqual(thread('11'))
    for (let i = 0; i < 10; i++) await navigation.back()
    await navigation.push(thread('branch'))
    expect(navigation.getSnapshot().entries).toHaveLength(41)
    expect(navigation.getSnapshot().index).toBe(40)
    expect(navigation.getSnapshot().entries[0]).toEqual(thread('11'))
    expect(await navigation.forward()).toBe(false)
  })

  it('replaces a pending ID or filter without consuming a step or losing the forward branch', async () => {
    const navigation = create()
    navigation.reset(thread('pending'))
    await navigation.replace(thread('official'))
    await navigation.push({ kind: 'memory', memoryId: 'M' })
    await navigation.replace({ kind: 'memory', memoryId: 'M', search: 'query' })
    await navigation.push({ kind: 'settings', section: 'runtime' })
    await navigation.back()
    await navigation.replace({ kind: 'memory', memoryId: 'M', search: 'other' })
    expect(navigation.getSnapshot().entries).toEqual([
      thread('official'), { kind: 'memory', memoryId: 'M', search: 'other' }, { kind: 'settings', section: 'runtime' }
    ])
    await navigation.forward()
    expect(navigation.getSnapshot().index).toBe(2)
  })

  it('shares history across settings sections, memory details and Thread resources', async () => {
    const navigation = create()
    const targets: NavigationTarget[] = [thread('A'), thread('B'), { kind: 'settings', section: 'runtime' },
      { kind: 'settings', section: 'general' }, { kind: 'memory', memoryId: null }, { kind: 'memory', memoryId: 'M' }]
    navigation.reset(targets[0])
    for (const target of targets.slice(1)) await navigation.push(target)
    for (const target of targets.slice(0, -1).reverse()) {
      await navigation.back()
      const state = navigation.getSnapshot()
      expect(state.entries[state.index]).toEqual(target)
    }
  })

  it('applies all rapid cursor moves to the latest intent and rejects stale completions', async () => {
    let delayed = false
    const pending: Array<{ transaction: NavigationTransaction; finish(): void }> = []
    const navigation = createDesktopNavigation(async (_target, transaction) => {
      if (delayed) await new Promise<void>(finish => pending.push({ transaction, finish }))
      transaction.commit()
    })
    navigation.reset(thread('A'))
    await navigation.push(thread('B'))
    await navigation.push(thread('C'))
    await navigation.push(thread('D'))
    delayed = true
    const back1 = navigation.back(), back2 = navigation.back(), back3 = navigation.back()
    expect(navigation.getSnapshot().index).toBe(3) // The guarded page is still D.
    pending[2].finish()
    expect(await back3).toBe(true)
    expect(navigation.getSnapshot().index).toBe(0)
    pending[0].finish(); pending[1].finish()
    expect(await back1).toBe(false); expect(await back2).toBe(false)
    expect(navigation.getSnapshot().index).toBe(0)
  })

  it('retains the page, cursor and forward branch when a leave guard refuses', async () => {
    let allow = true
    const navigation = createDesktopNavigation(async (_target, transaction) => { if (allow) transaction.commit() })
    navigation.reset(thread('A')); await navigation.push(thread('B')); await navigation.push(thread('C')); await navigation.back()
    const before = navigation.getSnapshot()
    allow = false
    expect(await navigation.push(thread('D'))).toBe(false)
    expect(navigation.getSnapshot()).toBe(before)
    allow = true
    await navigation.forward()
    expect(navigation.getSnapshot().entries[2]).toEqual(thread('C'))
  })

  it('releases obsolete guarded waiting as soon as a newer selection takes over', async () => {
    let finishedWaiting = false
    const navigation = createDesktopNavigation(async (target, transaction) => {
      if (target.kind === 'camp' && target.threadId === 'B') {
        await transaction.superseded
        finishedWaiting = true
      }
      transaction.commit()
    })
    navigation.reset(thread('A'))
    const pending = navigation.push(thread('B'))
    await navigation.push(thread('A'))
    expect(await pending).toBe(false)
    expect(finishedWaiting).toBe(true)
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A')], index: 0 })
  })

  it('omits superseded destinations that never rendered and cancels a pending departure to the displayed page', async () => {
    const pending: Array<() => void> = []
    const navigation = createDesktopNavigation(async (_target, transaction) => {
      await new Promise<void>(resolve => pending.push(resolve))
      transaction.commit()
    })
    navigation.reset(thread('A'))
    const first = navigation.push(thread('B'))
    const second = navigation.push(thread('C'))
    pending[1](); await second
    pending[0](); await first
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), thread('C')], index: 1 })
    const departure = navigation.push(thread('D'))
    const cancel = navigation.push(thread('C'))
    pending[3](); await cancel
    pending[2](); await departure
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), thread('C')], index: 1 })
  })

  it('replaces a deleted historical resource with a valid fallback', async () => {
    let deleted = false
    const navigation = createDesktopNavigation(async (target, transaction) => {
      transaction.commit(deleted && target.kind === 'camp' && target.threadId === 'A' ? { kind: 'quick_chat' } : target)
    })
    navigation.reset(thread('A')); await navigation.push(thread('B')); deleted = true
    await navigation.back()
    expect(navigation.getSnapshot()).toEqual({ entries: [{ kind: 'quick_chat' }, thread('B')], index: 0 })
  })

  it('isolates windows and resets outstanding requests when the session is replaced', async () => {
    let release!: () => void
    const first = createDesktopNavigation(async (_target, transaction) => {
      await new Promise<void>(resolve => { release = resolve }); transaction.commit()
    })
    const second = create()
    first.reset(thread('A')); second.reset(thread('B'))
    const pending = first.push(thread('C'))
    first.reset({ kind: 'quick_chat' }); release(); await pending
    expect(first.getSnapshot()).toEqual({ entries: [{ kind: 'quick_chat' }], index: 0 })
    expect(second.getSnapshot()).toEqual({ entries: [thread('B')], index: 0 })
  })
})

describe('uncommitted destinations and entry-owned corrections', () => {
  it('backs through displayed entries while an unseen push is loading', async () => {
    let release!: () => void
    const navigation = createDesktopNavigation(async (target, transaction) => {
      if (target.kind === 'camp' && target.threadId === 'C') await new Promise<void>(resolve => { release = resolve })
      transaction.commit()
    })
    navigation.reset(thread('A')); await navigation.push(thread('B'))
    const pending = navigation.push(thread('C'))
    await navigation.back(); release(); await pending
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), thread('B')], index: 0 })
  })

  it('retains the committed forward branch while cancelling an unfinished push', async () => {
    let release!: () => void
    const navigation = createDesktopNavigation(async (target, transaction) => {
      if (target.kind === 'camp' && target.threadId === 'C') await new Promise<void>(resolve => { release = resolve })
      transaction.commit()
    })
    navigation.reset(thread('A')); await navigation.push(thread('B')); await navigation.back()
    const pending = navigation.push(thread('C'))
    await navigation.forward(); release(); await pending
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), thread('B')], index: 1 })
  })

  it('repairs the displayed entry without superseding a newer push or losing the repair at commit', async () => {
    let release!: () => void
    const navigation = createDesktopNavigation(async (target, transaction) => {
      if (target.kind === 'camp' && target.threadId === 'C') await new Promise<void>(resolve => { release = resolve })
      transaction.commit()
    })
    navigation.reset(thread('A')); await navigation.push({ kind: 'memory', memoryId: null })
    const entry = navigation.captureCurrentEntry()
    const pending = navigation.push(thread('C'))
    expect(entry.update({ kind: 'memory', memoryId: 'M' })).toBe(true)
    release(); expect(await pending).toBe(true)
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), { kind: 'memory', memoryId: 'M' }, thread('C')], index: 2 })
    expect(entry.update({ kind: 'memory', memoryId: 'old' })).toBe(false)
    await navigation.back()
    expect(entry.update({ kind: 'memory', memoryId: 'old' })).toBe(false)
  })

  it('commits a preview and its loaded content to one entry', async () => {
    const navigation = createDesktopNavigation(async (_target, transaction) => {
      transaction.commit()
      await Promise.resolve()
      transaction.commit()
    })
    navigation.reset(thread('A'))
    await navigation.push(thread('B'))
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), thread('B')], index: 1 })
  })

  it('does not let a late preview hydration restore an automatically removed resource', async () => {
    let release!: () => void
    const navigation = createDesktopNavigation(async (_target, transaction) => {
      transaction.commit()
      await new Promise<void>(resolve => { release = resolve })
      expect(transaction.commit()).toBe(false)
    })
    navigation.reset(thread('A'))
    const opening = navigation.push(thread('D'))
    navigation.captureCurrentEntry().update({ kind: 'quick_chat' })
    release(); expect(await opening).toBe(false)
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), { kind: 'quick_chat' }], index: 1 })
  })

  it('user replace cancels pending push without inheriting its extra entry', async () => {
    let release!: () => void
    const navigation = createDesktopNavigation(async (target, transaction) => {
      if (target.kind === 'camp' && target.threadId === 'C') await new Promise<void>(resolve => { release = resolve })
      transaction.commit()
    })
    navigation.reset(thread('A')); await navigation.push(thread('B'))
    const pending = navigation.push(thread('C'))
    await navigation.replace({ kind: 'quick_chat' }); release(); await pending
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A'), { kind: 'quick_chat' }], index: 1 })
  })

  it('reserves creation intent before a target exists and invalidates it even on a repeated current-page click', async () => {
    const navigation = create()
    navigation.reset(thread('A'))
    const creating = navigation.beginIntent()
    expect(creating.isCurrent()).toBe(true)
    await navigation.push(thread('A'))
    expect(creating.isCurrent()).toBe(false)
    expect(navigation.getSnapshot()).toEqual({ entries: [thread('A')], index: 0 })
    const other = navigation.beginIntent()
    navigation.reset(thread('A'))
    expect(other.isCurrent()).toBe(false)
  })
})
