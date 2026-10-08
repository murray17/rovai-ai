import { createBrowserHtmlPreview } from './html-preview'
import { browserMemberAvatars } from './member-avatars'
import type { ThreadClient } from '../../desktop/src/renderer/src/camp-client'
import type { BusinessEnvironment } from '../../desktop/src/renderer/src/business-environment'
import type { ThreadReadInvalidation, SingleChatSnapshot, CoreMethod, FilePreviewApi, FilePreviewExternalUpdateEvent, FilePreviewOperationResult, OpenFilePreviewResult, RestoreFilePreviewRequest } from '@contracts'
import { ConsoleClient, WEB_OPERATIONS, type WebOperation } from './client'
import { createBrowserNavigationHistory } from './navigation-history'
import { browserEditingRecovery } from './editing-recovery'
import { browserPreferences } from './preferences'
import { createServerUpdates } from './server-updates'
import { restorableFilePreviewRequest } from '../../desktop/src/renderer/src/file-preview-session'
import { parseFileReference } from '../../desktop/src/file-preview-reference'
import { writeClipboardText } from '../../desktop/src/renderer/src/clipboard'

export function browserPlatform(): ThreadClient['platform'] {
  const platform = navigator.platform.toLowerCase()
  return platform.includes('mac') ? 'darwin' : platform.includes('win') ? 'win32' : 'linux'
}

export function createThreadAdapter(transport: ConsoleClient, selectWorkspaceDirectory: BusinessEnvironment['selectWorkspaceDirectory']) {
  if (!transport.editingScope || !transport.presentationScope) throw new Error('必须先认证才能建立编辑作用域。')
  const listeners = new Set<(change?: ThreadReadInvalidation) => void>()
  const unimplemented = async (): Promise<never> => { throw new Error('此操作的 Web 适配尚未接通。') }
  const channelAdapter: NonNullable<ThreadClient['channels']> = {
    native: null,
    get: () => transport.channel({ operation: 'get' }),
    // Main-owned channel progress is read by the mounted shared page, including
    // steps that do not emit Core events. Polling never owns publication work.
    onChanged: () => () => undefined,
    publishMemberBot: (agentId, kind = 'feishu') => transport.channel({ operation: 'publish', agentId, kind }),
    retryMemberBot: (agentId, kind = 'feishu') => transport.channel({ operation: 'retry', agentId, kind }),
    selectPublicationApprover: (agentId, userId, kind = 'feishu') => transport.channel({ operation: 'selectApprover', agentId, userId, kind })
  }
  const client: ThreadClient = {
    platform: browserPlatform(),
    missionAttachments: null,
    editingRecovery: browserEditingRecovery(transport.editingScope),
    exportDiagnostics: async () => downloadJson(await transport.request('diagnostics.export'), 'rovai-diagnostics.json'),
    exportMonitoring: async filter => downloadJson({ exportedAt: new Date().toISOString(), ...await transport.request<object>('monitoring.snapshot', filter) }, 'rovai-runtime-monitoring.json'),
    revealMonitoringExport: null,
    revealDiagnosticsExport: null,
    memberAvatars: browserMemberAvatars(transport),
    selectSkillImportDirectory: async () => (await selectWorkspaceDirectory())?.projectPath ?? null,
    selectRuntimeExecutable: null,
    revealMcpConfig: null,
    get channels() { return transport.channels === 'desktop' ? channelAdapter : null },
    request: <T,>(method: CoreMethod, params?: unknown): Promise<T> => {
      if (!(WEB_OPERATIONS as readonly string[]).includes(method)) return Promise.reject(new Error(`尚未开放此 Web 操作：${method}`))
      return transport.request<T>(method as WebOperation, params)
    },
    attachmentLocation: async locator => {
      const path = await transport.files<string | null>('attachmentLocation', locator)
      return typeof path === 'string' ? { path, location: 'server' } : null
    },
    onInvalidated: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    singleChatAttachments: {
      prepare: async (conversationId, revision, file) => {
        const snapshot = await transport.request<SingleChatSnapshot | null>('singleChat.get', { conversationId })
        if (!snapshot) throw new Error('单聊已不在当前会话中。')
        return transport.uploadTo(snapshot.conversation.threadId, revision, file, { kind: 'single_chat', conversationId })
      },
      preparePending: (input, file) => transport.uploadTo(input.threadId, input.expectedRevision, file, { kind: 'single_chat_pending', conversationId: input.conversationId, pendingInputId: input.pendingInputId, editToken: input.editToken }),
      remove: (conversationId, expectedDraftRevision, attachmentRefId) => transport.request('singleChat.composerDraft.removeAttachment', { conversationId, expectedDraftRevision, attachmentRefId })
    },
    composerAttachments: {
      prepare: (threadId, revision, file) => transport.uploadFile(threadId, revision, file),
      preview: unimplemented
    },
    attachments: { kind: 'download', download: unimplemented }
  }
  const fileListeners = new Set<(event: FilePreviewExternalUpdateEvent) => void>()
  const names = new Map<string, string>()
  const paths = new Map<string, string>()
  const sources = new Map<string, RestoreFilePreviewRequest>()
  let watchTimer: ReturnType<typeof setInterval> | null = null
  let watchGeneration = 0
  let watching = false
  let lastWatch = 0
  const refreshUpdates = async () => {
    if (watching || names.size === 0 || fileListeners.size === 0 || Date.now() - lastWatch < 1500) return
    const generation = watchGeneration
    watching = true; lastWatch = Date.now()
    try {
      const result = await transport.files<FilePreviewOperationResult<FilePreviewExternalUpdateEvent[]>>('updates', {})
      if (result.ok && generation === watchGeneration) {
        for (const event of result.value) for (const listener of fileListeners) listener(event)
      }
    } catch { /* Connection recovery is presented by the shared Web entry. */ }
    finally { watching = false }
  }

  const syncWatch = () => {
    if (fileListeners.size > 0 && names.size > 0) {
      if (watchTimer === null) watchTimer = setInterval(() => void refreshUpdates(), 2000)
    } else if (watchTimer !== null) {
      clearInterval(watchTimer); watchTimer = null; watchGeneration += 1; lastWatch = 0
    }
  }
  const opened = async (action: 'open' | 'restore' | 'reopen', request: unknown) => {
    const result = await transport.files<FilePreviewOperationResult<OpenFilePreviewResult>>(action, request)
    if (result.ok && result.value.kind === 'file_preview') {
      names.set(result.value.file.handleId, result.value.file.displayPath)
      if (result.value.file.absolutePath) paths.set(result.value.file.handleId, result.value.file.absolutePath)
      const source = result.value.file.restoreRequest ?? (request && typeof request === 'object' && 'kind' in request
        ? restorableFilePreviewRequest(request as RestoreFilePreviewRequest) : null)
      if (source) sources.set(result.value.file.handleId, source)
      syncWatch()
      if (request && typeof request === 'object' && 'rawReference' in request && typeof request.rawReference === 'string') {
        result.value.file.target = parseFileReference(request.rawReference)?.target
      }
    }
    return result
  }
  const files: FilePreviewApi = {
    bindThread: async () => { /* Thread tab state stays in the shared React provider; every resource carries an exact source. */ },
    open: request => opened('open', request), restore: request => opened('restore', request), reopen: request => opened('reopen', request),
    readText: request => transport.files('readText', request),
    readPage: request => transport.files('readPage', request), resolveLine: request => transport.files('resolveLine', request),
    readChildImage: async request => {
      const result = await transport.fileBytes('readChildImage', request)
      if (!result.ok) return result
      const { blob, ...metadata } = result.value
      return { ok: true, value: { ...metadata, bytes: new Uint8Array(await blob.arrayBuffer()) } }
    },
    readBinary: async request => {
      const result = await transport.fileBytes('readBinary', request)
      if (!result.ok) return result
      const { blob, ...metadata } = result.value
      return { ok: true, value: { ...metadata, bytes: new Uint8Array(await blob.arrayBuffer()) } }
    },
    prepareHtmlSite: request => createBrowserHtmlPreview(transport, request),
    releaseHtmlSite: async () => ({ released: true }), // The document belongs to the mounted iframe; no server site or object URL survives it.
    prepareHtml: unimplemented, // Legacy Desktop transport; the shared viewer uses prepareHtmlSite.
    reload: async request => {
      const source = sources.get(request.handleId)
      if (!source) return { ok: false, error: { code: 'source_not_authorized', message: '无法重新取得文件，已保留当前预览。', retryable: false } }
      const result = await opened('restore', source)
      if (!result.ok) return result
      return result.value.kind === 'file_preview' ? { ok: true, value: result.value.file }
        : { ok: false, error: { code: 'read_failed', message: '未能准备新预览。', retryable: true } }
    },
    release: async request => { names.delete(request.handleId); paths.delete(request.handleId); sources.delete(request.handleId); syncWatch(); return transport.files('release', request) },
    download: async request => {
      const result = await transport.fileBytes('download', request)
      if (!result.ok) return result
      const url = URL.createObjectURL(result.value.blob)
      const link = document.createElement('a'); link.href = url; link.download = result.value.name; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return { ok: true, value: { started: true } }
    },
    openInSystem: unimplemented, revealInFolder: unimplemented,
    copyPath: async request => {
      const name = paths.get(request.handleId) ?? (request.format === 'display' ? names.get(request.handleId) : undefined)
      if (!name) return { ok: false, error: { code: 'source_not_authorized', message: '此入口只提供页面显示的路径。', retryable: false } }
      if (!await writeClipboardText(name)) return { ok: false, error: { code: 'read_failed', message: '未能复制路径，请重试。', retryable: true } }
      return { ok: true, value: { copied: true } }
    },
    chooseAuthorizedRoot: async () => ({ ok: false, error: { code: 'authorization_required', message: '请选择文件所在的 Host 工作目录后重试。', retryable: true } }),
    onExternalUpdate: listener => {
      fileListeners.add(listener)
      syncWatch()
      return () => { fileListeners.delete(listener); syncWatch() }
    }
  }
  client.composerAttachments.preview = async locator => {
    const result = await opened('open', { kind: 'attachment', threadId: locator.threadId, locator })
    if (!result.ok) return { preview: null, availability: result.error.code === 'file_not_found' ? 'missing' : 'unreadable' }
    if (result.value.kind !== 'file_preview') return { preview: null, availability: 'unreadable' }
    const file = result.value.file
    try {
      if (file.kind !== 'image') return { preview: null, availability: 'available' }
      // Open has just reauthorized the exact binding and hashed the Host source.
      // Local bytes are usable only when that confirmation matches the upload.
      const local = transport.confirmedUpload(locator.threadId, file.contentGeneration, file.size)
      if (local) return { preview: { blob: local }, availability: 'available' }
      const image = await transport.fileBytes('readBinary', { handleId: file.handleId, expectedGeneration: file.contentGeneration })
      return image.ok ? { preview: { blob: image.value.blob }, availability: 'available' } : { preview: null, availability: 'unreadable' }
    } finally { await files.release({ handleId: file.handleId }) }
  }
  client.attachments = { kind: 'download', download: async locator => {
    try {
      const response = await transport.attachment(locator)
      const url = URL.createObjectURL(response.blob)
      const link = document.createElement('a'); link.href = url; link.download = response.name; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return { opened: true, error: null, availability: 'available' }
    } catch { return { opened: false, error: 'target_unavailable', availability: 'missing' } }
  } }
  const { preferences, profile } = browserPreferences(transport.presentationScope, transport)
  const environment: BusinessEnvironment = { navigationHistory: createBrowserNavigationHistory(transport.editingScope), client, preferences, files, selectWorkspaceDirectory,
    serverUpdates: transport.channels === 'desktop' ? undefined : createServerUpdates(transport) }
  return { environment, profile, invalidate: (change: ThreadReadInvalidation = { resync: true }) => { for (const listener of listeners) listener(change); void refreshUpdates() } }
}

function downloadJson(value: unknown, name: string): { exported: true } {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { exported: true }
}
