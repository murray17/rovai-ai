import type { ComponentProps } from 'react'
import { SafeMarkdown, type MarkdownCodeProps } from './SafeMarkdown'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'

function DocumentCode({ code, languageName, theme }: MarkdownCodeProps): React.JSX.Element {
  return languageName?.toLowerCase() === 'mermaid'
    ? <MarkdownMermaidBlock source={code} theme={theme} />
    : <MarkdownCodeBlock code={code} languageName={languageName} theme={theme} />
}

/** Document highlighting and message diagrams share the same isolated renderer. */
export function DocumentMarkdown(props: Omit<ComponentProps<typeof SafeMarkdown>, 'mode' | 'CodeBlock' | 'contentComplete'>): React.JSX.Element {
  return <SafeMarkdown {...props} mode="document" CodeBlock={DocumentCode} />
}
