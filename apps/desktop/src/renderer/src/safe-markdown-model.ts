export * from '../../shared/execution-presentation/safe-markdown-model'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parseFileReference } from '../../file-preview-reference'

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

export interface MessageFileReference {
  start: number
  end: number
  rawReference: string
  label: string
}

export interface MessageInlineCode {
  start: number
  end: number
  value: string
}

export function projectMessageInlineCodes(source: string): MessageInlineCode[] {
  if (!source || source.length > 1_048_576) return []
  const inlineCodes: MessageInlineCode[] = []
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'inlineCode') {
      if (typeof start === 'number' && typeof end === 'number' && typeof node.value === 'string') {
        inlineCodes.push({ start, end, value: node.value })
      }
      return
    }
    if (node.type === 'code' || node.type === 'link' || node.type === 'linkReference'
      || omittedNodeTypes.has(String(node.type))) return
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(safeMarkdownParser.parse(source))
  return inlineCodes
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
        references.push({ start, end, rawReference: node.url, label: label.trim() ? label : node.url })
      }
      return
    }
    if (node.type === 'inlineCode' || node.type === 'code' || node.type === 'linkReference'
      || omittedNodeTypes.has(String(node.type))) return
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(safeMarkdownParser.parse(source))
  return references
}
