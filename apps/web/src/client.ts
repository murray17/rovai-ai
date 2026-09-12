import { sha256 } from '@noble/hashes/sha2.js'
import { newCommandId } from '../../desktop/src/shared/command-id'
import type { CampComposerDraftView } from '@contracts'
class HttpRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`请求未完成（${code}）。`) }
}

class CoreRequestError extends Error {
  constructor(readonly code: string, message?: string) { super(message || `操作未完成（${code}）。`) }
}

export class SessionRequired extends Error {
  constructor() { super('会话已失效，请重新登录。') }
}

export type WorkspaceListing = { name: string; projectPath: string; parentPath: string | null; roots: string[]; directories: { name: string; projectPath: string }[]; nextOffset: number | null }

export const WEB_OPERATIONS = ["app.info", "navigation.snapshot", "navigation.groupCamps", "navigation.campViewed", "camps.exists", "camps.open", "camps.enter", "camp.messages.page", "camp.messages.around", "camp.messages.find", "members.list", "members.get", "tasks.list", "tasks.get", "memory.list", "memory.get", "memory.hearthReviewItems.list", "automations.list", "automations.get", "automations.runs.list", "runtime.installations.list", "runtime.subsystems.get", "monitoring.snapshot", "health.check", "skills.list", "skills.get", "skills.deliveryGroups.list", "mcp.config.get", "agentRunEvidence.list", "agentRunEvidence.getContent", "camp.composerDraft.get", "camp.composerDraft.save", "camp.composerDraft.discard", "camp.composerDraft.startReply", "camp.composerDraft.cancelReply", "camp.composerDraft.resolveReplyRecipient", "camp.composerDraft.dismissContinuation", "camp.composerDraft.resolveContinuationRecipient", "camp.composerDraft.removeAttachment", "messageQuotes.mutateDraft", "camp.pendingInputs.get", "camp.pendingInputs.edit", "camp.messages.send", "action.approvals.resolve", "agentRuns.cancel", "campTurns.cancel", "commands.reconcile", "camps.create", "camps.creationPreflight", "camps.members.add", "camps.members.remove", "camps.members.removalPreview", "camps.changeDefaultLead", "members.create", "members.update", "members.avatar.set", "members.runtime.set", "members.runtime.clear", "workspaces.inspect", "workspaces.validate", "agentRunImages.read", "agentRunFileChanges.get", "agentRuns.diagnostic.get", "runtime.product.ensure", "runtime.product.check", "runtime.modelCatalog.open", "runtime.discovery.rescan"] as const
export type WebOperation = typeof WEB_OPERATIONS[number]

const RECONCILABLE_COMMANDS = new Set<WebOperation>([
  'camp.messages.send', 'action.approvals.resolve', 'agentRuns.cancel', 'campTurns.cancel',
  'camps.create', 'camps.changeDefaultLead', 'camps.members.add', 'camps.members.remove',
  'members.create', 'members.update', 'members.avatar.set', 'members.runtime.set', 'members.runtime.clear',
  'camp.pendingInputs.edit', 'messageQuotes.mutateDraft'
])

export type ConnectionState = 'connecting' | 'live' | 'offline' | 'expired'
type PendingCommand = { operation: WebOperation; params: unknown; resolve(value: unknown): void; reject(error: unknown): void }
type PendingUpload = { intent: unknown; data: FormData; resolve(draft: CampComposerDraftView): void; reject(error: unknown): void }
type CommandReceipt = { state: 'unknown' | 'recorded'; result?: unknown; error?: { code: string; message?: string } }

/** Decodes bounded SSE frames; payloads are invalidations, never private Core events. */
export class InvalidationDecoder {
  #buffer = ''
  push(text: string): boolean {
    this.#buffer += text
    if (this.#buffer.length > 64 * 1024) throw new Error('实时连接的数据超出限制。')
    let changed = false
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.#buffer)
      if (!match) return changed
      const frame = this.#buffer.slice(0, match.index)
      this.#buffer = this.#buffer.slice(match.index + match[0].length)
      if (/^event: ?(?:resync|invalidate)\r?$/m.test(frame)) changed = true
    }
  }
}

export class ConsoleClient {
  readonly origin: string
  #token: string | null = null
  #generation = 0
  #lifetime = new AbortController()
  #fetch: typeof fetch
  #editor: { clientId: string; proof: string } | null = null
  #ownerId: string | null = null
  #authListeners = new Set<() => void>()

  #pending = new Map<string, PendingCommand>()
  #pendingUploads = new Map<string, PendingUpload>()
  #reconciling = false
  #pendingListeners = new Set<() => void>()
  get pendingCommandCount(): number { return this.#pending.size + this.#pendingUploads.size }
  onPendingCommandsChanged(listener: () => void): () => void {
    this.#pendingListeners.add(listener)
    return () => { this.#pendingListeners.delete(listener) }
  }
  #notifyPending(): void { for (const listener of this.#pendingListeners) listener() }

  get editingScope(): string | null {
    return this.#editor && this.#ownerId ? `${this.origin}/${this.#ownerId}/${this.#editor.clientId}` : null
  }
  get presentationScope(): string | null {
    return this.#ownerId ? `${this.origin}/${this.#ownerId}` : null
  }
  get authenticated(): boolean { return this.#token !== null }
  onAuthenticationChanged(listener: () => void): () => void {
    this.#authListeners.add(listener)
    return () => { this.#authListeners.delete(listener) }
  }

  constructor(origin: string, fetcher: typeof fetch = fetch) {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('控制台地址无效。')
    this.origin = origin
    // Native Window.fetch requires its Window receiver even when retained by a
    // transport object. Node's implementation does not expose this constraint.
    this.#fetch = fetcher.bind(globalThis)
  }

  async login(administratorToken: string): Promise<void> {
    this.clear()
    const generation = this.#generation
    const response = await this.#fetch(`${this.origin}/api/v1/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 2, administratorToken, ...(this.#editor ? { editor: this.#editor } : {}) }), credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: this.#lifetime.signal
    })
    if (!response.ok) throw new Error(response.status === 409 ? 'Web 与 Host 协议不兼容，请使用同一版本。' : response.status === 429 ? '登录次数过多，请稍后再试。' : '登录失败，请检查管理令牌。')
    const session = await response.json() as { protocolVersion?: unknown; token?: unknown; clientId?: unknown; editorProof?: unknown; ownerId?: unknown }
    if (generation !== this.#generation) throw new SessionRequired()
    if (session.protocolVersion !== 2) throw new Error('Web 与 Host 协议不兼容，请使用同一版本。')
    if (typeof session.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error('会话响应无效。')
    if (typeof session.clientId !== 'string' || !/^[a-f0-9]{64}$/.test(session.clientId)
      || typeof session.editorProof !== 'string' || !/^[a-f0-9]{64}$/.test(session.editorProof)
      || typeof session.ownerId !== 'string') throw new Error('编辑归属响应无效。')
    if (this.#ownerId !== null && this.#ownerId !== session.ownerId) throw new Error('Owner 已变化，请先保存当前编辑并切换连接。')
    if (this.#editor !== null && this.#editor.clientId !== session.clientId) throw new Error('编辑归属已变化，无法把当前编辑转交给新的草稿身份。')
    this.#editor = { clientId: session.clientId, proof: session.editorProof }
    this.#ownerId = session.ownerId
    this.#token = session.token
    void this.reconcilePending()
    for (const listener of this.#authListeners) listener()
  }

  clear(): void {
    this.#token = null
    this.#generation++
    this.#lifetime.abort()
    this.#lifetime = new AbortController()
    for (const listener of this.#authListeners) listener()
  }

  async logout(): Promise<void> {
    const generation = this.#generation
    try { await this.#authorized('logout', { method: 'POST' }) }
    finally { if (generation === this.#generation) this.clear() }
  }

  async request<T>(operation: WebOperation, params: unknown = {}): Promise<T> {
    const commandId = params && typeof params === 'object' && 'commandId' in params ? params.commandId : undefined
    if (!RECONCILABLE_COMMANDS.has(operation) || typeof commandId !== 'string') return this.#rpc<T>(operation, params)
    if (!this.authenticated) throw new SessionRequired()
    if (this.#pending.has(commandId)) throw new Error('原命令仍在核对中，请等待其结果。')
    // Keep the original request and promise alive through connection/session
    // loss. Shared production handlers retain their submitting state; no new ID
    // or automatic redispatch is manufactured by the Web adapter.
    return new Promise<T>((resolve, reject) => {
      const entry = { operation, params: structuredClone(params), resolve: (value: unknown) => resolve(value as T), reject }
      this.#pending.set(commandId, entry)
      this.#notifyPending()
      void this.#dispatchCommand(commandId, entry)
    })
  }

  async #dispatchCommand(commandId: string, entry: PendingCommand, preserveUnknown = false): Promise<void> {
    await this.#rpc(entry.operation, entry.params).then(value => {
        if (this.#pending.get(commandId) !== entry) return
        this.#pending.delete(commandId); this.#notifyPending(); entry.resolve(value)
      }).catch(error => {
        if (preserveUnknown) { void this.reconcilePending(); return }
        if (error instanceof HttpRequestError && ['operation_not_admitted', 'workspace_not_authorized', 'request_capacity'].includes(error.code)) {
          if (this.#pending.get(commandId) === entry) { this.#pending.delete(commandId); this.#notifyPending(); entry.reject(error) }
          return
        }
        if (error instanceof CoreRequestError || error instanceof SessionRequired) {
          // An explicit authentication rejection was not admitted. A Core error
          // is first checked for a receipt, including errors after a commit.
          void this.#settleKnownFailure(commandId, entry, error)
        } else { void this.reconcilePending() }
      })
  }

  async #settleKnownFailure(commandId: string, entry: PendingCommand, error: Error): Promise<void> {
    if (error instanceof SessionRequired) {
      if (this.#pending.get(commandId) === entry) { this.#pending.delete(commandId); this.#notifyPending(); entry.reject(error) }
      return
    }
    try {
      const receipt = await this.#rpc<CommandReceipt>('commands.reconcile', { operation: entry.operation, params: entry.params })
      if (this.#pending.get(commandId) !== entry) return
      this.#pending.delete(commandId); this.#notifyPending()
      if (receipt.state === 'recorded' && receipt.error) entry.reject(new CoreRequestError(receipt.error.code, receipt.error.message))
      else if (receipt.state === 'recorded') entry.resolve(receipt.result)
      else entry.reject(error) // Explicit Core completion plus a successful absent-receipt lookup.
    } catch { /* Still unknown if reconciliation itself could not complete. */ }
  }

  async uploadFile(campId: string, expectedRevision: number, file: File): Promise<CampComposerDraftView> {
    if (!this.authenticated) throw new SessionRequired()
    if (file.size > 20 * 1024 * 1024) throw new Error('单个上传文件不能超过 20 MB。')
    const digest = sha256(new Uint8Array(await file.arrayBuffer()))
    const commandId = newCommandId()
    const intent = { commandId, campId, expectedRevision, displayName: file.name, byteSize: file.size,
      sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    const data = new FormData(); data.append('intent', JSON.stringify(intent)); data.append('file', file)
    return new Promise((resolve, reject) => {
      const entry = { intent, data, resolve, reject }
      this.#pendingUploads.set(commandId, entry); this.#notifyPending()
      void this.#dispatchUpload(commandId, entry)
    })
  }

  async #dispatchUpload(commandId: string, entry: PendingUpload, preserveUnknown = false): Promise<void> {
    await this.#json<{ draft: CampComposerDraftView }>('uploads', { method: 'POST', body: entry.data }).then(result => {
        if (this.#pendingUploads.get(commandId) !== entry) return
        this.#pendingUploads.delete(commandId); this.#notifyPending(); entry.resolve(result.draft)
      }).catch(error => {
        if (preserveUnknown) { void this.reconcilePending(); return }
        if (error instanceof SessionRequired || (error instanceof HttpRequestError && ['draft_changed', 'invalid_upload', 'upload_too_large', 'upload_changed_or_session_expired', 'upload_conflict', 'upload_capacity'].includes(error.code))) {
          if (this.#pendingUploads.get(commandId) === entry) { this.#pendingUploads.delete(commandId); this.#notifyPending(); entry.reject(error) }
        } else { void this.reconcilePending() }
      })
  }

  /** Explicit user action only. Reconcile first, then reuse exact identities and
   * payloads for requests whose receipts are still unknown. Never called by SSE,
   * reconnect or login. Core remains the sole command/replay authority. */
  async retryPending(): Promise<void> {
    if (!this.authenticated) throw new SessionRequired()
    await this.reconcilePending()
    for (const [id, entry] of [...this.#pending]) {
      if (this.#pending.get(id) === entry) await this.#dispatchCommand(id, entry, true)
    }
    for (const [id, entry] of [...this.#pendingUploads]) {
      if (this.#pendingUploads.get(id) === entry) await this.#dispatchUpload(id, entry, true)
    }
  }

  async files<T>(action: string, request: unknown): Promise<T> {
    return this.#json('files', { method: 'POST', body: JSON.stringify({ action, request }) })
  }
  async attachment(locator: unknown): Promise<{ blob: Blob; name: string }> {
    const generation = this.#generation
    const response = await this.#authorized('attachments', { method: 'POST', body: JSON.stringify(locator) })
    const blob = await response.blob()
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
    const name = encodedName ? decodeURIComponent(encodedName).replace(/[\\/\x00-\x1f\x7f]/g, '_') : 'attachment'
    return { blob, name }
  }

  async reconcilePending(): Promise<void> {
    if (this.#reconciling || !this.authenticated) return
    this.#reconciling = true
    try {
      for (const [id, entry] of this.#pending) {
        try {
          const receipt = await this.#rpc<CommandReceipt>('commands.reconcile', { operation: entry.operation, params: entry.params })
          if (receipt.state === 'recorded' && this.#pending.get(id) === entry) {
            this.#pending.delete(id); this.#notifyPending()
            if (receipt.error) entry.reject(new CoreRequestError(receipt.error.code, receipt.error.message))
            else entry.resolve(receipt.result)
          }
        } catch { /* Unknown stays associated with its original commandId. */ }
      }
      for (const [id, entry] of this.#pendingUploads) {
        try {
          const result = await this.#json<{ draft?: CampComposerDraftView }>('uploads/reconcile', { method: 'POST', body: JSON.stringify(entry.intent) })
          if (result.draft && this.#pendingUploads.get(id) === entry) {
            this.#pendingUploads.delete(id); this.#notifyPending(); entry.resolve(result.draft)
          }
        } catch { /* No deletion or redispatch while binding remains unknown. */ }
      }
    } finally { this.#reconciling = false }
  }

  async #rpc<T>(operation: WebOperation, params: unknown): Promise<T> {
    const generation = this.#generation
    const response = await this.#authorized('request', { method: 'POST', body: JSON.stringify({ operation, params }) })
    const body = await response.json() as { result: T; error?: { code?: string; message?: string } }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (body.error) throw new CoreRequestError(body.error.code ?? 'request_failed', body.error.message)
    return body.result
  }

  async getWorkspaces(path?: string, offset = 0): Promise<WorkspaceListing> {
    return this.#json('workspaces', { method: 'POST', body: JSON.stringify({ path, offset }) })
  }

  async #json<T>(path: 'workspaces' | 'uploads' | 'uploads/reconcile' | 'files', options: RequestInit = {}): Promise<T> {
    const generation = this.#generation
    const result = await (await this.#authorized(path, options)).json() as T
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return result
  }

  async #authorized(path: 'request' | 'events' | 'logout' | 'workspaces' | 'uploads' | 'uploads/reconcile' | 'files' | 'attachments', options: RequestInit = {}): Promise<Response> {
    if (!this.#token) throw new SessionRequired()
    const generation = this.#generation
    const response = await this.#fetch(`${this.origin}/api/v1/${path}`, {
      ...options, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${this.#token}` },
      signal: options.signal ? AbortSignal.any([options.signal, this.#lifetime.signal]) : this.#lifetime.signal
    })
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (response.status === 401) { this.clear(); throw new SessionRequired() }
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { code?: string } }
      throw new HttpRequestError(response.status, error.error?.code ?? 'connection_unavailable')
    }
    return response
  }

  subscribe(invalidate: () => void, status: (state: ConnectionState) => void): () => void {
    const controller = new AbortController()
    const lifetime = this.#lifetime.signal
    const signal = AbortSignal.any([controller.signal, lifetime])
    const run = async (): Promise<void> => {
      let retry = 1000
      while (!signal.aborted) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          status('connecting')
          const response = await this.#authorized('events', { signal })
          if (!response.body) throw new Error('实时连接不可用。')
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          const frames = new InvalidationDecoder()
          status('live')
          retry = 1000
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (frames.push(decoder.decode(value, { stream: true }))) { invalidate(); void this.reconcilePending() }
          }
        } catch (error) {
          if (error instanceof SessionRequired) { status('expired'); return }
          if (signal.aborted) return
        } finally {
          await reader?.cancel().catch(() => undefined)
          reader?.releaseLock()
        }
        if (signal.aborted) return
        status('offline')
        await new Promise<void>((resolve) => {
          const onAbort = (): void => { clearTimeout(timer); resolve() }
          const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, retry)
          signal.addEventListener('abort', onAbort, { once: true })
        })
        retry = Math.min(retry * 2, 30_000)
      }
    }
    void run()
    return () => controller.abort()
  }
}
