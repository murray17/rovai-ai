import { createContext, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FILE_REFERENCE_FRAGMENT, FileReferenceLink, type FileReferenceActivation } from './FileReferenceLink'
import { ResourceReferenceIcon } from './FilePreviewTabIcon'
import { remarkRepairCjkUrlTail } from './remark-repair-cjk-url-tail'
import {
  inlineFileReferenceSource,
  isInlineFileReference,
  parseFileReference
} from '../../file-preview-reference'

type MarkdownTreeNode = {
  type?: string
  value?: string
  children?: MarkdownTreeNode[]
  url?: string
  data?: { hProperties?: Record<string, string> }
}

const LeadingMarkdownContentContext = createContext<ReactNode>(null)

function LeadingMarkdownContent(): JSX.Element {
  return <>{useContext(LeadingMarkdownContentContext)}</>
}

function remarkLeadingContent({ enabled, inline }: { enabled: boolean; inline: boolean }): (tree: MarkdownTreeNode) => void {
  return (tree) => {
    if (!enabled) return
    const children = tree.children ??= []
    const firstBlock = children.find((node) => !['definition', 'footnoteDefinition'].includes(node.type ?? ''))
    const paragraph = inline && firstBlock?.type === 'paragraph'
      ? firstBlock
      : { type: 'paragraph', children: [] }
    if (paragraph !== firstBlock) children.unshift(paragraph)
    paragraph.data = {
      ...paragraph.data,
      hProperties: { ...paragraph.data?.hProperties, 'data-rovai-leading-content': 'true' }
    }
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

function remarkFileReferences(): (tree: MarkdownTreeNode) => void {
  return (tree) => {
    const candidates: string[] = []
    const collect = (node: MarkdownTreeNode): void => {
      if (node.type === 'link') {
        if (node.url && parseFileReference(node.url)) candidates.push(node.url)
      } else if (node.type === 'inlineCode') {
        if (node.value && isInlineFileReference(node.value)) candidates.push(node.value)
      } else if (!['code', 'html', 'definition', 'image', 'imageReference', 'linkReference'].includes(node.type ?? '')) {
        node.children?.forEach(collect)
      }
    }
    collect(tree)
    const visit = (node: MarkdownTreeNode): void => {
      if (!Array.isArray(node.children)) return
      const next: MarkdownTreeNode[] = []
      for (const child of node.children) {
        if (child.type === 'link' && typeof child.url === 'string' && parseFileReference(child.url)) {
          next.push({ ...child, url: `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(child.url)}` })
          continue
        }
        if (
          child.type === 'inlineCode'
          && typeof child.value === 'string'
          && inlineFileReferenceSource(child.value, candidates) !== null
        ) {
          const sourceReference = inlineFileReferenceSource(child.value, candidates)!
          next.push({
            type: 'link',
            url: `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(child.value)}`,
            ...(sourceReference !== child.value
              ? { data: { hProperties: { 'data-file-source-reference': sourceReference } } } : {}),
            children: [{ type: 'inlineCode', value: child.value }]
          })
          continue
        }
        if (child.type !== 'link' && child.type !== 'inlineCode' && child.type !== 'code') visit(child)
        next.push(child)
      }
      node.children = next
    }
    visit(tree)
  }
}

export function SafeMarkdown({
  children,
  className,
  onFileReference,
  localImageUrl,
  headingTarget,
  onHeadingTargetResult,
  leadingContent,
  inlineLeadingContent = true
}: {
  children: string
  className?: string
  onFileReference?: FileReferenceActivation
  localImageUrl?(rawReference: string): string | null
  headingTarget?: string
  onHeadingTargetResult?(found: boolean): void
  /** Trusted inline UI, never parsed from the Markdown source. */
  leadingContent?: ReactNode
  inlineLeadingContent?: boolean
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onFileReference, onHeadingTargetResult })
  useLayoutEffect(() => {
    callbacks.current = { onFileReference, onHeadingTargetResult }
  }, [onFileReference, onHeadingTargetResult])
  const fileReferencesEnabled = Boolean(onFileReference)
  const hasLeadingContent = leadingContent !== undefined && leadingContent !== null

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
    const heading = (Tag: 'h3' | 'h4') => function MarkdownHeading({ children: headingChildren }: { children?: ReactNode }) {
      const text = markdownHeadingText(headingChildren)
      return <Tag data-markdown-heading={text}>{headingChildren}</Tag>
    }

    return (
      <Markdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          remarkRepairCjkUrlTail,
          ...(fileReferencesEnabled ? [remarkFileReferences] : []),
          [remarkLeadingContent, { enabled: hasLeadingContent, inline: inlineLeadingContent }]
        ]}
        skipHtml
        disallowedElements={[
          ...(!localImageUrl ? ['img'] : []),
          'iframe', 'object', 'embed', 'script', 'style'
        ]}
        unwrapDisallowed
        components={{
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
          h1: heading('h3'),
          h2: heading('h3'),
          h3: heading('h4'),
          a({ href, children: linkChildren, node }) {
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
                  className="markdown-file-reference"
                  rawReference={rawReference}
                  sourceReference={typeof node?.properties['data-file-source-reference'] === 'string'
                    ? node.properties['data-file-source-reference'] : undefined}
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
            if (!href?.startsWith('https://')) {
              return <code className="markdown-inert-link">{linkChildren}</code>
            }
            return (
              <a className="markdown-web-reference" href={href} target="_blank" rel="noreferrer noopener">
                <ResourceReferenceIcon kind="web" className="resource-reference-icon web-reference-icon" />
                <span className="resource-reference-label">{linkChildren}</span>
              </a>
            )
          },
          img({ src, alt }) {
            if (!localImageUrl || !src) return null
            const rawReference = src.startsWith(FILE_REFERENCE_FRAGMENT)
              ? decodeURIComponent(src.slice(FILE_REFERENCE_FRAGMENT.length))
              : src
            const safeUrl = localImageUrl(rawReference)
            return safeUrl ? <img src={safeUrl} alt={alt ?? ''} loading="lazy" /> : null
          }
        }}
        urlTransform={(url) => {
          if (fileReferencesEnabled && parseFileReference(url)) {
            return `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(url)}`
          }
          return defaultUrlTransform(url)
        }}
      >
        {children}
      </Markdown>
    )
  }, [children, fileReferencesEnabled, localImageUrl, hasLeadingContent, inlineLeadingContent])

  return (
    <LeadingMarkdownContentContext.Provider value={leadingContent}>
      <div ref={rootRef} className={className ? `safe-markdown ${className}` : 'safe-markdown'}>
        {markdown}
      </div>
    </LeadingMarkdownContentContext.Provider>
  )
}
