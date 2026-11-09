import type { ComposerDocument, ThreadMessageView } from '@contracts'
import { composerDocumentFromLegacyContent, composerDocumentFromText, normalizeComposerDocument, validateComposerDocument } from './composer-document'

export const REEDIT_TTL_MS = 120_000
export const REEDIT_LIMITS = { recordBytes: 64 * 1024, totalBytes: 512 * 1024, records: 100 } as const
const PREFIX = 'rovai.message-reedit.v1:'
type LocalStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>
export interface WithdrawalRequest {
  commandId: string
  command: { threadId: string; messageId: string; expectedVersion: number }
}
interface ReeditRecord {
  version: 1
  scope: string
  request: WithdrawalRequest
  document: ComposerDocument
  state: 'pending' | 'ready'
  pendingExpiresAt: number
  expiresAt: number | null
}

function browserStorage(): LocalStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** Only authored text and explicit people mentions. No display prefixes or attachment/reply authority. */
export function messageReeditDocument(message: Pick<ThreadMessageView, 'content' | 'body'>): ComposerDocument | null {
  const document = message.content.length
    ? composerDocumentFromLegacyContent(message.content.flatMap(segment =>
      segment.kind === 'project_file_reference' ? [{ kind: 'text' as const, text: segment.labelAtSend }]
        : segment.kind === 'text' || segment.kind === 'member_mention' || segment.kind === 'all_members_mention' ? [segment] : []))
    : composerDocumentFromText(message.body)
  return document.segments.some(segment => segment.kind === 'atom' || segment.text.trim()) ? document : null
}

/** A bounded, best-effort client store. Limits are not reservations or cross-window transactions. */
export class MessageReeditStore {
  private readonly prefix: string
  private readonly listeners = new Map<string, Set<() => void>>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(
    private readonly scope: string,
    private readonly storage: LocalStorage | null = browserStorage(),
    private readonly now: () => number = Date.now
  ) { this.prefix = `${PREFIX}${encodeURIComponent(scope)}:` }

  subscribe(threadId: string, messageId: string, listener: () => void): () => void {
    const key = this.key(threadId, messageId)
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(listener)
    this.listeners.set(key, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(key)
    }
  }

  private key(threadId: string, messageId: string, scope = this.scope): string {
    return `${PREFIX}${encodeURIComponent(scope)}:${encodeURIComponent(threadId)}:${encodeURIComponent(messageId)}`
  }
  private deadline(record: ReeditRecord): number {
    return record.state === 'ready' ? record.expiresAt! : record.pendingExpiresAt
  }
  private parse(raw: string | null, enforceScope = true): ReeditRecord | null {
    if (!raw || raw.length * 2 > REEDIT_LIMITS.recordBytes) return null
    try {
      const r = JSON.parse(raw) as ReeditRecord
      const c = r?.request?.command
      if (r.version !== 1 || typeof r.scope !== 'string' || !r.scope || (enforceScope && r.scope !== this.scope)
        || typeof r.request?.commandId !== 'string'
        || !r.request.commandId || typeof c?.threadId !== 'string' || !c.threadId
        || typeof c.messageId !== 'string' || !c.messageId || !Number.isSafeInteger(c.expectedVersion) || c.expectedVersion < 1
        || !Number.isFinite(r.pendingExpiresAt) || r.pendingExpiresAt <= 0
        || !['pending', 'ready'].includes(r.state)
        || (r.state === 'pending' ? r.expiresAt !== null
          : !Number.isFinite(r.expiresAt) || r.expiresAt! <= 0 || r.expiresAt! > r.pendingExpiresAt + REEDIT_TTL_MS)) return null
      if (!validateComposerDocument(r.document)) return null
      const document = normalizeComposerDocument(r.document)
      if (!document.segments.length || document.segments.some(segment =>
        segment.kind === 'atom' && !['member', 'all_members'].includes(segment.atom.type))) return null
      return { ...r, document }
    } catch { return null }
  }
  private read(threadId: string, messageId: string): ReeditRecord | null {
    try {
      const r = this.parse(this.storage?.getItem(this.key(threadId, messageId)) ?? null)
      return r && r.request.command.threadId === threadId && r.request.command.messageId === messageId
        && this.now() < this.deadline(r) ? r : null
    } catch { return null }
  }

  /** Shared validity gate for display, click and final replacement. Never extends a deadline. */
  readReady(threadId: string, messageId: string): ComposerDocument | null {
    const record = this.read(threadId, messageId)
    return record?.state === 'ready' ? record.document : null
  }
  requestFor(threadId: string, messageId: string): WithdrawalRequest | null {
    return this.read(threadId, messageId)?.request ?? null
  }

  private entries(allScopes = false): Array<{ key: string; raw: string; record: ReeditRecord | null }> {
    try {
      const keys = Array.from({ length: this.storage?.length ?? 0 }, (_, i) => this.storage!.key(i))
      return keys.filter((key): key is string => Boolean(key?.startsWith(allScopes ? PREFIX : this.prefix))).map(key => {
        const raw = this.storage!.getItem(key) ?? ''
        const record = this.parse(raw, !allScopes)
        return { key, raw, record: record && this.key(record.request.command.threadId, record.request.command.messageId, record.scope) === key ? record : null }
      })
    } catch { return [] }
  }
  private remove(key: string): void {
    try { this.storage?.removeItem(key) } catch { /* Reads still reject expired/unreadable records. */ }
    this.changed(key)
  }
  private changed(key: string | null): void {
    // Only storage.clear() needs a broadcast. Ordinary sweeps do not invalidate unrelated rows.
    if (key === null) this.listeners.forEach(listeners => listeners.forEach(listener => listener()))
    else this.listeners.get(key)?.forEach(listener => listener())
  }
  private write(record: ReeditRecord): boolean {
    try { this.storage!.setItem(this.key(record.request.command.threadId, record.request.command.messageId), JSON.stringify(record)); return true }
    catch { return false }
  }

  stage(request: WithdrawalRequest, document: ComposerDocument): boolean {
    this.sweep()
    const existing = this.read(request.command.threadId, request.command.messageId)
    if (existing) return existing.request.commandId === request.commandId
    const record: ReeditRecord = { version: 1, scope: this.scope, request, document,
      state: 'pending', pendingExpiresAt: this.now() + REEDIT_TTL_MS, expiresAt: null }
    // Reserve the extra characters for the later ready timestamp within this module's soft budget.
    const bytes = JSON.stringify({ ...record, expiresAt: record.pendingExpiresAt + REEDIT_TTL_MS }).length * 2
    const entries = this.entries(true)
    if (!this.storage || bytes > REEDIT_LIMITS.recordBytes || entries.length >= REEDIT_LIMITS.records
      || entries.reduce((sum, entry) => sum + entry.raw.length * 2 + 32, 0) + bytes > REEDIT_LIMITS.totalBytes) return false
    const saved = this.write(record)
    this.sweep()
    return saved
  }

  confirm(request: WithdrawalRequest, recovered = false): boolean {
    const { threadId, messageId } = request.command
    const record = this.read(threadId, messageId)
    if (!record || record.request.commandId !== request.commandId) return false
    if (record.state === 'ready') return true
    const saved = this.write({ ...record, state: 'ready',
      expiresAt: recovered ? record.pendingExpiresAt : this.now() + REEDIT_TTL_MS })
    if (!saved) this.remove(this.key(threadId, messageId))
    else this.changed(this.key(threadId, messageId))
    this.sweep()
    return saved
  }
  reject(request: WithdrawalRequest): void {
    const { threadId, messageId } = request.command
    if (this.read(threadId, messageId)?.request.commandId === request.commandId) this.remove(this.key(threadId, messageId))
    this.sweep()
  }
  pending(): WithdrawalRequest[] {
    return this.entries().flatMap(({ record }) => record?.state === 'pending'
      && this.now() < record.pendingExpiresAt ? [record.request] : [])
  }
  deleteThread(threadId: string): void {
    for (const { key, record } of this.entries()) if (record?.request.command.threadId === threadId) this.remove(key)
    this.sweep()
  }

  sweep = (): void => {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    let next = Infinity
    // Clean the dedicated namespace, including expired copies from previously active owners.
    // Recovery/replay remain scoped; other owners' live records are never returned or evicted.
    for (const { key, record } of this.entries(true)) {
      if (!record || this.now() >= this.deadline(record)) this.remove(key)
      else next = Math.min(next, this.deadline(record))
    }
    if (this.running && Number.isFinite(next)) this.timer = setTimeout(this.sweep, Math.max(0, next - this.now()))
  }
  start(target: Window = window): () => void {
    this.running = true
    const storageChanged = (event: StorageEvent): void => {
      if (event.key === null || event.key.startsWith(PREFIX)) {
        this.sweep()
        this.changed(event.key)
      }
    }
    const visible = (): void => { if (target.document.visibilityState === 'visible') this.sweep() }
    target.addEventListener('storage', storageChanged)
    target.addEventListener('focus', this.sweep)
    target.document.addEventListener('visibilitychange', visible)
    this.sweep()
    return () => {
      this.running = false
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = null
      target.removeEventListener('storage', storageChanged)
      target.removeEventListener('focus', this.sweep)
      target.document.removeEventListener('visibilitychange', visible)
    }
  }
}
