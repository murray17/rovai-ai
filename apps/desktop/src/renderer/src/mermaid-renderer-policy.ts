// Keep the wrapper's original-source admission and Mermaid's own limits equal.
export const MERMAID_MAX_TEXT_SIZE = 50_000
export const MERMAID_MAX_EDGES = 500
export const MERMAID_CHANNEL = 'rovai-mermaid-v1'

export type MermaidPalette = {
  darkMode: boolean
  background: string
  foreground: string
  line: string
  border: string
  fontFamily: string
}
