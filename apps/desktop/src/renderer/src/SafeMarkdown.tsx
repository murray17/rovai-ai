import { createContext, isValidElement, useContext, useEffect, useState, useLayoutEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly'
import { FILE_REFERENCE_FRAGMENT, FileReferenceLink, type FileReferenceActivation } from './FileReferenceLink'
import { WebLink } from './WebLink'
import { isWebUrl } from '../../web-url'
import { remarkRepairCjkUrlTail } from './remark-repair-cjk-url-tail'
import { parseFileReference } from '../../file-preview-reference'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownCodeFrame } from './MarkdownCodeFrame'
import {
  visitRenderedFileReferences,
  type MarkdownNode
} from './safe-markdown-model'
import type { FilePreviewBinaryContent, FilePreviewOperationResult, ResolvedTheme } from '@contracts'
import { UiText, uiAttribute } from './interface-language'

type MarkdownTreeNode = MarkdownNode

const LeadingMarkdownContentContext = createContext<ReactNode>(null)
const InlineMarkdownContentContext = createContext<Readonly<Record<string, ReactNode>>>({})

function InlineMarkdownContent({ token }: { token: string }): JSX.Element {
  return <>{useContext(InlineMarkdownContentContext)[token]}</>
}

// Placeholders are supplied alongside trusted UI by the caller, never inferred
// from a user's name or an @word in Markdown. The caller excludes both raw and
// decoded-source collisions. Transform rendered text, including code blocks,
// so indentation cannot expose a placeholder instead of the structured UI.
type InlineHtmlNode = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, string>
  children?: InlineHtmlNode[]
}

function rehypeInlineContent({ tokens }: { tokens: string[] }): (tree: InlineHtmlNode) => void {
  return (tree) => {
    if (tokens.length === 0) return
    const tokenSet = new Set(tokens)
    const escapedTokens = tokens.map((token) => Array.from(token, (character) => (
      /[A-Za-z0-9]/u.test(character) ? character : `\\${character}`
    )).join(''))
    const pattern = new RegExp(`(${escapedTokens.join('|')})`, 'gu')
    const visit = (parent: InlineHtmlNode): void => {
      parent.children = parent.children?.flatMap((node) => {
        if (node.type !== 'text' || !node.value) {
          visit(node)
          return [node]
        }
        const parts = node.value.split(pattern)
        if (parts.length === 1) return [node]
        return parts.filter(Boolean).map((value): InlineHtmlNode => tokenSet.has(value)
          ? { type: 'element', tagName: 'span', properties: { 'data-rovai-inline-content': value }, children: [] }
          : { type: 'text', value })
      })
    }
    visit(tree)
  }
}

function LeadingMarkdownContent(): JSX.Element {
  return <>{useContext(LeadingMarkdownContentContext)}</>
}

function rehypeLeadingContent({ enabled, inline }: { enabled: boolean; inline: boolean }): (tree: InlineHtmlNode) => void {
  return (tree) => {
    if (!enabled) return
    const children = tree.children ??= []
    const firstVisible = children.find(node => node.type !== 'text' || node.value?.trim())
    const paragraph: InlineHtmlNode = inline && firstVisible?.tagName === 'p'
      ? firstVisible : { type: 'element', tagName: 'p', properties: {}, children: [] }
    if (paragraph !== firstVisible) children.unshift(paragraph)
    paragraph.properties = { ...paragraph.properties, 'data-rovai-leading-content': 'true' }
  }
}

function markdownHeadingText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(markdownHeadingText).join('')
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return markdownHeadingText(children.props.children)
  }
  return ''
}

type MarkdownHeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

function markdownCodeBlock(children: ReactNode): { code: string; languageName?: string } | null {
  const child = Array.isArray(children) && children.length === 1 ? children[0] : children
  if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return null
  const code = markdownHeadingText(child.props.children)
  const match = /(?:^|\s)language-([^\s]+)/u.exec(child.props.className ?? '')
  return { code, languageName: match?.[1] }
}

function markdownHeadingSlug(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/gu, '-')
}

function scrollToMarkdownHeading(root: HTMLElement, target: string): boolean {
  const normalizedTarget = target.trim().replace(/^#/u, '')
  const targetSlug = markdownHeadingSlug(normalizedTarget)
  const heading = [...root.querySelectorAll<HTMLElement>('[data-markdown-heading]')]
    .find((candidate) => {
      const text = candidate.dataset.markdownHeading ?? ''
      return text === normalizedTarget || markdownHeadingSlug(text) === targetSlug
    })
  heading?.scrollIntoView({ block: 'start' })
  return Boolean(heading)
}

function remarkFileLinks(): (tree: MarkdownTreeNode) => void {
  return (tree) => {
    const visit = (node: MarkdownTreeNode): void => {
      if (node.type === 'link' && node.url && parseFileReference(node.url)) {
        node.url = `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(node.url)}`
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

function rehypeFileLinkSpacing(): (tree: InlineHtmlNode) => void {
  return tree => visitRenderedFileReferences(tree, FILE_REFERENCE_FRAGMENT)
}

export function SafeMarkdown({
  children,
  className,
  onFileReference,
  localImageUrl,
  localImageContent,
  headingTarget,
  onHeadingTargetResult,
  leadingContent,
  inlineContent,
  inlineLeadingContent = true,
  mode = 'message',
  theme = 'day'
}: {
  children: string
  className?: string
  onFileReference?: FileReferenceActivation
  localImageUrl?(rawReference: string): string | null
  localImageContent?(rawReference: string): Promise<FilePreviewOperationResult<FilePreviewBinaryContent>>
  headingTarget?: string
  onHeadingTargetResult?(found: boolean): void
  /** Trusted inline UI, never parsed from the Markdown source. */
  leadingContent?: ReactNode
  /** Collision-free placeholders generated from authoritative structured content. */
  inlineContent?: Readonly<Record<string, ReactNode>>
  inlineLeadingContent?: boolean
  mode?: 'message' | 'document'
  theme?: ResolvedTheme
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onFileReference, onHeadingTargetResult })
  useLayoutEffect(() => {
    callbacks.current = { onFileReference, onHeadingTargetResult }
  }, [onFileReference, onHeadingTargetResult])
  const fileReferencesEnabled = Boolean(onFileReference)
  const hasLeadingContent = leadingContent !== undefined && leadingContent !== null
  const inlineContentKeys = JSON.stringify(Object.keys(inlineContent ?? {}))

  useEffect(() => {
    if (!headingTarget) return undefined
    const frame = window.requestAnimationFrame(() => {
      const root = rootRef.current
      if (root) onHeadingTargetResult?.(scrollToMarkdownHeading(root, headingTarget))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [children, headingTarget, onHeadingTargetResult])

  // Parsing old messages must not be coupled to Composer keystrokes or Runtime
  // deltas. Keep event callbacks fresh without rebuilding the Markdown tree;
  // image projection changes still invalidate it because they change the output.
  // Leading UI reads context so member/profile updates do not reparse Markdown.
  const markdown = useMemo(() => {
    const heading = (Tag: MarkdownHeadingTag) => function MarkdownHeading({ children: headingChildren }: { children?: ReactNode }) {
      const text = markdownHeadingText(headingChildren)
      return <Tag data-markdown-heading={text}>{headingChildren}</Tag>
    }
    const headingComponents = mode === 'document'
      ? {
          h1: heading('h1'),
          h2: heading('h2'),
          h3: heading('h3'),
          h4: heading('h4'),
          h5: heading('h5'),
          h6: heading('h6')
        }
      : {
          h1: heading('h3'),
          h2: heading('h3'),
          h3: heading('h4')
        }
    return (
      <Markdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          remarkCjkFriendly,
          [remarkCjkFriendlyStrikethrough, { singleTilde: false }],
          remarkRepairCjkUrlTail,
          [remarkFileLinks, fileReferencesEnabled]
        ]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitize,
          [rehypeLeadingContent, { enabled: hasLeadingContent, inline: inlineLeadingContent }],
          [rehypeInlineContent, { tokens: JSON.parse(inlineContentKeys) as string[] }],
          [rehypeFileLinkSpacing, fileReferencesEnabled && mode === 'message']
        ]}
        disallowedElements={[
          ...(!localImageUrl && !localImageContent ? ['img'] : []),
          'iframe', 'object', 'embed', 'script', 'style'
        ]}
        unwrapDisallowed
        components={{
          ...headingComponents,
          span({ node, children: spanChildren }) {
            const token = node?.properties['data-rovai-inline-content']
            return typeof token === 'string'
              ? <InlineMarkdownContent token={token} />
              : <span>{spanChildren}</span>
          },
          p({ node, children: paragraphChildren }) {
            const leading = node?.properties['data-rovai-leading-content'] === 'true'
            return (
              <p>
                {leading && <LeadingMarkdownContent />}
                {leading && paragraphChildren ? ' ' : null}
                {paragraphChildren}
              </p>
            )
          },
          pre({ children: preChildren }) {
            const block = markdownCodeBlock(preChildren)
            if (!block) return <pre>{preChildren}</pre>
            return (
              <MarkdownCodeFrame code={inlineContentKeys === '[]' ? block.code : undefined}>
                {mode === 'document'
                  ? <MarkdownCodeBlock code={block.code} languageName={block.languageName} theme={theme} />
                  : <pre>{preChildren}</pre>}
              </MarkdownCodeFrame>
            )
          },
          table({ children: tableChildren }) {
            return mode === 'document'
              ? <div className="markdown-table-scroll"><table>{tableChildren}</table></div>
              : <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label={uiAttribute('表格')}><table>{tableChildren}</table></div>
          },
          a({ href, children: linkChildren, className: linkClassName }) {
            if (href?.startsWith(FILE_REFERENCE_FRAGMENT) && fileReferencesEnabled) {
              let rawReference: string
              try {
                rawReference = decodeURIComponent(href.slice(FILE_REFERENCE_FRAGMENT.length))
              } catch {
                return <code className="markdown-inert-link">{linkChildren}</code>
              }
              if (!parseFileReference(rawReference)) return <code className="markdown-inert-link">{linkChildren}</code>
              return (
                <FileReferenceLink
                  className={['markdown-file-reference', linkClassName].filter(Boolean).join(' ')}
                  rawReference={rawReference}
                  onActivate={(reference, source, target) => callbacks.current.onFileReference?.(reference, source, target)}
                >
                  {markdownHeadingText(linkChildren).trim() ? linkChildren : rawReference}
                </FileReferenceLink>
              )
            }
            if (href?.startsWith('#')) {
              let target = href.slice(1)
              try {
                target = decodeURIComponent(target)
              } catch {
                return <code className="markdown-inert-link">{linkChildren}</code>
              }
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault()
                    const root = rootRef.current
                    if (root) callbacks.current.onHeadingTargetResult?.(scrollToMarkdownHeading(root, target))
                  }}
                >
                  {linkChildren}
                </a>
              )
            }
            if (!href || !isWebUrl(href)) {
              return <code className="markdown-inert-link">{linkChildren}</code>
            }
            return (
              <WebLink className="markdown-web-reference" target={href}>
                <span className="resource-reference-label">{linkChildren}</span>
              </WebLink>
            )
          },
          img({ src, alt }) {
            if ((!localImageUrl && !localImageContent) || !src) return null
            const rawReference = src.startsWith(FILE_REFERENCE_FRAGMENT)
              ? decodeURIComponent(src.slice(FILE_REFERENCE_FRAGMENT.length))
              : src
            if (localImageContent) return <LocalMarkdownImage reference={rawReference} alt={alt ?? ''} read={localImageContent} />
            const safeUrl = localImageUrl?.(rawReference)
            return safeUrl ? <img src={safeUrl} alt={alt ?? ''} loading="lazy" /> : null
          }
        }}
        urlTransform={defaultUrlTransform}
      >
        {children}
      </Markdown>
    )
  }, [children, fileReferencesEnabled, localImageUrl, localImageContent, hasLeadingContent, inlineLeadingContent, inlineContentKeys, mode, theme])

  return (
    <LeadingMarkdownContentContext.Provider value={leadingContent}>
      <InlineMarkdownContentContext.Provider value={inlineContent ?? {}}>
        <div
          ref={rootRef}
          className={[
            'safe-markdown',
            mode === 'document' ? 'is-document' : '',
            className ?? ''
          ].filter(Boolean).join(' ')}
        >
          {markdown}
        </div>
      </InlineMarkdownContentContext.Provider>
    </LeadingMarkdownContentContext.Provider>
  )
}

function LocalMarkdownImage({ reference, alt, read }: {
  reference: string; alt: string
  read(reference: string): Promise<FilePreviewOperationResult<FilePreviewBinaryContent>>
}): React.JSX.Element {
  const root = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let active = true
    let objectUrl: string | null = null
    setUrl(null); setFailed(false)
    void read(reference).then(result => {
      if (!active) return
      if (!result.ok) { setFailed(true); return }
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.value.bytes)], { type: result.value.mime }))
      setUrl(objectUrl)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [reference, read, visible])
  return <span ref={root}>{url ? <img src={url} alt={alt} loading="lazy" /> : failed ? <span role="status">{alt ||uiAttribute("图片")}<UiText zh={"（暂不可读）"} /></span> : <span>{alt ||uiAttribute("图片")}</span>}</span>
}
