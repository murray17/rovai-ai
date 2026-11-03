import type { ComponentProps } from 'react'
import type { ResolvedTheme } from '@contracts'
import { SafeMarkdown, type MarkdownCodeProps } from './SafeMarkdown'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'

function MessageCode({ code, languageName, theme, renderReady, children }: MarkdownCodeProps): React.JSX.Element {
  return languageName?.toLowerCase() === 'mermaid'
    ? <MarkdownMermaidBlock source={code} theme={theme} renderReady={renderReady} />
    : <pre>{children}</pre>
}

/** Only assistant body entry points opt in; ordinary Markdown remains lightweight. */
export function MessageMarkdown(props: Omit<ComponentProps<typeof SafeMarkdown>, 'mode' | 'CodeBlock'> & { theme: ResolvedTheme }): React.JSX.Element {
  return <SafeMarkdown {...props} CodeBlock={MessageCode} />
}
