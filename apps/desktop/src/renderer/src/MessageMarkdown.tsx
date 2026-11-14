import { useContext, useDeferredValue, type ComponentProps, type ReactNode } from 'react'
import { MessageExportContext } from './message-export-context'
import type { ResolvedTheme } from '@contracts'
import { SafeMarkdown, type MarkdownCodeProps } from './SafeMarkdown'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'
import { uiAttribute } from './interface-language'

function MessageCode({ code, languageName, theme, renderReady, children }: MarkdownCodeProps): React.JSX.Element {
  return languageName?.toLowerCase() === 'mermaid'
    ? <MarkdownMermaidBlock source={code} theme={theme} renderReady={renderReady} />
    : <pre>{children}</pre>
}

/** Only assistant body entry points opt in; ordinary Markdown remains lightweight. */
export function MessageMarkdown(props: Omit<ComponentProps<typeof SafeMarkdown>, 'mode' | 'CodeBlock'> & { theme: ResolvedTheme }): React.JSX.Element {
  const exporting = useContext(MessageExportContext)
  const body = <SafeMarkdown {...props} CodeBlock={exporting ? undefined : MessageCode} />
  return !exporting && props.children.length > 12_000 ? <DeferredMessageBody>{body}</DeferredMessageBody> : body
}

// Initial large bodies enter a concurrent render: React can yield between
// blocks while the already mounted composer handles input. Export stays full
// and synchronous. Parsing and DOM commit remain indivisible on the main
// thread; React can yield while constructing the intervening component tree.
function DeferredMessageBody({ children }: { children: ReactNode }): React.JSX.Element {
  const ready = useDeferredValue(true, false)
  return ready ? <>{children}</> : <div className="safe-markdown" data-timeline-pending aria-busy="true" role="status">
    {uiAttribute('正在加载…')}
  </div>
}
