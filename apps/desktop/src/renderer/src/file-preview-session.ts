import { filePreviewRetentionLimits } from '../../file-preview-retention'
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

export interface FilePreviewReadingState {
  scrollTop?: number
  scrollLeft?: number
  codeScrollTop?: number
  codeScrollLeft?: number
  pageOffsets?: number[]
  pageIndex?: number
  imageScale?: number | null
  imageScrollTop?: number
  imageScrollLeft?: number
  htmlSourceMode?: boolean
  htmlScrollTop?: number
  htmlScrollLeft?: number
}

export interface FilePreviewFileTabSnapshot {
  reading?: FilePreviewReadingState
  kind: 'file'
  id: string
  sourceRequest: RestorableFilePreviewRequest | null
  presentation: FilePreviewPresentation
}

export interface FilePreviewChangesTabSnapshot {
  reading?: FilePreviewReadingState
  kind: 'file_change'
  id: string
  threadId: string
  changes: AgentRunFileChangesView
  selectedEvidenceFileId: string | null
}

export interface MissionActivityTabSnapshot {
  kind: 'mission_activity'
  id: string
  missionId: string
  reading?: FilePreviewReadingState
}

export interface ExecutionTabSnapshot {
  kind: 'execution'
  id: string
  reading?: FilePreviewReadingState
}

export type FilePreviewTabSnapshot = FilePreviewFileTabSnapshot | FilePreviewChangesTabSnapshot | MissionActivityTabSnapshot | ExecutionTabSnapshot

export interface FilePreviewSessionSnapshot {
  tabs: FilePreviewTabSnapshot[]
  activeTabId: string | null
  paneVisible: boolean
}

const DEFAULT_SESSION_LIMIT = filePreviewRetentionLimits.snapshots

function copySnapshot(snapshot: FilePreviewSessionSnapshot): FilePreviewSessionSnapshot {
  return {
    tabs: snapshot.tabs.map((tab) => tab.kind === 'mission_activity' || tab.kind === 'execution'
      ? { ...tab, reading: tab.reading ? { ...tab.reading } : undefined }
      : tab.kind === 'file_change'
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
          presentation: { ...tab.presentation },
          reading: tab.reading ? structuredClone(tab.reading) : undefined
        }),
    activeTabId: snapshot.activeTabId,
    paneVisible: snapshot.paneVisible
  }
}

export class FilePreviewSessionStore {
  readonly #limit: number
  readonly #sessions = new Map<string, FilePreviewSessionSnapshot>()
  readonly #usage = new Map<string, number>()
  readonly #protected = new Set<string>()
  readonly #discardListeners = new Set<(threadId: string) => void>()
  #sequence = 0
  readonly #skipNextSave = new Set<string>()

  constructor(limit: number = DEFAULT_SESSION_LIMIT) {
    this.#limit = Math.max(1, Math.trunc(limit))
  }

  get(threadId: string): FilePreviewSessionSnapshot | null {
    const snapshot = this.#sessions.get(threadId)
    if (!snapshot) return null
    return copySnapshot(snapshot)
  }

  set(threadId: string, snapshot: FilePreviewSessionSnapshot): void {
    if (this.#skipNextSave.delete(threadId)) return
    this.#sessions.set(threadId, copySnapshot(snapshot))
    while (this.#sessions.size > this.#limit) {
      const oldestThreadId = [...this.#sessions.keys()].filter(id => !this.#protected.has(id))
        .sort((a, b) => (this.#usage.get(a) ?? 0) - (this.#usage.get(b) ?? 0))[0]
      if (!oldestThreadId) break
      this.#sessions.delete(oldestThreadId)
    }
  }

  touch(threadId: string): void { this.#usage.set(threadId, ++this.#sequence) }

  protect(threadIds: Iterable<string>): void {
    this.#protected.clear()
    for (const id of threadIds) this.#protected.add(id)
  }

  onDiscard(listener: (threadId: string) => void): () => void {
    this.#discardListeners.add(listener)
    return () => this.#discardListeners.delete(listener)
  }

  discard(threadId: string, preventNextSave = false): void {
    for (const listener of this.#discardListeners) listener(threadId)
    this.#usage.delete(threadId)
    this.#sessions.delete(threadId)
    if (!preventNextSave) {
      this.#skipNextSave.delete(threadId)
      return
    }
    this.#skipNextSave.delete(threadId)
    this.#skipNextSave.add(threadId)
    while (this.#skipNextSave.size > this.#limit) {
      const oldestThreadId = this.#skipNextSave.values().next().value as string | undefined
      if (!oldestThreadId) break
      this.#skipNextSave.delete(oldestThreadId)
    }
  }

  clear(): void {
    for (const id of this.#sessions.keys()) for (const listener of this.#discardListeners) listener(id)
    this.#sessions.clear()
    this.#usage.clear()
    this.#protected.clear()
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
    case 'skill_reference':
      return `skill:${request.threadId}:${request.skillId}`
    case 'message_reference': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `message:${request.threadId}:${request.messageId}:${path}`
    }
    case 'camp_workspace': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `workspace:${request.threadId}:${path}`
    }
    case 'attachment': {
      const locator = request.locator
      switch (locator.owner) {
        case 'composer':
          return `attachment:composer:${locator.threadId}:${locator.attachmentRefId}`
        case 'message':
          return `attachment:message:${locator.threadId}:${locator.messageId}:${locator.attachmentRefId}`
        case 'mission':
          return `attachment:mission:${locator.threadId}:${locator.missionId}:${locator.attachmentRefId}`
        case 'pending':
          return `attachment:pending:${locator.threadId}:${locator.pendingInputId}:${locator.attachmentRefId}`
        case 'pending_edit':
          return `attachment:pending-edit:${locator.threadId}:${locator.pendingInputId}:${locator.editToken}:${locator.attachmentRefId}`
        case 'single_chat_composer':
          return `attachment:single-chat-composer:${locator.threadId}:${locator.conversationId}:${locator.attachmentRefId}`
        case 'single_chat_pending':
          return `attachment:single-chat-pending:${locator.threadId}:${locator.conversationId}:${locator.pendingInputId}:${locator.attachmentRefId}`
        case 'single_chat_pending_edit':
          return `attachment:single-chat-pending-edit:${locator.threadId}:${locator.conversationId}:${locator.pendingInputId}:${locator.editToken}:${locator.attachmentRefId}`
        case 'single_chat_message':
          return `attachment:single-chat-message:${locator.threadId}:${locator.conversationId}:${locator.conversationMessageId}:${locator.attachmentRefId}`
      }
    }
    case 'run_evidence':
      return `evidence:${request.threadId}:${request.agentRunId}:${request.executionEpoch}:${request.evidenceFileId}:${request.action}`
    case 'run_activity_file': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `run-activity:${request.threadId}:${request.agentRunId}:${request.executionEpoch}:${request.evidenceId}:${path}`
    }
    case 'child_of_handle': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `child:${request.parentHandleId}:${path}`
    }
    case 'authorized_root': {
      const path = parseFileReference(request.rawReference)?.pathPart ?? request.rawReference
      return `root:${request.threadId}:${request.rootGrantId}:${path}`
    }
  }
}

export function stableFilePreviewSourceKey(
  request: OpenFilePreviewRequest,
  presentation: Pick<FilePreviewPresentation, 'displayPath' | 'pathPresentation'>
): string {
  if ('threadId' in request && presentation.pathPresentation === 'project_relative') {
    return `workspace:${request.threadId}:${presentation.displayPath}`
  }
  return filePreviewSourceKey(request)
}

export function restorableFilePreviewRequest(
  request: OpenFilePreviewRequest
): RestorableFilePreviewRequest | null {
  return request.kind === 'child_of_handle' || request.kind === 'authorized_root'
    ? null
    : request
}

export function resolvedFilePreviewSource(
  request: OpenFilePreviewRequest,
  file: Pick<ResolvedFilePreview, 'displayPath' | 'pathPresentation' | 'restoreRequest'>,
  fallbackRequest?: OpenFilePreviewRequest | null
): { sourceRequest: OpenFilePreviewRequest; sourceKey: string } {
  const sourceRequest = file.restoreRequest
    ?? restorableFilePreviewRequest(request)
    ?? (fallbackRequest ? restorableFilePreviewRequest(fallbackRequest) : null)
    ?? request
  return {
    sourceRequest,
    sourceKey: stableFilePreviewSourceKey(sourceRequest, file)
  }
}

export function filePreviewTabMatchesResolvedFile(
  tab: { previewKey: string | null; sourceKey: string },
  file: Pick<ResolvedFilePreview, 'previewKey'>,
  resolvedSourceKey: string
): boolean {
  return tab.previewKey !== null
    ? tab.previewKey === file.previewKey
    : tab.sourceKey === resolvedSourceKey
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
    && (
      request.kind === 'message_reference'
      || request.kind === 'camp_workspace'
      || request.kind === 'run_activity_file'
    )
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

export function forgetFilePreviewSession(threadId: string, preventNextSave = false): void {
  filePreviewSessionStore.discard(threadId, preventNextSave)
}
