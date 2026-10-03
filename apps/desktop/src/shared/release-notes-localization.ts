import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import type { Root, RootContent } from 'mdast'

export interface ReleaseNotesLanguageSection {
  language: string
  content: string
}

export interface LocalizedReleaseNotes {
  preamble: string
  sections: ReleaseNotesLanguageSection[]
  definitions: string
}

const LANGUAGE_MARKER = /^<!--[\t ]*lang:[\t ]*([a-z]{2,3}(?:-[a-z0-9]{2,8})*)[\t ]*-->$/iu
const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkStringify)

function collectDefinitions(node: Root | RootContent, definitions: RootContent[], seen: Set<string>): void {
  if (node.type === 'definition' || node.type === 'footnoteDefinition') {
    const key = `${node.type}:${node.identifier}`
    if (!seen.has(key)) {
      seen.add(key)
      definitions.push(node)
    }
  }
  if ('children' in node) {
    for (const child of node.children) collectDefinitions(child, definitions, seen)
  }
}

function hasInlineLanguageMarker(node: RootContent): boolean {
  // 引用、列表和脚注中的标记仍是示例；代码和普通注释没有需要遍历的子节点。
  if (node.type === 'blockquote' || node.type === 'list' || node.type === 'footnoteDefinition') return false
  if (node.type === 'html') return /^<!--\s*lang\b/iu.test(node.value.trim())
  return 'children' in node && node.children.some(hasInlineLanguageMarker)
}

/** 只识别顶层独立注释；代码、引用、列表及 HTML 块内的示例不作为分段。 */
export function parseReleaseNotesLanguages(source: string): LocalizedReleaseNotes | null {
  const markers: Array<{ language: string; start: number; end: number }> = []
  const languages = new Set<string>()
  const tree = parser.parse(source)
  for (const node of tree.children) {
    if (node.type !== 'html') {
      if (hasInlineLanguageMarker(node)) return null
      continue
    }
    const marker = LANGUAGE_MARKER.exec(node.value.trim())
    if (!marker) {
      if (/^<!--\s*lang\b/iu.test(node.value.trim())
        || (!node.value.trim().startsWith('<!--') && /<!--\s*lang\b/iu.test(node.value))) return null
      continue
    }
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return null
    const lineStart = source.lastIndexOf('\n', start - 1) + 1
    const lineEnd = source.indexOf('\n', end)
    if (!/^ {0,3}$/u.test(source.slice(lineStart, start))
      || !/^[\t \r]*$/u.test(source.slice(end, lineEnd === -1 ? source.length : lineEnd))) return null
    const language = marker[1].toLowerCase()
    if (languages.has(language)) return null
    languages.add(language)
    markers.push({ language, start: lineStart, end: lineEnd === -1 ? end : lineEnd + 1 })
  }
  if (markers.length === 0) return null
  const definitions: RootContent[] = []
  collectDefinitions(tree, definitions, new Set())
  return {
    preamble: source.slice(0, markers[0].start),
    sections: markers.map((marker, index) => ({
      language: marker.language,
      content: source.slice(marker.end, markers[index + 1]?.start ?? source.length)
    })),
    definitions: definitions.length ? parser.stringify({ type: 'root', children: definitions }) : ''
  }
}

function hasVisibleContent(node: Root | RootContent): boolean {
  if (node.type === 'html' || node.type === 'definition' || node.type === 'footnoteDefinition'
    || node.type === 'image' || node.type === 'imageReference') return false
  if ('children' in node) return node.children.some(hasVisibleContent)
  if (node.type === 'text') return node.value.trim().length > 0
  return true
}

export function hasReleaseNotesContent(content: string, definitions = ''): boolean {
  return hasVisibleContent(parser.parse(definitions ? `${definitions}\n${content}` : content))
}

/** 匹配语言优先，其次同语种、英文、首个非空版本；公共前言始终保留。 */
export function selectReleaseNotesLanguage(
  source: string,
  language: string,
  hasDisplayContent?: (source: string) => boolean
): string {
  const parsed = parseReleaseNotesLanguages(source)
  if (!parsed) return source
  const displaySource = (content: string): string => {
    const displayed = parsed.preamble + content
    // 文档级定义先于选中段，保留原始 first-wins 语义及完整多段脚注。
    return parsed.definitions ? `${parsed.definitions}\n${displayed}` : displayed
  }
  const sections = parsed.sections.filter((section) =>
    hasReleaseNotesContent(section.content, parsed.definitions)
    // 展示层按标题清理后的完整副本判空，跳过空候选并继续既有回退。
    && (!hasDisplayContent || hasDisplayContent(displaySource(section.content))))
  const normalized = language.toLowerCase()
  const primary = normalized.split('-')[0]
  const selected = sections.find((section) => section.language === normalized)
    ?? sections.find((section) => section.language === primary)
    ?? sections.find((section) => section.language.split('-')[0] === primary)
    ?? sections.find((section) => section.language === 'en')
    ?? sections.find((section) => section.language.startsWith('en-'))
    ?? sections[0]
  if (!selected) return source
  return displaySource(selected.content)
}
