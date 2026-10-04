import type {
  ThreadComposerContinuationIntentView,
  ThreadComposerDraftView,
  ThreadMessageAttachmentView,
  ThreadSnapshot,
  ComposerDocument,
  MessageQuoteSnapshot
} from '@contracts'

const STORAGE_PREFIX = 'rovai.camp-composer-draft.v1:'
const MAX_STORED_DRAFT_BYTES = 4 * 1024 * 1024
const MAX_SEGMENTS = 4_096
const MAX_ATTACHMENTS = 10
const MAX_QUOTES = 32

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown, maximum = 1_048_576): value is string {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0')
}

function nullableString(value: unknown, maximum = 1_048_576): value is string | null {
  return value === null || string(value, maximum)
}

function uuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
}

function isComposerDocument(value: unknown): value is ComposerDocument {
  if (!object(value) || value.version !== 2 || !Array.isArray(value.segments)
    || value.segments.length > MAX_SEGMENTS) return false
  return value.segments.every((segment) => {
    if (!object(segment)) return false
    if (segment.kind === 'text') return string(segment.text)
    if (segment.kind !== 'atom' || !object(segment.atom)) return false
    if (segment.atom.type === 'all_members') return true
    if (segment.atom.type === 'member') {
      return string(segment.atom.agentId, 512)
        && (segment.atom.labelFallback === undefined || string(segment.atom.labelFallback, 512))
    }
    return segment.atom.type === 'skill'
      && string(segment.atom.skillId, 512)
      && string(segment.atom.nameAtSend, 512)
  })
}

function isQuote(value: unknown): value is MessageQuoteSnapshot {
  if (!object(value) || value.version !== 1 || !string(value.quoteId, 512)
    || !object(value.source) || !string(value.source.campId, 512)
    || !string(value.source.messageId, 512)
    || (value.source.scope !== 'camp' && value.source.scope !== 'single_chat')
    || !object(value.authorAtCapture) || !string(value.authorAtCapture.displayName, 512)
    || (value.authorAtCapture.type !== 'user' && value.authorAtCapture.type !== 'agent')
    || !string(value.text) || value.format !== 'plain_text'
    || !string(value.capturedAt, 128) || !string(value.sourceContentDigest, 512)
    || !string(value.snapshotDigest, 512)) return false
  return value.authorAtCapture.type !== 'agent' || string(value.authorAtCapture.agentId, 512)
}

function isAttachment(value: unknown): value is ThreadMessageAttachmentView {
  return object(value)
    && uuid(value.id)
    && string(value.displayName, 512)
    && (value.kind === 'file' || value.kind === 'directory')
    && (value.fileCount === null || (Number.isInteger(value.fileCount) && Number(value.fileCount) >= 0))
    && nullableString(value.mediaType, 512)
    && (value.byteSize === null || (Number.isInteger(value.byteSize) && Number(value.byteSize) >= 0))
    && (value.previewKind === 'image' || value.previewKind === 'none')
    && ['unknown', 'available', 'missing', 'unreadable', 'kind_changed'].includes(String(value.availability))
    && (value.sourcePath === undefined || string(value.sourcePath, 16_384))
}

function isReplyIntent(value: unknown): boolean {
  if (value === null) return true
  if (!object(value) || !string(value.replyToThreadMessageId, 512)
    || (value.targetState !== 'available' && value.targetState !== 'message_unavailable')
    || !nullableString(value.excerpt)
    || typeof value.recipientSelectionRequired !== 'boolean') return false
  if (value.author === null) return true
  return object(value.author)
    && ['user', 'agent', 'system'].includes(String(value.author.authorType))
    && string(value.author.authorId, 512)
    && string(value.author.displayName, 512)
    && ['available', 'unavailable', 'not_applicable'].includes(String(value.author.recipientAvailability))
}

function isContinuationIntent(value: unknown): value is ThreadComposerContinuationIntentView | null {
  if (value === null) return true
  return object(value)
    && string(value.sourceThreadMessageId, 512)
    && object(value.recipient)
    && string(value.recipient.agentId, 512)
    && string(value.recipient.displayName, 512)
    && (value.recipient.recipientAvailability === 'available'
      || value.recipient.recipientAvailability === 'unavailable')
    && typeof value.recipientSelectionRequired === 'boolean'
}

function isStoredDraft(value: unknown, threadId: string): value is ThreadComposerDraftView {
  return object(value)
    && value.threadId === threadId
    && string(value.body)
    && isComposerDocument(value.content)
    && Number.isInteger(value.revision)
    && Number(value.revision) >= 1
    && Array.isArray(value.quotes)
    && value.quotes.length <= MAX_QUOTES
    && value.quotes.every(isQuote)
    && Array.isArray(value.attachments)
    && value.attachments.length <= MAX_ATTACHMENTS
    && value.attachments.every(isAttachment)
    && isReplyIntent(value.replyIntent)
    && isContinuationIntent(value.continuationIntent)
    && nullableString(value.updatedAt, 128)
    && nullableString(value.expiresAt, 128)
}

function storageKey(threadId: string): string {
  return `${STORAGE_PREFIX}${threadId}`
}

function browserStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadLocalThreadComposerDraft(
  threadId: string,
  storage: DraftStorage | null = browserStorage()
): ThreadComposerDraftView | null {
  if (!storage) return null
  const encoded = storage.getItem(storageKey(threadId))
  if (!encoded || encoded.length > MAX_STORED_DRAFT_BYTES) return null
  try {
    const parsed: unknown = JSON.parse(encoded)
    // Preserve the established on-disk draft format and key across the public rename.
    if (object(parsed) && 'campId' in parsed && !('threadId' in parsed)) {
      parsed.threadId = parsed.campId
      delete parsed.campId
      if (object(parsed.replyIntent) && 'replyToCampMessageId' in parsed.replyIntent) {
        parsed.replyIntent.replyToThreadMessageId = parsed.replyIntent.replyToCampMessageId
        delete parsed.replyIntent.replyToCampMessageId
      }
      if (object(parsed.continuationIntent) && 'sourceCampMessageId' in parsed.continuationIntent) {
        parsed.continuationIntent.sourceThreadMessageId = parsed.continuationIntent.sourceCampMessageId
        delete parsed.continuationIntent.sourceCampMessageId
      }
    }
    return isStoredDraft(parsed, threadId) ? parsed : null
  } catch {
    return null
  }
}

export function localThreadComposerDraftIsEmpty(draft: ThreadComposerDraftView): boolean {
  return draft.content.segments.every((segment) => segment.kind === 'text' && !segment.text)
    && draft.quotes.length === 0
    && draft.attachments.length === 0
    && draft.replyIntent === null
    && draft.continuationIntent === null
}

export function saveLocalThreadComposerDraft(
  draft: ThreadComposerDraftView,
  storage: DraftStorage | null = browserStorage()
): void {
  if (!storage) return
  if (localThreadComposerDraftIsEmpty(draft)) {
    storage.removeItem(storageKey(draft.threadId))
    return
  }
  const { threadId, replyIntent, continuationIntent, ...rest } = draft
  const encoded = JSON.stringify({
    ...rest,
    campId: threadId,
    replyIntent: replyIntent === null ? null : (() => {
      const { replyToThreadMessageId, ...rest } = replyIntent
      return { ...rest, replyToCampMessageId: replyToThreadMessageId }
    })(),
    continuationIntent: continuationIntent === null ? null : (() => {
      const { sourceThreadMessageId, ...rest } = continuationIntent
      return { ...rest, sourceCampMessageId: sourceThreadMessageId }
    })()
  })
  if (encoded.length > MAX_STORED_DRAFT_BYTES) {
    throw new Error('当前输入超过本机草稿保存上限。')
  }
  storage.setItem(storageKey(draft.threadId), encoded)
}

export function clearLocalThreadComposerDraft(
  threadId: string,
  storage: DraftStorage | null = browserStorage()
): void {
  storage?.removeItem(storageKey(threadId))
}

export function composerBodyForContent(
  content: ComposerDocument,
  members: ThreadSnapshot['members']
): string {
  return content.segments.map((segment) => {
    if (segment.kind === 'text') return segment.text
    const atom = segment.atom
    if (atom.type === 'all_members') return '@所有成员'
    if (atom.type === 'skill') return `$${atom.nameAtSend}`
    return `@${members.find((member) => member.agentId === atom.agentId)?.displayName
      ?? atom.labelFallback
      ?? atom.agentId}`
  }).join('')
}

function explicitRecipientIds(content: ComposerDocument): string[] {
  return [...new Set(content.segments.flatMap((segment) =>
    segment.kind === 'atom' && segment.atom.type === 'member'
      ? [segment.atom.agentId]
      : []
  ))]
}

export function materializeLocalContinuation(
  draft: ThreadComposerDraftView,
  members: ThreadSnapshot['members']
): ThreadComposerDraftView {
  const intent = draft.continuationIntent
  if (!intent || draft.replyIntent
    || explicitRecipientIds(draft.content).length > 0
    || draft.content.segments.some((segment) =>
      segment.kind === 'atom' && segment.atom.type === 'all_members')) return draft
  const recipient = members.find((member) => member.agentId === intent.recipient.agentId)
  if (!recipient || recipient.membershipStatus !== 'active' || recipient.profilePresence !== 'present') {
    return draft
  }
  const content: ComposerDocument = {
    version: 2,
    segments: [
      { kind: 'atom', atom: { type: 'member', agentId: recipient.agentId } },
      { kind: 'text', text: ' ' },
      ...draft.content.segments
    ]
  }
  return { ...draft, content, body: composerBodyForContent(content, members) }
}

export function emptyLocalThreadComposerDraft(
  threadId: string,
  revision = 1,
  continuationIntent: ThreadComposerContinuationIntentView | null = null
): ThreadComposerDraftView {
  return {
    threadId,
    body: '',
    content: { version: 2, segments: [] },
    quotes: [],
    revision,
    attachments: [],
    replyIntent: null,
    continuationIntent,
    updatedAt: null,
    expiresAt: null
  }
}

export function nextLocalThreadComposerDraftAfterSend(input: {
  sent: ThreadComposerDraftView
  threadMessageId: string | undefined
  addressedAgentIds: readonly string[]
  members: ThreadSnapshot['members']
}): ThreadComposerDraftView {
  const leadId = input.members.find((member) => member.isDefaultLead)?.agentId ?? null
  const ids = explicitRecipientIds(input.sent.content)
  const broadcast = input.sent.content.segments.some((segment) =>
    segment.kind === 'atom' && segment.atom.type === 'all_members')
  const recipient = !broadcast && ids.length === 1 && ids[0] !== leadId
    && input.addressedAgentIds.length === 1 && input.addressedAgentIds[0] === ids[0]
    ? input.members.find((member) => member.agentId === ids[0]) ?? null
    : null
  const continuationIntent = recipient && input.threadMessageId
    ? {
        sourceThreadMessageId: input.threadMessageId,
        recipient: {
          agentId: recipient.agentId,
          displayName: recipient.displayName,
          recipientAvailability: recipient.membershipStatus === 'active'
            && recipient.profilePresence === 'present'
            ? 'available' as const
            : 'unavailable' as const
        },
        recipientSelectionRequired: recipient.membershipStatus !== 'active'
          || recipient.profilePresence !== 'present'
      }
    : null
  return emptyLocalThreadComposerDraft(
    input.sent.threadId,
    input.sent.revision + 1,
    continuationIntent
  )
}
