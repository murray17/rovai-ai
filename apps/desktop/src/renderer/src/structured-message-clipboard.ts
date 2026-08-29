import type { StructuredCampMessageContent } from '@contracts'

const CLIPBOARD_ATTRIBUTE = 'data-rovai-structured-camp-message-v1'
const CLIPBOARD_VERSION = 1
const MAX_PRIVATE_PAYLOAD_LENGTH = 2_000_000
const MAX_SEGMENT_COUNT = 10_000
const MAX_SEGMENT_TEXT_LENGTH = 1_000_000
const MAX_AGENT_ID_LENGTH = 512

export interface StructuredClipboardMember {
  agentId: string
  displayName: string
  mentionable?: boolean
}

export interface StructuredMessageClipboardData {
  text: string
  html: string
}

type PrivateClipboardSegment =
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string; fallbackText: string }
  | { kind: 'all_members_mention'; fallbackText: '@所有队员' }
  | { kind: 'current_user_mention'; userId: 'local_user'; fallbackText: '@你' }

interface PrivateClipboardPayload {
  version: 1
  content: PrivateClipboardSegment[]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function privateSegmentText(segment: PrivateClipboardSegment): string {
  return segment.kind === 'text' ? segment.text : segment.fallbackText
}

function isPrivateClipboardSegment(value: unknown): value is PrivateClipboardSegment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const segment = value as Record<string, unknown>
  if (segment.kind === 'text') {
    return typeof segment.text === 'string' && segment.text.length <= MAX_SEGMENT_TEXT_LENGTH
  }
  if (segment.kind === 'member_mention') {
    return typeof segment.agentId === 'string'
      && segment.agentId.trim().length > 0
      && segment.agentId.length <= MAX_AGENT_ID_LENGTH
      && typeof segment.fallbackText === 'string'
      && segment.fallbackText.startsWith('@')
      && segment.fallbackText.length <= MAX_SEGMENT_TEXT_LENGTH
  }
  if (segment.kind === 'current_user_mention') {
    return segment.userId === 'local_user' && segment.fallbackText === '@你'
  }
  return segment.kind === 'all_members_mention' && segment.fallbackText === '@所有队员'
}

function parsePrivateClipboardPayload(encoded: string): PrivateClipboardPayload | null {
  if (!encoded || encoded.length > MAX_PRIVATE_PAYLOAD_LENGTH) return null
  try {
    const parsed = JSON.parse(decodeBase64Utf8(encoded)) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const payload = parsed as Record<string, unknown>
    if (
      payload.version !== CLIPBOARD_VERSION
      || !Array.isArray(payload.content)
      || payload.content.length === 0
      || payload.content.length > MAX_SEGMENT_COUNT
      || !payload.content.every(isPrivateClipboardSegment)
      || !payload.content.some((segment) => segment.kind !== 'text')
    ) return null
    return payload as unknown as PrivateClipboardPayload
  } catch {
    return null
  }
}

function privatePayloadFromHtml(html: string): PrivateClipboardPayload | null {
  if (!html || html.length > MAX_PRIVATE_PAYLOAD_LENGTH * 2) return null
  const attributePattern = new RegExp(`\\b${CLIPBOARD_ATTRIBUTE}\\s*=\\s*(["'])([^"']+)\\1`, 'i')
  const encoded = attributePattern.exec(html)?.[2]
  return encoded ? parsePrivateClipboardPayload(encoded) : null
}

export function createStructuredMessageClipboardData(
  content: StructuredCampMessageContent | null,
  members: readonly StructuredClipboardMember[]
): StructuredMessageClipboardData | null {
  if (!content?.some((segment) => segment.kind !== 'text')) return null
  const memberById = new Map(members.map((member) => [member.agentId, member]))
  const privateContent: PrivateClipboardSegment[] = content.map((segment) => {
    if (segment.kind === 'text') return segment
    if (segment.kind === 'all_members_mention') {
      return { kind: 'all_members_mention', fallbackText: '@所有队员' }
    }
    if (segment.kind === 'current_user_mention') {
      return { kind: 'current_user_mention', userId: 'local_user', fallbackText: '@你' }
    }
    if (segment.kind === 'skill_mention') {
      // Paste is intentionally identity-free: a copied Skill token becomes
      // ordinary slash text and can never be reverse-parsed into a selection.
      return { kind: 'text', text: `/${segment.nameAtSend}` }
    }
    if (segment.kind === 'file_selection') {
      const selection = segment.selection
      const start = `L${selection.startLine}${selection.startColumn ? `:${selection.startColumn}` : ''}`
      const end = `L${selection.endLine}${selection.endColumn ? `:${selection.endColumn}` : ''}`
      return {
        kind: 'text',
        text: `\n文件选区：${selection.displayPath} · ${start}–${end}\n${selection.selectedText}${selection.selectedText.endsWith('\n') ? '' : '\n'}`
      }
    }
    return {
      kind: 'member_mention',
      agentId: segment.agentId,
      fallbackText: `@${memberById.get(segment.agentId)?.displayName ?? '不可用队员'}`
    }
  })
  if (
    privateContent[0]?.kind === 'current_user_mention'
    && privateContent.slice(1).some((segment) => privateSegmentText(segment).length > 0)
  ) {
    privateContent.splice(1, 0, { kind: 'text', text: ' ' })
  }
  const text = privateContent.map(privateSegmentText).join('')
  const payload: PrivateClipboardPayload = {
    version: CLIPBOARD_VERSION,
    content: privateContent
  }
  const encoded = encodeBase64Utf8(JSON.stringify(payload))
  return {
    text,
    html: `<span ${CLIPBOARD_ATTRIBUTE}="${encoded}" style="white-space: pre-wrap">${escapeHtml(text)}</span>`
  }
}

export function readStructuredMessageClipboardContent(
  html: string,
  plainText: string,
  members: readonly StructuredClipboardMember[]
): StructuredCampMessageContent | null {
  const payload = privatePayloadFromHtml(html)
  if (!payload || payload.content.map(privateSegmentText).join('') !== plainText) return null
  const mentionableMemberIds = new Set(
    members.filter((member) => member.mentionable !== false).map((member) => member.agentId)
  )
  return payload.content.map((segment) => {
    if (segment.kind === 'text') return segment
    if (segment.kind === 'all_members_mention') return { kind: 'all_members_mention' }
    if (segment.kind === 'current_user_mention') {
      return { kind: 'text', text: segment.fallbackText }
    }
    if (mentionableMemberIds.has(segment.agentId)) {
      return { kind: 'member_mention', agentId: segment.agentId }
    }
    return { kind: 'text', text: segment.fallbackText }
  })
}
