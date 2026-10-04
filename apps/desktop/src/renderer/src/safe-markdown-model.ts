export * from '../../shared/execution-presentation/safe-markdown-model'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { decodeString } from 'micromark-util-decode-string'
import { parseFileReference } from '../../file-preview-reference'

export type MarkdownNode = {
  type?: string
  value?: string
  checked?: boolean
  children?: MarkdownNode[]
  url?: string
  data?: { hProperties?: Record<string, string> }
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const safeMarkdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })

// Check decoded Markdown text as well as raw source: an entity such as &#82;
// must never turn ordinary text into a trusted structured-content placeholder.
export function markdownInlineContentPrefix(source: string): string {
  // Decode the entire source independently of block syntax. Inserting mentions
  // can turn a definition or HTML region into visible text. Removing escapes
  // deliberately overestimates collisions, including across segment boundaries.
  const decoded = decodeString(source.replaceAll('\\', ''))
  let prefix = 'ROVAICURRENTUSER'
  while (source.includes(prefix) || decoded.includes(prefix)) prefix += 'X'
  return prefix
}

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
  marginInlineStart: boolean
  marginInlineEnd: boolean
}

export interface FileReferenceInlineSpacing {
  marginInlineStart: boolean
  marginInlineEnd: boolean
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
  visit(safeMarkdownParser.parse(source) as MarkdownNode)
  return inlineCodes
}

function markdownLinkLabel(node: MarkdownNode): string {
  if ((node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') {
    return node.value
  }
  if (node.type === 'break') return ' '
  return Array.isArray(node.children) ? node.children.map(markdownLinkLabel).join('') : ''
}

const inlineFlowNodeTypes = new Set(['heading', 'paragraph', 'tableCell'])
const inlineFlowBoundaryNodeTypes = new Set(['break', 'footnoteReference'])
const bodyTextCharacter = /[\p{Letter}\p{Number}]/u

type InlineFlowToken =
  | { kind: 'text'; value: string }
  | { kind: 'fileReference'; node: MarkdownNode }
  | { kind: 'boundary' }

function markdownNodeChildren(node: MarkdownNode): MarkdownNode[] {
  return node.children ?? []
}

function isMarkdownFileReference(node: MarkdownNode): boolean {
  return node.type === 'link'
    && typeof node.url === 'string'
    && Boolean(parseFileReference(node.url))
}

function appendInlineFlowTokens(node: MarkdownNode, tokens: InlineFlowToken[]): void {
  if (isMarkdownFileReference(node)) {
    tokens.push({ kind: 'fileReference', node })
    return
  }
  if ((node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') {
    if (node.value) tokens.push({ kind: 'text', value: node.value })
    return
  }
  if (inlineFlowBoundaryNodeTypes.has(String(node.type))) {
    tokens.push({ kind: 'boundary' })
    return
  }
  // SafeMarkdown omits raw HTML and images in message mode, so neither creates
  // a visible character boundary for the surrounding rendered prose.
  if (omittedNodeTypes.has(String(node.type))) return
  for (const child of markdownNodeChildren(node)) appendInlineFlowTokens(child, tokens)
}

function firstCodePoint(value: string): string {
  const codePoint = value.codePointAt(0)
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint)
}

function lastCodePoint(value: string): string {
  if (!value) return ''
  const finalCodeUnit = value.charCodeAt(value.length - 1)
  const offset = finalCodeUnit >= 0xdc00 && finalCodeUnit <= 0xdfff ? value.length - 2 : value.length - 1
  const codePoint = value.codePointAt(Math.max(0, offset))
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint)
}

function inlineTokenTouchesBodyText(token: InlineFlowToken | undefined, edge: 'start' | 'end'): boolean {
  if (token?.kind !== 'text') return false
  const character = edge === 'start' ? firstCodePoint(token.value) : lastCodePoint(token.value)
  return bodyTextCharacter.test(character)
}

export function visitMarkdownFileReferences(
  root: MarkdownNode,
  visitor: (node: MarkdownNode, spacing: FileReferenceInlineSpacing) => void
): void {
  const visitBlocks = (node: MarkdownNode): void => {
    if (inlineFlowNodeTypes.has(String(node.type))) {
      const tokens: InlineFlowToken[] = []
      appendInlineFlowTokens(node, tokens)
      for (const [index, token] of tokens.entries()) {
        if (token.kind !== 'fileReference') continue
        visitor(token.node, {
          marginInlineStart: inlineTokenTouchesBodyText(tokens[index - 1], 'end'),
          marginInlineEnd: inlineTokenTouchesBodyText(tokens[index + 1], 'start')
        })
      }
      return
    }
    if (node.type === 'code' || omittedNodeTypes.has(String(node.type))) return
    for (const child of markdownNodeChildren(node)) visitBlocks(child)
  }
  visitBlocks(root)
}

export function fileReferenceSpacingClassName(spacing: FileReferenceInlineSpacing): string {
  return [
    spacing.marginInlineStart ? 'has-adjacent-text-before' : '',
    spacing.marginInlineEnd ? 'has-adjacent-text-after' : ''
  ].filter(Boolean).join(' ')
}

function sourceCodePointBefore(source: string, offset: number): string {
  if (offset <= 0) return ''
  const finalCodeUnit = source.charCodeAt(offset - 1)
  const start = finalCodeUnit >= 0xdc00 && finalCodeUnit <= 0xdfff ? offset - 2 : offset - 1
  const codePoint = source.codePointAt(Math.max(0, start))
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint)
}

function sourceCodePointAt(source: string, offset: number): string {
  const codePoint = source.codePointAt(offset)
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint)
}

// Project only file references. Source ranges outside those nodes stay byte-for-byte
// intact so ordinary user text and structured Mention/Skill rendering remain independent.
export function projectMessageFileReferences(source: string): MessageFileReference[] {
  if (!source || source.length > 1_048_576) return []
  const references: MessageFileReference[] = []
  const inlineCodeByStart = new Map<number, string>()
  const inlineCodeByEnd = new Map<number, string>()
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'inlineCode') {
      if (typeof start === 'number' && typeof end === 'number' && typeof node.value === 'string') {
        inlineCodeByStart.set(start, node.value)
        inlineCodeByEnd.set(end, node.value)
      }
      return
    }
    if (node.type === 'link') {
      if (typeof start === 'number' && typeof end === 'number'
        && typeof node.url === 'string' && parseFileReference(node.url)) {
        const label = markdownLinkLabel(node)
        references.push({
          start,
          end,
          rawReference: node.url,
          label: label.trim() ? label : node.url,
          marginInlineStart: bodyTextCharacter.test(sourceCodePointBefore(source, start)),
          marginInlineEnd: bodyTextCharacter.test(sourceCodePointAt(source, end))
        })
      }
      return
    }
    if (node.type === 'code' || node.type === 'linkReference'
      || omittedNodeTypes.has(String(node.type))) return
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(safeMarkdownParser.parse(source) as MarkdownNode)
  for (const reference of references) {
    const before = inlineCodeByEnd.get(reference.start)
    const after = inlineCodeByStart.get(reference.end)
    if (before !== undefined) reference.marginInlineStart = bodyTextCharacter.test(lastCodePoint(before))
    if (after !== undefined) reference.marginInlineEnd = bodyTextCharacter.test(firstCodePoint(after))
  }
  return references
}
