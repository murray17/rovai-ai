import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import type {
  FileContentVersion,
  FileLocationTarget,
  FilePreviewApi,
  FilePreviewAuthorizationChallenge,
  FilePreviewCapability,
  FilePreviewErrorCode,
  FilePreviewHtmlDocument,
  FilePreviewOperationResult,
  FilePreviewPageContent,
  FilePreviewRootGrantResult,
  FilePreviewTextContent,
  FilePreviewKind,
  OpenFilePreviewRequest,
  OpenFilePreviewResult,
  ParsedFileReference,
  ResolvedFilePreview
} from '@contracts'
import { parseFileReference } from '../../file-preview-reference'
import { filePreviewAssetUrl, parseFilePreviewAssetUrl } from '../../file-preview-asset-url'
import {
  canonicalizeExistingPath,
  FilePreviewAccessError,
  inspectPreviewPath,
  openPreviewFile,
  pathIsWithin,
  referenceCandidatePath,
  type OpenedPreviewFile
} from './file-preview-access'
import {
  classifyFilePreview,
  filePreviewLimits,
  type FilePreviewClassification
} from './file-preview-classifier'
import {
  RootWatchRegistry,
  type RootWatchNotification
} from './file-preview-watchers'

const HANDLE_TTL_MS = 30 * 60 * 1000
const PENDING_OPEN_TTL_MS = 5 * 60 * 1000
const MAX_HANDLES_PER_WINDOW = 64
const HTML_TOKEN_TTL_MS = 10 * 60 * 1000
const HTML_ASSET_BYTES = 8 * 1024 * 1024

export type FilePreviewAuthorityResult =
  | {
      kind: 'evidence_review'
      campId: string
      agentRunId: string
      executionEpoch: number
      evidenceFileId: string
    }
  | {
      kind: 'evidence_identity_unavailable'
      campId: string
      agentRunId: string
      executionEpoch: number
      evidenceFileId: string
    }
  | {
      kind: 'file_target'
      campId: string
      sourceKind: 'message_reference' | 'camp_workspace' | 'attachment' | 'run_evidence'
      sourceIdentity: string
      rootPath: string
      basePath: string
      rawReference?: string
      candidatePath?: string
      displayName?: string
      openRisk?: 'normal' | 'confirm'
      allowChildren?: boolean
    }

export interface FilePreviewSourceAuthority {
  resolve(request: Exclude<OpenFilePreviewRequest, { kind: 'child_of_handle' | 'authorized_root' }>): Promise<FilePreviewAuthorityResult | null>
}

export interface FilePreviewNativeActions {
  selectRoot(webContentsId: number): Promise<string | null>
  confirmOpen(displayName: string): Promise<boolean>
  openPath(path: string): Promise<string>
  revealPath(path: string): void
  copyText(text: string): void
  publishExternalUpdate(notification: RootWatchNotification): void
}

interface ResolvedTarget {
  kind: 'file_target'
  campId: string
  sourceKind: OpenFilePreviewRequest['kind']
  sourceIdentity: string
  rootPath: string
  basePath: string
  rawReference?: string
  candidatePath?: string
  displayName?: string
  target?: FileLocationTarget
  openRisk: 'normal' | 'confirm'
  allowChildren: boolean
}

type SupportedClassification = Omit<FilePreviewClassification, 'kind'> & { kind: FilePreviewKind }

interface PreviewHandleRecord {
  handleId: string
  webContentsId: number
  campId: string
  request: OpenFilePreviewRequest
  sourceIdentity: string
  file: FileHandle | null
  reopening: Promise<FileHandle> | null
  reopenTarget: ResolvedTarget
  canonicalRoot: string
  canonicalPath: string
  displayPath: string
  fileName: string
  version: FileContentVersion
  classification: SupportedClassification
  previewKey: string
  reopenToken: string
  generation: string
  target?: FileLocationTarget
  capabilities: FilePreviewCapability[]
  hasExternalUpdate: boolean
  allowChildren: boolean
  lastUsedAt: number
}

interface PendingOpen {
  id: string
  webContentsId: number
  campId: string
  request: OpenFilePreviewRequest
  target: ResolvedTarget
  candidatePath: string
  displayReference: string
  expiresAt: number
}

interface RootGrant {
  id: string
  webContentsId: number
  campId: string
  canonicalRoot: string
  displayName: string
}

interface HtmlPreviewToken {
  token: string
  bridgeToken: string
  handleId: string
  webContentsId: number
  campId: string
  generation: string
  expiresAt: number
}

function ok<T>(value: T): FilePreviewOperationResult<T> {
  return { ok: true, value }
}

function failed<T>(
  code: FilePreviewErrorCode,
  message: string,
  retryable = false,
  extra?: { displayReference?: string; authorizationChallenge?: FilePreviewAuthorizationChallenge }
): FilePreviewOperationResult<T> {
  return { ok: false, error: { code, message, retryable, ...extra } }
}

function generation(): string {
  return randomUUID()
}

function contentVersionMatches(left: FileContentVersion, right: FileContentVersion): boolean {
  if (left.fileId && right.fileId && left.fileId !== right.fileId) return false
  return left.size === right.size && left.mtimeMs === right.mtimeMs
}

async function fileHandleVersion(file: FileHandle): Promise<FileContentVersion> {
  const stat = await file.stat()
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    fileId: `${stat.dev}:${stat.ino}`
  }
}

function safeDisplayReference(value: string): string {
  const normalized = value.replace(/[\r\n\0]/gu, ' ').trim()
  return Array.from(normalized).slice(0, 180).join('')
}

function strictDecode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function htmlAssetMime(path: string): string | null {
  const extension = extname(path).toLocaleLowerCase('en-US')
  return new Map<string, string>([
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.wasm', 'application/wasm'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.avif', 'image/avif'],
    ['.bmp', 'image/bmp'],
    ['.ico', 'image/x-icon'],
    ['.svg', 'image/svg+xml'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
    ['.ttf', 'font/ttf'],
    ['.otf', 'font/otf'],
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.ogg', 'audio/ogg'],
    ['.mp4', 'video/mp4'],
    ['.webm', 'video/webm']
  ]).get(extension) ?? null
}

function rewriteAssetCss(css: string, token: string, basePath: string): string {
  return css
    .replace(/url\(\s*(['"]?)([^)'"\s][^)'"\n]*?)\1\s*\)/giu, (_match, quote: string, value: string) => {
      const rewritten = filePreviewAssetUrl(value.trim(), token, basePath)
      return `url(${quote}${rewritten ?? value.trim()}${quote})`
    })
    .replace(/(@import\s+)(['"])([^'"]+)\2/giu, (_match, prefix: string, quote: string, value: string) => {
      const rewritten = filePreviewAssetUrl(value, token, basePath)
      return `${prefix}${quote}${rewritten ?? value}${quote}`
    })
}

export class FilePreviewService {
  readonly #authority: FilePreviewSourceAuthority
  readonly #native: FilePreviewNativeActions
  readonly #handles = new Map<string, PreviewHandleRecord>()
  readonly #windowCamps = new Map<number, string>()
  readonly #pending = new Map<string, PendingOpen>()
  readonly #rootGrants = new Map<string, RootGrant>()
  readonly #htmlTokens = new Map<string, HtmlPreviewToken>()
  readonly #watchers: RootWatchRegistry

  constructor(
    authority: FilePreviewSourceAuthority,
    native: FilePreviewNativeActions,
    watchers?: RootWatchRegistry
  ) {
    this.#authority = authority
    this.#native = native
    this.#watchers = watchers ?? new RootWatchRegistry({
      notify: (notification) => this.#onExternalUpdate(notification)
    })
  }

  async bindCamp(webContentsId: number, campId: string | null): Promise<void> {
    this.#prune()
    const previous = this.#windowCamps.get(webContentsId)
    if (previous && previous !== campId) await this.#releaseCamp(webContentsId, previous)
    if (campId) this.#windowCamps.set(webContentsId, campId)
    else this.#windowCamps.delete(webContentsId)
  }

  async open(
    webContentsId: number,
    request: OpenFilePreviewRequest
  ): Promise<FilePreviewOperationResult<OpenFilePreviewResult>> {
    this.#prune()
    try {
      const target = await this.#resolveTarget(webContentsId, request)
      if (!target) return failed('source_not_authorized', '无法确认这个文件来源。')
      if (target.kind === 'evidence_review') return ok(target)
      if (target.kind === 'evidence_identity_unavailable') {
        return failed('evidence_identity_unavailable', '无法可靠定位这个历史记录对应的当前文件。')
      }
      return await this.#openResolved(webContentsId, request, target, true)
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async reopen(
    webContentsId: number,
    request: { campId: string; reopenToken: string }
  ): Promise<FilePreviewOperationResult<OpenFilePreviewResult>> {
    this.#prune()
    const record = [...this.#handles.values()].find((candidate) =>
      candidate.webContentsId === webContentsId
      && candidate.campId === request.campId
      && candidate.reopenToken === request.reopenToken
    )
    if (!record) return failed('source_not_authorized', '这个文件访问已失效。', true)
    try {
      await this.#ensureFile(record)
      return ok({ kind: 'file_preview', file: this.#publicFile(record) })
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async readText(
    webContentsId: number,
    request: { handleId: string; expectedGeneration: string }
  ): Promise<FilePreviewOperationResult<FilePreviewTextContent>> {
    try {
      const record = this.#record(webContentsId, request.handleId, request.expectedGeneration)
      if (record.version.size > filePreviewLimits.wholeTextBytes) {
        return failed('file_too_large', '文件较大，请使用分页阅读。')
      }
      const bytes = await this.#readAt(record, 0, record.version.size)
      return ok({
        text: strictDecode(bytes),
        contentGeneration: record.generation,
        contentVersion: record.version
      })
    } catch (error) {
      return this.#errorResult(error, 'decode_failed')
    }
  }

  async readPage(
    webContentsId: number,
    request: { handleId: string; expectedGeneration: string; offset: number; maxBytes?: number }
  ): Promise<FilePreviewOperationResult<FilePreviewPageContent>> {
    try {
      const record = this.#record(webContentsId, request.handleId, request.expectedGeneration)
      if (!Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > record.version.size) {
        return failed('read_failed', '分页位置无效。')
      }
      const maximum = Math.min(
        Math.max(1, request.maxBytes ?? filePreviewLimits.pageBytes),
        filePreviewLimits.pageBytes
      )
      const bytes = await this.#readAt(record, request.offset, Math.min(maximum, record.version.size - request.offset))
      let text: string | null = null
      let decodedLength = bytes.byteLength
      for (let trim = 0; trim <= Math.min(3, bytes.byteLength); trim += 1) {
        try {
          decodedLength = bytes.byteLength - trim
          text = strictDecode(bytes.subarray(0, decodedLength))
          break
        } catch {
          // A page may end halfway through a UTF-8 scalar; trim only that incomplete tail.
        }
      }
      if (text === null) return failed('decode_failed', '这个文件不是有效的 UTF-8 文本。')
      const startLine = await this.#lineAtOffset(record, request.offset)
      const endOffset = request.offset + decodedLength
      return ok({
        text,
        startOffset: request.offset,
        endOffset,
        startLine,
        hasPrevious: request.offset > 0,
        hasNext: endOffset < record.version.size,
        contentGeneration: record.generation,
        contentVersion: record.version
      })
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async resolveLine(
    webContentsId: number,
    request: { handleId: string; expectedGeneration: string; line: number }
  ): Promise<FilePreviewOperationResult<{ offset: number; line: number; contentGeneration: string }>> {
    try {
      const record = this.#record(webContentsId, request.handleId, request.expectedGeneration)
      if (!Number.isSafeInteger(request.line) || request.line < 1) return failed('read_failed', '行号无效。')
      let line = 1
      let offset = 0
      while (offset < record.version.size && line < request.line) {
        const bytes = await this.#readAt(record, offset, Math.min(64 * 1024, record.version.size - offset))
        for (let index = 0; index < bytes.byteLength && line < request.line; index += 1) {
          if (bytes[index] === 0x0a) line += 1
          offset += 1
        }
      }
      return ok({ offset, line, contentGeneration: record.generation })
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async readBinary(
    webContentsId: number,
    request: { handleId: string; expectedGeneration: string }
  ): Promise<ReturnType<FilePreviewApi['readBinary']>> {
    try {
      const record = this.#record(webContentsId, request.handleId, request.expectedGeneration)
      if (record.version.size > filePreviewLimits.binaryBytes) {
        return failed('file_too_large', '图片超过 32 MiB，无法预览。')
      }
      return ok({
        bytes: await this.#readAt(record, 0, record.version.size),
        mime: record.classification.mime,
        contentGeneration: record.generation,
        contentVersion: record.version
      })
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async prepareHtml(
    webContentsId: number,
    request: { handleId: string; expectedGeneration: string }
  ): Promise<FilePreviewOperationResult<FilePreviewHtmlDocument>> {
    const result = await this.readText(webContentsId, request)
    if (!result.ok) return result
    const record = this.#record(webContentsId, request.handleId, request.expectedGeneration)
    this.#revokeHtmlTokens(record.handleId)
    const token: HtmlPreviewToken = {
      token: randomUUID(),
      bridgeToken: randomUUID(),
      handleId: record.handleId,
      webContentsId: record.webContentsId,
      campId: record.campId,
      generation: record.generation,
      expiresAt: Date.now() + HTML_TOKEN_TTL_MS
    }
    this.#htmlTokens.set(token.token, token)
    return ok({
      html: result.value.text,
      tabToken: token.token,
      bridgeToken: token.bridgeToken,
      assetBasePath: relative(record.canonicalRoot, dirname(record.canonicalPath)).replace(/\\/gu, '/'),
      contentGeneration: result.value.contentGeneration,
      contentVersion: result.value.contentVersion
    })
  }

  authorizeHtmlAsset(webContentsId: number, method: string, url: string): boolean {
    if (method !== 'GET') return false
    const parsed = parseFilePreviewAssetUrl(url)
    if (!parsed) return false
    const token = this.#htmlTokens.get(parsed.tabToken)
    if (!token || token.webContentsId !== webContentsId || token.expiresAt <= Date.now()) return false
    const record = this.#handles.get(token.handleId)
    return Boolean(
      record
      && record.webContentsId === webContentsId
      && record.campId === token.campId
      && record.generation === token.generation
      && record.capabilities.includes('preview_asset')
      && this.#windowCamps.get(webContentsId) === token.campId
    )
  }

  async serveHtmlAsset(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const parsed = parseFilePreviewAssetUrl(request.url)
    if (!parsed) return new Response(null, { status: 404 })
    const token = this.#htmlTokens.get(parsed.tabToken)
    if (!token || token.expiresAt <= Date.now()) return new Response(null, { status: 403 })
    const record = this.#handles.get(token.handleId)
    if (
      !record
      || record.webContentsId !== token.webContentsId
      || record.campId !== token.campId
      || record.generation !== token.generation
      || !record.capabilities.includes('preview_asset')
      || this.#windowCamps.get(record.webContentsId) !== record.campId
    ) return new Response(null, { status: 403 })

    let opened: OpenedPreviewFile | null = null
    try {
      const relativePath = parsed.pathSegments.join('/')
      const mime = htmlAssetMime(relativePath)
      if (!mime) return new Response(null, { status: 415 })
      opened = await openPreviewFile(record.canonicalRoot, resolve(record.canonicalRoot, ...parsed.pathSegments))
      const limit = mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')
        ? filePreviewLimits.binaryBytes
        : HTML_ASSET_BYTES
      if (opened.version.size > limit) return new Response(null, { status: 413 })
      const bytes = Buffer.alloc(opened.version.size)
      const { bytesRead } = await opened.file.read(bytes, 0, bytes.byteLength, 0)
      token.expiresAt = Date.now() + HTML_TOKEN_TTL_MS
      record.lastUsedAt = Date.now()
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': mime,
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff'
      }
      if (mime.startsWith('text/css')) {
        const css = strictDecode(bytes.subarray(0, bytesRead))
        return new Response(rewriteAssetCss(css, token.token, dirname(relativePath).replace(/\\/gu, '/')), { headers })
      }
      return new Response(new Uint8Array(bytes.buffer, bytes.byteOffset, bytesRead), { headers })
    } catch {
      return new Response(null, { status: 404 })
    } finally {
      await opened?.file.close().catch(() => undefined)
    }
  }

  async reload(
    webContentsId: number,
    request: { handleId: string; reopenToken: string; expectedGeneration: string }
  ): Promise<FilePreviewOperationResult<ResolvedFilePreview>> {
    const record = this.#recordOrNull(webContentsId, request.handleId)
    if (!record || record.reopenToken !== request.reopenToken || record.generation !== request.expectedGeneration) {
      return failed('source_not_authorized', '这个文件访问已失效。', true)
    }
    try {
      const target = await this.#resolveReopenTarget(record)
      const parsed = this.#parsedReference(target)
      const candidatePath = target.candidatePath
        ?? referenceCandidatePath(parsed, target.rootPath, target.basePath)
      const beforeSequence = this.#watchers.sequence(record.canonicalRoot)
      const opened = await openPreviewFile(target.rootPath, candidatePath)
      const classification = await this.#classify(opened)
      if (classification.kind === 'system') {
        await opened.file.close().catch(() => undefined)
        return failed('open_failed', '这个文件类型需要使用系统默认应用打开。')
      }
      const supportedClassification = classification as SupportedClassification
      const oldFile = record.file
      const oldRoot = record.canonicalRoot
      const oldPath = record.canonicalPath
      Object.assign(record, {
        file: opened.file,
        reopenTarget: {
          ...target,
          target: parsed.target,
          openRisk: target.openRisk ?? 'normal',
          allowChildren: target.allowChildren ?? true
        },
        canonicalRoot: opened.canonicalRoot,
        canonicalPath: opened.canonicalPath,
        displayPath: target.displayName || opened.displayPath,
        fileName: target.displayName || opened.fileName,
        version: opened.version,
        classification: supportedClassification,
        generation: generation(),
        target: parsed.target,
        lastUsedAt: Date.now()
      })
      const targetChanged = oldRoot !== opened.canonicalRoot || oldPath !== opened.canonicalPath
      if (targetChanged) this.#subscribe(record)
      const afterSequence = this.#watchers.sequence(record.canonicalRoot)
      record.hasExternalUpdate = !targetChanged && beforeSequence !== afterSequence
      await oldFile?.close().catch(() => undefined)
      return ok(this.#publicFile(record))
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async release(webContentsId: number, request: { handleId: string }): Promise<{ released: true }> {
    const record = this.#handles.get(request.handleId)
    if (record?.webContentsId === webContentsId) await this.#dropHandle(record)
    return { released: true }
  }

  async openInSystem(
    webContentsId: number,
    request: { handleId: string }
  ): Promise<FilePreviewOperationResult<{ opened: true }>> {
    const record = this.#recordOrNull(webContentsId, request.handleId)
    if (!record) return failed('source_not_authorized', '这个文件访问已失效。')
    try {
      const current = await this.#revalidateRecordPath(record)
      return this.#openNative(current.canonicalPath, record.fileName, current.openRisk)
    } catch (error) {
      return this.#errorResult(error, 'open_failed')
    }
  }

  async revealInFolder(
    webContentsId: number,
    request: { handleId: string }
  ): Promise<FilePreviewOperationResult<{ revealed: true }>> {
    const record = this.#recordOrNull(webContentsId, request.handleId)
    if (!record) return failed('source_not_authorized', '这个文件访问已失效。')
    try {
      const current = await this.#revalidateRecordPath(record)
      this.#native.revealPath(current.canonicalPath)
      return ok({ revealed: true })
    } catch (error) {
      const result = this.#errorResult<{ revealed: true }>(error, 'reveal_failed')
      return result.ok ? failed('reveal_failed', '无法在文件夹中显示这个文件。', true) : result
    }
  }

  async copyPath(
    webContentsId: number,
    request: { handleId: string; format: 'display' | 'absolute' }
  ): Promise<FilePreviewOperationResult<{ copied: true }>> {
    const record = this.#recordOrNull(webContentsId, request.handleId)
    if (!record) return failed('source_not_authorized', '这个文件访问已失效。')
    try {
      const value = request.format === 'absolute'
        ? (await this.#revalidateRecordPath(record)).canonicalPath
        : record.displayPath
      this.#native.copyText(value)
      return ok({ copied: true })
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async chooseAuthorizedRoot(
    webContentsId: number,
    request: { campId: string; pendingOpenId: string }
  ): Promise<FilePreviewOperationResult<FilePreviewRootGrantResult | null>> {
    this.#prune()
    const pending = this.#pending.get(request.pendingOpenId)
    if (!pending || pending.webContentsId !== webContentsId || pending.campId !== request.campId) {
      return failed('source_not_authorized', '这次目录授权请求已失效。')
    }
    const selected = await this.#native.selectRoot(webContentsId)
    if (!selected) return ok(null)
    try {
      const canonicalRoot = await canonicalizeExistingPath(selected)
      const canonicalCandidate = await canonicalizeExistingPath(pending.candidatePath)
      if (!pathIsWithin(canonicalRoot, canonicalCandidate)) {
        return failed('outside_authorized_root', '所选目录不包含目标文件。')
      }
      const grant: RootGrant = {
        id: randomUUID(),
        webContentsId,
        campId: request.campId,
        canonicalRoot,
        displayName: basename(canonicalRoot) || '已授权目录'
      }
      this.#rootGrants.set(grant.id, grant)
      this.#pending.delete(pending.id)
      const result = await this.#openResolved(webContentsId, {
        kind: 'authorized_root',
        campId: request.campId,
        rootGrantId: grant.id,
        rawReference: pending.candidatePath
      }, {
        ...pending.target,
        sourceKind: 'authorized_root',
        sourceIdentity: `root-grant:${grant.id}`,
        rootPath: canonicalRoot,
        basePath: canonicalRoot,
        candidatePath: canonicalCandidate
      }, false)
      if (!result.ok) return result
      return ok({ rootGrantId: grant.id, displayName: grant.displayName, result: result.value })
    } catch (error) {
      return this.#errorResult(error)
    }
  }

  async releaseWindow(webContentsId: number): Promise<void> {
    const records = [...this.#handles.values()].filter((record) => record.webContentsId === webContentsId)
    await Promise.all(records.map((record) => this.#dropHandle(record)))
    this.#windowCamps.delete(webContentsId)
    for (const [id, pending] of this.#pending) if (pending.webContentsId === webContentsId) this.#pending.delete(id)
    for (const [id, grant] of this.#rootGrants) if (grant.webContentsId === webContentsId) this.#rootGrants.delete(id)
    this.#watchers.releaseWindow(webContentsId)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#handles.values()].map((record) => this.#dropHandle(record)))
    this.#windowCamps.clear()
    this.#pending.clear()
    this.#rootGrants.clear()
    this.#htmlTokens.clear()
    this.#watchers.closeAll()
  }

  get handleCount(): number {
    return this.#handles.size
  }

  async #resolveTarget(
    webContentsId: number,
    request: OpenFilePreviewRequest
  ): Promise<FilePreviewAuthorityResult | ResolvedTarget | null> {
    if (request.kind === 'child_of_handle') {
      const parent = this.#recordOrNull(webContentsId, request.parentHandleId)
      if (!parent || !parent.allowChildren) return null
      this.#requireActiveCamp(webContentsId, parent.campId)
      return {
        kind: 'file_target',
        campId: parent.campId,
        sourceKind: request.kind,
        sourceIdentity: `child:${parent.previewKey}:${request.rawReference}`,
        rootPath: parent.canonicalRoot,
        basePath: dirname(parent.canonicalPath),
        rawReference: request.rawReference,
        openRisk: 'normal',
        allowChildren: true
      }
    }
    if (request.kind === 'authorized_root') {
      this.#requireActiveCamp(webContentsId, request.campId)
      const grant = this.#rootGrants.get(request.rootGrantId)
      if (!grant || grant.webContentsId !== webContentsId || grant.campId !== request.campId) return null
      return {
        kind: 'file_target',
        campId: request.campId,
        sourceKind: request.kind,
        sourceIdentity: `root-grant:${grant.id}:${request.rawReference}`,
        rootPath: grant.canonicalRoot,
        basePath: grant.canonicalRoot,
        rawReference: request.rawReference,
        openRisk: 'normal',
        allowChildren: true
      }
    }
    this.#requireActiveCamp(webContentsId, request.campId)
    return this.#authority.resolve(request)
  }

  async #openResolved(
    webContentsId: number,
    request: OpenFilePreviewRequest,
    target: ResolvedTarget | Extract<FilePreviewAuthorityResult, { kind: 'file_target' }>,
    permitAuthorizationChallenge: boolean
  ): Promise<FilePreviewOperationResult<OpenFilePreviewResult>> {
    const parsed = this.#parsedReference(target)
    const candidatePath = target.candidatePath
      ?? referenceCandidatePath(parsed, target.rootPath, target.basePath)
    let opened: OpenedPreviewFile
    try {
      const path = await inspectPreviewPath(target.rootPath, candidatePath)
      if (path.kind === 'directory') {
        if (target.allowChildren === false || request.kind === 'run_evidence') {
          return failed('not_regular_file', '这个来源不支持打开文件夹。')
        }
        if (request.kind === 'child_of_handle' && request.allowSystemOpen === false) {
          return failed('reference_not_clickable', '这个链接不能在预览中打开。')
        }
        this.#requireActiveCamp(webContentsId, target.campId)
        // Reveal through the file manager, never launch a directory-shaped app bundle.
        try {
          this.#native.revealPath(path.canonicalPath)
          return ok({ kind: 'opened_in_system', fileName: basename(path.canonicalPath) })
        } catch {
          return failed('open_failed', '无法在文件管理器中显示这个文件夹。', true)
        }
      }
      opened = await openPreviewFile(target.rootPath, candidatePath)
    } catch (error) {
      if (
        permitAuthorizationChallenge
        && error instanceof FilePreviewAccessError
        && error.code === 'outside_authorized_root'
        && isAbsolute(candidatePath)
      ) {
        const challenge = this.#createAuthorizationChallenge(webContentsId, request, {
          ...target,
          target: parsed.target,
          openRisk: target.openRisk ?? 'normal',
          allowChildren: target.allowChildren ?? true
        }, candidatePath)
        return failed('authorization_required', '这个文件位于当前项目之外，需要选择其所属目录。', false, {
          displayReference: challenge.displayReference,
          authorizationChallenge: challenge
        })
      }
      throw error
    }
    let classification: FilePreviewClassification
    try {
      classification = await this.#classify(opened)
    } catch (error) {
      await opened.file.close().catch(() => undefined)
      if (!(error instanceof FilePreviewAccessError) || error.code !== 'read_failed') throw error
      opened = await openPreviewFile(target.rootPath, candidatePath)
      classification = await this.#classify(opened)
    }
    const fileName = target.displayName || opened.fileName
    const openRisk = target.openRisk === 'confirm' ? 'confirm' : classification.openRisk
    if (classification.kind === 'system') {
      await opened.file.close().catch(() => undefined)
      if (request.kind === 'child_of_handle' && request.allowSystemOpen === false) {
        return failed('reference_not_clickable', '这个链接不能在预览中打开。')
      }
      const nativeResult = await this.#openNative(opened.canonicalPath, fileName, openRisk)
      return nativeResult.ok
        ? ok({ kind: 'opened_in_system', fileName })
        : nativeResult
    }
    const supportedClassification = classification as SupportedClassification
    if (this.#windowHandleCount(webContentsId) >= MAX_HANDLES_PER_WINDOW) {
      await opened.file.close().catch(() => undefined)
      return failed('too_many_open_files', '打开的文件较多，请先关闭一些标签页。')
    }
    const handleId = randomUUID()
    const previewKey = createHash('sha256')
      .update(`${webContentsId}\0${target.campId}\0${opened.canonicalPath}`)
      .digest('hex')
    const allowChildren = target.allowChildren ?? target.sourceKind !== 'attachment'
    const capabilities: FilePreviewCapability[] = ['read', 'open_in_system']
    if (allowChildren) capabilities.push('read_child')
    if (allowChildren && (classification.kind === 'html' || classification.kind === 'markdown')) {
      capabilities.push('preview_asset')
    }
    const record: PreviewHandleRecord = {
      handleId,
      webContentsId,
      campId: target.campId,
      request,
      reopenTarget: {
        ...target,
        target: parsed.target,
        openRisk: target.openRisk ?? 'normal',
        allowChildren
      },
      sourceIdentity: target.sourceIdentity,
      file: opened.file,
      reopening: null,
      canonicalRoot: opened.canonicalRoot,
      canonicalPath: opened.canonicalPath,
      displayPath: target.displayName || opened.displayPath,
      fileName,
      version: opened.version,
      classification: supportedClassification,
      previewKey,
      reopenToken: randomUUID(),
      generation: generation(),
      target: parsed.target,
      capabilities,
      hasExternalUpdate: false,
      allowChildren,
      lastUsedAt: Date.now()
    }
    this.#handles.set(record.handleId, record)
    this.#subscribe(record)
    return ok({ kind: 'file_preview', file: this.#publicFile(record) })
  }

  #parsedReference(target: { rawReference?: string; candidatePath?: string; target?: FileLocationTarget }): ParsedFileReference {
    const parsed = target.rawReference ? parseFileReference(target.rawReference) : null
    if (parsed) return parsed
    if (target.candidatePath) {
      return {
        raw: target.candidatePath,
        pathPart: target.candidatePath,
        pathKind: 'unix_absolute',
        target: target.target
      }
    }
    throw new FilePreviewAccessError('file_not_found', '文件引用无效。')
  }

  async #classify(opened: OpenedPreviewFile): Promise<FilePreviewClassification> {
    try {
      const length = Math.min(filePreviewLimits.sampleBytes, opened.version.size)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await opened.file.read(buffer, 0, length, 0)
      const after = await fileHandleVersion(opened.file)
      if (!contentVersionMatches(opened.version, after)) {
        throw new FilePreviewAccessError('read_failed', '文件在打开时发生了变化。')
      }
      return classifyFilePreview(opened.canonicalPath, opened.version.size, buffer.subarray(0, bytesRead))
    } catch (error) {
      await opened.file.close().catch(() => undefined)
      throw error
    }
  }

  #publicFile(record: PreviewHandleRecord): ResolvedFilePreview {
    return {
      handleId: record.handleId,
      reopenToken: record.reopenToken,
      previewKey: record.previewKey,
      displayPath: record.displayPath,
      fileName: record.fileName,
      size: record.version.size,
      mime: record.classification.mime,
      extension: record.classification.extension,
      kind: record.classification.kind,
      hasExternalUpdate: record.hasExternalUpdate,
      contentVersion: record.version,
      contentGeneration: record.generation,
      capabilities: record.capabilities,
      target: record.target
    }
  }

  #subscribe(record: PreviewHandleRecord): void {
    this.#watchers.subscribe(record.canonicalRoot, {
      handleId: record.handleId,
      webContentsId: record.webContentsId,
      campId: record.campId,
      previewKey: record.previewKey,
      canonicalFilePath: record.canonicalPath
    })
  }

  #onExternalUpdate(notification: RootWatchNotification): void {
    const changed = new Set(notification.previewKeys)
    for (const record of this.#handles.values()) {
      if (
        record.webContentsId === notification.webContentsId
        && record.campId === notification.campId
        && changed.has(record.previewKey)
      ) record.hasExternalUpdate = true
    }
    this.#native.publishExternalUpdate(notification)
  }

  #record(webContentsId: number, handleId: string, expectedGeneration: string): PreviewHandleRecord {
    const record = this.#recordOrNull(webContentsId, handleId)
    if (!record || record.generation !== expectedGeneration) {
      throw new FilePreviewAccessError('read_failed', '这个文件访问已失效。')
    }
    return record
  }

  #recordOrNull(webContentsId: number, handleId: string): PreviewHandleRecord | null {
    this.#prune()
    const record = this.#handles.get(handleId)
    if (!record || record.webContentsId !== webContentsId) return null
    this.#requireActiveCamp(webContentsId, record.campId)
    record.lastUsedAt = Date.now()
    return record
  }

  #requireActiveCamp(webContentsId: number, campId: string): void {
    if (this.#windowCamps.get(webContentsId) !== campId) {
      throw new FilePreviewAccessError('read_failed', '文件不属于当前 Camp。')
    }
  }

  async #readAt(record: PreviewHandleRecord, position: number, length: number): Promise<Uint8Array> {
    const buffer = Buffer.alloc(length)
    const file = await this.#ensureFile(record)
    const before = await fileHandleVersion(file)
    if (!contentVersionMatches(record.version, before)) {
      await this.#retireChangedFile(record, file)
      throw new FilePreviewAccessError('read_failed', '文件已有更新，请重新加载。')
    }
    const { bytesRead } = await file.read(buffer, 0, length, position)
    const after = await fileHandleVersion(file)
    if (!contentVersionMatches(record.version, after)) {
      await this.#retireChangedFile(record, file)
      throw new FilePreviewAccessError('read_failed', '文件已有更新，请重新加载。')
    }
    record.lastUsedAt = Date.now()
    return new Uint8Array(buffer.subarray(0, bytesRead))
  }

  async #retireChangedFile(record: PreviewHandleRecord, file: FileHandle): Promise<void> {
    record.hasExternalUpdate = true
    if (record.file === file) record.file = null
    await file.close().catch(() => undefined)
  }

  async #ensureFile(record: PreviewHandleRecord): Promise<FileHandle> {
    if (record.file) return record.file
    if (record.reopening) return record.reopening

    const reopening = this.#reopenFile(record)
    record.reopening = reopening
    try {
      return await reopening
    } finally {
      if (record.reopening === reopening) record.reopening = null
    }
  }

  async #reopenFile(record: PreviewHandleRecord): Promise<FileHandle> {
    this.#requireActiveCamp(record.webContentsId, record.campId)
    const target = await this.#resolveReopenTarget(record)
    const parsed = this.#parsedReference(target)
    const candidatePath = target.candidatePath
      ?? referenceCandidatePath(parsed, target.rootPath, target.basePath)
    const opened = await openPreviewFile(target.rootPath, candidatePath)
    if (
      opened.canonicalRoot !== record.canonicalRoot
      || opened.canonicalPath !== record.canonicalPath
    ) {
      await opened.file.close().catch(() => undefined)
      throw new FilePreviewAccessError('read_failed', '文件来源已发生变化，请重新打开。')
    }
    if (!contentVersionMatches(record.version, opened.version)) {
      record.hasExternalUpdate = true
      await opened.file.close().catch(() => undefined)
      throw new FilePreviewAccessError('read_failed', '文件已有更新，请重新加载。')
    }
    if (this.#handles.get(record.handleId) !== record) {
      await opened.file.close().catch(() => undefined)
      throw new FilePreviewAccessError('read_failed', '这个文件访问已失效。')
    }
    record.file = opened.file
    record.reopenTarget = target
    record.lastUsedAt = Date.now()
    return opened.file
  }

  async #revalidateRecordPath(record: PreviewHandleRecord): Promise<{
    canonicalPath: string
    openRisk: 'normal' | 'confirm'
  }> {
    const target = await this.#resolveReopenTarget(record)
    const parsed = this.#parsedReference(target)
    const candidatePath = target.candidatePath
      ?? referenceCandidatePath(parsed, target.rootPath, target.basePath)
    const opened = await openPreviewFile(target.rootPath, candidatePath)
    try {
      if (
        opened.canonicalRoot !== record.canonicalRoot
        || opened.canonicalPath !== record.canonicalPath
      ) throw new FilePreviewAccessError('read_failed', '文件来源已发生变化，请重新打开。')
      const classification = await this.#classify(opened)
      if (!contentVersionMatches(record.version, opened.version)) record.hasExternalUpdate = true
      return {
        canonicalPath: opened.canonicalPath,
        openRisk: target.openRisk === 'confirm' ? 'confirm' : classification.openRisk
      }
    } finally {
      await opened.file.close().catch(() => undefined)
    }
  }

  async #resolveReopenTarget(record: PreviewHandleRecord): Promise<ResolvedTarget> {
    if (record.request.kind === 'child_of_handle') return record.reopenTarget
    const target = await this.#resolveTarget(record.webContentsId, record.request)
    if (
      !target
      || target.kind !== 'file_target'
      || target.campId !== record.campId
      || target.sourceIdentity !== record.sourceIdentity
    ) throw new FilePreviewAccessError('read_failed', '无法重新确认文件来源。')
    return {
      ...target,
      target: record.target,
      openRisk: target.openRisk ?? record.reopenTarget.openRisk,
      allowChildren: target.allowChildren ?? record.allowChildren
    }
  }

  async #lineAtOffset(record: PreviewHandleRecord, targetOffset: number): Promise<number> {
    let line = 1
    let offset = 0
    while (offset < targetOffset) {
      const bytes = await this.#readAt(record, offset, Math.min(64 * 1024, targetOffset - offset))
      for (const byte of bytes) if (byte === 0x0a) line += 1
      if (bytes.byteLength === 0) break
      offset += bytes.byteLength
    }
    return line
  }

  async #openNative(
    path: string,
    displayName: string,
    openRisk: 'normal' | 'confirm'
  ): Promise<FilePreviewOperationResult<{ opened: true }>> {
    try {
      if (openRisk === 'confirm' && !(await this.#native.confirmOpen(displayName))) {
        return failed('open_failed', '已取消打开。')
      }
      const error = await this.#native.openPath(path)
      return error ? failed('open_failed', '系统默认应用无法打开这个文件。', true) : ok({ opened: true })
    } catch {
      return failed('open_failed', '系统默认应用无法打开这个文件。', true)
    }
  }

  #createAuthorizationChallenge(
    webContentsId: number,
    request: OpenFilePreviewRequest,
    target: ResolvedTarget,
    candidatePath: string
  ): FilePreviewAuthorizationChallenge & { displayReference: string } {
    const id = randomUUID()
    const displayReference = safeDisplayReference(target.rawReference || candidatePath)
    const pending: PendingOpen = {
      id,
      webContentsId,
      campId: target.campId,
      request,
      target,
      candidatePath,
      displayReference,
      expiresAt: Date.now() + PENDING_OPEN_TTL_MS
    }
    this.#pending.set(id, pending)
    return {
      pendingOpenId: id,
      campId: target.campId,
      displayReference,
      expiresAt: pending.expiresAt
    }
  }

  async #releaseCamp(webContentsId: number, campId: string): Promise<void> {
    const records = [...this.#handles.values()].filter((record) =>
      record.webContentsId === webContentsId && record.campId === campId
    )
    await Promise.all(records.map((record) => this.#dropHandle(record)))
    for (const [id, pending] of this.#pending) {
      if (pending.webContentsId === webContentsId && pending.campId === campId) this.#pending.delete(id)
    }
    for (const [id, grant] of this.#rootGrants) {
      if (grant.webContentsId === webContentsId && grant.campId === campId) this.#rootGrants.delete(id)
    }
    this.#watchers.releaseCamp(webContentsId, campId)
  }

  async #dropHandle(record: PreviewHandleRecord): Promise<void> {
    if (!this.#handles.delete(record.handleId)) return
    this.#revokeHtmlTokens(record.handleId)
    this.#watchers.unsubscribe(record.handleId)
    const file = record.file
    record.file = null
    await file?.close().catch(() => undefined)
  }

  #revokeHtmlTokens(handleId: string): void {
    for (const [token, value] of this.#htmlTokens) {
      if (value.handleId === handleId) this.#htmlTokens.delete(token)
    }
  }

  #windowHandleCount(webContentsId: number): number {
    let count = 0
    for (const record of this.#handles.values()) if (record.webContentsId === webContentsId) count += 1
    return count
  }

  #prune(now = Date.now()): void {
    for (const record of this.#handles.values()) {
      if (record.file && now - record.lastUsedAt > HANDLE_TTL_MS) {
        const file = record.file
        record.file = null
        this.#revokeHtmlTokens(record.handleId)
        void file.close().catch(() => undefined)
      }
    }
    for (const [id, pending] of this.#pending) if (pending.expiresAt <= now) this.#pending.delete(id)
    for (const [token, value] of this.#htmlTokens) if (value.expiresAt <= now) this.#htmlTokens.delete(token)
  }

  #errorResult<T>(
    error: unknown,
    defaultCode: FilePreviewErrorCode = 'read_failed'
  ): FilePreviewOperationResult<T> {
    if (error instanceof FilePreviewAccessError) {
      return failed(error.code, error.message, error.code === 'read_failed')
    }
    if (error instanceof TypeError) return failed('decode_failed', '这个文件不是有效的 UTF-8 文本。')
    return failed(defaultCode, '无法打开文件。', true)
  }
}
