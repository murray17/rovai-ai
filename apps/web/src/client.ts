import { TAB_AUTH_KEY, type AuthStorage, type BrowserSession } from './auth-storage'
import { browserEditingRecovery } from './editing-recovery'
import { RECOVERY_KEY, type RecoveryStorage } from './tab-recovery'
import { fileDigest } from './file-digest'
import { newCommandId } from '../../desktop/src/shared/command-id'
import type { ChannelSettingsSnapshot, FilePreviewBinaryContent, FilePreviewOperationResult, LocalAttachmentSourceView } from '@contracts'

const HOST_WEB_PROTOCOL_VERSION = 4

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

export const WEB_OPERATIONS = [
  'camps.rename',
  'camps.delete',
  'camps.deletionIssues',
  'camps.retryDeletion',
  'camps.discardPending',
  'camps.members.fast.check',
  'camps.members.fast.set',
  'members.removalPreview',
  'members.remove',
  'members.reorder',
  'runtime.subsystems.retry',
  'notifications.inbox',
  'notifications.changesSince',
  'notifications.preference.get',
  'notifications.preference.update',
  'notifications.acknowledge',
  'notifications.acknowledgeVisibleSources',
  'diagnostics.check',
  'diagnostics.export',
  'skills.reconcile',
  'singleChat.list',
  'singleChat.get',
  'singleChat.open',
  'singleChat.send',
  'singleChat.end',
  'singleChat.pendingInputs.edit',
  'singleChat.composerDraft.removeAttachment',
  'skills.content.read',
  'skills.import.inspect',
  'skills.import.github.inspect',
  'skills.import.commit',
  'skills.setEnabled',
  'skills.setGroupAssignments',
  'skills.delete',
  'mcp.servers.create',
  'mcp.servers.update',
  'mcp.servers.setMembers',
  'mcp.servers.setEnabled',
  'mcp.servers.delete',
  'mcp.servers.reveal',
  'mcp.config.repairPermissions',
  'mcp.import.scan',
  'mcp.import.commit',
  'runtime.startup.get',
  'runtime.startup.save',
  'runtime.startup.inspect',
  'runtime.startup.check',
  'navigation.findCamp',
  'agentRunExecution.page',
  'agentRunExecution.changes',
  'tasks.create',
  'tasks.update',
  'memory.create',
  'memory.revise',
  'memory.retire',
  'memory.reactivate',
  'memory.forget',
  'memory.supersede',
  'memory.review.schedule',
  'memory.hearthReviewItems.accept',
  'memory.hearthReviewItems.reject',
  'memory.export',
  'missions.workspace.cleanup',
  'missions.cleanup.list',
  'missions.cleanup.retry',
  'missions.list',
  'missions.get',
  'missions.activity',
  'missions.delivery',
  'missions.changes',
  'missions.fileDiff',
  'missions.diffSession.release',
  'missions.create',
  'missions.update',
  'missions.status',
  'missions.start',
  'missions.linkPr',
  'automations.create',
  'automations.update',
  'automations.close',
  'automations.delete',
  'automations.run',
  'app.info',
  'navigation.snapshot',
  'navigation.camps',
  'navigation.groupCamps',
  'navigation.campViewed',
  'camps.exists',
  'camps.open',
  'camps.enter',
  'camp.messages.page',
  'camp.messages.around',
  'camp.messages.find',
  'members.list',
  'members.get',
  'tasks.list',
  'tasks.get',
  'memory.list',
  'memory.get',
  'memory.hearthReviewItems.list',
  'automations.list',
  'automations.get',
  'automations.runs.list',
  'runtime.installations.list',
  'runtime.subsystems.get',
  'monitoring.snapshot',
  'health.check',
  'skills.list',
  'skills.get',
  'toolbox.list',
  'toolbox.read',
  'toolbox.setMembers',
  'nativeSkills.list',
  'nativeSkills.read',
  'skills.candidates',
  'skills.deliveryGroups.list',
  'mcp.config.get',
  'agentRunEvidence.list',
  'agentRunEvidence.getContent',
  'messageQuotes.mutateDraft',
  'messageQuotes.capture',
  'camp.messages.send',
  'camp.messages.withdraw',
  'action.approvals.resolve',
  'agentRuns.cancel',
  'commands.reconcile',
  'camps.create',
  'camps.creationPreflight',
  'camps.members.add',
  'camps.members.remove',
  'camps.members.removalPreview',
  'camps.changeDefaultLead',
  'members.create',
  'preferences.newConversation.get',
  'preferences.newConversation.setDefaults',
  'preferences.newConversation.setOneClick',
  'preferences.newConversation.invalidate',
  'members.update',
  'members.avatar.set',
  'members.runtime.set',
  'members.runtime.clear',
  'workspaces.inspect',
  'workspaces.validate',
  'agentRunImages.read',
  'agentRunFileChanges.get',
  'agentRuns.diagnostic.get',
  'runtime.product.ensure',
  'runtime.product.check',
  'runtime.modelCatalog.open',
  'runtime.discovery.rescan',
] as const
export type WebOperation = typeof WEB_OPERATIONS[number]

const RECONCILABLE_COMMANDS = new Set<WebOperation>([
  'camps.rename',
  'camps.delete',
  'camps.retryDeletion',
  'camps.discardPending',
  'camps.members.fast.set',
  'members.remove',
  'members.reorder',
  'notifications.preference.update',
  'notifications.acknowledge',
  'notifications.acknowledgeVisibleSources',
  'skills.reconcile',

  'singleChat.open', 'singleChat.send', 'singleChat.end', 'singleChat.pendingInputs.edit',
  'skills.import.commit',
  'skills.setEnabled',
  'skills.setGroupAssignments',
  'skills.delete',

  'tasks.create',
  'tasks.update',
  'memory.create',
  'memory.revise',
  'memory.retire',
  'memory.reactivate',
  'memory.forget',
  'memory.supersede',
  'memory.review.schedule',
  'memory.hearthReviewItems.accept',
  'memory.hearthReviewItems.reject',
  'missions.create',
  'missions.update',
  'missions.status',
  'missions.start',
  'missions.linkPr',
  'automations.create',
  'automations.update',
  'automations.close',
  'automations.delete',
  'automations.run',

  'camp.messages.send', 'camp.messages.withdraw', 'action.approvals.resolve', 'agentRuns.cancel',
  'camps.create', 'camps.changeDefaultLead', 'camps.members.add', 'camps.members.remove',
  'members.create', 'members.update', 'members.avatar.set', 'members.runtime.set', 'members.runtime.clear',
  'messageQuotes.mutateDraft'
])

export type ConnectionState = 'connecting' | 'live' | 'offline' | 'expired'
type PendingCommand = { operation: WebOperation; params: unknown; resolve(value: unknown): void; reject(error: unknown): void }
type PendingUpload = { intent: unknown; data: FormData | null; resolve(draft: unknown): void; reject(error: unknown): void }
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

type SessionResponse = { protocolVersion?: unknown; token?: unknown; clientId?: unknown; editorProof?: unknown; ownerId?: unknown; channels?: unknown; expiresAt?: unknown; serverTime?: unknown; renewalWindowSeconds?: unknown }

export class ConsoleClient {
  readonly origin: string
  #channels: 'desktop' | 'unsupported' = 'unsupported'
  get channels(): 'desktop' | 'unsupported' { return this.#channels }
  #token: string | null = null
  #authStorage?: AuthStorage
  #now: () => number
  #expiresAt: number | null = null
  #localExpiry: number | null = null
  #renewalWindow = 7 * 24 * 60 * 60 * 1000
  #renewal: Promise<void> | null = null
  #retryRenewalAt = 0
  #generation = 0
  #lifetime = new AbortController()
  #fetch: typeof fetch
  #editor: { clientId: string; proof: string } | null = null
  #ownerId: string | null = null
  #authListeners = new Set<() => void>()

  #pending = new Map<string, PendingCommand>()
  #pendingUploads = new Map<string, PendingUpload>()
  #localUploads = new Map<string, File>()
  #reconciling = false
  #restored = false
  #storage?: RecoveryStorage
  #assertTab?: () => Promise<void>
  #recoveryListeners = new Set<() => void>()
  onRecovered(listener: () => void): () => void { this.#recoveryListeners.add(listener); return () => { this.#recoveryListeners.delete(listener) } }
  #notifyRecovered(): void { for (const listener of this.#recoveryListeners) listener() }
  #pendingListeners = new Set<() => void>()
  get pendingCommandCount(): number { return this.#pending.size + this.#pendingUploads.size }
  onPendingCommandsChanged(listener: () => void): () => void {
    this.#pendingListeners.add(listener)
    return () => { this.#pendingListeners.delete(listener) }
  }
  #notifyPending(): void { this.#persistRecovery(); for (const listener of this.#pendingListeners) listener() }

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

  constructor(origin: string, fetcher: typeof fetch = fetch, storage?: RecoveryStorage, authStorage?: AuthStorage, now: () => number = Date.now) {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('控制台地址无效。')
    this.origin = origin
    this.#storage = storage
    this.#authStorage = authStorage
    this.#now = now
    // Native Window.fetch requires its Window receiver even when retained by a
    // transport object. Node's implementation does not expose this constraint.
    this.#fetch = fetcher.bind(globalThis)
  }

  async restore(fork = false, assertTab: () => Promise<void> = async () => undefined, authenticate = true): Promise<boolean> {
    this.#assertTab = assertTab
    if (this.#restored) return this.authenticated
    this.#restored = true
    const raw = this.#storage?.getItem(RECOVERY_KEY)
    type Recovery = { version: number; origin: string; token?: string | null; editor: { clientId: string; proof: string }; ownerId: string; pending?: Array<{ operation: WebOperation; params: unknown }>; uploads?: unknown[] }
    let saved: Recovery | null = null
    const identity = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    if (raw) {
      try { saved = JSON.parse(raw) } catch { throw new Error('编辑恢复材料损坏，请清除该标签页数据后重新登录。') }
      if (!saved || ![1, 2].includes(saved.version) || saved.origin !== this.origin || !identity(saved.editor?.clientId) || !identity(saved.editor?.proof) || typeof saved.ownerId !== 'string' || (saved.version === 1 && saved.token !== null && !identity(saved.token))) throw new Error('编辑恢复材料无效。')
    }
    const tabRaw = this.#storage?.getItem(TAB_AUTH_KEY)
    let authentication: BrowserSession | null = null
    if (tabRaw) {
      try { authentication = JSON.parse(tabRaw) } catch { throw new Error('登录恢复材料损坏。') }
    } else if (saved?.version === 1 && saved.token) {
      // One-time migration of the old per-tab snapshot. The long login Token
      // was never saved; only the existing ordinary Bearer can be recovered.
      authentication = { version: 1, origin: this.origin, token: saved.token, ownerId: saved.ownerId, expiresAt: null }
    } else if (!saved && authenticate) {
      authentication = await this.#authStorage?.read() ?? null
    }
    if (authentication && (authentication.version !== 1 || authentication.origin !== this.origin || !identity(authentication.token) || typeof authentication.ownerId !== 'string'
      || (authentication.expiresAt !== null && (!Number.isSafeInteger(authentication.expiresAt) || authentication.expiresAt <= 0)))) throw new Error('登录恢复材料无效。')
    if (fork) { this.#storage?.removeItem(RECOVERY_KEY); this.#storage?.removeItem(TAB_AUTH_KEY); this.clearEditingRecovery() }
    if (saved && !fork) {
      if (saved.version === 1 && authentication) this.#storage?.setItem(TAB_AUTH_KEY, JSON.stringify(authentication))
      this.#editor = saved.editor; this.#ownerId = saved.ownerId
      for (const command of saved.pending ?? []) {
        const id = (command.params as { commandId?: string })?.commandId
        if (typeof id === 'string' && RECONCILABLE_COMMANDS.has(command.operation)) this.#pending.set(id, { ...command, resolve: value => this.#settleRecovered(command.operation, command.params, value), reject: () => this.#notifyRecovered() })
      }
      for (const intent of saved.uploads ?? []) {
        const id = (intent as { commandId?: string })?.commandId
        if (typeof id === 'string') this.#pendingUploads.set(id, { intent, data: null, resolve: () => this.#notifyRecovered(), reject: () => this.#notifyRecovered() })
      }
      this.#persistRecovery()
    }
    if (!authenticate || !authentication) return false
    const source = authentication
    const generation = this.#generation
    const newEditor = fork || !saved
    this.#token = source.token
    try {
      const response = await this.#json<SessionResponse>('session', { method: 'POST', body: JSON.stringify({ ...(saved ? { editor: saved.editor } : {}), fork: newEditor }) })
      if (response.ownerId !== source.ownerId || (!newEditor && response.clientId !== saved?.editor.clientId)) throw new Error('Host 或编辑归属已变化，无法恢复当前页面。')
      this.#acceptSession({ ...response, token: newEditor ? response.token : source.token })
      await this.#saveAuthentication(source.token)
      if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
      this.#notifyAuthentication()
      await this.reconcilePending()
      return true
    } catch (error) {
      if (generation !== this.#generation && !(error instanceof SessionRequired)) throw error
      this.#token = null
      if (error instanceof SessionRequired) { this.#persistRecovery(); return false }
      // A network failure must not erase durable credentials or force another
      // login. The same tab can retry / reload with its original editing scope.
      this.#restored = false
      throw error
    }
  }

  #settleRecovered(operation: WebOperation, params: unknown, result: unknown): void {
    if (operation === 'singleChat.send' && this.#storage && this.editingScope && (result as { status?: string })?.status !== 'rejected') {
      const command = (params as { command?: { campId?: string; conversationId?: string; body?: string } })?.command
      if (command?.campId && command.conversationId && typeof command.body === 'string') {
        const recovery = browserEditingRecovery(this.editingScope, this.#storage)
        const key = `single-chat:${command.campId}`
        const drafts = recovery.get(key) as Record<string, string> | null
        const draftKey = `${command.campId}:${command.conversationId}`
        if (drafts?.[draftKey]?.trim() === command.body) { delete drafts[draftKey]; recovery.set(key, drafts) }
      }
    }
    this.#notifyRecovered()
  }

  #persistRecovery(): void {
    if (!this.#storage || !this.#editor || !this.#ownerId) return
    this.#storage.setItem(RECOVERY_KEY, JSON.stringify({ version: 2, origin: this.origin, editor: this.#editor, ownerId: this.#ownerId,
      pending: [...this.#pending.values()].map(({ operation, params }) => ({ operation, params })), uploads: [...this.#pendingUploads.values()].map(({ intent }) => intent) }))
  }

  clearEditingRecovery(): void { this.#storage?.removeItem('rovai.web.edits.v1') }

  async login(administratorToken: string): Promise<void> {
    await this.#login('login', { administratorToken })
  }

  async loginTicket(ticket: string): Promise<void> {
    await this.#login('login-ticket', { ticket })
  }

  async #login(path: 'login' | 'login-ticket', credential: { administratorToken: string } | { ticket: string }): Promise<void> {
    if (this.#assertTab) await this.#assertTab()
    await this.#forgetAuthentication()
    const generation = this.#generation
    const response = await this.#fetch(`${this.origin}/api/v1/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: HOST_WEB_PROTOCOL_VERSION, ...credential, ...(this.#editor ? { editor: this.#editor } : {}) }), credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: this.#lifetime.signal
    })
    if (!response.ok) throw new Error(response.status === 409 ? 'Web 与 Host 协议不兼容，请使用同一版本。' : response.status === 429 ? '登录暂受限，请稍后再试。' : response.status >= 500 ? '服务暂不可用，请稍后重试。' : path === 'login-ticket' ? '扫码登录未完成，二维码可能已过期或已使用。请在运行服务的 Desktop 重新生成，或使用登录 Token 登录。' : 'Token 无效，请检查后重试。')
    const session = await response.json() as SessionResponse
    if (generation !== this.#generation) throw new SessionRequired()
    try {
      this.#acceptSession(session)
      await this.#saveAuthentication()
      if (generation !== this.#generation) throw new SessionRequired()
      this.#notifyAuthentication()
      void this.reconcilePending()
    } catch (error) { if (generation === this.#generation) this.clear(); throw error }
  }

  #acceptSession(session: SessionResponse): void {
    if (session.protocolVersion !== HOST_WEB_PROTOCOL_VERSION) throw new Error('Web 与 Host 协议不兼容，请使用同一版本。')
    if (typeof session.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error('会话响应无效。')
    if (typeof session.clientId !== 'string' || !/^[a-f0-9]{64}$/.test(session.clientId)
      || typeof session.editorProof !== 'string' || !/^[a-f0-9]{64}$/.test(session.editorProof)
      || typeof session.ownerId !== 'string') throw new Error('编辑归属响应无效。')
    if (this.#ownerId !== null && this.#ownerId !== session.ownerId) throw new Error('Owner 已变化，请先保存当前编辑并切换连接。')
    if (this.#editor !== null && this.#editor.clientId !== session.clientId) throw new Error('编辑归属已变化，无法把当前编辑转交给新的草稿身份。')
    this.#acceptTiming(session)
    this.#editor = { clientId: session.clientId, proof: session.editorProof }
    this.#ownerId = session.ownerId
    this.#channels = session.channels === 'desktop' ? 'desktop' : 'unsupported'
    this.#token = session.token
    this.#persistTabAuthentication()
    this.#persistRecovery()
  }

  #notifyAuthentication(): void { for (const listener of this.#authListeners) listener() }

  #acceptTiming(session: SessionResponse): void {
    // Older protocol-v2 Hosts have no renewable Session metadata. They may
    // still reconnect but cannot be treated as having a thirty-day lease.
    if (session.expiresAt === undefined && session.serverTime === undefined) {
      this.#expiresAt = this.#localExpiry = null
      return
    }
    if (typeof session.expiresAt !== 'number' || !Number.isSafeInteger(session.expiresAt)
      || typeof session.serverTime !== 'number' || !Number.isSafeInteger(session.serverTime)
      || session.expiresAt <= session.serverTime || session.renewalWindowSeconds !== 7 * 24 * 60 * 60) throw new Error('会话有效期响应无效。')
    this.#expiresAt = session.expiresAt
    this.#localExpiry = this.#now() + session.expiresAt - session.serverTime
    this.#renewalWindow = session.renewalWindowSeconds * 1000
  }

  #authentication(): BrowserSession | null {
    return this.#token && this.#ownerId ? { version: 1, origin: this.origin, token: this.#token, ownerId: this.#ownerId, expiresAt: this.#expiresAt } : null
  }
  #persistTabAuthentication(): void { this.#storage?.setItem(TAB_AUTH_KEY, JSON.stringify(this.#authentication())) }
  async #saveAuthentication(expectedToken?: string): Promise<void> {
    const session = this.#authentication()
    const generation = this.#generation
    if (session) await this.#authStorage?.write(session, expectedToken, () => this.#generation === generation && this.#token === session.token)
  }
  async #forgetAuthentication(): Promise<void> {
    const token = this.#token
    try { this.clear() }
    finally { if (token) await this.#authStorage?.remove(token) }
  }
  clear(): void {
    this.#token = null
    this.#expiresAt = this.#localExpiry = null
    this.#retryRenewalAt = 0
    this.#renewal = null
    this.#generation++
    this.#localUploads.clear()
    this.#lifetime.abort()
    this.#lifetime = new AbortController()
    try {
      this.#persistTabAuthentication()
      this.#persistRecovery()
    } finally { this.#notifyAuthentication() }
  }

  async logout(): Promise<void> {
    const generation = this.#generation
    try { await this.#authorized('logout', { method: 'POST' }) }
    catch (error) { if (generation !== this.#generation && !(error instanceof SessionRequired)) throw error; if (!(error instanceof SessionRequired)) throw new Error('退出未完成，请检查网络后重试。'); return }
    if (generation === this.#generation) await this.#forgetAuthentication()
  }

  /** Called by ordinary requests and the visible-page activity timer. A failed
   * renewal leaves a still-valid Session usable and retries after one minute. */
  async renewIfNeeded(): Promise<void> {
    if (!this.#token || this.#localExpiry === null || this.#localExpiry - this.#now() > this.#renewalWindow || this.#now() < this.#retryRenewalAt) return
    if (this.#renewal) return this.#renewal
    const generation = this.#generation
    const token = this.#token
    const renewal = (async () => {
      try {
        // Host is authoritative at expiry, including when the browser's clock
        // moved. A 401 drops only authentication, never the tab's editing data.
        if (this.#localExpiry !== null && this.#localExpiry <= this.#now()) {
          const verified = await this.#json<SessionResponse>('session', { method: 'POST', body: JSON.stringify({ editor: this.#editor, fork: false }) })
          this.#acceptTiming(verified)
          if (this.#localExpiry === null || this.#localExpiry - this.#now() > this.#renewalWindow) return
        }
        const timing = await this.#json<SessionResponse>('session/renew', { method: 'POST' })
        if (generation !== this.#generation) return
        this.#acceptTiming(timing)
        this.#persistTabAuthentication()
        await this.#saveAuthentication(token)
      } catch (error) {
        if (generation === this.#generation) this.#retryRenewalAt = this.#now() + 60_000
        if (error instanceof SessionRequired) throw error
      }
    })()
    this.#renewal = renewal
    try { await renewal } finally { if (this.#renewal === renewal) this.#renewal = null }
  }

  async request<T>(operation: WebOperation, params: unknown = {}): Promise<T> {
    const commandId = params && typeof params === 'object' && 'commandId' in params ? params.commandId : undefined
    if (!RECONCILABLE_COMMANDS.has(operation) || typeof commandId !== 'string') return this.#rpc<T>(operation, params)
    if (!this.authenticated) throw new SessionRequired()
    if ([...this.#pending.values()].some(entry => entry.operation === operation)) throw new Error('同类操作的原提交仍待核对，请先核对原提交结果。')
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

  async uploadFile(campId: string, expectedRevision: number, file: File): Promise<LocalAttachmentSourceView> {
    return this.uploadTo<LocalAttachmentSourceView>(campId, expectedRevision, file)
  }

  async uploadTo<T>(campId: string, expectedRevision: number, file: File, target?:
    | { kind: 'single_chat'; conversationId: string }
    | { kind: 'single_chat_pending'; conversationId: string; pendingInputId: string; editToken: string }
  ): Promise<T> {
    if (!this.authenticated) throw new SessionRequired()
    if (file.size > 20 * 1024 * 1024) throw new Error('单个上传文件不能超过 20 MB。')
    const scope = this.editingScope
    const digest = await fileDigest(file, this.#lifetime.signal)
    const commandId = newCommandId()
    const intent = { commandId, campId, expectedRevision, ...(target ? { target } : {}), displayName: file.name, byteSize: file.size,
      sha256: digest }
    const data = new FormData(); data.append('intent', JSON.stringify(intent)); data.append('file', file)
    return new Promise((resolve, reject) => {
      const entry: PendingUpload = { intent, data, resolve: value => {
        // A successful binding or its canonical reconciliation is required before
        // retaining a payload for previews. Never persist local bytes or credentials.
        if (scope === this.editingScope && this.authenticated) this.#retainUpload(campId, digest, file)
        resolve(value as T)
      }, reject }
      this.#pendingUploads.set(commandId, entry); this.#notifyPending()
      void this.#dispatchUpload(commandId, entry)
    })
  }

  #retainUpload(campId: string, digest: string, file: File): void {
    const key = `${campId}:${digest}`
    this.#localUploads.delete(key); this.#localUploads.set(key, file)
    let bytes = [...this.#localUploads.values()].reduce((size, item) => size + item.size, 0)
    // This is a bounded, disposable optimization; eviction restores Host reads.
    while (this.#localUploads.size > 16 || bytes > 40 * 1024 * 1024) {
      const oldest = this.#localUploads.keys().next().value!
      bytes -= this.#localUploads.get(oldest)!.size; this.#localUploads.delete(oldest)
    }
  }

  confirmedUpload(campId: string, generation: string, size: number): File | null {
    const key = `${campId}:${generation}`
    const file = this.#localUploads.get(key)
    if (!file || file.size !== size) return null
    this.#localUploads.delete(key); this.#localUploads.set(key, file)
    return file
  }

  async #dispatchUpload(commandId: string, entry: PendingUpload, preserveUnknown = false): Promise<void> {
    if (!entry.data) throw new Error('上传内容无法随刷新保留。请先核对原上传结果；未完成时重新选择文件。')
    await this.#json<{ draft: unknown }>('uploads', { method: 'POST', body: entry.data }).then(result => {
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

  async avatar<T>(action: 'read' | 'save', request: unknown): Promise<T> {
    return this.#json('avatars', { method: 'POST', body: JSON.stringify({ action, request }) })
  }

  async files<T>(action: string, request: unknown): Promise<T> {
    return this.#json('files', { method: 'POST', body: JSON.stringify({ action, request }) })
  }
  async updates(operation: 'get' | 'check' | 'download' | 'install', version?: string): Promise<import('@contracts').AppUpdateSnapshot> {
    const response = await this.#json<{ result: import('@contracts').AppUpdateSnapshot }>('updates', {
      method: 'POST', body: JSON.stringify({ operation, ...(version ? { version } : {}) })
    })
    return response.result
  }
  async fileBytes(action: 'readBinary' | 'readChildImage' | 'download', request: unknown): Promise<FilePreviewOperationResult<Omit<FilePreviewBinaryContent, 'bytes'> & { blob: Blob; name: string }>> {
    const generation = this.#generation
    const response = await this.#authorized('files/bytes', { method: 'POST', body: JSON.stringify({ action, request }) })
    const value = response.headers.get('Content-Type')?.includes('application/json')
      ? await response.json() as FilePreviewOperationResult<never>
      : { ok: true as const, value: { blob: await response.blob(), mime: response.headers.get('Content-Type') ?? 'application/octet-stream',
        contentGeneration: response.headers.get('x-rovai-content-generation') ?? '',
        contentVersion: JSON.parse(response.headers.get('x-rovai-content-version') ?? 'null') as FilePreviewBinaryContent['contentVersion'],
        name: responseFileName(response) } }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return value
  }
  async attachment(locator: unknown): Promise<{ blob: Blob; name: string }> {
    const generation = this.#generation
    const response = await this.#authorized('attachments', { method: 'POST', body: JSON.stringify(locator) })
    const blob = await response.blob()
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return { blob, name: responseFileName(response) }
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
          const result = await this.#json<{ draft?: unknown }>('uploads/reconcile', { method: 'POST', body: JSON.stringify(entry.intent) })
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

  async channel(request: { operation: 'get' | 'publish' | 'retry' | 'selectApprover'; kind?: 'feishu' | 'dingtalk'; agentId?: string; userId?: string }): Promise<ChannelSettingsSnapshot> {
    try {
      const reply = await this.#json<{ result: ChannelSettingsSnapshot }>('channels', { method: 'POST', body: JSON.stringify(request) })
      return reply.result
    } catch (error) {
      if (!(error instanceof HttpRequestError)) throw error
      const message = error.code === 'channel_session_expired'
        ? '请在运行此服务的 Rovai Desktop 中重新连接账号，完成后返回本页重试。'
        : error.code === 'channel_native_interaction'
          ? '此步骤需要原生页面，请在运行此服务的 Rovai Desktop 中完成后返回。'
          : error.code === 'channels_unsupported'
            ? '独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。'
            : error.code === 'channel_capacity'
              ? '渠道操作较多，请稍后重新读取状态。'
              : '渠道操作结果暂时无法确认。请重新读取发布状态，再继续原发布流程。'
      throw new CoreRequestError(error.code, message)
    }
  }

  async getWorkspaces(path?: string, offset = 0): Promise<WorkspaceListing> {
    return this.#json('workspaces', { method: 'POST', body: JSON.stringify({ path, offset }) })
  }

  async #json<T>(path: 'session' | 'session/renew' | 'channels' | 'updates' | 'workspaces' | 'uploads' | 'uploads/reconcile' | 'files' | 'avatars', options: RequestInit = {}): Promise<T> {
    const generation = this.#generation
    const result = await (await this.#authorized(path, options)).json() as T
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return result
  }

  async #authorized(path: 'session' | 'session/renew' | 'channels' | 'updates' | 'request' | 'events' | 'logout' | 'workspaces' | 'uploads' | 'uploads/reconcile' | 'files' | 'files/bytes' | 'attachments' | 'avatars', options: RequestInit = {}): Promise<Response> {
    if (!this.#token) throw new SessionRequired()
    const generation = this.#generation
    if (this.#localExpiry !== null && this.#localExpiry - this.#now() <= this.#renewalWindow && !['session', 'session/renew', 'logout'].includes(path)) await this.renewIfNeeded()
    if (this.#assertTab) await this.#assertTab()
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    const response = await this.#fetch(`${this.origin}/api/v1/${path}`, {
      ...options, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${this.#token}` },
      signal: options.signal ? AbortSignal.any([options.signal, this.#lifetime.signal]) : this.#lifetime.signal
    })
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (response.status === 401) { await this.#forgetAuthentication(); throw new SessionRequired() }
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

function responseFileName(response: Response): string {
  const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
  return name ? decodeURIComponent(name).replace(/[\\/\x00-\x1f\x7f]/g, '_') : 'attachment'
}
