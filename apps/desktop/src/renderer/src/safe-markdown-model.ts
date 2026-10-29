export * from '../../shared/execution-presentation/safe-markdown-model'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { decodeString } from 'micromark-util-decode-string'
import { parseFileReference } from '../../file-preview-reference'
import { isWebUrl } from '../../web-url'
import { bareWebLinks, type WebLinkRange } from './web-link-ranges'

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
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyStrikethrough, { singleTilde: false })

/** Literal source ranges only: no rendered labels, wrappers, or editor mutations. */
export function projectWebLinkRanges(source: string): WebLinkRange[] {
  if (!/https?:\/\//iu.test(source)) return []
  if (!/[\u0060~<>\[\]\\\r\n*_]/u.test(source) && !/^(?: {4}|\t)/u.test(source)) return bareWebLinks(source)
  const links: WebLinkRange[] = []
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    const raw = source.slice(start, end)
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html'
      || node.type === 'image' || node.type === 'imageReference' || node.type === 'linkReference') {
      return
    }
    if (node.type === 'link' && (raw.startsWith('[') || raw.startsWith('<')) || node.type === 'definition') {
      if (!node.url || !isWebUrl(node.url)) return
      let from = raw.startsWith('<') ? 1 : node.type === 'definition' ? raw.indexOf(':') + 1
        : source.indexOf('](', node.children?.at(-1)?.position?.end.offset ?? start + 1) - start + 2
      if (from < 1) return
      while (from < raw.length && /\s/u.test(raw[from])) from++
      const angle = raw[from] === '<' || raw.startsWith('<')
      if (raw[from] === '<') from++
      let to = from
      let depth = 0
      for (; to < raw.length; to++) {
        const char = raw[to]
        if (char === '\\') { to++; continue }
        if (angle ? char === '>' : /\s/u.test(char) || char === ')' && depth === 0) break
        if (char === '(') depth++
        if (char === ')') depth--
      }
      if (/^https?:\/\//iu.test(raw.slice(from, to))) links.push({ start: start + from, end: start + to, target: node.url })
      return
    }
    if (node.type === 'text' || node.type === 'link') {
      links.push(...bareWebLinks(raw, start))
      return
    }
    const children = node.children ?? []
    for (let index = 0; index < children.length; index++) {
      const child = children[index]
      const implicit = (part: MarkdownNode): boolean => part.position?.start.offset !== undefined
        && part.position?.end.offset !== undefined && (part.type === 'text'
          || part.type === 'link' && !/^[\[<]/u.test(source.slice(part.position.start.offset, part.position.end.offset)))
      if (!implicit(child)) { visit(child); continue }
      let last = child
      while (index + 1 < children.length && implicit(children[index + 1])) last = children[++index]
      const from = child.position?.start.offset
      const to = last.position?.end.offset
      if (from !== undefined && to !== undefined) links.push(...bareWebLinks(source.slice(from, to), from))
    }
  }
  visit(safeMarkdownParser.parse(source) as MarkdownNode)
  return links
}

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

const bodyTextCharacter = /[\p{Letter}\p{Number}]/u

type RenderedNode = {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: RenderedNode[]
}
type InlineFlowToken = { kind: 'text'; value: string } | { kind: 'fileReference'; node: RenderedNode } | { kind: 'boundary' }
const flowBlocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'li', 'div', 'blockquote'])

// This runs on sanitized HTML, so discarded tags and attributes never count as
// visible neighbors. Existing file links alone receive the presentation classes.
export function visitRenderedFileReferences(root: RenderedNode, fragment: string): void {
  const tokens: InlineFlowToken[] = []
  const walk = (node: RenderedNode): void => {
    if (node.type === 'text') {
      if (node.value) tokens.push({ kind: 'text', value: node.value })
      return
    }
    if (node.tagName === 'a' && String(node.properties?.href ?? '').startsWith(fragment)) {
      tokens.push({ kind: 'fileReference', node }); return
    }
    if (node.tagName === 'img' || node.tagName === 'pre') { tokens.push({ kind: 'boundary' }); return }
    const block = flowBlocks.has(node.tagName ?? '') || node.tagName === 'br' || node.tagName === 'hr'
    if (block) tokens.push({ kind: 'boundary' })
    node.children?.forEach(walk)
    if (block) tokens.push({ kind: 'boundary' })
  }
  walk(root)
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'fileReference') continue
    token.node.properties = { ...token.node.properties, className: fileReferenceSpacingClassName({
      marginInlineStart: inlineTokenTouchesBodyText(tokens[index - 1], 'end'),
      marginInlineEnd: inlineTokenTouchesBodyText(tokens[index + 1], 'start')
    }) }
  }
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
