import type { EditorState } from '@codemirror/state'
import type { EditableFileSnapshot, FileEditAccess, FileEditResult, FileLocationTarget, FilePreviewApi, ResolvedFilePreview } from '@contracts'
import { filePreviewRetentionLimits } from '../../file-preview-retention'
import { uiAttribute } from './interface-language'

export interface FileEditDocument {
  key: string
  name: string
  draft: string
  savedText: string
  version: string
  access: FileEditAccess
  saving: boolean
  error: string | null
  conflict?: EditableFileSnapshot
  unknown?: { text: string }
  editorState?: EditorState
  scrollTop?: number
  navigationTarget?: FileLocationTarget
}
export const fileEditDirty = (doc?: FileEditDocument): boolean => !!doc && doc.draft !== doc.savedText
const pending = (doc: FileEditDocument): boolean => fileEditDirty(doc) || doc.saving || !!doc.unknown
type Choice = 'cancel' | 'discard' | 'save'
export interface FileEditDialog { kind: 'close' | 'conflict'; doc: FileEditDocument; resolve(choice: Choice): void }
const windows = new Set<FileEditStore>()
export async function prepareFileEditsForQuit(): Promise<void> {
  for (const store of windows) if (!await store.confirmClose([...store.tabs.keys()])) throw new Error(uiAttribute('文件更改尚未保存。'))
  for (const store of windows) store.acceptExit()
}

/** Window-owned buffers. Preview caches may be discarded without owning these drafts. */
export class FileEditStore {
  readonly documents = new Map<string, FileEditDocument>()
  readonly tabs = new Map<string, FileEditDocument>()
  readonly #listeners = new Set<() => void>()
  readonly #loading = new Map<string, string>()
  readonly #handles = new Map<string, string>()
  readonly #access = new Map<string, FileEditAccess>()
  readonly failures = new Map<string, string>()
  #revision = 0
  #exitContents = new Map<FileEditDocument, string>()
  #disposed = false
  dialog: FileEditDialog | null = null
  onSaved?: (tabIds: string[]) => void
  constructor(readonly api: FilePreviewApi) {}
  registerWindow = (): void => { windows.add(this) }
  subscribe = (fn: () => void): (() => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn) } }
  getSnapshot = (): number => this.#revision
  acceptExit = (): void => { this.#exitContents = new Map([...this.documents.values()].map(doc => [doc, doc.draft])) }
  shouldWarnOnUnload = (): boolean => [...this.documents.values()].some(doc => pending(doc) && this.#exitContents.get(doc) !== doc.draft)
  changed = (): void => { if (!this.#disposed) { this.#revision++; this.#listeners.forEach(fn => fn()) } }
  get = (tabId: string): FileEditDocument | undefined => this.tabs.get(tabId)
  protects = (tabId: string): boolean => { const doc = this.get(tabId); return !!doc && pending(doc) }
  hasUnsaved = (): boolean => [...this.documents.values()].some(pending)

  async attach(tabId: string, file: ResolvedFilePreview): Promise<void> {
    if (!this.api.readEditableFile || !this.api.saveTextFile || !['code', 'text', 'markdown', 'html'].includes(file.kind)) return
    const handleVersion = `${file.handleId}:${file.contentGeneration}`
    const access = { handleId: file.handleId, expectedGeneration: file.contentGeneration }
    if (this.#handles.get(tabId) === handleVersion || this.#loading.get(tabId) === handleVersion) return
    this.#loading.set(tabId, handleVersion)
    // A read started before a save completed must never roll that confirmed baseline back.
    const baselines = new Map([...this.documents].map(([key, doc]) => [key, { draft: doc.draft, version: doc.version }]))
    try {
      const result = await this.api.readEditableFile(access)
      if (this.#disposed || this.#loading.get(tabId) !== handleVersion) return
      this.#handles.set(tabId, handleVersion)
      if (!result.ok) return
      const old = this.tabs.get(tabId)
      if (old && old.key !== result.value.key) {
        old.error = uiAttribute('文件位置已失效，修改已保留'); this.changed(); return
      }
      let doc = this.documents.get(result.value.key)
      if (!doc) {
        const bytes = [...this.documents.values()].reduce((n, d) => n + 2 * (d.draft.length + d.savedText.length), 0)
        if (this.documents.size >= filePreviewRetentionLimits.handles || bytes + result.value.text.length * 4 > filePreviewRetentionLimits.backgroundBytes) {
          this.failures.set(tabId, uiAttribute('编辑空间不足，请先保存或关闭文件。')); this.changed(); return
        }
        doc = { ...result.value, name: file.fileName, draft: result.value.text, savedText: result.value.text, access, saving: false, error: null }
        this.documents.set(doc.key, doc)
      } else if (!pending(doc) && doc.version !== result.value.version
        && baselines.get(doc.key)?.version === doc.version && baselines.get(doc.key)?.draft === doc.draft) {
        doc.draft = doc.savedText = result.value.text; doc.version = result.value.version
        doc.conflict = undefined; doc.error = null
      }
      doc.access = access
      this.#access.set(tabId, access)
      this.tabs.set(tabId, doc); this.failures.delete(tabId); this.changed()
    } catch { /* A failed capability probe keeps the existing read-only preview available. */ }
    finally { if (this.#loading.get(tabId) === handleVersion) this.#loading.delete(tabId) }
  }

  allowChange(doc: FileEditDocument, characters: number): boolean {
    const bytes = [...this.documents.values()].reduce((total, entry) => total + 2 * ((entry === doc ? characters : entry.draft.length) + entry.savedText.length), 0)
    if (bytes <= filePreviewRetentionLimits.backgroundBytes) return true
    doc.error = uiAttribute('编辑空间不足，请先保存或关闭文件。'); this.changed(); return false
  }
  change(doc: FileEditDocument, text: string): void { doc.draft = text; this.changed() }
  ask(kind: FileEditDialog['kind'], doc: FileEditDocument): Promise<Choice> {
    if (this.dialog) return Promise.resolve('cancel')
    return new Promise(resolve => {
      this.dialog = { kind, doc, resolve: choice => { this.dialog = null; this.changed(); resolve(choice) } }
      this.changed()
    })
  }
  async handleConflict(doc: FileEditDocument): Promise<boolean> {
    const observed = doc.conflict
    if (!observed || observed.key !== doc.key) return false
    const choice = await this.ask('conflict', doc)
    if (choice === 'discard') {
      // Reload again: a second external change must not be mistaken for the observed version.
      const discarded = doc.draft
      const result = await this.api.readEditableFile!(doc.access).catch(() => null)
      if (doc.draft !== discarded) { doc.error = uiAttribute('内容又有修改，请重新处理冲突'); this.changed(); return false }
      if (!result?.ok || result.value.key !== doc.key) { doc.error = uiAttribute('无法重新加载，修改已保留'); this.changed(); return false }
      doc.draft = doc.savedText = result.value.text; doc.version = result.value.version
      doc.conflict = undefined; doc.unknown = undefined; doc.error = null; doc.editorState = undefined
      this.changed(); this.onSaved?.(this.tabIds(doc)); return true
    }
    if (choice === 'save') return this.save(doc, observed.version)
    return false
  }
  private tabIds(doc: FileEditDocument): string[] { return [...this.tabs].filter(([, value]) => value === doc).map(([id]) => id) }

  async checkDisk(doc: FileEditDocument): Promise<void> {
    if (doc.saving) return
    if (doc.unknown) { await this.reconcile(doc); return }
    const result = await this.api.readEditableFile!(doc.access).catch(() => null)
    if (!result?.ok || result.value.key !== doc.key) { doc.error = uiAttribute('无法重新加载，修改已保留'); this.changed(); return }
    if (result.value.version === doc.version) { this.onSaved?.(this.tabIds(doc)); return }
    doc.conflict = result.value; doc.error = uiAttribute('文件已在外部更新'); this.changed()
    await this.handleConflict(doc)
  }

  async reconcile(doc: FileEditDocument): Promise<boolean> {
    const submitted = doc.unknown
    if (!submitted || doc.saving) return false
    doc.saving = true; this.changed()
    try {
      const result = await this.api.readEditableFile!(doc.access)
      if (!result.ok || result.value.key !== doc.key) return false
      if (result.value.text === submitted.text) {
        doc.savedText = submitted.text; doc.version = result.value.version
        doc.unknown = undefined; doc.error = null; doc.conflict = undefined
        this.onSaved?.(this.tabIds(doc)); return true
      }
      doc.unknown = undefined; doc.conflict = result.value
      doc.error = uiAttribute('磁盘内容与提交内容不同，修改已保留')
      return false
    } catch { return false }
    finally { doc.saving = false; this.changed() }
  }

  async save(doc: FileEditDocument, observedVersion?: string): Promise<boolean> {
    if (doc.saving) return false
    if (doc.unknown) return this.reconcile(doc) // Never resubmit an uncertain write.
    if (doc.conflict && !observedVersion) return this.handleConflict(doc)
    if (!fileEditDirty(doc) && !observedVersion) return true
    const submitted = doc.draft
    if (new TextEncoder().encode(submitted).byteLength > 2 * 1024 * 1024) { doc.error = uiAttribute('文件超过 2 MiB，无法保存'); this.changed(); return false }
    doc.saving = true; doc.error = null; this.changed()
    let result: FileEditResult
    try { result = await this.api.saveTextFile!({ ...doc.access, text: submitted, expectedVersion: observedVersion ?? doc.version }) }
    catch { result = { ok: false, error: { code: 'save_unknown', message: uiAttribute('保存结果未知，修改已保留') } } }
    doc.saving = false
    if (result.ok && result.value.key !== doc.key) result = { ok: false, error: { code: 'save_unknown', message: '保存结果未知，修改已保留' } }
    if (result.ok) {
      // Only the submitted snapshot becomes saved. Subsequent input and undo history stay intact.
      doc.savedText = submitted; doc.version = result.value.version
      doc.error = null; doc.conflict = undefined; this.changed(); this.onSaved?.(this.tabIds(doc)); return true
    }
    doc.error = uiAttribute(result.error.message)
    if (result.error.code === 'save_unknown') doc.unknown = { text: submitted }
    if (result.error.code === 'edit_conflict' && result.current) {
      if (result.current.key === doc.key) doc.conflict = result.current
      else doc.error = uiAttribute('文件位置已失效，修改已保留')
    }
    this.changed()
    if (doc.conflict) return this.handleConflict(doc)
    return false
  }

  async confirmClose(tabIds: string[]): Promise<boolean> {
    const docs = new Set(tabIds.map(id => this.tabs.get(id)).filter((doc): doc is FileEditDocument => !!doc))
    for (const doc of docs) if (pending(doc)) {
      if (doc.saving) { doc.error = uiAttribute('正在保存，请稍后关闭'); this.changed(); return false }
      const choice = await this.ask('close', doc)
      if (choice === 'cancel') return false
      if (choice === 'save' && (!await this.save(doc) || pending(doc))) return false
    }
    return true
  }
  release(tabIds: string[]): void {
    for (const id of tabIds) { this.tabs.delete(id); this.#loading.delete(id); this.#handles.delete(id); this.#access.delete(id); this.failures.delete(id) }
    // Another tab can own the same draft after the most recently used handle closes.
    for (const [id, doc] of this.tabs) {
      const access = this.#access.get(id)
      if (access) doc.access = access
    }
    const retained = new Set([...this.tabs.values()].map(doc => doc.key))
    for (const key of this.documents.keys()) if (!retained.has(key)) this.documents.delete(key)
    this.changed()
  }
  dispose(): void { this.dialog?.resolve('cancel'); this.#disposed = true; windows.delete(this); this.#listeners.clear(); this.documents.clear(); this.tabs.clear() }
}
