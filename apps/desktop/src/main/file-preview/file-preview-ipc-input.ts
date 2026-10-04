import { filePreviewRetentionLimits } from '../../file-preview-retention'
import {
  isThreadId,
  type FilePreviewRetentionState,
  type LocalAttachmentOwnerLocator,
  type OpenFilePreviewRequest,
  type RestoreFilePreviewRequest
} from '@contracts'
import { isAttachmentId } from '../attachment-desktop'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unsupported file preview request')
  }
  return value as Record<string, unknown>
}

function string(value: unknown, maximum = 4_096): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > maximum
    || value.includes('\0')
  ) throw new Error('Unsupported file preview request')
  return value
}

function threadId(value: unknown): string {
  if (!isThreadId(value)) throw new Error('Unsupported file preview Thread')
  return value
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('Unsupported file preview number')
  }
  return value as number
}

function attachmentLocator(value: unknown, expectedThreadId: string): LocalAttachmentOwnerLocator {
  const input = record(value)
  const ownerThreadId = threadId(input.threadId)
  const attachmentRefId = string(input.attachmentRefId, 128)
  if (ownerThreadId !== expectedThreadId || !isAttachmentId(attachmentRefId)) {
    throw new Error('Unsupported Attachment')
  }
  if (input.owner === 'composer') {
    return { owner: input.owner, threadId: ownerThreadId, attachmentRefId }
  }
  if (input.owner === 'pending') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      pendingInputId: string(input.pendingInputId, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'pending_edit') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      pendingInputId: string(input.pendingInputId, 128),
      editToken: string(input.editToken, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'message') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      messageId: string(input.messageId, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'mission') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      missionId: string(input.missionId, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'single_chat_composer') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      conversationId: string(input.conversationId, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'single_chat_pending') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      conversationId: string(input.conversationId, 128),
      pendingInputId: string(input.pendingInputId, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'single_chat_pending_edit') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      conversationId: string(input.conversationId, 128),
      pendingInputId: string(input.pendingInputId, 128),
      editToken: string(input.editToken, 128),
      attachmentRefId
    }
  }
  if (input.owner === 'single_chat_message') {
    return {
      owner: input.owner,
      threadId: ownerThreadId,
      conversationId: string(input.conversationId, 128),
      conversationMessageId: string(input.conversationMessageId, 128),
      attachmentRefId
    }
  }
  throw new Error('Unsupported Attachment')
}

export function parseFilePreviewThread(value: unknown): string | null {
  return value === null ? null : threadId(value)
}

export function parseOpenFilePreviewRequest(value: unknown): OpenFilePreviewRequest {
  const input = record(value)
  switch (input.kind) {
    case 'skill_reference':
      if (input.rawReference !== 'SKILL.md') throw new Error('Unsupported Skill entry')
      return {
        kind: input.kind,
        threadId: threadId(input.threadId),
        skillId: string(input.skillId, 128),
        rawReference: 'SKILL.md'
      }
    case 'message_reference':
      return {
        kind: input.kind,
        threadId: threadId(input.threadId),
        messageId: string(input.messageId, 128),
        rawReference: string(input.rawReference)
      }
    case 'camp_workspace':
      return {
        kind: input.kind,
        threadId: threadId(input.threadId),
        rawReference: string(input.rawReference)
      }
    case 'attachment': {
      const attachmentThreadId = threadId(input.threadId)
      return {
        kind: input.kind,
        threadId: attachmentThreadId,
        locator: attachmentLocator(input.locator, attachmentThreadId)
      }
    }
    case 'run_evidence':
      if (input.action !== 'review' && input.action !== 'open_current') {
        throw new Error('Unsupported evidence action')
      }
      return {
        kind: input.kind,
        threadId: threadId(input.threadId),
        agentRunId: string(input.agentRunId, 128),
        executionEpoch: positiveInteger(input.executionEpoch),
        evidenceFileId: string(input.evidenceFileId, 256),
        action: input.action
      }
    case 'run_activity_file':
      return {
        kind: input.kind,
        threadId: threadId(input.threadId),
        agentRunId: string(input.agentRunId, 128),
        executionEpoch: positiveInteger(input.executionEpoch),
        evidenceId: string(input.evidenceId, 256),
        rawReference: string(input.rawReference)
      }
    case 'child_of_handle':
      if (input.allowSystemOpen !== undefined && typeof input.allowSystemOpen !== 'boolean') {
        throw new Error('Unsupported file preview activation')
      }
      return {
        kind: input.kind,
        parentHandleId: string(input.parentHandleId, 128),
        rawReference: string(input.rawReference),
        allowSystemOpen: input.allowSystemOpen as boolean | undefined
      }
    case 'authorized_root':
      return {
        kind: input.kind,
        threadId: threadId(input.threadId),
        rootGrantId: string(input.rootGrantId, 128),
        rawReference: string(input.rawReference)
      }
    default:
      throw new Error('Unsupported file preview source')
  }
}

export function parseRestoreFilePreviewRequest(value: unknown): RestoreFilePreviewRequest {
  const request = parseOpenFilePreviewRequest(value)
  if (request.kind === 'child_of_handle' || request.kind === 'authorized_root') {
    throw new Error('Unsupported file preview restore source')
  }
  return request
}

export function parseHandleRequest(value: unknown): { handleId: string } {
  return { handleId: string(record(value).handleId, 128) }
}

export function parseHtmlSiteRequest(value: unknown): { previewId: string } {
  return { previewId: string(record(value).previewId, 128) }
}

export function parseGenerationRequest(value: unknown): {
  handleId: string
  expectedGeneration: string
} {
  const input = record(value)
  return {
    handleId: string(input.handleId, 128),
    expectedGeneration: string(input.expectedGeneration, 128)
  }
}

export function parsePageRequest(value: unknown): {
  handleId: string
  expectedGeneration: string
  offset: number
  maxBytes?: number
} {
  const input = record(value)
  if (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0) {
    throw new Error('Unsupported file preview offset')
  }
  const maxBytes = input.maxBytes === undefined ? undefined : positiveInteger(input.maxBytes)
  return { ...parseGenerationRequest(input), offset: input.offset as number, maxBytes }
}

export function parseLineRequest(value: unknown): {
  handleId: string
  expectedGeneration: string
  line: number
} {
  const input = record(value)
  return { ...parseGenerationRequest(input), line: positiveInteger(input.line) }
}

export function parseReloadRequest(value: unknown): {
  handleId: string
  reopenToken: string
  expectedGeneration: string
} {
  const input = record(value)
  return {
    ...parseGenerationRequest(input),
    reopenToken: string(input.reopenToken, 128)
  }
}

export function parseReopenRequest(value: unknown): { threadId: string; reopenToken: string } {
  const input = record(value)
  return { threadId: threadId(input.threadId), reopenToken: string(input.reopenToken, 128) }
}

export function parseChooseRootRequest(value: unknown): { threadId: string; pendingOpenId: string } {
  const input = record(value)
  return { threadId: threadId(input.threadId), pendingOpenId: string(input.pendingOpenId, 128) }
}

export function parseCopyPathRequest(value: unknown): {
  handleId: string
  format: 'display' | 'absolute'
} {
  const input = record(value)
  if (input.format !== 'display' && input.format !== 'absolute') {
    throw new Error('Unsupported file path format')
  }
  return { handleId: string(input.handleId, 128), format: input.format }
}

export function parseRetentionState(value: unknown): FilePreviewRetentionState {
  const input = record(value)
  if (!Array.isArray(input.sessions) || input.sessions.length > filePreviewRetentionLimits.snapshots
    || !Array.isArray(input.handles) || input.handles.length > filePreviewRetentionLimits.handles * 2) throw new Error('Unsupported preview retention')
  return {
    sessions: input.sessions.map(value => { const item = record(value); return {
      threadId: threadId(item.threadId), previewSessionId: string(item.previewSessionId, 128)
    } }),
    handles: input.handles.map(value => {
      const item = record(value)
      if (!Number.isSafeInteger(item.lastUsed) || (item.lastUsed as number) < 0
        || typeof item.visible !== 'boolean' || typeof item.busy !== 'boolean'
        || typeof item.recoverable !== 'boolean') throw new Error('Unsupported preview retention')
      return { handleId: string(item.handleId, 128), previewSessionId: string(item.previewSessionId, 128),
        tabId: string(item.tabId, 512), lastUsed: item.lastUsed as number, visible: item.visible,
        busy: item.busy, recoverable: item.recoverable }
    })
  }
}
