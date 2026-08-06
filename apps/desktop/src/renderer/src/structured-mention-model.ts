export type StructuredMentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string }
  | { kind: 'all_members_mention' }

export type StructuredMentionContent = StructuredMentionSegment[]

export interface StructuredMentionSelection {
  anchor: number
  focus: number
}

export interface StructuredMentionEditorState {
  content: StructuredMentionContent
  selection: StructuredMentionSelection
}

/**
 * Returns a canonical Renderer projection: empty text is absent and adjacent
 * text is merged. Mention occurrences deliberately remain ordered and distinct.
 */
export function normalizeStructuredMentionContent(
  content: readonly StructuredMentionSegment[]
): StructuredMentionContent {
  const normalized: StructuredMentionContent = []
  for (const segment of content) {
    if (segment.kind === 'text') {
      if (!segment.text) continue
      const previous = normalized.at(-1)
      if (previous?.kind === 'text') {
        previous.text += segment.text
      } else {
        normalized.push({ kind: 'text', text: segment.text })
      }
      continue
    }
    if (segment.kind === 'member_mention') {
      normalized.push({
        kind: 'member_mention',
        agentId: segment.agentId
      })
      continue
    }
    normalized.push({ kind: 'all_members_mention' })
  }
  return normalized
}

/**
 * Text uses DOM-compatible UTF-16 offsets. Each structured token occupies one
 * indivisible editor position; these offsets are ephemeral and never persisted.
 */
export function structuredMentionContentLength(
  content: readonly StructuredMentionSegment[]
): number {
  return content.reduce(
    (length, segment) => length + (segment.kind === 'text' ? segment.text.length : 1),
    0
  )
}

export function replaceStructuredSelection(
  state: StructuredMentionEditorState,
  replacement: readonly StructuredMentionSegment[]
): StructuredMentionEditorState {
  const content = normalizeStructuredMentionContent(state.content)
  const length = structuredMentionContentLength(content)
  const anchor = clampOffset(state.selection.anchor, length)
  const focus = clampOffset(state.selection.focus, length)
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  const canonicalReplacement = normalizeStructuredMentionContent(replacement)
  const nextContent = normalizeStructuredMentionContent([
    ...sliceStructuredMentionContent(content, 0, start),
    ...canonicalReplacement,
    ...sliceStructuredMentionContent(content, end, length)
  ])
  const caret = start + structuredMentionContentLength(canonicalReplacement)
  return {
    content: nextContent,
    selection: { anchor: caret, focus: caret }
  }
}

export function insertStructuredText(
  state: StructuredMentionEditorState,
  text: string
): StructuredMentionEditorState {
  return replaceStructuredSelection(state, [{ kind: 'text', text }])
}

export function pasteStructuredPlainText(
  state: StructuredMentionEditorState,
  text: string
): StructuredMentionEditorState {
  // Plain Clipboard text is intentionally never parsed for @name or @all.
  return insertStructuredText(state, text)
}

export function insertMemberMention(
  state: StructuredMentionEditorState,
  agentId: string
): StructuredMentionEditorState {
  if (!agentId.trim()) throw new Error('Member Mention requires an Agent Profile ID')
  return replaceStructuredSelection(state, [{
    kind: 'member_mention',
    agentId
  }])
}

export function insertAllMembersMention(
  state: StructuredMentionEditorState
): StructuredMentionEditorState {
  return replaceStructuredSelection(state, [{ kind: 'all_members_mention' }])
}

export function deleteStructuredBackward(
  state: StructuredMentionEditorState
): StructuredMentionEditorState {
  const normalized = normalizeEditorState(state)
  if (normalized.selection.anchor !== normalized.selection.focus) {
    return replaceStructuredSelection(normalized, [])
  }
  const caret = normalized.selection.anchor
  if (caret === 0) return normalized
  const boundary = previousStructuredMentionBoundary(normalized.content, caret)
  return replaceStructuredSelection({
    content: normalized.content,
    selection: { anchor: boundary, focus: caret }
  }, [])
}

export function deleteStructuredForward(
  state: StructuredMentionEditorState
): StructuredMentionEditorState {
  const normalized = normalizeEditorState(state)
  if (normalized.selection.anchor !== normalized.selection.focus) {
    return replaceStructuredSelection(normalized, [])
  }
  const caret = normalized.selection.anchor
  const length = structuredMentionContentLength(normalized.content)
  if (caret === length) return normalized
  const boundary = nextStructuredMentionBoundary(normalized.content, caret)
  return replaceStructuredSelection({
    content: normalized.content,
    selection: { anchor: caret, focus: boundary }
  }, [])
}

function previousStructuredMentionBoundary(
  content: readonly StructuredMentionSegment[],
  caret: number
): number {
  let cursor = 0
  for (const segment of content) {
    const segmentLength = segment.kind === 'text' ? segment.text.length : 1
    const segmentEnd = cursor + segmentLength
    if (caret > cursor && caret <= segmentEnd) {
      if (segment.kind !== 'text') return cursor
      return cursor + previousGraphemeBoundary(segment.text, caret - cursor)
    }
    cursor = segmentEnd
  }
  return Math.max(0, caret - 1)
}

function nextStructuredMentionBoundary(
  content: readonly StructuredMentionSegment[],
  caret: number
): number {
  let cursor = 0
  for (const segment of content) {
    const segmentLength = segment.kind === 'text' ? segment.text.length : 1
    const segmentEnd = cursor + segmentLength
    if (caret >= cursor && caret < segmentEnd) {
      if (segment.kind !== 'text') return segmentEnd
      return cursor + nextGraphemeBoundary(segment.text, caret - cursor)
    }
    cursor = segmentEnd
  }
  return caret + 1
}

function previousGraphemeBoundary(text: string, offset: number): number {
  let previous = 0
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (part.index >= offset) break
    previous = part.index
  }
  return previous
}

function nextGraphemeBoundary(text: string, offset: number): number {
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const end = part.index + part.segment.length
    if (end > offset) return end
  }
  return text.length
}

function normalizeEditorState(
  state: StructuredMentionEditorState
): StructuredMentionEditorState {
  const content = normalizeStructuredMentionContent(state.content)
  const length = structuredMentionContentLength(content)
  return {
    content,
    selection: {
      anchor: clampOffset(state.selection.anchor, length),
      focus: clampOffset(state.selection.focus, length)
    }
  }
}

function sliceStructuredMentionContent(
  content: readonly StructuredMentionSegment[],
  start: number,
  end: number
): StructuredMentionContent {
  if (start >= end) return []
  const sliced: StructuredMentionContent = []
  let cursor = 0
  for (const segment of content) {
    const segmentLength = segment.kind === 'text' ? segment.text.length : 1
    const segmentStart = cursor
    const segmentEnd = cursor + segmentLength
    cursor = segmentEnd
    if (segmentEnd <= start) continue
    if (segmentStart >= end) break

    if (segment.kind === 'text') {
      const localStart = Math.max(0, start - segmentStart)
      const localEnd = Math.min(segmentLength, end - segmentStart)
      const text = segment.text.slice(localStart, localEnd)
      if (text) sliced.push({ kind: 'text', text })
      continue
    }

    if (start <= segmentStart && end >= segmentEnd) {
      sliced.push(segment.kind === 'member_mention'
        ? { kind: 'member_mention', agentId: segment.agentId }
        : { kind: 'all_members_mention' })
    }
  }
  return sliced
}

function clampOffset(offset: number, length: number): number {
  if (offset === Number.POSITIVE_INFINITY) return length
  if (!Number.isFinite(offset)) return 0
  return Math.min(length, Math.max(0, Math.trunc(offset)))
}
