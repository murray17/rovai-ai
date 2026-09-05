import type {
  AgentRunFileChangesView,
  FilePreviewPathPresentation,
  OpenFilePreviewRequest,
  RestoreFilePreviewRequest,
  ResolvedFilePreview
} from '@contracts'
import { parseFileReference } from '../../file-preview-reference'

export type RestorableFilePreviewRequest = RestoreFilePreviewRequest

export interface FilePreviewPresentation {
  fileName: string
  displayPath: string
  pathPresentation: FilePreviewPathPresentation
}

export interface FilePreviewPresentationHint {
  fileName: string
}

export interface FilePreviewFileTabSnapshot {
  kind: 'file'
  id: string
  sourceRequest: RestorableFilePreviewRequest | null
  presentation: FilePreviewPresentation
}

export interface FilePreviewChangesTabSnapshot {
  kind: 'file_change'
  id: string
  campId: string
  changes: AgentRunFileChangesView
  selectedEvidenceFileId: string | null
}

export type FilePreviewTabSnapshot = FilePreviewFileTabSnapshot | FilePreviewChangesTabSnapshot

export interface FilePreviewSessionSnapshot {
  tabs: FilePreviewTabSnapshot[]
  activeTabId: string | null
  paneVisible: boolean
}

const DEFAULT_SESSION_LIMIT = 24

function copySnapshot(snapshot: FilePreviewSessionSnapshot): FilePreviewSessionSnapshot {
  return {
    tabs: snapshot.tabs.map((tab) => tab.kind === 'file_change'
      ? {
          ...tab,
          changes: {
            ...tab.changes,
            files: tab.changes.files.map((file) => ({ ...file }))
          }
        }
      : {
          ...tab,
          sourceRequest: tab.sourceRequest
            ? structuredClone(tab.sourceRequest)
            : null,
          presentation: { ...tab.presentation }
        }),
    activeTabId: snapshot.activeTabId,
    paneVisible: snapshot.paneVisible
  }
}

export class FilePreviewSessionStore {
  readonly #limit: number
  readonly #sessions = new Map<string, FilePreviewSessionSnapshot>()
  readonly #skipNextSave = new Set<string>()

  constructor(limit = DEFAULT_SESSION_LIMIT) {
    this.#limit = Math.max(1, Math.trunc(limit))
  }

  get(campId: string): FilePreviewSessionSnapshot | null {
    const snapshot = this.#sessions.get(campId)
    if (!snapshot) return null
    this.#sessions.delete(campId)
    this.#sessions.set(campId, snapshot)
    return copySnapshot(snapshot)
  }

  set(campId: string, snapshot: FilePreviewSessionSnapshot): void {
    if (this.#skipNextSave.delete(campId)) return
    this.#sessions.delete(campId)
    this.#sessions.set(campId, copySnapshot(snapshot))
    while (this.#sessions.size > this.#limit) {
      const oldestCampId = this.#sessions.keys().next().value as string | undefined
      if (!oldestCampId) break
      this.#sessions.delete(oldestCampId)
    }
  }

  discard(campId: string, preventNextSave = false): void {
    this.#sessions.delete(campId)
    if (!preventNextSave) {
      this.#skipNextSave.delete(campId)
      return
    }
    this.#skipNextSave.delete(campId)
    this.#skipNextSave.add(campId)
    while (this.#skipNextSave.size > this.#limit) {
      const oldestCampId = this.#skipNextSave.values().next().value as string | undefined
      if (!oldestCampId) break
      this.#skipNextSave.delete(oldestCampId)
    }
  }

  clear(): void {
    this.#sessions.clear()
    this.#skipNextSave.clear()
  }
}

function cleanDisplayValue(value: string): string {
  return Array.from(value.replace(/[\r\n\0]/gu, ' ').trim()).slice(0, 180).join('')
}

function referenceFileName(value: string): string {
  const withoutTrailingSeparators = value.replace(/[\\/]+$/gu, '')
  const lastPart = withoutTrailingSeparators.split(/[\\/]/u).at(-1) ?? ''
  try {
    return cleanDisplayValue(decodeURIComponent(lastPart)) || '文件'
  } catch {
    return cleanDisplayValue(lastPart) || '文件'
  }
}

export function filePreviewSourceKey(request: OpenFilePreviewRequest): string {
  switch (request.kind) {
    case 'message_reference': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `message:${request.campId}:${request.messageId}:${path}`
    }
    case 'camp_workspace': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `workspace:${request.campId}:${path}`
    }
    case 'attachment': {
      const locator = request.locator
      switch (locator.owner) {
        case 'composer':
          return `attachment:composer:${locator.campId}:${locator.attachmentRefId}`
        case 'message':
          return `attachment:message:${locator.campId}:${locator.messageId}:${locator.attachmentRefId}`
        case 'pending':
          return `attachment:pending:${locator.campId}:${locator.pendingInputId}:${locator.attachmentRefId}`
        case 'pending_edit':
          return `attachment:pending-edit:${locator.campId}:${locator.pendingInputId}:${locator.editToken}:${locator.attachmentRefId}`
        case 'single_chat_composer':
          return `attachment:single-chat-composer:${locator.campId}:${locator.conversationId}:${locator.attachmentRefId}`
        case 'single_chat_pending':
          return `attachment:single-chat-pending:${locator.campId}:${locator.conversationId}:${locator.pendingInputId}:${locator.attachmentRefId}`
        case 'single_chat_pending_edit':
          return `attachment:single-chat-pending-edit:${locator.campId}:${locator.conversationId}:${locator.pendingInputId}:${locator.editToken}:${locator.attachmentRefId}`
        case 'single_chat_message':
          return `attachment:single-chat-message:${locator.campId}:${locator.conversationId}:${locator.conversationMessageId}:${locator.attachmentRefId}`
      }
    }
    case 'run_evidence':
      return `evidence:${request.campId}:${request.agentRunId}:${request.executionEpoch}:${request.evidenceFileId}:${request.action}`
    case 'child_of_handle': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `child:${request.parentHandleId}:${path}`
    }
    case 'authorized_root': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `root:${request.campId}:${request.rootGrantId}:${path}`
    }
  }
}

export function restorableFilePreviewRequest(
  request: OpenFilePreviewRequest
): RestorableFilePreviewRequest | null {
  return request.kind === 'child_of_handle' || request.kind === 'authorized_root'
    ? null
    : request
}

export function filePreviewPresentationFromRequest(
  request: OpenFilePreviewRequest,
  hint?: FilePreviewPresentationHint
): FilePreviewPresentation {
  if (hint) {
    const fileName = referenceFileName(hint.fileName)
    return {
      fileName,
      displayPath: fileName,
      pathPresentation: 'file_name_only'
    }
  }
  const rawReference = 'rawReference' in request ? request.rawReference : ''
  const parsed = rawReference ? parseFileReference(rawReference) : null
  const fileName = referenceFileName(parsed?.pathPart ?? rawReference)
  const mayShowRelativePath = parsed?.pathKind === 'relative'
    && (request.kind === 'message_reference' || request.kind === 'camp_workspace')
  const displayPath = mayShowRelativePath
    ? cleanDisplayValue(parsed.pathPart) || fileName
    : fileName
  return {
    fileName,
    displayPath,
    pathPresentation: mayShowRelativePath ? 'project_relative' : 'file_name_only'
  }
}

export function filePreviewPresentationFromFile(file: ResolvedFilePreview): FilePreviewPresentation {
  return {
    fileName: file.fileName,
    displayPath: file.displayPath,
    pathPresentation: file.pathPresentation
  }
}

export const filePreviewSessionStore = new FilePreviewSessionStore()

export function forgetFilePreviewSession(campId: string, preventNextSave = false): void {
  filePreviewSessionStore.discard(campId, preventNextSave)
}
