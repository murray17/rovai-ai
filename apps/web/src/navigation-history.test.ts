import { describe, it, expect } from 'vitest'
import { createBrowserNavigationHistory } from './navigation-history'
import { createDesktopNavigation, type NavigationTarget } from '../../desktop/src/renderer/src/desktop-navigation'

function browser() {
  const storage = new Map<string, string>()
  const listeners = new Set<() => void>()
  const entries: unknown[] = [null]
  let index = 0
  const host = {
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    history: {
      get state() { return entries[index] },
      pushState(state: unknown) { entries.splice(++index); entries.push(state) },
      replaceState(state: unknown) { entries[index] = state },
      go(delta: number) { queueMicrotask(() => { const next = index + delta; if (next < 0 || next >= entries.length) return; index = next; listeners.forEach(listener => listener()) }) }
    },
    addEventListener(_name: string, listener: () => void) { listeners.add(listener) },
    removeEventListener(_name: string, listener: () => void) { listeners.delete(listener) }
  } as unknown as Window
  return host
}
const thread = (threadId: string): NavigationTarget => ({ kind: 'camp', threadId })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('browser navigation adapter', () => {
  it('keeps mobile settings overview distinct from its remembered section through Back and refresh', async () => {
    const host = browser()
    const navigation = createDesktopNavigation(async (_target, tx) => { tx.commit() }, createBrowserNavigationHistory('phone', host))
    const stop = navigation.connect()
    const overview: NavigationTarget = { kind: 'settings', section: 'runtime', overview: true }
    const detail: NavigationTarget = { kind: 'settings', section: 'runtime' }
    navigation.reset({ kind: 'missions' })
    await navigation.replace(overview)
    await navigation.push(detail)
    expect(navigation.getSnapshot().entries).toEqual([overview, detail])
    host.history.go(-1); await settle()
    expect(host.history.state.rovai.target).toEqual(overview)
    stop()
    const contexts: Array<{ preserveUnreadReminder: boolean } | undefined> = []
    const restored = createDesktopNavigation<{ preserveUnreadReminder: boolean }>(async (_target, tx, context) => { contexts.push(context); tx.commit() }, createBrowserNavigationHistory('phone', host))
    const disconnect = restored.connect()
    expect(await restored.restore({ preserveUnreadReminder: true })).toBe(true)
    expect(contexts.at(-1)).toEqual({ preserveUnreadReminder: true })
    expect(restored.getSnapshot()).toEqual({ entries: [overview, detail], index: 0 })
    expect(await restored.forward()).toBe(true)
    expect(contexts.at(-1)).toBeUndefined()
    expect(host.history.state.rovai.target).toEqual(detail)
    disconnect()
  })
  it('repairs the displayed page during native Back without cancelling the newer destination', async () => {
    const host = browser()
    let release: (() => void) | undefined
    let hold = false
    const navigation = createDesktopNavigation(async (_target, tx) => {
      if (hold) await new Promise<void>(resolve => { release = resolve })
      tx.commit()
    }, createBrowserNavigationHistory('scope', host))
    const stop = navigation.connect()
    navigation.reset(thread('A')); await navigation.push(thread('B'))
    const displayed = navigation.captureCurrentEntry()
    hold = true
    const back = navigation.back(); await settle()
    expect(displayed.update({ kind: 'quick_chat' })).toBe(true)
    expect(host.history.state.rovai.target).toEqual(thread('A'))
    hold = false; release!()
    expect(await back).toBe(true)
    expect(await navigation.forward()).toBe(true)
    expect(host.history.state.rovai.target).toEqual({ kind: 'quick_chat' })
    stop()
    const restored = createDesktopNavigation(async (_target, tx) => { tx.commit() }, createBrowserNavigationHistory('scope', host))
    expect(await restored.restore()).toBe(true)
    expect(restored.getSnapshot().entries[1]).toEqual({ kind: 'quick_chat' })
  })
  it('restores legacy Camp history without changing its IDs', () => {
    const host = browser()
    host.sessionStorage.setItem('rovai.web.history.v1:scope', JSON.stringify({ snapshot: { entries: [{ kind: 'camp', campId: 'A' }], index: 0 }, ids: ['old'] }))
    host.history.replaceState({ rovai: { scope: 'scope', id: 'old', target: { kind: 'camp', campId: 'A' } } }, '')
    expect(createBrowserNavigationHistory('scope', host).initial).toEqual({ entries: [thread('A')], index: 0 })
  })
  it('commits preview and full projection into one native history entry', async () => {
    const host = browser()
    const navigation = createDesktopNavigation(async (_target, tx) => { tx.commit(); tx.commit() }, createBrowserNavigationHistory('scope', host))
    const stop = navigation.connect()
    navigation.reset(thread('A')); await navigation.push(thread('B'))
    expect(await navigation.back()).toBe(true)
    expect(host.history.state.rovai.target).toEqual(thread('A'))
    expect(await navigation.back()).toBe(false)
    stop()
  })
  it('shares native and in-page traversal, restores after refresh and returns to the same cursor when a guard declines', async () => {
    const host = browser()
    let allow = true
    const driver = createBrowserNavigationHistory('scope', host)
    const navigation = createDesktopNavigation(async (_target, tx) => { if (allow) tx.commit() }, driver)
    const disconnect = navigation.connect()
    navigation.reset(thread('A')); await navigation.push(thread('B')); await navigation.push(thread('C'))
    expect(await navigation.back()).toBe(true)
    expect(navigation.getSnapshot().index).toBe(1)
    host.history.go(-1); await settle()
    expect(navigation.getSnapshot().index).toBe(0)
    await navigation.forward()
    allow = false
    expect(await navigation.back()).toBe(false)
    expect(navigation.getSnapshot().index).toBe(1)
    expect(host.history.state.rovai.target).toEqual(thread('B'))
    disconnect()
    const restored = createDesktopNavigation(async (_target, tx) => { tx.commit() }, createBrowserNavigationHistory('scope', host))
    const stop = restored.connect()
    expect(await restored.restore()).toBe(true)
    expect(restored.getSnapshot()).toEqual(navigation.getSnapshot())
    await restored.forward(); expect(restored.getSnapshot().entries[2]).toEqual(thread('C'))
    await restored.back(); await restored.push(thread('branch'))
    expect(await restored.forward()).toBe(false)
    stop()
  })
  it('keeps native browser entries addressable beyond the Desktop 50-entry cap', async () => {
    const host = browser()
    const navigation = createDesktopNavigation(async (_target, tx) => { tx.commit() }, createBrowserNavigationHistory('scope', host))
    const stop = navigation.connect(); navigation.reset(thread('0'))
    for (let i = 1; i <= 55; i++) await navigation.push(thread(String(i)))
    await navigation.back(); await navigation.back()
    expect(navigation.getSnapshot().entries[navigation.getSnapshot().index]).toEqual(thread('53'))
    expect(host.history.state.rovai.target).toEqual(thread('53'))
    expect(navigation.getSnapshot().entries).toHaveLength(56)
    for (let i = 0; i < 53; i++) await navigation.back()
    expect(host.history.state.rovai.target).toEqual(thread('0'))
    expect(await navigation.forward()).toBe(true)
    stop()
  })
})
