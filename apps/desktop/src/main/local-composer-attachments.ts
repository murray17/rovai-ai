import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  AttachmentPreviewResult,
  LocalAttachmentAvailability,
  LocalAttachmentOwnerLocator,
  LocalAttachmentSourceView
} from '@contracts'
import { isAttachmentId, type DesktopAttachmentTarget } from './attachment-desktop'
import { classifyFilePreview } from './file-preview/file-preview-classifier'
import { pastedTextPreview } from '../shared/pasted-text-preview'

const REGISTRY_SCHEMA_VERSION = 1
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 200
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

interface RegistryEntry {
  threadId: string
  attachmentId: string
  sourcePath: string
  displayName: string
  kind: 'file' | 'directory'
  mediaType: string | null
  observedByteSize: number | null
  createdAt: string
  updatedAt: string
  /** Only Main's long-paste creation path can grant physical deletion authority. */
  generatedBy?: 'long_text_paste'
  enteredSendFlow?: boolean
  pastedTextPreview?: string
}

interface PersistedRegistry {
  schemaVersion: 1
  entries: RegistryEntry[]
}

function entryKey(threadId: string, attachmentId: string): string {
  return `${threadId}:${attachmentId}`
}

function availabilityFromError(error: unknown): LocalAttachmentAvailability {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'ENOENT') return 'missing'
    if (error.code === 'EACCES' || error.code === 'EPERM') return 'unreadable'
  }
  return 'unknown'
}

function validEntry(value: unknown): value is RegistryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<RegistryEntry>
  return typeof entry.threadId === 'string'
    && entry.threadId.length > 0
    && isAttachmentId(entry.attachmentId)
    && typeof entry.sourcePath === 'string'
    && isAbsolute(entry.sourcePath)
    && typeof entry.displayName === 'string'
    && entry.displayName.length > 0
    && (entry.kind === 'file' || entry.kind === 'directory')
    && (entry.mediaType === null || typeof entry.mediaType === 'string')
    && (entry.observedByteSize === null
      || (Number.isInteger(entry.observedByteSize) && Number(entry.observedByteSize) >= 0))
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
    && (entry.pastedTextPreview === undefined || (typeof entry.pastedTextPreview === 'string'
      && Array.from(entry.pastedTextPreview).length <= 160))
}

export class LocalComposerAttachmentRegistry {
  readonly #path: string
  readonly #entries = new Map<string, RegistryEntry>()
  #loaded: Promise<void> | null = null
  #mutation: Promise<void> = Promise.resolve()

  constructor(path: string) {
    this.#path = path
  }

  async prepare(input: {
    threadId: string
    sourcePath: string
    displayName: string
    mediaType: string | null
    generatedBy?: 'long_text_paste'
    pastedTextPreview?: string
  }): Promise<LocalAttachmentSourceView> {
    await this.#ensureLoaded()
    const attachmentId = randomUUID()
    const now = new Date().toISOString()
    const inspected = await this.#inspect({
      threadId: input.threadId,
      attachmentId,
      sourcePath: input.sourcePath,
      displayName: input.displayName,
      kind: 'file',
      mediaType: input.mediaType,
      observedByteSize: null,
      createdAt: now,
      updatedAt: now,
      ...(input.generatedBy ? { generatedBy: input.generatedBy, enteredSendFlow: false } : {}),
      ...(input.generatedBy && input.pastedTextPreview !== undefined ? { pastedTextPreview: input.pastedTextPreview } : {})
    }, true)
    if (inspected.view.availability !== 'available' || !inspected.entry) {
      throw new Error('附件当前不可读取。')
    }
    await this.#mutate(() => {
      this.#entries.set(entryKey(input.threadId, attachmentId), inspected.entry!)
      this.#prune()
    })
    return inspected.view
  }

  async restore(
    threadId: string,
    attachments: readonly LocalAttachmentSourceView[]
  ): Promise<LocalAttachmentSourceView[]> {
    await this.#ensureLoaded()
    const restored: LocalAttachmentSourceView[] = []
    for (const requested of attachments.slice(0, 10)) {
      const entry = this.#entries.get(entryKey(threadId, requested.id))
      if (!entry) {
        restored.push({ ...requested, availability: 'missing', sourcePath: undefined })
        continue
      }
      const inspected = await this.#inspect(entry, false)
      restored.push(inspected.view)
    }
    return restored
  }

  async discard(threadId: string, attachmentRefIds?: readonly string[]): Promise<void> {
    await this.#ensureLoaded()
    await this.#mutate(() => {
      const selected = attachmentRefIds ? new Set(attachmentRefIds) : null
      for (const [key, entry] of this.#entries) {
        if (entry.threadId === threadId && (!selected || selected.has(entry.attachmentId))) {
          this.#entries.delete(key)
        }
      }
    })
  }

  /** Called only after the replacement local draft has been saved. */
  async removePastedText(
    threadId: string,
    attachmentId: string,
    resolveOutputRoot: () => Promise<string>
  ): Promise<'deleted' | 'retained'> {
    await this.#ensureLoaded()
    let outcome: 'deleted' | 'retained' = 'retained'
    await this.#mutate(async () => {
      const key = entryKey(threadId, attachmentId)
      const entry = this.#entries.get(key)
      // Missing/old/malformed provenance never grants deletion authority.
      if (!entry || entry.generatedBy !== 'long_text_paste') return false
      if (entry.enteredSendFlow === false) {
        const root = await resolveOutputRoot()
        if (dirname(entry.sourcePath) !== root
          || !entry.sourcePath.endsWith('.txt')
          || !isAttachmentId(entry.sourcePath.slice(root.length + 1, -4))) return false
        // Unlink the exact generated entry, never a user-supplied replacement.
        // Parent symlinks are checked again because the directory may have changed.
        await assertNoSymlinkParents(root)
        await unlink(entry.sourcePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        outcome = 'deleted'
      }
      this.#entries.delete(key)
    })
    return outcome
  }

  /** Persist the one-way protection before Main forwards a publication request.
   * Sources are the final request snapshot, not all entries owned by this Thread.
   * An empty/later snapshot never clears protection from an earlier request.
   * This shares #mutation with physical deletion; no per-send state is required.
   */
  async protectForSend(threadId: string, sources: readonly { id: string; sourcePath: string }[]): Promise<void> {
    if (sources.length === 0) return
    await this.#ensureLoaded()
    await this.#mutate(() => {
      const ids = new Set(sources.map(source => source.id))
      const paths = new Set(sources.map(source => source.sourcePath))
      let changed = false
      for (const [key, entry] of this.#entries) {
        if (entry.generatedBy === 'long_text_paste'
          && entry.enteredSendFlow !== true
          // The same source can be selected as an external file in another
          // Thread. IDs are Thread-scoped; exact source paths protect their owner.
          && ((entry.threadId === threadId && ids.has(entry.attachmentId)) || paths.has(entry.sourcePath))) {
          this.#entries.set(key, { ...entry, enteredSendFlow: true })
          changed = true
        }
      }
      return changed
    })
  }

  async preview(locator: LocalAttachmentOwnerLocator): Promise<AttachmentPreviewResult | null> {
    if (locator.owner !== 'composer') return null
    await this.#ensureLoaded()
    const entry = this.#entries.get(entryKey(locator.threadId, locator.attachmentRefId))
    if (!entry) return { preview: null, availability: 'missing' }
    const inspected = await this.#inspect(entry, false)
    if (inspected.view.availability !== 'available'
      || inspected.view.previewKind !== 'image'
      || inspected.view.byteSize === null
      || inspected.view.byteSize > MAX_PREVIEW_BYTES) {
      return { preview: null, availability: inspected.view.availability }
    }
    try {
      const bytes = await readFile(entry.sourcePath)
      if (bytes.byteLength !== inspected.view.byteSize || bytes.byteLength > MAX_PREVIEW_BYTES) {
        return { preview: null, availability: 'unreadable' }
      }
      return {
        preview: {
          mediaType: inspected.view.mediaType ?? 'application/octet-stream',
          bytes: new Uint8Array(bytes)
        },
        availability: 'available'
      }
    } catch (error) {
      return { preview: null, availability: availabilityFromError(error) }
    }
  }

  async resolveTarget(
    locator: LocalAttachmentOwnerLocator
  ): Promise<{ target: DesktopAttachmentTarget | null; availability: LocalAttachmentAvailability } | null> {
    if (locator.owner !== 'composer') return null
    await this.#ensureLoaded()
    const entry = this.#entries.get(entryKey(locator.threadId, locator.attachmentRefId))
    if (!entry) return { target: null, availability: 'missing' }
    const inspected = await this.#inspect(entry, false)
    if (inspected.view.availability !== 'available') {
      return { target: null, availability: inspected.view.availability }
    }
    const classification = inspected.view.kind === 'file'
      ? classifyFilePreview(entry.sourcePath, inspected.view.byteSize ?? 0, new Uint8Array())
      : null
    return {
      target: {
        attachmentId: entry.attachmentId,
        displayName: entry.displayName,
        kind: inspected.view.kind,
        mediaType: inspected.view.mediaType ?? classification?.mime ?? 'application/octet-stream',
        path: entry.sourcePath,
        openRisk: classification?.openRisk ?? 'normal',
        canShowPath: true
      },
      availability: 'available'
    }
  }

  async location(locator: LocalAttachmentOwnerLocator): Promise<string | null> {
    const resolved = await this.resolveTarget(locator)
    return resolved?.target?.path ?? null
  }

  async #inspect(
    entry: RegistryEntry,
    preparing: boolean
  ): Promise<{ entry: RegistryEntry | null; view: LocalAttachmentSourceView }> {
    try {
      if (!isAbsolute(entry.sourcePath)) throw new Error('Attachment source must be absolute')
      const info = await lstat(entry.sourcePath)
      const kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null
      if (!kind) throw new Error('Attachment source must be a regular file or directory')
      if (!preparing && entry.kind !== kind) {
        return { entry, view: this.#view(entry, 'kind_changed') }
      }
      await access(entry.sourcePath, constants.R_OK)
      const classification = kind === 'file'
        ? classifyFilePreview(entry.sourcePath, info.size, new Uint8Array())
        : null
      const next: RegistryEntry = {
        ...entry,
        kind,
        mediaType: kind === 'file' ? entry.mediaType ?? classification?.mime ?? null : null,
        observedByteSize: kind === 'file' ? info.size : null,
        updatedAt: new Date().toISOString()
      }
      return { entry: next, view: this.#view(next, 'available', classification?.kind === 'image') }
    } catch (error) {
      if (preparing) throw error
      return { entry, view: this.#view(entry, availabilityFromError(error)) }
    }
  }

  #view(
    entry: RegistryEntry,
    availability: LocalAttachmentAvailability,
    image = false
  ): LocalAttachmentSourceView {
    return {
      id: entry.attachmentId,
      displayName: entry.displayName,
      kind: entry.kind,
      fileCount: entry.kind === 'file' ? 1 : null,
      mediaType: entry.mediaType,
      byteSize: entry.observedByteSize,
      previewKind: image ? 'image' : 'none',
      availability,
      ...(entry.generatedBy === 'long_text_paste' ? { generatedBy: entry.generatedBy } : {}),
      ...(entry.pastedTextPreview !== undefined ? { pastedTextPreview: entry.pastedTextPreview } : {}),
      sourcePath: availability === 'missing' ? undefined : entry.sourcePath
    }
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) {
      this.#loaded = (async () => {
        const persisted = await readFile(this.#path, 'utf8')
          .then((encoded) => JSON.parse(encoded) as unknown)
          .catch(() => null)
        if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return
        const record = persisted as Partial<PersistedRegistry>
        if (record.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(record.entries)) return
        for (const entry of record.entries) {
          if (validEntry(entry)) this.#entries.set(entryKey(entry.threadId, entry.attachmentId), entry)
        }
        this.#prune()
      })()
    }
    await this.#loaded
  }

  async #mutate(operation: () => void | boolean | Promise<void | boolean>): Promise<void> {
    const next = this.#mutation.then(async () => {
      const previous = new Map(this.#entries)
      try {
        if (await operation() === false) return
        await this.#persist()
      } catch (error) {
        this.#entries.clear()
        for (const [key, entry] of previous) this.#entries.set(key, entry)
        throw error
      }
    })
    this.#mutation = next.catch(() => undefined)
    await next
  }

  #prune(): void {
    const cutoff = Date.now() - RETENTION_MS
    const sorted = [...this.#entries.entries()].sort((left, right) =>
      Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt)
    )
    this.#entries.clear()
    let ordinaryEntries = 0
    for (const [key, entry] of sorted) {
      // Generated entries are retained until explicit draft release or Thread
      // deletion. They may still own recovery, protection, or failed cleanup.
      if (entry.generatedBy === 'long_text_paste') {
        this.#entries.set(key, entry)
        continue
      }
      if (ordinaryEntries >= MAX_ENTRIES) continue
      if (Number.isFinite(Date.parse(entry.updatedAt)) && Date.parse(entry.updatedAt) < cutoff) continue
      this.#entries.set(key, entry)
      ordinaryEntries += 1
    }
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true })
    const temporary = `${this.#path}.tmp-${process.pid}-${randomUUID()}`
    const record: PersistedRegistry = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      entries: [...this.#entries.values()]
    }
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.#path)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }
}

export async function assertNoSymlinkParents(directory: string): Promise<void> {
  for (let path = directory; ; path = dirname(path)) {
    // Node lstat rejects a namespaced Windows drive root (\\?\C:\).
    // Keep the namespace on every other component, including long paths.
    const metadataPath = process.platform === 'win32' && /^\\\\\?\\[a-z]:\\$/iu.test(path)
      ? path.slice(4)
      : path
    const info = await lstat(metadataPath)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('附件目录已变化。')
    if (dirname(path) === path) break
  }
}

/** The root comes from Host/Core. No platform layout is reconstructed here. */
export async function createPastedTextAttachment(
  registry: LocalComposerAttachmentRegistry,
  threadId: string,
  outputRoot: string,
  displayName: string,
  bytes: Uint8Array
): Promise<LocalAttachmentSourceView> {
  await assertNoSymlinkParents(outputRoot)
  const sourcePath = join(outputRoot, `${randomUUID()}.txt`)
  await writeFile(sourcePath, bytes, { flag: 'wx', mode: 0o600 })
  // Report failure promptly so Renderer restores its original text first.
  // A write/registry failure before returning an identity can leave a residue
  // for normal Thread deletion; it does not create a second recovery protocol.
  return registry.prepare({
    threadId, sourcePath, displayName, mediaType: 'text/plain;charset=utf-8', generatedBy: 'long_text_paste',
    pastedTextPreview: pastedTextPreview(bytes)
  })
}
