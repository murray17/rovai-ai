import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { unified } from 'unified'

type MarkdownNode = {
  type?: unknown
  value?: unknown
  tagName?: string
  children?: unknown
}

const safeMarkdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyStrikethrough, { singleTilde: false })
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize)

const visibleStructure = new Set(['blockquote', 'pre', 'ul', 'ol', 'table', 'hr', 'input'])

function hasContent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as MarkdownNode
  if (node.tagName === 'img') return false
  if (visibleStructure.has(node.tagName ?? '')) return true
  if (node.type === 'text' && typeof node.value === 'string' && node.value.trim()) return true
  return Array.isArray(node.children) && node.children.some(hasContent)
}

export function safeMarkdownHasRenderableContent(source: string): boolean {
  if (!source.trim()) return false
  return hasContent(safeMarkdownParser.runSync(safeMarkdownParser.parse(source)))
}
