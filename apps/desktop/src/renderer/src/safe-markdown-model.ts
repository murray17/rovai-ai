import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { inlineFileReferenceSource, isInlineFileReference, parseFileReference, tokenizeFileReferences } from '../../file-preview-reference'

type MarkdownNode = {
  type?: unknown
  value?: unknown
  checked?: unknown
  children?: unknown
  url?: unknown
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const safeMarkdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })

const omittedNodeTypes = new Set([
  'definition',
  'html',
  'image',
  'imageReference'
])

const visibleStructuralNodeTypes = new Set([
  'blockquote',
  'code',
  'list',
  'table',
  'thematicBreak'
])

function markdownNodeHasRenderableContent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as MarkdownNode
  const type = typeof node.type === 'string' ? node.type : ''
  if (omittedNodeTypes.has(type)) return false
  if (visibleStructuralNodeTypes.has(type)) return true
  if (
    (type === 'inlineCode' || type === 'text')
    && typeof node.value === 'string'
    && node.value.trim().length > 0
  ) {
    return true
  }
  if (type === 'listItem' && typeof node.checked === 'boolean') return true
  return Array.isArray(node.children)
    && node.children.some(markdownNodeHasRenderableContent)
}

export function safeMarkdownHasRenderableContent(source: string): boolean {
  if (!source.trim()) return false
  return markdownNodeHasRenderableContent(safeMarkdownParser.parse(source))
}

export interface MessageFileReference {
  start: number
  end: number
  rawReference: string
  label: string
  inlineCode: boolean
  sourceReference?: string
}

function markdownLinkLabel(node: MarkdownNode): string {
  if ((node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') {
    return node.value
  }
  if (node.type === 'break') return ' '
  return Array.isArray(node.children) ? node.children.map(markdownLinkLabel).join('') : ''
}

// Project only file references. Source ranges outside those nodes stay byte-for-byte
// intact so ordinary user text and structured Mention/Skill rendering remain independent.
export function projectMessageFileReferences(source: string): MessageFileReference[] {
  if (!source || source.length > 1_048_576) return []
  const references: MessageFileReference[] = []
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'link') {
      if (typeof start === 'number' && typeof end === 'number'
        && typeof node.url === 'string' && parseFileReference(node.url)) {
        const label = markdownLinkLabel(node)
        references.push({ start, end, rawReference: node.url, label: label.trim() ? label : node.url, inlineCode: false })
      }
      return
    }
    if (node.type === 'inlineCode') {
      if (typeof start === 'number' && typeof end === 'number'
        && typeof node.value === 'string' && isInlineFileReference(node.value)) {
        references.push({ start, end, rawReference: node.value, label: node.value, inlineCode: true })
      }
      return
    }
    if (node.type === 'text' && typeof start === 'number' && typeof end === 'number') {
      for (const token of tokenizeFileReferences(source.slice(start, end))) {
        references.push({
          start: start + token.start,
          end: start + token.end,
          rawReference: token.raw,
          label: token.raw,
          inlineCode: false
        })
      }
      return
    }
    if (node.type === 'code' || node.type === 'linkReference' || omittedNodeTypes.has(String(node.type))) return
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(safeMarkdownParser.parse(source))
  const candidates = references.map((reference) => reference.rawReference)
  return references.flatMap((reference) => {
    if (!reference.inlineCode) return [reference]
    const sourceReference = inlineFileReferenceSource(reference.rawReference, candidates)
    return sourceReference === null ? [] : [{
      ...reference,
      ...(sourceReference !== reference.rawReference ? { sourceReference } : {})
    }]
  })
}
