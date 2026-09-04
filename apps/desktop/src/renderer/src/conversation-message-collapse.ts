import type { StructuredCampMessageContent } from '@contracts'

export const LONG_MESSAGE_LINE_THRESHOLD = 20
export const COLLAPSED_MESSAGE_VISIBLE_LINE_COUNT = 19

export interface CollapsedMessageProjection {
  lineCount: number
  body: string
  content: StructuredCampMessageContent | null
}

export function explicitMessageLineCount(body: string): number {
  if (body.length === 0) return 0
  return body.split(/\r\n|\n|\r/u).length
}

function firstExplicitLines(body: string, lineCount: number): string {
  if (lineCount <= 0 || body.length === 0) return ''
  const lineBreakPattern = /\r\n|\n|\r/gu
  let remainingLineBreaks = lineCount
  let match = lineBreakPattern.exec(body)
  while (match) {
    remainingLineBreaks -= 1
    if (remainingLineBreaks === 0) return body.slice(0, match.index)
    match = lineBreakPattern.exec(body)
  }
  return body
}

function firstStructuredContentLines(
  content: StructuredCampMessageContent,
  lineCount: number
): StructuredCampMessageContent {
  if (lineCount <= 0) return []
  const projection: StructuredCampMessageContent = []
  let remainingLineBreaks = lineCount

  for (const segment of content) {
    if (segment.kind !== 'text') {
      projection.push(segment)
      continue
    }

    const lineBreakPattern = /\r\n|\n|\r/gu
    let match = lineBreakPattern.exec(segment.text)
    while (match) {
      remainingLineBreaks -= 1
      if (remainingLineBreaks === 0) {
        const prefix = segment.text.slice(0, match.index)
        if (prefix.length > 0) projection.push({ kind: 'text', text: prefix })
        return projection
      }
      match = lineBreakPattern.exec(segment.text)
    }
    projection.push(segment)
  }

  return projection
}

export function collapsedMessageProjection(
  body: string,
  content: StructuredCampMessageContent | null
): CollapsedMessageProjection | null {
  const lineCount = explicitMessageLineCount(body)
  if (lineCount <= LONG_MESSAGE_LINE_THRESHOLD) return null
  return {
    lineCount,
    body: firstExplicitLines(body, COLLAPSED_MESSAGE_VISIBLE_LINE_COUNT),
    content: content === null
      ? null
      : firstStructuredContentLines(content, COLLAPSED_MESSAGE_VISIBLE_LINE_COUNT)
  }
}
