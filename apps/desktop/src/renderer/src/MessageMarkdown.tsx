import { useContext, type ComponentProps } from 'react'
import { MessageExportContext } from './message-export-context'
import type { ResolvedTheme } from '@contracts'
import { SafeMarkdown, type MarkdownCodeProps } from './SafeMarkdown'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'

function MessageCode({ code, languageName, theme, renderReady, children }: MarkdownCodeProps): React.JSX.Element {
  return languageName?.toLowerCase() === 'mermaid'
    ? <MarkdownMermaidBlock source={code} theme={theme} renderReady={renderReady} />
    : <pre>{children}</pre>
}

/** Conversation and execution entry points opt in; general Markdown stays lightweight. */
export function MessageMarkdown(props: Omit<ComponentProps<typeof SafeMarkdown>, 'mode' | 'CodeBlock'> & { theme: ResolvedTheme }): React.JSX.Element {
  const exporting = useContext(MessageExportContext)
  return <SafeMarkdown {...props} CodeBlock={exporting ? undefined : MessageCode} />
}
