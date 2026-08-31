type MarkdownNode = {
  type?: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const CJK_BOUNDARY = /[。．，、？！：；（）【】「」『』〈〉《》]/u
const CLOSING_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function webUrlEnd(label: string): number | null {
  if (!/^(?:https?:\/\/|www\.)/iu.test(label)) return null
  let end = label.search(CJK_BOUNDARY)
  if (end < 0) return null
  while (end > 0) {
    const last = label[end - 1]
    if (/[.,;:!?]/u.test(last)) {
      // Query and fragment punctuation can be data; do not trim it speculatively.
      if (/[?#]/u.test(label.slice(0, end))) break
      end -= 1
      continue
    }
    const opening = CLOSING_PAIRS[last]
    if (!opening) break
    const prefix = label.slice(0, end)
    if (prefix.split(last).length <= prefix.split(opening).length) break
    end -= 1
  }
  try {
    const prefix = label.slice(0, end)
    const url = new URL(/^www\./iu.test(prefix) ? `http://${prefix}` : prefix)
    return url.hostname ? end : null
  } catch {
    return null
  }
}

// Repair the AST rather than only href: the swallowed punctuation and prose must
// remain visible text, including while an incomplete streamed message is reparsed.
export function remarkRepairCjkUrlTail(): (tree: MarkdownNode) => void {
  return function visit(node): void {
    if (!node.children || ['code', 'inlineCode', 'html'].includes(node.type ?? '')) return
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'link') {
        visit(child)
        return [child]
      }
      const label = child.children?.length === 1 && child.children[0].type === 'text'
        ? child.children[0].value : undefined
      if (typeof label !== 'string' || typeof child.url !== 'string') return [child]
      const wwwPrefix = /^www\./iu.test(label) && child.url === `http://${label}` ? 'http://' : ''
      if (child.url !== `${wwwPrefix}${label}`) return [child]
      const end = webUrlEnd(label)
      if (end === null) return [child]
      return [
        { ...child, url: `${wwwPrefix}${label.slice(0, end)}`, children: [{ type: 'text', value: label.slice(0, end) }] },
        { type: 'text', value: label.slice(end) }
      ]
    })
  }
}
