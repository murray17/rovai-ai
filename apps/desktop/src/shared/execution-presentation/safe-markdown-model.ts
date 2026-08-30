import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

type MarkdownNode = {
  type?: unknown
  value?: unknown
  checked?: unknown
  children?: unknown
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
