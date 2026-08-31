import { isValidElement, useEffect, useLayoutEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FILE_REFERENCE_FRAGMENT, FileReferenceLink } from './FileReferenceLink'
import {
  isInlineFileReference,
  parseFileReference,
  tokenizeFileReferences
} from '../../file-preview-reference'

type MarkdownTreeNode = {
  type?: string
  value?: string
  children?: MarkdownTreeNode[]
  url?: string
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
    const visit = (node: MarkdownTreeNode): void => {
      if (!Array.isArray(node.children)) return
      const next: MarkdownTreeNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || typeof child.value !== 'string') {
          if (child.type === 'link' && typeof child.url === 'string' && parseFileReference(child.url)) {
            next.push({ ...child, url: `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(child.url)}` })
            continue
          }
          if (
            child.type === 'inlineCode'
            && typeof child.value === 'string'
            && isInlineFileReference(child.value)
          ) {
            next.push({
              type: 'link',
              url: `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(child.value)}`,
              children: [{ type: 'inlineCode', value: child.value }]
            })
            continue
          }
          if (child.type !== 'link' && child.type !== 'inlineCode' && child.type !== 'code') visit(child)
          next.push(child)
          continue
        }
        const tokens = tokenizeFileReferences(child.value)
        if (tokens.length === 0) {
          next.push(child)
          continue
        }
        let offset = 0
        for (const token of tokens) {
          if (token.start > offset) next.push({ type: 'text', value: child.value.slice(offset, token.start) })
          next.push({
            type: 'link',
            url: `${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(token.raw)}`,
            children: [{ type: 'text', value: token.raw }]
          })
          offset = token.end
        }
        if (offset < child.value.length) next.push({ type: 'text', value: child.value.slice(offset) })
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
  onHeadingTargetResult
}: {
  children: string
  className?: string
  onFileReference?(rawReference: string): void
  localImageUrl?(rawReference: string): string | null
  headingTarget?: string
  onHeadingTargetResult?(found: boolean): void
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onFileReference, onHeadingTargetResult })
  useLayoutEffect(() => {
    callbacks.current = { onFileReference, onHeadingTargetResult }
  }, [onFileReference, onHeadingTargetResult])
  const fileReferencesEnabled = Boolean(onFileReference)

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
  const markdown = useMemo(() => {
    const heading = (Tag: 'h3' | 'h4') => function MarkdownHeading({ children: headingChildren }: { children?: ReactNode }) {
      const text = markdownHeadingText(headingChildren)
      return <Tag data-markdown-heading={text}>{headingChildren}</Tag>
    }

    return (
      <Markdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          ...(fileReferencesEnabled ? [remarkFileReferences] : [])
        ]}
        skipHtml
        disallowedElements={[
          ...(!localImageUrl ? ['img'] : []),
          'iframe', 'object', 'embed', 'script', 'style'
        ]}
        unwrapDisallowed
        components={{
          h1: heading('h3'),
          h2: heading('h3'),
          h3: heading('h4'),
          a({ href, children: linkChildren }) {
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
                  onActivate={(reference) => callbacks.current.onFileReference?.(reference)}
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
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
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
  }, [children, fileReferencesEnabled, localImageUrl])

  return (
    <div ref={rootRef} className={className ? `safe-markdown ${className}` : 'safe-markdown'}>
      {markdown}
    </div>
  )
}
