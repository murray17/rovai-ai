import type { JSX } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function SafeMarkdown({
  children,
  className
}: {
  children: string
  className?: string
}): JSX.Element {
  return (
    <div className={className ? `safe-markdown ${className}` : 'safe-markdown'}>
      <Markdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        skipHtml
        disallowedElements={['img', 'iframe', 'object', 'embed', 'script', 'style']}
        unwrapDisallowed
        components={{
          h1: 'h3',
          h2: 'h3',
          h3: 'h4',
          a({ href, children: linkChildren }) {
            if (!href?.startsWith('https://')) {
              return <code className="markdown-inert-link">{linkChildren}</code>
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
              </a>
            )
          },
          img() {
            return null
          }
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
