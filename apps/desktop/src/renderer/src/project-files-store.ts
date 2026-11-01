import type { OpenFilePreviewRequest, ProjectFileEntry, ProjectFilesApi, ProjectFilesPage, ProjectFilesRequest, ProjectFilesScope } from '@contracts'

export interface DirectoryPage extends ProjectFilesPage { loading?: boolean; error?: string }
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
const emptyPage = (): DirectoryPage => ({ entries: [], nextOffset: null, partial: false })

/** One Thread's reading state. Closing the view releases transport resources, not navigation. */
export class ProjectFilesStore {
  private state: ProjectFilesSnapshot = { scope: null, rootId: null, name: '', expanded: new Set(), pages: new Map(), query: '', results: null, searching: false, selected: null, loading: false, error: null, watchFailed: false }
  private listeners = new Set<() => void>()
  private epoch = 0
  private queryEpoch = 0
  private refreshingEpoch: number | null = null
  private loadSequence = 0
  private loads = new Map<string, number>()
  private refreshAgain = false
  private active = false
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
  async activate(): Promise<void> {
    if (this.active) return
    this.active = true
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
    this.active = false; ++this.epoch; ++this.queryEpoch
    if (this.state.scope) this.release(this.state.scope)
    this.update({ scope: null, loading: false, searching: false })
  }
  retry = (): void => { this.deactivate(); void this.activate() }
  async load(id: string, more = false): Promise<void> {
    const scope = this.state.scope, epoch = this.epoch
    if (!scope) return
    const sequence = ++this.loadSequence
    this.loads.set(id, sequence)
    const old = this.state.pages.get(id) ?? emptyPage()
    this.update({ pages: new Map(this.state.pages).set(id, { ...old, error: undefined, loading: true }) })
    try {
      let page = await this.request<ProjectFilesPage>('list', scope, { entryId: id, offset: more ? old.nextOffset ?? 0 : 0 })
      // Reopening/refreshing retains the pages the user already reached, so a
      // fresh snapshot does not silently collapse their scrollable range.
      while (!more && page.nextOffset !== null && page.entries.length < old.entries.length) {
        if (epoch !== this.epoch || this.loads.get(id) !== sequence) return
        const next = await this.request<ProjectFilesPage>('list', scope, { entryId: id, offset: page.nextOffset })
        const entries = [...page.entries, ...next.entries.filter(entry => !page.entries.some(previous => previous.id === entry.id))]
        if (next.nextOffset !== null && next.nextOffset <= page.nextOffset) break
        page = { ...next, entries, partial: page.partial || next.partial }
      }
      if (epoch !== this.epoch || this.loads.get(id) !== sequence) return
      this.update({ pages: new Map(this.state.pages).set(id, { ...page, entries: more ? [...old.entries, ...page.entries.filter(entry => !old.entries.some(previous => previous.id === entry.id))] : page.entries }) })
    } catch (error) {
      if (epoch === this.epoch && this.loads.get(id) === sequence) this.update({ pages: new Map(this.state.pages).set(id, { ...old, loading: false, error: error instanceof Error ? error.message : 'read_failed' }) })
    }
  }
  async toggle(entry: ProjectFileEntry): Promise<void> {
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
  async open(entry: ProjectFileEntry): Promise<OpenFilePreviewRequest | null> {
    const scope = this.state.scope, epoch = this.epoch
    if (!scope || entry.unavailable) return null
    this.update({ selected: entry.id })
    try {
      const source = await this.request<OpenFilePreviewRequest>('open', scope, { entryId: entry.id })
      return epoch === this.epoch ? source : null
    } catch (error) {
      if (epoch === this.epoch) this.update({ error: error instanceof Error ? error.message : 'read_failed' })
      return null
    }
  }
}
