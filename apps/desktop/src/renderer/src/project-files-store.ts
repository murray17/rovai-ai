import type { ProjectFileReferenceSource, ProjectFileEntry, ProjectFilesApi, ProjectFilesPage, ProjectFilesRequest, ProjectFilesScope } from '@contracts'

const referenceBusinessErrors = new Set(['root_unavailable', 'scope_expired', 'entry_unavailable', 'browse_limit', 'read_failed'])

export interface DirectoryPage extends ProjectFilesPage { visibleCount: number; loading?: boolean; error?: string }
export interface ProjectFilesSnapshot {
  scope: ProjectFilesScope | null
  rootId: string | null
  name: string
  expanded: ReadonlySet<string>
  pages: ReadonlyMap<string, DirectoryPage>
  query: string
  results: ProjectFilesPage | null
  searching: boolean
  selected: string | null
  loading: boolean
  error: string | null
  watchFailed: boolean
}
const emptyPage = (): DirectoryPage => ({ entries: [], visibleCount: 200, partial: false })

/** One Thread's reading state. Closing the view releases transport resources, not navigation. */
export class ProjectFilesStore {
  private state: ProjectFilesSnapshot = { scope: null, rootId: null, name: '', expanded: new Set(), pages: new Map(), query: '', results: null, searching: false, selected: null, loading: false, error: null, watchFailed: false }
  private listeners = new Set<() => void>()
  private epoch = 0
  private queryEpoch = 0
  private revealEpoch = 0
  private refreshingEpoch: number | null = null
  private loadSequence = 0
  private loads = new Map<string, number>()
  private refreshAgain = false
  private active = false
  private activation: Promise<void> | null = null
  scrollTop = 0
  constructor(readonly threadId: string, private readonly api: ProjectFilesApi) {}
  getSnapshot = (): ProjectFilesSnapshot => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private update(patch: Partial<ProjectFilesSnapshot>): void {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener())
  }
  private async request<T>(action: ProjectFilesRequest['action'], scope: ProjectFilesScope, input: Partial<ProjectFilesRequest> = {}): Promise<T> {
    const result = await this.api.request<T>({ ...input, threadId: this.threadId, action, scopeId: scope.scopeId })
    if (!result.ok) throw new Error(result.error.code)
    return result.value
  }
  private release(scope: ProjectFilesScope): void { void this.request('release', scope).catch(() => undefined) }
  activate(): Promise<void> {
    if (this.active) return this.activation ?? Promise.resolve()
    this.active = true
    const pending = this.activateScope()
    this.activation = pending
    void pending.finally(() => { if (this.activation === pending) this.activation = null })
    return pending
  }
  private async activateScope(): Promise<void> {
    const epoch = ++this.epoch
    this.update({ loading: true, error: null })
    try {
      const result = await this.api.request<ProjectFilesScope>({ threadId: this.threadId, action: 'resolve' })
      if (!result.ok) throw new Error(result.error.code)
      if (epoch !== this.epoch) { this.release(result.value); return }
      const sameRoot = this.state.rootId === result.value.rootId
      if (!sameRoot) this.scrollTop = 0
      this.update({ scope: result.value, rootId: result.value.rootId, name: result.value.name,
        ...(sameRoot ? {} : { expanded: new Set<string>(), pages: new Map(), selected: null, results: null }) })
      await this.watch()
      await this.refresh()
      if (epoch !== this.epoch) return
      await this.watch()
      if (epoch !== this.epoch) return
      this.update({ loading: false })
      void this.poll(result.value, epoch)
      if (this.state.query) void this.search()
    } catch (error) {
      if (epoch === this.epoch) this.update({ loading: false, error: error instanceof Error ? error.message : 'read_failed' })
    }
  }
  deactivate(): void {
    this.active = false; this.activation = null; ++this.epoch; ++this.queryEpoch; ++this.revealEpoch
    if (this.state.scope) this.release(this.state.scope)
    this.update({ scope: null, loading: false, searching: false })
  }
  retry = (): void => { this.deactivate(); void this.activate() }
  showMore(id: string): void {
    const page = this.state.pages.get(id)
    if (page) this.update({ pages: new Map(this.state.pages).set(id, { ...page, visibleCount: page.visibleCount + 200 }) })
  }
  async load(id: string): Promise<void> {
    const scope = this.state.scope, epoch = this.epoch
    if (!scope) return
    const sequence = ++this.loadSequence
    this.loads.set(id, sequence)
    const old = this.state.pages.get(id) ?? emptyPage()
    this.update({ pages: new Map(this.state.pages).set(id, { ...old, error: undefined, loading: true }) })
    try {
      const page = await this.request<ProjectFilesPage>('list', scope, { entryId: id })
      if (epoch !== this.epoch || this.loads.get(id) !== sequence) return
      this.update({ pages: new Map(this.state.pages).set(id, { ...page, visibleCount: this.state.pages.get(id)?.visibleCount ?? old.visibleCount }) })
    } catch (error) {
      if (epoch === this.epoch && this.loads.get(id) === sequence) this.update({ pages: new Map(this.state.pages).set(id, { ...old, loading: false, error: error instanceof Error ? error.message : 'read_failed' }) })
    }
  }
  async toggle(entry: ProjectFileEntry): Promise<void> {
    ++this.revealEpoch
    if (!entry.directory || entry.unavailable) return
    const expanded = new Set(this.state.expanded)
    if (expanded.has(entry.id)) expanded.delete(entry.id)
    else expanded.add(entry.id)
    this.update({ expanded })
    if (expanded.has(entry.id)) await this.load(entry.id)
    await this.watch()
  }
  private async watch(): Promise<void> {
    const scope = this.state.scope, epoch = this.epoch
    if (!scope) return
    try {
      const visible = this.visibleDirectories()
      const result = await this.request<{ watchFailed: boolean }>('watch', scope, { entryIds: visible.slice(0, 255) })
      if (epoch === this.epoch) this.update({ watchFailed: result.watchFailed || visible.length > 255 })
    } catch { if (epoch === this.epoch) this.update({ watchFailed: true }) }
  }
  private visibleDirectories(): string[] {
    const result: string[] = []
    const visit = (id: string): void => {
      for (const entry of this.state.pages.get(id)?.entries ?? []) if (entry.directory && this.state.expanded.has(entry.id) && !result.includes(entry.id)) { result.push(entry.id); visit(entry.id) }
    }
    visit('root')
    return result
  }
  async refresh(): Promise<void> {
    const epoch = this.epoch
    if (this.refreshingEpoch === epoch) { this.refreshAgain = true; return }
    this.refreshingEpoch = epoch
    try {
      do {
        this.refreshAgain = false
        await this.load('root')
        for (const id of this.visibleDirectories()) {
          if (epoch !== this.epoch) break
          await this.load(id)
        }
      } while (this.refreshAgain && epoch === this.epoch)
    } finally { if (this.refreshingEpoch === epoch) this.refreshingEpoch = null }
  }
  private async poll(scope: ProjectFilesScope, epoch: number): Promise<void> {
    let revision = scope.revision
    try {
      while (epoch === this.epoch) {
        const result = await this.request<{ revision: number; watchFailed: boolean }>('poll', scope, { revision })
        if (epoch !== this.epoch) return
        this.update({ watchFailed: result.watchFailed })
        if (result.revision !== revision) {
          revision = result.revision
          await this.refresh()
          await this.watch()
          if (this.state.query) void this.search()
        }
      }
    } catch (error) {
      if (epoch === this.epoch) this.update({ watchFailed: true, ...(error instanceof Error && ['root_unavailable', 'scope_expired'].includes(error.message) ? { error: error.message } : {}) })
    }
  }
  setQuery(query: string): void {
    ++this.revealEpoch
    ++this.queryEpoch
    if (this.state.scope) void this.request('cancelSearch', this.state.scope, { queryRevision: this.queryEpoch }).catch(() => undefined)
    this.update({ query, results: null, searching: !!query.trim() })
  }
  async search(): Promise<void> {
    const scope = this.state.scope, epoch = this.epoch, queryEpoch = ++this.queryEpoch, query = this.state.query.trim()
    if (!scope || !query) return
    this.update({ searching: true, error: null })
    try {
      const results = await this.request<ProjectFilesPage>('search', scope, { query, queryRevision: queryEpoch })
      if (epoch === this.epoch && queryEpoch === this.queryEpoch) this.update({ results, searching: false })
    } catch (error) {
      if (epoch === this.epoch && queryEpoch === this.queryEpoch) this.update({ searching: false, error: error instanceof Error ? error.message : 'read_failed' })
    }
  }
  /** A reference reveals only its ancestor chain and immediate children, never a recursive subtree. */
  async revealReference(rawReference: string, expectedPathAtSend?: string): Promise<boolean | null> {
    let ticket = ++this.revealEpoch
    await this.activate()
    if (ticket !== this.revealEpoch) return null
    const scope = this.state.scope, epoch = this.epoch
    if (!scope) {
      const code = this.state.error ?? 'root_unavailable'
      if (referenceBusinessErrors.has(code)) return false
      this.update({ error: 'network_error' })
      throw new Error(code)
    }
    try {
      let decoded: unknown
      try { decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(rawReference.replace(/-/gu, '+').replace(/_/gu, '/')), c => c.charCodeAt(0)))) } catch { throw new Error('entry_unavailable') }
      if (!Array.isArray(decoded) || decoded.length !== 2 || decoded[0] !== scope.rootId || typeof decoded[1] !== 'string') throw new Error('entry_unavailable')
      const parts = decoded[1].split('/') as string[]
      if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('entry_unavailable')
      const entryId = (path: string): string => 'p:' + btoa(String.fromCharCode(...new TextEncoder().encode(path))).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_')
      const id = entryId(decoded[1])
      const source = await this.request<ProjectFileReferenceSource>('open', scope, { entryId: id, rawReference, ...(expectedPathAtSend ? { expectedPathAtSend } : {}) })
      if (epoch !== this.epoch || ticket !== this.revealEpoch) return null
      if (source.kind !== 'project_file' || source.targetKind !== 'directory') return false
      this.setQuery(''); ticket = this.revealEpoch
      const expanded = new Set(this.state.expanded)
      for (let depth = 1; depth <= parts.length; depth++) {
        const parent = depth === 1 ? 'root' : entryId(parts.slice(0, depth - 1).join('/'))
        if (!this.state.pages.has(parent)) await this.load(parent)
        if (epoch !== this.epoch || ticket !== this.revealEpoch) return null
        const next = entryId(parts.slice(0, depth).join('/'))
        let page = this.state.pages.get(parent)
        if (page?.error) throw new Error(page.error)
        let index = page?.entries.findIndex(entry => entry.id === next) ?? -1
        if (index < 0) {
          await this.load(parent)
          if (epoch !== this.epoch || ticket !== this.revealEpoch) return null
          page = this.state.pages.get(parent)
          if (page?.error) throw new Error(page.error)
          index = page?.entries.findIndex(entry => entry.id === next) ?? -1
        }
        if (index < 0) throw new Error(page?.partial ? 'browse_limit' : 'entry_unavailable')
        if (page && index >= page.visibleCount) this.update({ pages: new Map(this.state.pages).set(parent, { ...page, visibleCount: index + 1 }) })
        expanded.add(next)
      }
      await this.load(id)
      if (epoch !== this.epoch || ticket !== this.revealEpoch) return null
      const targetError = this.state.pages.get(id)?.error
      if (targetError) throw new Error(targetError)
      this.update({ expanded, selected: id, error: null })
      await this.watch()
      return epoch === this.epoch && ticket === this.revealEpoch ? true : null
    } catch (error) {
      if (epoch !== this.epoch || ticket !== this.revealEpoch) return null
      const code = error instanceof Error ? error.message : ''
      const business = referenceBusinessErrors.has(code)
      this.update({ error: business ? code : 'network_error' })
      if (!business) throw error
      return false
    }
  }
  async open(entry: ProjectFileEntry): Promise<ProjectFileReferenceSource | null> {
    ++this.revealEpoch
    const scope = this.state.scope, epoch = this.epoch
    if (!scope || entry.unavailable) return null
    this.update({ selected: entry.id })
    try {
      const source = await this.request<ProjectFileReferenceSource>('open', scope, { entryId: entry.id, targetKind: entry.directory ? 'directory' : 'file' })
      return epoch === this.epoch ? source : null
    } catch (error) {
      if (epoch === this.epoch) this.update({ error: error instanceof Error ? error.message : 'read_failed' })
      return null
    }
  }
}
