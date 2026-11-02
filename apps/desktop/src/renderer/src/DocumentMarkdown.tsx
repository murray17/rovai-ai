import type { ComponentProps } from 'react'
import { SafeMarkdown, type MarkdownDocumentCodeProps } from './SafeMarkdown'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'

function DocumentCode({ code, languageName, theme }: MarkdownDocumentCodeProps): React.JSX.Element {
  return languageName?.toLowerCase() === 'mermaid'
    ? <MarkdownMermaidBlock source={code} theme={theme} />
    : <MarkdownCodeBlock code={code} languageName={languageName} theme={theme} />
}

/** The document entry owns syntax highlighting and diagrams; messages do not import them. */
export function DocumentMarkdown(props: Omit<ComponentProps<typeof SafeMarkdown>, 'mode' | 'DocumentCode'>): React.JSX.Element {
  return <SafeMarkdown {...props} mode="document" DocumentCode={DocumentCode} />
}
