export interface ConversationFindRange {
  start: number
  end: number
}

export type PendingConversationFindStatus = 'idle' | 'searching'

const MATCH_HIGHLIGHT_NAME = 'conversation-find-match'
const CURRENT_HIGHLIGHT_NAME = 'conversation-find-current'

export function pendingConversationFindStatus(query: string): PendingConversationFindStatus {
  return query.trim() ? 'searching' : 'idle'
}

export function conversationFindRanges(text: string, query: string): ConversationFindRange[] {
  const foldedTextParts: string[] = []
  const sourceStarts: number[] = []
  const sourceEnds: number[] = []
  let sourceOffset = 0
  for (const character of text) {
    const foldedCharacter = character.toLowerCase()
    foldedTextParts.push(foldedCharacter)
    for (let offset = 0; offset < foldedCharacter.length; offset += 1) {
      sourceStarts.push(sourceOffset)
      sourceEnds.push(sourceOffset + character.length)
    }
    sourceOffset += character.length
  }
  const foldedText = foldedTextParts.join('')
  const foldedQuery = query.toLowerCase()
  if (!foldedQuery || foldedQuery.length > foldedText.length) return []

  const ranges: ConversationFindRange[] = []
  let offset = 0
  while (offset + foldedQuery.length <= foldedText.length) {
    const matchOffset = foldedText.indexOf(foldedQuery, offset)
    if (matchOffset < 0) break
    const start = sourceStarts[matchOffset]
    const end = sourceEnds[matchOffset + foldedQuery.length - 1]
    const previous = ranges.at(-1)
    if (start !== undefined && end !== undefined && (!previous || start >= previous.end)) {
      ranges.push({ start, end })
    }
    offset = matchOffset + foldedQuery.length
  }
  return ranges
}

export function nextConversationFindIndex(
  currentIndex: number | null,
  totalMatchCount: number,
  direction: 1 | -1
): number | null {
  if (totalMatchCount <= 0) return null
  const current = currentIndex ?? (direction === 1 ? -1 : 0)
  return (current + direction + totalMatchCount) % totalMatchCount
}

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void
  delete(name: string): boolean
}

interface HighlightConstructorLike {
  new (...ranges: Range[]): unknown
}

function domRangeForOffsets(
  textNodes: Text[],
  startOffset: number,
  endOffset: number
): Range | null {
  let traversed = 0
  let startNode: Text | null = null
  let startNodeOffset = 0
  let endNode: Text | null = null
  let endNodeOffset = 0
  for (const node of textNodes) {
    const nextTraversed = traversed + node.data.length
    if (!startNode && startOffset >= traversed && startOffset < nextTraversed) {
      startNode = node
      startNodeOffset = startOffset - traversed
    }
    if (endOffset > traversed && endOffset <= nextTraversed) {
      endNode = node
      endNodeOffset = endOffset - traversed
      break
    }
    traversed = nextTraversed
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startNodeOffset)
  range.setEnd(endNode, endNodeOffset)
  return range
}

function searchableTextNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    if (current instanceof Text && current.data) nodes.push(current)
    current = walker.nextNode()
  }
  return nodes
}

export function applyConversationFindHighlights(
  timeline: HTMLElement,
  query: string,
  currentMessageId: string | null,
  currentOccurrenceIndex: number | null
): () => void {
  const cssWithHighlights = globalThis.CSS as typeof CSS & {
    highlights?: HighlightRegistryLike
  }
  const HighlightConstructor = (globalThis as typeof globalThis & {
    Highlight?: HighlightConstructorLike
  }).Highlight
  const registry = cssWithHighlights.highlights
  const clear = (): void => {
    registry?.delete(MATCH_HIGHLIGHT_NAME)
    registry?.delete(CURRENT_HIGHLIGHT_NAME)
  }
  clear()
  if (!registry || !HighlightConstructor || !query) return clear

  const passiveRanges: Range[] = []
  const currentRanges: Range[] = []
  for (const message of timeline.querySelectorAll<HTMLElement>(
    '.conversation-bubble.user[data-message-id], .conversation-bubble.agent[data-message-id]'
  )) {
    const messageId = message.dataset.messageId ?? null
    let messageOccurrenceIndex = 0
    const bodyRoots = message.querySelectorAll<HTMLElement>('.message-bubble, .final-copy')
    for (const bodyRoot of bodyRoots) {
      const textNodes = searchableTextNodes(bodyRoot)
      const text = textNodes.map((node) => node.data).join('')
      for (const match of conversationFindRanges(text, query)) {
        const range = domRangeForOffsets(textNodes, match.start, match.end)
        if (!range) continue
        const isCurrent = messageId === currentMessageId
          && messageOccurrenceIndex === currentOccurrenceIndex
        const targetRanges = isCurrent ? currentRanges : passiveRanges
        targetRanges.push(range)
        messageOccurrenceIndex += 1
      }
    }
  }

  if (passiveRanges.length > 0) {
    registry.set(MATCH_HIGHLIGHT_NAME, new HighlightConstructor(...passiveRanges))
  }
  if (currentRanges.length > 0) {
    registry.set(CURRENT_HIGHLIGHT_NAME, new HighlightConstructor(...currentRanges))
  }
  return clear
}
