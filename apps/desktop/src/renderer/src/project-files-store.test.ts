import { describe, expect, it } from 'vitest'
import type { ProjectFilesApi, ProjectFilesPage, ProjectFilesRequest, ProjectFilesResult } from '@contracts'
import { ProjectFilesStore } from './project-files-store'

const page: ProjectFilesPage = { entries: [{ id: 'src', name: 'src', relativePath: 'src', directory: true, unavailable: false }], nextOffset: null, partial: false }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fixture() {
  const searches: Array<ReturnType<typeof deferred<ProjectFilesResult<ProjectFilesPage>>>> = []
  const calls: ProjectFilesRequest[] = []
  let scope = 0
  const api: ProjectFilesApi = { request: async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
    calls.push(request)
    if (request.action === 'poll') return new Promise(() => {})
    if (request.action === 'search') { const pending = deferred<ProjectFilesResult<ProjectFilesPage>>(); searches.push(pending); return pending.promise as Promise<ProjectFilesResult<T>> }
    const value = request.action === 'resolve' ? { scopeId: String(++scope), rootId: 'root-a', name: 'project', revision: 0 }
      : request.action === 'list' ? page : { watchFailed: false }
    return { ok: true, value: value as T }
  } }
  return { api, calls, searches }
}
describe('project file navigation lifetime', () => {
  it('a late search cannot replace a newer query or repopulate a released scope', async () => {
    const { api, calls, searches } = fixture(), store = new ProjectFilesStore('thread', api)
    await store.activate()
    store.setQuery('old'); const old = store.search()
    store.setQuery('new'); const latest = store.search()
    const expected = { ...page, entries: [{ ...page.entries[0], id: 'new', name: 'new.ts', directory: false }] }
    searches[1].resolve({ ok: true, value: expected }); await latest
    searches[0].resolve({ ok: true, value: page }); await old
    expect(store.getSnapshot().results).toEqual(expected)
    store.setQuery('in flight'); const stopped = store.search()
    store.deactivate()
    searches[2].resolve({ ok: true, value: page }); await stopped
    expect(store.getSnapshot().scope).toBeNull()
    expect(store.getSnapshot().results).toBeNull()
    expect(calls.filter(call => call.action === 'release')).toHaveLength(1)
  })
  it('closing transport resources preserves navigation and reopening obtains a fresh scope', async () => {
    const { api, calls } = fixture(), store = new ProjectFilesStore('thread', api)
    await store.activate(); await store.toggle(page.entries[0]); store.scrollTop = 124
    const first = store.getSnapshot().scope!.scopeId
    store.deactivate(); await store.activate()
    expect(store.getSnapshot().expanded.has('src')).toBe(true)
    expect(store.scrollTop).toBe(124)
    expect(store.getSnapshot().scope!.scopeId).not.toBe(first)
    expect(calls.some(call => call.action === 'list' && call.entryId === 'src' && call.scopeId !== first)).toBe(true)
    store.deactivate()
  })
  it('a pending snapshot from a closed scope cannot suppress the newly opened snapshot', async () => {
    const pending = deferred<ProjectFilesResult<ProjectFilesPage>>()
    const { api } = fixture(), original = api.request
    let loading = false
    api.request = async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      if (request.action === 'list' && request.scopeId === '1') { loading = true; return pending.promise as Promise<ProjectFilesResult<T>> }
      return original<T>(request)
    }
    const store = new ProjectFilesStore('thread', api), first = store.activate()
    while (!loading) await Promise.resolve()
    store.deactivate(); await store.activate()
    expect(store.getSnapshot().pages.get('root')?.entries).toEqual(page.entries)
    pending.resolve({ ok: true, value: { ...page, entries: [] } }); await first
    expect(store.getSnapshot().scope?.scopeId).toBe('2')
    expect(store.getSnapshot().pages.get('root')?.entries).toEqual(page.entries)
    store.deactivate()
  })
})
