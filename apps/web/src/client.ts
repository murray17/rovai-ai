import { TAB_AUTH_KEY, type AuthStorage, type BrowserSession } from './auth-storage'
import { browserEditingRecovery } from './editing-recovery'
import { RECOVERY_KEY, type RecoveryStorage } from './tab-recovery'
import { fileDigest } from './file-digest'
import { uploadRequest } from './upload-request'
import { newCommandId } from '../../desktop/src/shared/command-id'
import { recoverLocalThreadSend } from '../../desktop/src/renderer/src/camp-composer-send-recovery'
import type { ThreadReadInvalidation, ChannelKind, ChannelSettingsSnapshot, FilePreviewBinaryContent, FilePreviewOperationResult, LocalAttachmentSourceView } from '@contracts'

const HOST_WEB_PROTOCOL_VERSION = 6

const transferErrors: Record<string, string> = {
  upload_too_large: '单个上传文件不能超过 30 MiB（31,457,280 字节）。',
  upload_envelope_too_large: '上传请求超出传输额度，请检查文件大小和附加信息。',
  upload_capacity: '当前上传较多，请稍后重试。',
  invalid_upload: '上传内容未能通过校验，请重新选择文件后重试。',
  download_expired: '下载地址已过期，请重新点击下载。',
  download_capacity: '当前下载较多，请稍后重试。',
  download_ticket_capacity: '待使用的下载申请过多，请稍后重新申请。',
  download_timeout: '准备下载超时，请重试。',
  core_unavailable: '服务暂不可用，请稍后重试。',
  read_failed: '服务器暂时无法读取此文件，请稍后重试。',
  download_too_large: '文件超过此服务器设置的下载额度。',
  file_changed: '文件已变化，请刷新预览或重新申请下载。',
  file_not_found: '源文件已不存在，可能已被清理。',
  file_unreadable: '服务器暂时无法读取此文件，请检查文件权限后重试。',
  source_not_authorized: '此文件来源已失效或未获授权。',
  not_regular_file: '当前入口只支持下载普通文件。',
  download_unavailable: '文件暂不可读，请稍后重试。'
}

export class HttpRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) { super(message || transferErrors[code] || `请求未完成（${code}）。`) }
}

function sessionStorageMessage(body: { error?: { code?: string; message?: string } }): string | undefined {
  return body?.error?.code === 'session_storage_unavailable' && typeof body.error.message === 'string'
    ? body.error.message : undefined
}

class CoreRequestError extends Error {
  constructor(readonly code: string, message?: string) { super(message || `操作未完成（${code}）。`) }
}

export class SessionRequired extends Error {
  constructor() { super('会话已失效，请重新登录。') }
}

class ConnectionUnavailable extends Error {
  constructor() { super('服务连接已中断，请恢复连接后重试。') }
}

export type WorkspaceListing = { name: string; projectPath: string; parentPath: string | null; roots: string[]; directories: { name: string; projectPath: string }[]; nextOffset: number | null }

export const WEB_OPERATIONS = [
  'projectFiles.request',
  'projectFileReferences.resolve',
  'threads.rename',
  'threads.delete',
  'threads.deletionIssues',
  'threads.retryDeletion',
  'threads.discardPending',
  'threads.pendingDraft.setPresence',
  'threads.members.fast.check',
  'threads.members.fast.set',
  'members.removalPreview',
  'members.remove',
  'members.reorder',
  'runtime.subsystems.retry',
  'notifications.inbox',
  'notifications.threadInterruptions',
  'notifications.changesSince',
  'notifications.preference.get',
  'notifications.preference.update',
  'notifications.acknowledge',
  'notifications.acknowledgeVisibleSources',
  'notifications.acknowledgeThreadInterruptions',
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
  'runtime.environment.get',
  'member.runtimeEnvironment.get',
  'conversations.memberSession.get',
  'conversations.restartNativeSession',
  'runtime.environmentLegacy.list',
  'runtime.environmentLegacy.get',
  'runtime.environmentLegacy.acknowledge',

  'runtime.startup.save',
  'runtime.startup.inspect',
  'runtime.startup.check',
  'navigation.findThread',
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
  'navigation.threads',
  'navigation.groupThreads',
  'navigation.campViewed',
  'threads.exists',
  'threads.open',
  'threads.enter',
  'thread.messages.page',
  'thread.messages.anchors',
  'thread.messages.anchorPreview',
  'thread.messages.replies',
  'thread.messages.around',
  'thread.messages.find',
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
  'monitoring.execution',
  'health.check',
  'runtime.status.get',
  'skills.list',
  'skills.get',
  'toolbox.list',
  'toolbox.read',
  'toolbox.setMembers',
  'nativeSkills.list',
  'nativeSkills.read',
  'skills.candidates',
  'threadReferences.list',
  'threadReferences.resolve',
  'skills.deliveryGroups.list',
  'mcp.config.get',
  'agentRunEvidence.list',
  'agentRunEvidence.getContent',
  'messageQuotes.mutateDraft',
  'messageQuotes.capture',
  'thread.messages.send',
  'thread.messages.withdraw',
  'action.approvals.resolve',
  'agentRuns.cancel', 'agentRuns.continue',
  'commands.reconcile',
  'threads.create',
  'threads.creationPreflight',
  'threads.members.add',
  'threads.members.remove',
  'threads.members.removalPreview',
  'threads.changeDefaultLead',
  'members.create',
  'preferences.tasks.get',
  'preferences.tasks.set',
  'teams.list',
  'teams.save',
  'teams.delete',
  'preferences.newConversation.setTeam',
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
  'teams.save',
  'teams.delete',
  'threads.rename',
  'threads.delete',
  'threads.retryDeletion',
  'threads.discardPending',
  'threads.members.fast.set',
  'members.remove',
  'members.reorder',
  'notifications.preference.update',
  'notifications.acknowledge',
  'notifications.acknowledgeVisibleSources',
  'notifications.acknowledgeThreadInterruptions',
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

  'thread.messages.send', 'thread.messages.withdraw', 'action.approvals.resolve', 'agentRuns.cancel', 'agentRuns.continue',
  'threads.create', 'threads.changeDefaultLead', 'threads.members.add', 'threads.members.remove',
  'members.create', 'members.update', 'members.avatar.set', 'members.runtime.set', 'members.runtime.clear',
  'messageQuotes.mutateDraft'
])

export type ConnectionState = 'connecting' | 'live' | 'offline' | 'expired'
export type RequestResult<T> = { result: T; source: 'direct' | 'recovery' }
type PendingCommand = { operation: WebOperation; params: unknown; resolve(value: unknown, source?: RequestResult<unknown>['source']): void; reject(error: unknown): void }
export type UploadProgress = { id: string; name: string; phase: 'hashing' | 'transferring' | 'binding' | 'unknown' | 'received'; percent: number; cancelled: boolean }
type UploadTarget = { kind: 'pasted_text' } | { kind: 'single_chat'; conversationId: string }
  | { kind: 'single_chat_pending'; conversationId: string; pendingInputId: string; editToken: string }
type UploadIntent = { commandId: string; threadId: string; expectedRevision: number; target?: UploadTarget; displayName: string; byteSize: number; sha256: string }
type PendingUpload = { cancelled?: boolean; signal?: AbortSignal; intent: UploadIntent; data: FormData | null; resolve(draft: unknown): void; reject(error: unknown): void }
type CommandReceipt = { state: 'unknown' | 'recorded'; result?: unknown; error?: { code: string; message?: string } }

/** Decodes bounded SSE frames; payloads are invalidations, never private Core events. */
export class InvalidationDecoder {
  #buffer = ''
  #changes: ThreadReadInvalidation[] = []
  takeChanges(): ThreadReadInvalidation[] { return this.#changes.splice(0) }
  push(text: string): boolean {
    this.#buffer += text
    if (this.#buffer.length > 64 * 1024) throw new Error('实时连接的数据超出限制。')
    let changed = false
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.#buffer)
      if (!match) return changed
      const frame = this.#buffer.slice(0, match.index)
      this.#buffer = this.#buffer.slice(match.index + match[0].length)
      if (/^event: ?(?:resync|invalidate)\r?$/m.test(frame)) {
        changed = true
        if (/^event: ?resync\r?$/m.test(frame)) this.#changes.push({ resync: true })
        else {
          const data = /^data: ?(.*)\r?$/m.exec(frame)?.[1]
          const payload = data ? JSON.parse(data) as ThreadReadInvalidation : {}
          const messages = Array.isArray(payload.messages) ? payload.messages.filter(change =>
            typeof change.threadId === 'string' && typeof change.indexChanged === 'boolean'
            && Number.isSafeInteger(change.throughGlobalSequence)) : []
          this.#changes.push({ messages, ...(payload.referencesChanged === true ? { referencesChanged: true } : {}), ...(payload.tasksChanged === true ? { tasksChanged: true } : {}), ...(payload.teamsChanged === true ? { teamsChanged: true } : {}), ...(payload.notificationsChanged === true ? { notificationsChanged: true } : {}) })
        }
      }
    }
  }
}

type SessionResponse = { protocolVersion?: unknown; token?: unknown; clientId?: unknown; editorProof?: unknown; ownerId?: unknown; channels?: unknown; fileTransfers?: { uploadMaxBytes?: unknown; nativeDownload?: unknown }; expiresAt?: unknown; serverTime?: unknown; renewalWindowSeconds?: unknown }

export class ConsoleClient {
  readonly origin: string
  #channels: 'desktop' | 'unsupported' = 'unsupported'
  get channels(): 'desktop' | 'unsupported' { return this.#channels }
  #uploadMaxBytes = 20 * 1024 * 1024
  #nativeDownload = false
  get nativeDownload(): boolean { return this.#nativeDownload }
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
  #receivedUploads = new Map<string, unknown>()
  #uploadProgress = new Map<string, UploadProgress>()
  #uploadControllers = new Map<string, AbortController>()
  #uploadListeners = new Set<() => void>()
  get uploadProgress(): UploadProgress[] { return [...this.#uploadProgress.values()] }
  onUploadsChanged(listener: () => void): () => void { this.#uploadListeners.add(listener); return () => { this.#uploadListeners.delete(listener) } }
  #notifyUploads(): void { for (const listener of this.#uploadListeners) listener() }
  #uploadPhase(id: string, phase: UploadProgress['phase'], percent = 0): void {
    const current = this.#uploadProgress.get(id)
    if (current) { this.#uploadProgress.set(id, { ...current, phase, percent }); this.#notifyUploads() }
  }
  dismissUpload(id: string): void { this.#uploadProgress.delete(id); this.#notifyUploads() }
  cancelUpload(id: string): void {
    const current = this.#uploadProgress.get(id)
    if (!current || current.cancelled || current.phase === 'received') return
    this.#uploadProgress.set(id, { ...current, cancelled: true, phase: 'unknown' })
    const entry = this.#pendingUploads.get(id)
    if (entry) {
      entry.cancelled = true; entry.data = null
      entry.reject(new Error('已取消上传；若服务器已接收，将继续核对原结果。'))
    }
    this.#uploadControllers.get(id)?.abort()
    this.#notifyUploads()
  }
  canRetryUpload(id: string): boolean { const entry = this.#pendingUploads.get(id); return Boolean(entry?.data && !entry.cancelled) }
  #resetUploadSignal(id: string, entry: PendingUpload): void {
    const controller = new AbortController()
    this.#uploadControllers.set(id, controller)
    entry.signal = AbortSignal.any([controller.signal, this.#lifetime.signal])
  }
  async retryUpload(id: string): Promise<void> {
    await this.reconcilePending()
    const entry = this.#pendingUploads.get(id)
    if (entry?.data && !entry.cancelled) { this.#resetUploadSignal(id, entry); await this.#dispatchUpload(id, entry, true) }
  }
  #localUploads = new Map<string, File>()
  #reconciling: Promise<void> | null = null
  #retrying: Promise<boolean> | null = null
  #connection: ConnectionState = 'connecting'
  #needsRecovery = false
  #connectionListeners = new Set<() => void>()
  #wakeReconnect: (() => void) | null = null
  get connectionState(): ConnectionState {
    return this.#connection === 'live' && this.#needsRecovery ? 'offline' : this.#connection
  }
  onConnectionChanged(listener: () => void): () => void {
    this.#connectionListeners.add(listener)
    return () => { this.#connectionListeners.delete(listener) }
  }
  #notifyConnection(): void { for (const listener of this.#connectionListeners) listener() }
  #setConnection(state: ConnectionState): void { this.#connection = state; this.#notifyConnection() }
  #requireRecovery(): void { this.#needsRecovery = this.pendingCommandCount > 0; this.#notifyConnection() }
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
  #notifyPending(): void {
    this.#persistRecovery()
    if (!this.pendingCommandCount) { this.#needsRecovery = false; this.#notifyConnection() }
    for (const listener of this.#pendingListeners) listener()
  }

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
    type Recovery = { version: number; origin: string; token?: string | null; editor: { clientId: string; proof: string }; ownerId: string; pending?: Array<{ operation: WebOperation; params: unknown }>; uploads?: unknown[]; receivedUploads?: unknown[] }
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
        if (typeof id === 'string') {
          this.#uploadProgress.set(id, { id, name: (intent as { displayName: string }).displayName, phase: 'unknown', percent: 0, cancelled: false })
          this.#pendingUploads.set(id, { intent: intent as UploadIntent, data: null, resolve: () => {
            this.#receivedUploads.set(id, intent); this.#persistRecovery(); this.#uploadPhase(id, 'received'); this.#notifyRecovered()
          }, reject: () => this.#notifyRecovered() })
        }
      }
      for (const intent of saved.receivedUploads ?? []) {
        const recorded = intent as { commandId?: string; displayName?: string }
        if (typeof recorded.commandId === 'string' && typeof recorded.displayName === 'string') {
          this.#receivedUploads.set(recorded.commandId, intent)
          this.#uploadProgress.set(recorded.commandId, { id: recorded.commandId, name: recorded.displayName, phase: 'received', percent: 0, cancelled: true })
        }
      }
      if (this.pendingCommandCount) this.#requireRecovery()
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
    if (operation === 'thread.messages.send') recoverLocalThreadSend(params, result)
    if (operation === 'singleChat.send' && this.#storage && this.editingScope && (result as { status?: string })?.status !== 'rejected') {
      const command = (params as { command?: { threadId?: string; conversationId?: string; body?: string } })?.command
      if (command?.threadId && command.conversationId && typeof command.body === 'string') {
        const recovery = browserEditingRecovery(this.editingScope, this.#storage)
        const key = `single-chat:${command.threadId}`
        const drafts = recovery.get(key) as Record<string, string> | null
        const draftKey = `${command.threadId}:${command.conversationId}`
        if (drafts?.[draftKey]?.trim() === command.body) { delete drafts[draftKey]; recovery.set(key, drafts) }
      }
    }
    this.#notifyRecovered()
  }

  #persistRecovery(): void {
    if (!this.#storage || !this.#editor || !this.#ownerId) return
    this.#storage.setItem(RECOVERY_KEY, JSON.stringify({ version: 2, origin: this.origin, editor: this.#editor, ownerId: this.#ownerId,
      pending: [...this.#pending.values()].map(({ operation, params }) => ({ operation, params })), uploads: [...this.#pendingUploads.values()].map(({ intent }) => intent), receivedUploads: [...this.#receivedUploads.values()] }))
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
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(sessionStorageMessage(body) || (response.status === 409 ? 'Web 与 Host 协议不兼容，请使用同一版本。' : response.status === 429 ? '登录暂受限，请稍后再试。' : response.status >= 500 ? '服务暂不可用，请稍后重试。' : path === 'login-ticket' ? '扫码登录未完成，二维码可能已过期或已使用。请在运行服务的 Desktop 重新生成，或使用登录 Token 登录。' : 'Token 无效，请检查后重试。'))
    }
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
    this.#uploadMaxBytes = typeof session.fileTransfers?.uploadMaxBytes === 'number' && Number.isSafeInteger(session.fileTransfers.uploadMaxBytes) && session.fileTransfers.uploadMaxBytes >= 0
      ? Math.min(30 * 1024 * 1024, session.fileTransfers.uploadMaxBytes) : 20 * 1024 * 1024
    this.#nativeDownload = session.fileTransfers?.nativeDownload === true
    this.#token = session.token
    this.#setConnection('live')
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
    this.#setConnection('expired')
    try {
      this.#persistTabAuthentication()
      this.#persistRecovery()
    } finally { this.#notifyAuthentication() }
  }

  async logout(): Promise<void> {
    const generation = this.#generation
    try { await this.#authorized('logout', { method: 'POST' }) }
    catch (error) {
      if (error instanceof HttpRequestError && error.code === 'session_storage_unavailable') throw error
      if (generation !== this.#generation && !(error instanceof SessionRequired)) throw error
      if (!(error instanceof SessionRequired)) throw new Error('退出未完成，请检查网络后重试。')
      return
    }
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
    return (await this.requestWithSource<T>(operation, params)).result
  }

  /** Client-only provenance; the RPC value and persisted command/receipt shape stay unchanged. */
  async requestWithSource<T>(operation: WebOperation, params: unknown = {}): Promise<RequestResult<T>> {
    const commandId = params && typeof params === 'object' && 'commandId' in params ? params.commandId : undefined
    if (!RECONCILABLE_COMMANDS.has(operation) || typeof commandId !== 'string') return { result: await this.#rpc<T>(operation, params), source: 'direct' }
    if (!this.authenticated) throw new SessionRequired()
    this.#assertConnected()
    if ([...this.#pending.values()].some(entry => entry.operation === operation)) throw new Error('同类操作的原提交仍待核对，请先核对原提交结果。')
    if (this.#pending.has(commandId)) throw new Error('原命令仍在核对中，请等待其结果。')
    // Keep the original request and promise alive through connection/session
    // loss. Shared production handlers retain their submitting state; no new ID
    // or automatic redispatch is manufactured by the Web adapter.
    return new Promise<RequestResult<T>>((resolve, reject) => {
      const entry: PendingCommand = { operation, params: structuredClone(params),
        resolve: (value, source = 'direct') => resolve({ result: value as T, source }), reject }
      this.#pending.set(commandId, entry)
      this.#notifyPending()
      void this.#dispatchCommand(commandId, entry)
    })
  }

  async #dispatchCommand(commandId: string, entry: PendingCommand, preserveUnknown = false): Promise<void> {
    await this.#rpc(entry.operation, entry.params, preserveUnknown).then(value => {
        if (this.#pending.get(commandId) !== entry) return
        this.#pending.delete(commandId); this.#notifyPending(); entry.resolve(value, preserveUnknown ? 'recovery' : 'direct')
      }).catch(async error => {
        if (!preserveUnknown && (error instanceof ConnectionUnavailable || error instanceof HttpRequestError && ['operation_not_admitted', 'workspace_not_authorized', 'request_capacity'].includes(error.code))) {
          if (this.#pending.get(commandId) === entry) { this.#pending.delete(commandId); this.#notifyPending(); entry.reject(error) }
          return
        }
        if (error instanceof CoreRequestError || !preserveUnknown && error instanceof SessionRequired) {
          // An explicit authentication rejection was not admitted. A Core error
          // is first checked for a receipt, including errors after a commit.
          await this.#settleKnownFailure(commandId, entry, error)
        } else {
          this.#requireRecovery()
          await this.reconcilePending()
        }
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
      else if (receipt.state === 'recorded') entry.resolve(receipt.result, 'recovery')
      else entry.reject(error) // Explicit Core completion plus a successful absent-receipt lookup.
    } catch { this.#requireRecovery() /* Still unknown if reconciliation itself could not complete. */ }
  }

  async uploadFile(threadId: string, expectedRevision: number, file: File, target?: UploadTarget): Promise<LocalAttachmentSourceView> {
    const source = await this.uploadTo<{
      id: string; sourcePath: string; displayName: string; kind: 'file' | 'directory'
      mediaType: string | null; observedByteSize: number | null
      generatedBy?: 'long_text_paste'; pastedTextPreview?: string
    }>(threadId, expectedRevision, file, target)
    return {
      id: source.id, sourcePath: source.sourcePath, displayName: source.displayName, kind: source.kind,
      mediaType: source.mediaType, byteSize: source.observedByteSize,
      fileCount: source.kind === 'file' ? 1 : null,
      previewKind: source.mediaType?.startsWith('image/') ? 'image' : 'none',
      availability: 'available',
      ...(source.generatedBy ? { generatedBy: source.generatedBy } : {}),
      ...(source.pastedTextPreview !== undefined ? { pastedTextPreview: source.pastedTextPreview } : {})
    }
  }

  async uploadTo<T>(threadId: string, expectedRevision: number, file: File, target?: UploadTarget): Promise<T> {
    if (!this.authenticated) throw new SessionRequired()
    this.#assertConnected()
    const maxBytes = target?.kind === 'pasted_text' ? Math.min(this.#uploadMaxBytes, 25 * 1024 * 1024) : this.#uploadMaxBytes
    if (file.size > maxBytes) throw new Error(`单个上传文件不能超过 ${maxBytes / (1024 * 1024)} MiB（${maxBytes.toLocaleString('en-US')} 字节）。`)
    const scope = this.editingScope
    let commandId = newCommandId()
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.#lifetime.signal])
    this.#uploadControllers.set(commandId, controller)
    this.#uploadProgress.set(commandId, { id: commandId, name: file.name, phase: 'hashing', percent: 0, cancelled: false }); this.#notifyUploads()
    let digest: string
    try { digest = await fileDigest(file, signal); this.#assertConnected() }
    catch (error) { this.#uploadControllers.delete(commandId); this.dismissUpload(commandId); throw controller.signal.aborted ? new Error('已取消上传。') : error }
    const matchesFile = (intent: unknown): boolean => {
      const previous = intent as UploadIntent
      return previous.threadId === threadId && previous.sha256 === digest && previous.displayName === file.name && previous.byteSize === file.size
        && previous.target?.kind === target?.kind
        && (previous.target?.kind !== 'single_chat' && previous.target?.kind !== 'single_chat_pending'
          || (target?.kind === 'single_chat' || target?.kind === 'single_chat_pending') && previous.target.conversationId === target.conversationId)
        && (previous.target?.kind !== 'single_chat_pending' || target?.kind === 'single_chat_pending'
          && previous.target.pendingInputId === target.pendingInputId && previous.target.editToken === target.editToken)
    }
    const pendingUpload = [...this.#pendingUploads.entries()].find(([, entry]) => matchesFile(entry.intent))
    if (pendingUpload) {
      try {
        if (pendingUpload[1].data) throw new Error('同一文件的原上传仍待核对，请先核对原结果。')
        await this.#reconcileUpload(pendingUpload[0], pendingUpload[1], signal)
        signal.throwIfAborted()
      } catch (error) { this.#uploadControllers.delete(commandId); this.dismissUpload(commandId); throw error }
    }
    // Re-selecting a file after a confirmed cancelled/recovered upload reuses
    // its original receipt. No second byte upload or source is created.
    for (const [id, original] of this.#receivedUploads) {
      if (!matchesFile(original)) continue
      try {
        const confirmed = await this.#json<{ draft?: T }>('uploads/reconcile', { method: 'POST', body: JSON.stringify(original), signal })
        signal.throwIfAborted()
        if (!confirmed.draft) throw new Error('原上传结果仍待核对，请稍后重试。')
        this.#receivedUploads.delete(id); this.dismissUpload(id); this.#persistRecovery()
        return confirmed.draft
      } finally { this.#uploadControllers.delete(commandId); this.dismissUpload(commandId) }
    }
    const previousUpload = [...this.#pendingUploads.entries()].find(([, entry]) => matchesFile(entry.intent))
    if (previousUpload?.[1].data) { this.#uploadControllers.delete(commandId); this.dismissUpload(commandId); throw new Error('同一文件的原上传仍待核对，请先核对原结果。') }
    if (previousUpload) {
      // A cancelled request or a refreshed page has lost its File body. This
      // explicit re-selection supplies bytes for the original idempotent intent.
      this.#uploadControllers.delete(commandId); this.dismissUpload(commandId)
      commandId = previousUpload[0]
      this.#uploadControllers.set(commandId, controller)
      this.#uploadProgress.set(commandId, { id: commandId, name: file.name, phase: 'hashing', percent: 0, cancelled: false }); this.#notifyUploads()
    }
    const intent = previousUpload?.[1].intent ?? { commandId, threadId, expectedRevision, ...(target ? { target } : {}), displayName: file.name, byteSize: file.size,
      sha256: digest }
    const data = new FormData(); data.append('intent', JSON.stringify(intent)); data.append('file', file)
    return new Promise((resolve, reject) => {
      const entry: PendingUpload = { intent, data, signal, resolve: value => {
        // A successful binding or its canonical reconciliation is required before
        // retaining a payload for previews. Never persist local bytes or credentials.
        this.#uploadControllers.delete(commandId)
        if (entry.cancelled) { this.#receivedUploads.set(commandId, intent); this.#persistRecovery(); this.#uploadPhase(commandId, 'received'); this.#notifyRecovered(); return }
        this.dismissUpload(commandId)
        if (scope === this.editingScope && this.authenticated) this.#retainUpload(threadId, digest, file)
        resolve(value as T)
      }, reject }
      this.#pendingUploads.set(commandId, entry); this.#notifyPending()
      void this.#dispatchUpload(commandId, entry, Boolean(previousUpload))
    })
  }

  #retainUpload(threadId: string, digest: string, file: File): void {
    const key = `${threadId}:${digest}`
    this.#localUploads.delete(key); this.#localUploads.set(key, file)
    let bytes = [...this.#localUploads.values()].reduce((size, item) => size + item.size, 0)
    // This is a bounded, disposable optimization; eviction restores Host reads.
    while (this.#localUploads.size > 16 || bytes > 40 * 1024 * 1024) {
      const oldest = this.#localUploads.keys().next().value!
      bytes -= this.#localUploads.get(oldest)!.size; this.#localUploads.delete(oldest)
    }
  }

  confirmedUpload(threadId: string, generation: string, size: number): File | null {
    const key = `${threadId}:${generation}`
    const file = this.#localUploads.get(key)
    if (!file || file.size !== size) return null
    this.#localUploads.delete(key); this.#localUploads.set(key, file)
    return file
  }

  async #dispatchUpload(commandId: string, entry: PendingUpload, preserveUnknown = false): Promise<void> {
    if (!entry.data) throw new Error('上传内容无法随刷新保留。请先核对原上传结果；未完成时重新选择文件。')
    this.#uploadPhase(commandId, 'transferring')
    await this.#sendUpload(commandId, entry, preserveUnknown).then(result => {
        if (this.#pendingUploads.get(commandId) !== entry) return
        this.#pendingUploads.delete(commandId); this.#notifyPending(); entry.resolve(result.draft)
      }).catch(async error => {
        if (error instanceof HttpRequestError && error.code === 'draft_changed'
          || !preserveUnknown && (error instanceof SessionRequired || error instanceof ConnectionUnavailable || (error instanceof HttpRequestError && [ 'invalid_upload', 'upload_too_large', 'upload_envelope_too_large', 'upload_changed_or_session_expired', 'upload_conflict', 'upload_capacity'].includes(error.code)))) {
          if (this.#pendingUploads.get(commandId) === entry) { this.#pendingUploads.delete(commandId); this.#uploadControllers.delete(commandId); this.dismissUpload(commandId); this.#notifyPending(); entry.reject(error) }
        } else {
          this.#uploadPhase(commandId, 'unknown')
          // An explicit cancellation keeps its uncertain receipt, but does not
          // mean that the healthy connection or the rest of the page is blocked.
          if (!entry.cancelled) this.#requireRecovery()
          await this.reconcilePending()
        }
      })
  }

  async #sendUpload(id: string, entry: PendingUpload, recovery = false): Promise<{ draft: unknown }> {
    const generation = this.#generation
    if (!this.#token) throw new SessionRequired()
    if (!recovery) this.#assertConnected(true)
    await this.renewIfNeeded()
    await this.#assertTab?.()
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    const signal = entry.signal ? AbortSignal.any([entry.signal, this.#lifetime.signal]) : this.#lifetime.signal
    // Non-browser test transports retain Fetch; production uses native upload progress.
    if (typeof XMLHttpRequest === 'undefined') return this.#json('uploads', { method: 'POST', body: entry.data, signal, headers: { 'X-Rovai-Upload-Command-Id': id } }, recovery)
    if (!recovery) this.#assertConnected(true)
    let response: Response
    try {
      response = await uploadRequest(`${this.origin}/api/v1/uploads`, this.#token!, id, entry.data!, signal, fraction => {
        this.#uploadPhase(id, fraction >= 1 ? 'binding' : 'transferring', Math.min(100, Math.floor(fraction * 100)))
      })
    } catch (error) {
      if (generation === this.#generation && !signal.aborted) this.#setConnection('offline')
      throw error
    }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (response.status === 401) { await this.#forgetAuthentication(); throw new SessionRequired() }
    const body = await this.#readResponse(() => response.json(), generation, signal)
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (!response.ok) {
      const code = body.error?.code ?? 'connection_unavailable'
      if (['connection_unavailable', 'core_unavailable', 'result_unavailable', 'upload_binding_unknown'].includes(code)) this.#setConnection('offline')
      throw new HttpRequestError(response.status, code)
    }
    return body
  }

  /** Explicit user action only. Reconcile first, then reuse exact identities and
   * payloads for requests whose receipts are still unknown. Never called by SSE,
   * reconnect or login. Core remains the sole command/replay authority. */
  retryPending(): Promise<boolean> {
    if (this.#retrying) return this.#retrying
    const retry = this.#recoverConnection().finally(() => { if (this.#retrying === retry) this.#retrying = null })
    this.#retrying = retry
    return retry
  }

  /** Returns whether an upload needs its local file reselected after refresh. */
  async #recoverConnection(): Promise<boolean> {
    if (!this.authenticated) throw new SessionRequired()
    const generation = this.#generation
    // A Core read verifies the service even when there are no pending commands.
    await this.#rpc('app.info', {}, true)
    this.#setConnection('live')
    this.#wakeReconnect?.()
    await this.reconcilePending()
    for (const [id, entry] of [...this.#pending]) {
      if (this.#pending.get(id) === entry) await this.#dispatchCommand(id, entry, true)
    }
    for (const [id, entry] of [...this.#pendingUploads]) {
      if (this.#pendingUploads.get(id) === entry && entry.data && !entry.cancelled) { this.#resetUploadSignal(id, entry); await this.#dispatchUpload(id, entry, true) }
    }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (this.#pending.size || [...this.#pendingUploads.values()].some(entry => entry.data)) {
      this.#requireRecovery()
      throw new ConnectionUnavailable()
    }
    // Unavailable file bytes must not trap the entire app. Retain those intents
    // for receipt lookup / exact-file reselection; they are not failed receipts.
    this.#needsRecovery = false
    this.#setConnection('live')
    this.#notifyRecovered()
    return this.#pendingUploads.size > 0
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
      ? await this.#readResponse(() => response.json(), generation) as FilePreviewOperationResult<never>
      : { ok: true as const, value: { blob: await this.#readResponse(() => response.blob(), generation), mime: response.headers.get('Content-Type') ?? 'application/octet-stream',
        contentGeneration: response.headers.get('x-rovai-content-generation') ?? '',
        contentVersion: JSON.parse(response.headers.get('x-rovai-content-version') ?? 'null') as FilePreviewBinaryContent['contentVersion'],
        name: responseFileName(response) } }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return value
  }
  async download(request: { kind: 'source'; source: unknown } | { kind: 'preview'; handleId: string; expectedGeneration: string }): Promise<void> {
    if (!this.#nativeDownload) throw new Error('此 Host 尚不支持独立下载，请升级 Host 后重试。')
    const generation = this.#generation
    const result = await this.#json<{ url: string; name: string }>('downloads', { method: 'POST', body: JSON.stringify(request) })
    // A short-lived capability is never persisted, logged, or passed to an
    // external origin. Do not follow a server-provided arbitrary URL.
    if (typeof result.url !== 'string' || !/^\/api\/v1\/downloads\/[a-f0-9]{64}$/.test(result.url)) throw new Error('下载地址无效。')
    const url = new URL(result.url, this.origin)
    if (url.origin !== this.origin || generation !== this.#generation || !this.authenticated) throw new DOMException('Connection replaced', 'AbortError')
    const link = document.createElement('a')
    link.href = url.href; link.download = result.name; link.rel = 'noreferrer'; link.referrerPolicy = 'no-referrer'
    document.body.append(link); link.click(); link.remove()
  }

  async attachment(locator: unknown): Promise<{ blob: Blob; name: string }> {
    const generation = this.#generation
    const response = await this.#authorized('attachments', { method: 'POST', body: JSON.stringify(locator) })
    const blob = await this.#readResponse(() => response.blob(), generation)
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return { blob, name: responseFileName(response) }
  }

  async #reconcileUpload(id: string, entry: PendingUpload, signal?: AbortSignal): Promise<void> {
    const result = await this.#json<{ draft?: unknown; state?: 'unknown' | 'unbound' }>('uploads/reconcile', { method: 'POST', body: JSON.stringify(entry.intent), signal })
    if (this.#pendingUploads.get(id) !== entry) return
    if (result.draft) {
      this.#pendingUploads.delete(id); this.#notifyPending(); entry.resolve(result.draft)
    } else if (result.state === 'unbound') {
      this.#pendingUploads.delete(id); this.#uploadControllers.delete(id); this.dismissUpload(id); this.#notifyPending()
      entry.reject(new Error('文件未完成上传，请重新选择后重试。'))
    }
  }

  reconcilePending(): Promise<void> {
    if (this.#reconciling) return this.#reconciling
    if (!this.authenticated) return Promise.resolve()
    const reconciliation = this.#reconcilePending().finally(() => { if (this.#reconciling === reconciliation) this.#reconciling = null })
    this.#reconciling = reconciliation
    return reconciliation
  }

  async #reconcilePending(): Promise<void> {
    for (const [id, entry] of this.#pending) {
      try {
        const receipt = await this.#rpc<CommandReceipt>('commands.reconcile', { operation: entry.operation, params: entry.params })
        if (receipt.state === 'recorded' && this.#pending.get(id) === entry) {
          this.#pending.delete(id); this.#notifyPending()
          if (receipt.error) entry.reject(new CoreRequestError(receipt.error.code, receipt.error.message))
          else entry.resolve(receipt.result, 'recovery')
        }
      } catch { /* Unknown stays associated with its original commandId. */ }
    }
    for (const [id, entry] of this.#pendingUploads) {
      try {
        await this.#reconcileUpload(id, entry)
      } catch { /* No deletion or redispatch while binding remains unknown. */ }
    }
  }

  async #rpc<T>(operation: WebOperation, params: unknown, recovery = false): Promise<T> {
    const generation = this.#generation
    const response = await this.#authorized('request', { method: 'POST', body: JSON.stringify({ operation, params }) }, recovery || operation === 'commands.reconcile')
    const body = await this.#readResponse(() => response.json(), generation) as { result: T; error?: { code?: string; message?: string } }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (body.error) throw new CoreRequestError(body.error.code ?? 'request_failed', body.error.message)
    return body.result
  }

  async channel(request: { operation: 'get' | 'publish' | 'retry' | 'selectApprover'; kind?: ChannelKind; agentId?: string; userId?: string }): Promise<ChannelSettingsSnapshot> {
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

  async #json<T>(path: 'session' | 'session/renew' | 'channels' | 'updates' | 'workspaces' | 'uploads' | 'uploads/reconcile' | 'files' | 'downloads' | 'avatars', options: RequestInit = {}, recovery = false): Promise<T> {
    const generation = this.#generation
    const response = await this.#authorized(path, options, recovery)
    const result = await this.#readResponse(() => response.json(), generation, options.signal, path !== 'session/renew') as T
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    return result
  }

  #assertConnected(allowPending = false): void {
    if (this.#connection === 'offline' || !allowPending && this.#needsRecovery) throw new ConnectionUnavailable()
  }

  async #readResponse<T>(read: () => Promise<T>, generation: number, signal?: AbortSignal | null, reportFailure = true): Promise<T> {
    try { return await read() }
    catch (error) {
      // Use the caller's cancellation signal, not the combined request signal:
      // the internal recovery deadline still represents an unavailable connection.
      if (generation === this.#generation && !signal?.aborted && reportFailure) this.#setConnection('offline')
      throw error
    }
  }

  async #authorized(path: 'session' | 'session/renew' | 'channels' | 'updates' | 'request' | 'events' | 'logout' | 'workspaces' | 'uploads' | 'uploads/reconcile' | 'files' | 'files/bytes' | 'attachments' | 'downloads' | 'avatars', options: RequestInit = {}, recovery = false): Promise<Response> {
    if (!this.#token) throw new SessionRequired()
    const internal = recovery || ['session', 'session/renew', 'events', 'logout', 'uploads/reconcile'].includes(path)
    // Pending domain submissions block new commands/uploads at their admission
    // points. Once the service is reachable, background reads must still be able
    // to mount/refresh the page behind the interaction boundary.
    if (!internal) this.#assertConnected(true)
    const generation = this.#generation
    if (this.#localExpiry !== null && this.#localExpiry - this.#now() <= this.#renewalWindow && !['session', 'session/renew', 'logout'].includes(path)) await this.renewIfNeeded()
    if (this.#assertTab) await this.#assertTab()
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (!internal) this.#assertConnected(true)
    const signals = [this.#lifetime.signal, ...(options.signal ? [options.signal] : [])]
    // Bound recovery, including reading the response body; leave ordinary long
    // Runtime operations and the streaming SSE body on their existing limits.
    if (internal && path !== 'events') signals.push(AbortSignal.timeout(20_000))
    let response: Response
    try {
      response = await this.#fetch(`${this.origin}/api/v1/${path}`, {
        ...options, credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { ...Object.fromEntries(new Headers(options.headers)), ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${this.#token}` },
        signal: AbortSignal.any(signals)
      })
    } catch (error) {
      if (generation === this.#generation && !options.signal?.aborted && path !== 'session/renew') this.#setConnection('offline')
      throw error
    }
    if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
    if (response.status === 401) { await this.#forgetAuthentication(); throw new SessionRequired() }
    if (!response.ok) {
      const error = await this.#readResponse(() => response.json().catch(error => {
        if (error instanceof SyntaxError) return {}
        throw error
      }), generation, options.signal, path !== 'session/renew') as { error?: { code?: string; message?: string } }
      if (generation !== this.#generation) throw new DOMException('Connection replaced', 'AbortError')
      const code = error.error?.code ?? 'connection_unavailable'
      if (['connection_unavailable', 'core_unavailable', 'result_unavailable', 'upload_binding_unknown'].includes(code)) this.#setConnection('offline')
      throw new HttpRequestError(response.status, code, sessionStorageMessage(error))
    }
    return response
  }

  subscribe(invalidate: (change: ThreadReadInvalidation) => void, status: (state: ConnectionState) => void): () => void {
    const controller = new AbortController()
    const lifetime = this.#lifetime.signal
    const signal = AbortSignal.any([controller.signal, lifetime])
    const unsubscribe = this.onConnectionChanged(() => status(this.connectionState))
    status(this.connectionState)
    const run = async (): Promise<void> => {
      let retry = 1000
      while (!signal.aborted) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          // Starting another fetch neither proves availability nor invalidates
          // the successful login. Keep an existing offline gate until it opens.
          const response = await this.#authorized('events', { signal })
          if (signal.aborted) { await response.body?.cancel(); return }
          if (!response.body) throw new Error('实时连接不可用。')
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          const frames = new InvalidationDecoder()
          this.#setConnection('live')
          void this.reconcilePending()
          retry = 1000
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (frames.push(decoder.decode(value, { stream: true }))) {
              const changes = frames.takeChanges()
              invalidate({ resync: changes.some(change => change.resync), ...(changes.some(change => change.referencesChanged) ? { referencesChanged: true } : {}), ...(changes.some(change => change.notificationsChanged) ? { notificationsChanged: true } : {}), ...(changes.some(change => change.tasksChanged) ? { tasksChanged: true } : {}), ...(changes.some(change => change.teamsChanged) ? { teamsChanged: true } : {}), messages: changes.flatMap(change => change.messages ?? []) })
              void this.reconcilePending()
            }
          }
        } catch (error) {
          if (error instanceof SessionRequired) { this.#setConnection('expired'); return }
          if (signal.aborted) return
        } finally {
          await reader?.cancel().catch(() => undefined)
          reader?.releaseLock()
        }
        if (signal.aborted) return
        this.#setConnection('offline')
        await new Promise<void>((resolve) => {
          const wake = (): void => {
            clearTimeout(timer); signal.removeEventListener('abort', wake)
            if (this.#wakeReconnect === wake) this.#wakeReconnect = null
            resolve()
          }
          const timer = setTimeout(wake, retry)
          this.#wakeReconnect = wake
          signal.addEventListener('abort', wake, { once: true })
        })
        retry = Math.min(retry * 2, 30_000)
      }
    }
    void run()
    return () => { unsubscribe(); controller.abort() }
  }
}

function responseFileName(response: Response): string {
  const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
  return name ? decodeURIComponent(name).replace(/[\\/\x00-\x1f\x7f]/g, '_') : 'attachment'
}
