import { dirname, isAbsolute } from 'node:path'
import type { CoreMethod, OpenFilePreviewRequest } from '@contracts'
import {
  parseDesktopAttachmentTarget,
  type DesktopAttachmentTarget
} from '../attachment-desktop'
import type {
  FilePreviewAuthorityResult,
  FilePreviewSourceAuthority
} from './file-preview-service'

interface CoreRequester {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, maximum = 4_096): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !value.includes('\0')
}

export function parseCoreFilePreviewAuthorityResult(
  value: unknown,
  request: Exclude<OpenFilePreviewRequest, { kind: 'child_of_handle' | 'authorized_root' | 'attachment' }>
): FilePreviewAuthorityResult | null {
  if (!isObject(value) || value.campId !== request.campId) return null
  if (value.kind === 'evidence_review' && request.kind === 'run_evidence') {
    if (
      value.agentRunId !== request.agentRunId
      || value.executionEpoch !== request.executionEpoch
      || value.evidenceFileId !== request.evidenceFileId
    ) return null
    return {
      kind: 'evidence_review',
      campId: request.campId,
      agentRunId: request.agentRunId,
      executionEpoch: request.executionEpoch,
      evidenceFileId: request.evidenceFileId
    }
  }
  if (value.kind === 'evidence_identity_unavailable' && request.kind === 'run_evidence') {
    if (
      value.agentRunId !== request.agentRunId
      || value.executionEpoch !== request.executionEpoch
      || value.evidenceFileId !== request.evidenceFileId
    ) return null
    return {
      kind: 'evidence_identity_unavailable',
      campId: request.campId,
      agentRunId: request.agentRunId,
      executionEpoch: request.executionEpoch,
      evidenceFileId: request.evidenceFileId
    }
  }
  if (
    value.kind !== 'file_target'
    || value.sourceKind !== request.kind
    || !boundedString(value.sourceIdentity, 512)
    || !boundedString(value.rootPath)
    || !boundedString(value.basePath)
    || !isAbsolute(value.rootPath)
    || !isAbsolute(value.basePath)
    || value.allowChildren !== true
  ) return null
  if (request.kind === 'run_evidence') {
    if (value.sourceKind !== 'run_evidence' || !boundedString(value.rawReference)) return null
  } else if (value.rawReference !== request.rawReference) return null
  return {
    kind: 'file_target',
    campId: request.campId,
    sourceKind: request.kind,
    sourceIdentity: value.sourceIdentity,
    rootPath: value.rootPath,
    basePath: value.basePath,
    rawReference: value.rawReference,
    allowChildren: true
  }
}

function attachmentAuthorityTarget(
  request: Extract<OpenFilePreviewRequest, { kind: 'attachment' }>,
  target: DesktopAttachmentTarget
): FilePreviewAuthorityResult {
  const ownerIdentity = request.locator.owner === 'message'
    ? `${request.locator.owner}:${request.locator.messageId}`
    : request.locator.owner === 'pending' || request.locator.owner === 'pending_edit'
      ? `${request.locator.owner}:${request.locator.pendingInputId}`
      : request.locator.owner
  return {
    kind: 'file_target',
    campId: request.campId,
    sourceKind: request.kind,
    sourceIdentity: `attachment:${ownerIdentity}:${target.attachmentId}`,
    rootPath: dirname(target.path),
    basePath: dirname(target.path),
    candidatePath: target.path,
    displayName: target.displayName,
    openRisk: target.openRisk,
    allowChildren: false
  }
}

export class CoreFilePreviewSourceAuthority implements FilePreviewSourceAuthority {
  constructor(private readonly core: CoreRequester) {}

  async resolve(
    request: Exclude<OpenFilePreviewRequest, { kind: 'child_of_handle' | 'authorized_root' }>
  ): Promise<FilePreviewAuthorityResult | null> {
    if (request.kind === 'attachment') {
      const value = await this.core.request<unknown>(
        'camp.attachments.desktopOpenTarget' as CoreMethod,
        request.locator
      )
      const target = parseDesktopAttachmentTarget(value, request.locator.attachmentRefId)
      return target ? attachmentAuthorityTarget(request, target) : null
    }
    const value = await this.core.request<unknown>(
      'filePreview.resolveSource' as CoreMethod,
      request
    )
    return parseCoreFilePreviewAuthorityResult(value, request)
  }
}
