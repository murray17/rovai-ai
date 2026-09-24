import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type {
  AttachmentPreviewResult,
  LocalAttachmentAvailability,
  LocalAttachmentOwnerLocator,
  LocalAttachmentSourceView
} from '@contracts'
import { isAttachmentId, type DesktopAttachmentTarget } from './attachment-desktop'
import { classifyFilePreview } from './file-preview/file-preview-classifier'

const REGISTRY_SCHEMA_VERSION = 1
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 200
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

interface RegistryEntry {
  campId: string
  attachmentId: string
  sourcePath: string
  displayName: string
  kind: 'file' | 'directory'
  mediaType: string | null
  observedByteSize: number | null
  createdAt: string
  updatedAt: string
}

interface PersistedRegistry {
  schemaVersion: 1
  entries: RegistryEntry[]
}

function entryKey(campId: string, attachmentId: string): string {
  return `${campId}:${attachmentId}`
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
  return typeof entry.campId === 'string'
    && entry.campId.length > 0
    && isAttachmentId(entry.attachmentId)
    && typeof entry.sourcePath === 'string'
    && isAbsolute(entry.sourcePath)
    && typeof entry.displayName === 'string'
    && entry.displayName.length > 0
    && Array.from(entry.displayName).length <= 120
    && (entry.kind === 'file' || entry.kind === 'directory')
    && (entry.mediaType === null || typeof entry.mediaType === 'string')
    && (entry.observedByteSize === null
      || (Number.isInteger(entry.observedByteSize) && Number(entry.observedByteSize) >= 0))
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
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
    campId: string
    sourcePath: string
    displayName: string
    mediaType: string | null
  }): Promise<LocalAttachmentSourceView> {
    await this.#ensureLoaded()
    const attachmentId = randomUUID()
    const now = new Date().toISOString()
    const inspected = await this.#inspect({
      campId: input.campId,
      attachmentId,
      sourcePath: input.sourcePath,
      displayName: input.displayName,
      kind: 'file',
      mediaType: input.mediaType,
      observedByteSize: null,
      createdAt: now,
      updatedAt: now
    }, true)
    if (inspected.view.availability !== 'available' || !inspected.entry) {
      throw new Error('附件当前不可读取。')
    }
    await this.#mutate(() => {
      this.#entries.set(entryKey(input.campId, attachmentId), inspected.entry!)
      this.#prune()
    })
    return inspected.view
  }

  async restore(
    campId: string,
    attachments: readonly LocalAttachmentSourceView[]
  ): Promise<LocalAttachmentSourceView[]> {
    await this.#ensureLoaded()
    const restored: LocalAttachmentSourceView[] = []
    for (const requested of attachments.slice(0, 10)) {
      const entry = this.#entries.get(entryKey(campId, requested.id))
      if (!entry) {
        restored.push({ ...requested, availability: 'missing', sourcePath: undefined })
        continue
      }
      const inspected = await this.#inspect(entry, false)
      restored.push(inspected.view)
    }
    return restored
  }

  async discard(campId: string, attachmentRefIds?: readonly string[]): Promise<void> {
    await this.#ensureLoaded()
    await this.#mutate(() => {
      const selected = attachmentRefIds ? new Set(attachmentRefIds) : null
      for (const [key, entry] of this.#entries) {
        if (entry.campId === campId && (!selected || selected.has(entry.attachmentId))) {
          this.#entries.delete(key)
        }
      }
    })
  }

  async preview(locator: LocalAttachmentOwnerLocator): Promise<AttachmentPreviewResult | null> {
    if (locator.owner !== 'composer') return null
    await this.#ensureLoaded()
    const entry = this.#entries.get(entryKey(locator.campId, locator.attachmentRefId))
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
    const entry = this.#entries.get(entryKey(locator.campId, locator.attachmentRefId))
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
          if (validEntry(entry)) this.#entries.set(entryKey(entry.campId, entry.attachmentId), entry)
        }
        this.#prune()
      })()
    }
    await this.#loaded
  }

  async #mutate(operation: () => void): Promise<void> {
    const next = this.#mutation.then(async () => {
      const previous = new Map(this.#entries)
      operation()
      try {
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
    for (const [key, entry] of sorted) {
      if (this.#entries.size >= MAX_ENTRIES) break
      if (Number.isFinite(Date.parse(entry.updatedAt)) && Date.parse(entry.updatedAt) < cutoff) continue
      this.#entries.set(key, entry)
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
