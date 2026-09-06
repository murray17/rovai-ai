import {
  defaultHighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  type HighlightStyle,
  type LanguageSupport
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { search, searchKeymap } from '@codemirror/search'
import { EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { highlightCode } from '@lezer/highlight'
import { oneDarkHighlightStyle } from '@uiw/react-codemirror'
import { StyleModule } from 'style-mod'
import type { FileLocationTarget, ResolvedTheme } from '@contracts'

const SOURCE_FONT_FAMILY = [
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  'monospace'
].join(', ')

const languageLoads = new WeakMap<LanguageDescription, Promise<LanguageSupport | null>>()

const sourceReaderInterface = {
  '&': {
    height: '100%',
    color: 'var(--ink)',
    backgroundColor: 'var(--conversation-surface)'
  },
  '&.cm-focused': {
    outline: '2px solid var(--focus)',
    outlineOffset: '-2px'
  },
  '.cm-scroller': {
    overflow: 'auto',
    overflowAnchor: 'none',
    overscrollBehavior: 'contain',
    backgroundColor: 'var(--conversation-surface)',
    fontFamily: SOURCE_FONT_FAMILY,
    fontSize: '14px',
    fontWeight: '400',
    lineHeight: '1.6'
  },
  '.cm-content': {
    minWidth: 'max-content',
    padding: '14px 0 28px',
    caretColor: 'var(--focus)'
  },
  '.cm-line': {
    padding: '0 18px 0 12px'
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--line)',
    color: 'var(--faint)',
    backgroundColor: 'var(--conversation-surface)'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '52px',
    padding: '0 10px 0 8px'
  },
  '.cm-content ::selection': {
    color: 'inherit',
    backgroundColor: 'var(--focus-soft)'
  },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--focus-soft) !important'
  },
  '.cm-searchMatch': {
    color: 'inherit',
    backgroundColor: 'var(--conversation-find-match)',
    outline: 'none'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--conversation-find-current)',
    boxShadow: 'inset 0 -1px var(--conversation-find-line)'
  },
  '.cm-location-target': {
    backgroundColor: 'var(--info-soft)',
    boxShadow: 'inset 2px 0 var(--info)'
  },
  '.cm-panels': {
    color: 'var(--muted)',
    backgroundColor: 'var(--surface-raised)'
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--line-strong)'
  },
  '.cm-panel.cm-search': {
    padding: '7px 34px 7px 10px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
    fontSize: '11px',
    lineHeight: '1.4'
  },
  '.cm-panel.cm-search input': {
    height: '27px',
    padding: '0 7px',
    border: '1px solid var(--control-line)',
    borderRadius: '5px',
    color: 'var(--ink)',
    backgroundColor: 'var(--input)'
  },
  '.cm-panel.cm-search input:focus-visible': {
    outline: '2px solid var(--focus)',
    outlineOffset: '1px'
  },
  '.cm-panel.cm-search button': {
    minHeight: '27px',
    padding: '0 7px',
    border: '1px solid var(--line)',
    borderRadius: '5px',
    color: 'var(--muted)',
    backgroundColor: 'var(--surface-subtle)',
    backgroundImage: 'none',
    fontSize: '11px'
  },
  '.cm-panel.cm-search button:hover': {
    color: 'var(--ink)',
    backgroundColor: 'var(--surface-hover)'
  },
  '.cm-panel.cm-search [name=close]': {
    top: '7px',
    right: '8px',
    border: '0',
    backgroundColor: 'transparent'
  },
  '.cm-panel.cm-search label': {
    color: 'var(--faint)',
    fontSize: '10px'
  }
} as const

const sourceReaderThemes: Record<ResolvedTheme, Extension> = {
  day: EditorView.theme(sourceReaderInterface, { dark: false }),
  night: EditorView.theme(sourceReaderInterface, { dark: true })
}

const targetLineDecoration = Decoration.line({
  class: 'cm-location-target',
  attributes: { 'data-file-location-target': 'true' }
})

function loadLanguage(description: LanguageDescription | null): Promise<LanguageSupport | null> {
  if (!description) return Promise.resolve(null)
  const existing = languageLoads.get(description)
  if (existing) return existing
  const pending = description.load().catch(() => null)
  languageLoads.set(description, pending)
  return pending
}

export function sourceLanguageForFilename(filename: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, filename)
}

export function sourceLanguageForName(languageName: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, languageName)
}

export function loadSourceLanguageForFilename(filename: string): Promise<LanguageSupport | null> {
  return loadLanguage(sourceLanguageForFilename(filename))
}

export function loadSourceLanguageForName(languageName: string): Promise<LanguageSupport | null> {
  return loadLanguage(sourceLanguageForName(languageName))
}

export function sourceSyntaxHighlightStyle(theme: ResolvedTheme): HighlightStyle {
  return theme === 'night' ? oneDarkHighlightStyle : defaultHighlightStyle
}

export function sourceCodeMirrorTheme(theme: ResolvedTheme): 'light' | 'dark' {
  return theme === 'night' ? 'dark' : 'light'
}

export function mountSourceSyntaxHighlightStyle(theme: ResolvedTheme, root: Document | ShadowRoot): void {
  const module = sourceSyntaxHighlightStyle(theme).module
  if (module) StyleModule.mount(root, module)
}

export function sourceLineNumber(startLine: number, localLine: number): string {
  return String(Math.max(1, Math.trunc(startLine)) + localLine - 1)
}

export function sourceTargetLocalLines(
  startLine: number,
  lineCount: number,
  target?: FileLocationTarget
): { from: number; to: number } | null {
  if (!target?.line || target.line < 1 || lineCount < 1) return null
  const pageStart = Math.max(1, Math.trunc(startLine))
  const targetStart = Math.trunc(target.line)
  const targetEnd = Math.max(targetStart, Math.trunc(target.endLine ?? targetStart))
  const from = Math.max(1, targetStart - pageStart + 1)
  const to = Math.min(lineCount, targetEnd - pageStart + 1)
  return from <= to ? { from, to } : null
}

function sourceTargetExtension(startLine: number, target?: FileLocationTarget): Extension {
  const decorations = (state: EditorState): DecorationSet => {
    const local = sourceTargetLocalLines(startLine, state.doc.lines, target)
    if (!local) return Decoration.none
    const ranges = []
    for (let line = local.from; line <= local.to; line += 1) {
      ranges.push(targetLineDecoration.range(state.doc.line(line).from))
    }
    return Decoration.set(ranges)
  }

  return StateField.define<DecorationSet>({
    create: decorations,
    update: (value, transaction) => (transaction.docChanged ? decorations(transaction.state) : value),
    provide: (field) => EditorView.decorations.from(field)
  })
}

export function sourceReaderExtensions({
  ariaLabel,
  language,
  startLine,
  target,
  theme
}: {
  ariaLabel: string
  language: LanguageSupport | null
  startLine: number
  target?: FileLocationTarget
  theme: ResolvedTheme
}): Extension[] {
  return [
    lineNumbers({ formatNumber: (line) => sourceLineNumber(startLine, line) }),
    search({ top: true }),
    keymap.of(searchKeymap),
    EditorState.tabSize.of(2),
    EditorState.phrases.of({
      Find: '查找',
      next: '下一个',
      previous: '上一个',
      all: '全部',
      'match case': '区分大小写',
      regexp: '正则表达式',
      'by word': '全字匹配',
      close: '关闭',
      'current match': '当前匹配',
      'on line': '位于行'
    }),
    EditorView.contentAttributes.of({
      'aria-label': ariaLabel,
      tabindex: '0'
    }),
    sourceReaderThemes[theme],
    syntaxHighlighting(sourceSyntaxHighlightStyle(theme), { fallback: true }),
    sourceTargetExtension(startLine, target),
    ...(language ? [language] : [])
  ]
}

export interface HighlightedSourceSegment {
  text: string
  className?: string
}

export function highlightSourceCode(
  code: string,
  language: LanguageSupport,
  theme: ResolvedTheme
): HighlightedSourceSegment[] {
  const segments: HighlightedSourceSegment[] = []
  try {
    highlightCode(
      code,
      language.language.parser.parse(code),
      sourceSyntaxHighlightStyle(theme),
      (text, className) => segments.push(className ? { text, className } : { text }),
      () => segments.push({ text: '\n' })
    )
  } catch {
    return [{ text: code }]
  }
  return segments.length > 0 ? segments : [{ text: code }]
}
