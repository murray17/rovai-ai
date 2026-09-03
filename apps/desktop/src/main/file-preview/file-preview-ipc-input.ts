import {
  isCampId,
  type OpenFilePreviewRequest
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

function campId(value: unknown): string {
  if (!isCampId(value)) throw new Error('Unsupported file preview Camp')
  return value
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('Unsupported file preview number')
  }
  return value as number
}

export function parseFilePreviewCamp(value: unknown): string | null {
  return value === null ? null : campId(value)
}

export function parseOpenFilePreviewRequest(value: unknown): OpenFilePreviewRequest {
  const input = record(value)
  switch (input.kind) {
    case 'message_reference':
      return {
        kind: input.kind,
        campId: campId(input.campId),
        messageId: string(input.messageId, 128),
        rawReference: string(input.rawReference)
      }
    case 'camp_workspace':
      return {
        kind: input.kind,
        campId: campId(input.campId),
        rawReference: string(input.rawReference)
      }
    case 'attachment': {
      const attachmentId = string(input.attachmentId, 128)
      if (!isAttachmentId(attachmentId)) throw new Error('Unsupported Attachment')
      return { kind: input.kind, campId: campId(input.campId), attachmentId }
    }
    case 'run_evidence':
      if (input.action !== 'review' && input.action !== 'open_current') {
        throw new Error('Unsupported evidence action')
      }
      return {
        kind: input.kind,
        campId: campId(input.campId),
        agentRunId: string(input.agentRunId, 128),
        executionEpoch: positiveInteger(input.executionEpoch),
        evidenceFileId: string(input.evidenceFileId, 256),
        action: input.action
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
        campId: campId(input.campId),
        rootGrantId: string(input.rootGrantId, 128),
        rawReference: string(input.rawReference)
      }
    default:
      throw new Error('Unsupported file preview source')
  }
}

export function parseHandleRequest(value: unknown): { handleId: string } {
  return { handleId: string(record(value).handleId, 128) }
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

export function parseReopenRequest(value: unknown): { campId: string; reopenToken: string } {
  const input = record(value)
  return { campId: campId(input.campId), reopenToken: string(input.reopenToken, 128) }
}

export function parseChooseRootRequest(value: unknown): { campId: string; pendingOpenId: string } {
  const input = record(value)
  return { campId: campId(input.campId), pendingOpenId: string(input.pendingOpenId, 128) }
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
