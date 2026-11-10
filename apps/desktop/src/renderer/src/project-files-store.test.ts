import { describe, expect, it } from 'vitest'
import type { ProjectFilesApi, ProjectFilesPage, ProjectFilesRequest, ProjectFilesResult } from '@contracts'
import { ProjectFilesStore } from './project-files-store'

const page: ProjectFilesPage = { entries: [{ id: 'src', name: 'src', relativePath: 'src', directory: true, unavailable: false }], partial: false }
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
  it('reveals a validated directory under its original root, preserving the host locator and frozen path', async () => {
    const calls: ProjectFilesRequest[] = []
    let rootListings = 0
    const id = 'p:' + Buffer.from('apps').toString('base64url')
    const raw = Buffer.from(JSON.stringify(['root-a', 'apps'])).toString('base64url')
    const api: ProjectFilesApi = { request: async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      calls.push(request)
      if (request.action === 'poll') return new Promise(() => {})
      const value = request.action === 'resolve' ? { scopeId: 'scope', rootId: 'root-a', name: 'project', revision: 0 }
        : request.action === 'list' ? { entries: request.entryId === 'root' && ++rootListings > 1 ? [{ id, name: 'apps', relativePath: 'apps', directory: true, unavailable: false }] : [], partial: false }
        : request.action === 'open' ? { kind: 'project_file', threadId: 'thread', rawReference: raw, targetKind: 'directory' } : { watchFailed: false }
      return { ok: true, value: value as T }
    } }
    const store = new ProjectFilesStore('thread', api)
    expect(await store.revealReference(raw, '/project/apps')).toBe(true)
    expect(store.getSnapshot().selected).toBe(id)
    expect(store.getSnapshot().expanded.has(id)).toBe(true)
    expect(rootListings).toBe(2)
    expect(calls.find(call => call.action === 'open')).toMatchObject({ entryId: id, rawReference: raw, expectedPathAtSend: '/project/apps' })
    const opens = calls.filter(call => call.action === 'open').length
    expect(await store.revealReference(Buffer.from(JSON.stringify(['new-root', 'apps'])).toString('base64url'))).toBe(false)
    expect(calls.filter(call => call.action === 'open')).toHaveLength(opens)
    store.deactivate()
  })
  it('discards a directory open from a released scope and keeps transport failures distinct', async () => {
    const pending = deferred<ProjectFilesResult<unknown>>()
    const { api } = fixture(), original = api.request
    const raw = Buffer.from(JSON.stringify(['root-a', 'apps'])).toString('base64url')
    let started = false
    api.request = async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      if (request.action === 'open') { started = true; return pending.promise as Promise<ProjectFilesResult<T>> }
      return original<T>(request)
    }
    const store = new ProjectFilesStore('thread', api), reveal = store.revealReference(raw)
    while (!started) await Promise.resolve()
    store.deactivate(); await store.activate()
    pending.resolve({ ok: true, value: { kind: 'project_file', targetKind: 'directory' } })
    expect(await reveal).toBeNull()
    expect(store.getSnapshot().selected).toBeNull()
    api.request = async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      if (request.action === 'open') throw new Error('connection_closed')
      return original<T>(request)
    }
    await expect(store.revealReference(raw)).rejects.toThrow('connection_closed')
    expect(store.getSnapshot().error).toBe('network_error')
    store.deactivate()
  })
  it('shares pending scope activation and lets only the latest directory reveal select a row', async () => {
    const activation = deferred<ProjectFilesResult<unknown>>(), oldOpen = deferred<ProjectFilesResult<unknown>>()
    const calls: ProjectFilesRequest[] = []
    const entry = (name: string) => ({ id: 'p:' + Buffer.from(name).toString('base64url'), name, relativePath: name, directory: true, unavailable: false })
    const raw = (name: string) => Buffer.from(JSON.stringify(['root-a', name])).toString('base64url')
    const api: ProjectFilesApi = { request: async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      calls.push(request)
      if (request.action === 'resolve') return activation.promise as Promise<ProjectFilesResult<T>>
      if (request.action === 'poll') return new Promise(() => {})
      if (request.action === 'open' && request.entryId === entry('old').id) return oldOpen.promise as Promise<ProjectFilesResult<T>>
      const value = request.action === 'open' ? { kind: 'project_file', targetKind: 'directory' }
        : request.action === 'list' ? { entries: request.entryId === 'root' ? [entry('old'), entry('new')] : [], partial: false } : { watchFailed: false }
      return { ok: true, value: value as T }
    } }
    const store = new ProjectFilesStore('thread', api)
    const starting = store.activate(), first = store.revealReference(raw('old'))
    activation.resolve({ ok: true, value: { scopeId: 'scope', rootId: 'root-a', name: 'project', revision: 0 } })
    await starting
    while (!calls.some(call => call.action === 'open')) await Promise.resolve()
    expect(calls.filter(call => call.action === 'resolve')).toHaveLength(1)
    expect(await store.revealReference(raw('new'))).toBe(true)
    oldOpen.resolve({ ok: true, value: { kind: 'project_file', targetKind: 'directory' } })
    expect(await first).toBeNull()
    expect(store.getSnapshot().selected).toBe(entry('new').id)
    store.deactivate()
  })
  it('keeps transport errors distinct during directory scope activation and child loading', async () => {
    const { api } = fixture(), original = api.request
    const raw = Buffer.from(JSON.stringify(['root-a', 'apps'])).toString('base64url')
    api.request = async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      if (request.action === 'resolve') throw new Error('connection_closed')
      return original<T>(request)
    }
    const store = new ProjectFilesStore('thread', api)
    await expect(store.revealReference(raw)).rejects.toThrow('connection_closed')
    expect(store.getSnapshot().error).toBe('network_error')
    store.deactivate()
    api.request = async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => {
      if (request.action === 'list' && request.entryId !== 'root') throw new Error('connection_closed')
      const value = request.action === 'open' ? { kind: 'project_file', targetKind: 'directory' }
        : request.action === 'list' ? { entries: [{ ...page.entries[0], id: 'p:YXBwcw', name: 'apps', relativePath: 'apps' }], partial: false } : null
      return value ? { ok: true, value: value as T } : original<T>(request)
    }
    await expect(store.revealReference(raw)).rejects.toThrow('connection_closed')
    expect(store.getSnapshot().selected).toBeNull()
    expect(store.getSnapshot().error).toBe('network_error')
    store.deactivate()
  })
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
  it('shows cached rows locally and refreshes the visible range with one bounded request', async () => {
    const { api, calls } = fixture(), original = api.request
    const entries = Array.from({ length: 650 }, (_, index) => ({ id: String(index), name: `file-${index}.ts`, relativePath: `file-${index}.ts`, directory: false, unavailable: false }))
    api.request = async <T>(request: ProjectFilesRequest): Promise<ProjectFilesResult<T>> => request.action === 'list'
      ? (calls.push(request), { ok: true, value: { entries, partial: false } as T }) : original<T>(request)
    const store = new ProjectFilesStore('thread', api)
    await store.activate()
    expect(calls.filter(call => call.action === 'list')).toHaveLength(1)
    expect(store.getSnapshot().pages.get('root')?.visibleCount).toBe(200)
    store.showMore('root'); store.showMore('root')
    expect(store.getSnapshot().pages.get('root')?.visibleCount).toBe(600)
    expect(calls.filter(call => call.action === 'list')).toHaveLength(1)
    await store.load('root')
    expect(calls.filter(call => call.action === 'list')).toHaveLength(2)
    expect(store.getSnapshot().pages.get('root')?.visibleCount).toBe(600)
    expect(store.getSnapshot().pages.get('root')?.entries).toEqual(entries)
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
