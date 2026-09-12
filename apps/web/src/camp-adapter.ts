import type { CampClient } from '../../desktop/src/renderer/src/camp-client'
import type { BusinessEnvironment } from '../../desktop/src/renderer/src/business-environment'
import type { CoreMethod, FilePreviewApi, FilePreviewExternalUpdateEvent, FilePreviewOperationResult, FilePreviewBinaryContent, OpenFilePreviewResult } from '@contracts'
import { ConsoleClient, WEB_OPERATIONS, type WebOperation } from './client'
import { browserPreferences } from './preferences'

export function browserPlatform(): CampClient['platform'] {
  const platform = navigator.platform.toLowerCase()
  return platform.includes('mac') ? 'darwin' : platform.includes('win') ? 'win32' : 'linux'
}

export function createCampAdapter(transport: ConsoleClient, selectWorkspaceDirectory: BusinessEnvironment['selectWorkspaceDirectory']) {
  if (!transport.editingScope || !transport.presentationScope) throw new Error('必须先认证才能建立编辑作用域。')
  const listeners = new Set<() => void>()
  const unimplemented = async (): Promise<never> => { throw new Error('此操作的 Web 适配尚未接通。') }
  const client: CampClient = {
    platform: browserPlatform(),
    request: <T,>(method: CoreMethod, params?: unknown): Promise<T> => {
      if (!(WEB_OPERATIONS as readonly string[]).includes(method)) return Promise.reject(new Error(`尚未开放此 Web 操作：${method}`))
      return transport.request<T>(method as WebOperation, params)
    },
    onInvalidated: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    composerAttachments: { prepare: (campId, revision, file) => transport.uploadFile(campId, revision, file), preparePending: unimplemented, preview: unimplemented },
    attachments: { kind: 'download', download: unimplemented }
  }
  const fileListeners = new Set<(event: FilePreviewExternalUpdateEvent) => void>()
  const names = new Map<string, string>()
  const opened = async (action: 'open' | 'restore' | 'reopen', request: unknown) => {
    const result = await transport.files<FilePreviewOperationResult<OpenFilePreviewResult>>(action, request)
    if (result.ok && result.value.kind === 'file_preview') names.set(result.value.file.handleId, result.value.file.fileName)
    return result
  }
  const files: FilePreviewApi = {
    bindCamp: async () => { /* Camp tab state stays in the shared React provider; every resource carries an exact source. */ },
    open: request => opened('open', request), restore: request => opened('restore', request), reopen: request => opened('reopen', request),
    readText: request => transport.files('readText', request),
    readPage: request => transport.files('readPage', request), resolveLine: request => transport.files('resolveLine', request),
    readBinary: async request => {
      const result = await transport.files<FilePreviewOperationResult<Omit<FilePreviewBinaryContent, 'bytes'> & { base64: string }>>('readBinary', request)
      if (!result.ok) return result
      return { ok: true, value: { ...result.value, bytes: Uint8Array.from(atob(result.value.base64), char => char.charCodeAt(0)) } }
    },
    prepareHtml: async () => ({ ok: false, error: { code: 'source_not_authorized', message: 'Web 以文本方式打开 HTML。', retryable: false } }),
    reload: request => transport.files('reload', request),
    release: async request => { names.delete(request.handleId); return transport.files('release', request) },
    openInSystem: unimplemented, revealInFolder: unimplemented,
    copyPath: async request => {
      const name = names.get(request.handleId)
      if (!name || request.format !== 'display') return { ok: false, error: { code: 'source_not_authorized', message: '此入口只提供文件名。', retryable: false } }
      await navigator.clipboard.writeText(name)
      return { ok: true, value: { copied: true } }
    },
    chooseAuthorizedRoot: async () => ({ ok: false, error: { code: 'authorization_required', message: '请选择文件所在的 Host 工作目录后重试。', retryable: true } }),
    onExternalUpdate: listener => { fileListeners.add(listener); return () => { fileListeners.delete(listener) } }
  }
  client.composerAttachments.preview = async locator => {
    const result = await opened('open', { kind: 'attachment', campId: locator.campId, locator })
    if (!result.ok) return { preview: null, availability: result.error.code === 'file_not_found' ? 'missing' : 'unreadable' }
    if (result.value.kind !== 'file_preview') return { preview: null, availability: 'unreadable' }
    const file = result.value.file
    try {
      if (file.kind !== 'image') return { preview: null, availability: 'available' }
      const image = await files.readBinary({ handleId: file.handleId, expectedGeneration: file.contentGeneration })
      return image.ok ? { preview: { bytes: image.value.bytes, mediaType: image.value.mime }, availability: 'available' } : { preview: null, availability: 'unreadable' }
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
  const { preferences, profile } = browserPreferences(transport.presentationScope)
  const environment: BusinessEnvironment = { client, preferences, files, selectWorkspaceDirectory }
  return { environment, profile, invalidate: () => { for (const listener of listeners) listener() } }
}
