import type { Code, Root } from 'mdast'
import type { Plugin } from 'unified'

export type MermaidCode = { source: string; fenceClosed: boolean }
export type MermaidBlocks = Map<number, MermaidCode>

/** Observe the existing parser's fence tokens, including container/indent rules.
 * Metadata stays out of HTML and is joined by source position after sanitizing. */
export const remarkMermaidFences: Plugin<[{ blocks: MermaidBlocks }], Root> = function ({ blocks }) {
  const fences = new WeakMap<Code, number[]>()
  const data = this.data()
  const extensions = data.fromMarkdownExtensions ??= []
  extensions.push({ exit: {
    codeFencedFenceSequence(token) {
      const node = this.stack.findLast(node => node.type === 'code') as Code | undefined
      if (!node) return
      const ends = fences.get(node) ?? []
      ends.push(token.end.offset)
      fences.set(node, ends)
    }
  } })
  return (tree, file) => {
    blocks.clear()
    const source = String(file.value)
    const visit = (node: Root | Root['children'][number]): void => {
      if (node.type === 'code' && node.lang?.toLowerCase() === 'mermaid') {
        const start = node.position?.start.offset
        const closing = fences.get(node)?.[1]
        if (start !== undefined) blocks.set(start, {
          source: node.value,
          // A fence at a temporary EOF may still receive non-whitespace text.
          fenceClosed: closing !== undefined && /^[\t ]*(?:\r\n|\r|\n)/u.test(source.slice(closing))
        })
      }
      if ('children' in node) for (const child of node.children) visit(child as Root['children'][number])
    }
    visit(tree)
  }
}
