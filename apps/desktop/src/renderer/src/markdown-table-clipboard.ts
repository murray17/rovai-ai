const TABLE_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'BR', 'P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'A'])

/** Copy the rendered, sanitized table without application controls or private attributes. */
export function createTableClipboardData(table: HTMLTableElement): { text: string; html: string } {
  const document = table.ownerDocument
  const project = (source: Node, parent: Node): void => {
    if (source.nodeType === 3) {
      parent.appendChild(document.createTextNode(source.textContent ?? ''))
      return
    }
    if (source.nodeType !== 1) return
    const element = source as Element
    if (element.matches('[data-quote-exclude], [data-file-find-exclude], [aria-hidden="true"], script, style')) return
    const target = TABLE_TAGS.has(element.tagName)
      ? document.createElement(element.tagName.toLowerCase()) : document.createDocumentFragment()
    if (target.nodeType === 1) {
      const copy = target as HTMLElement
      if (element.matches('th, td')) {
        for (const attribute of ['colspan', 'rowspan']) {
          const value = element.getAttribute(attribute)
          if (value !== null) copy.setAttribute(attribute, value)
        }
        const alignment = element.getAttribute('align') ?? (element as HTMLElement).style.textAlign
        if (['left', 'center', 'right'].includes(alignment)) copy.setAttribute('align', alignment)
      }
      const href = element.tagName === 'A' ? element.getAttribute('href') : null
      if (href && /^https?:\/\//iu.test(href)) copy.setAttribute('href', href)
    }
    element.childNodes.forEach(child => project(child, target))
    parent.appendChild(target)
  }
  const fragment = document.createDocumentFragment()
  project(table, fragment)
  const copy = fragment.firstElementChild as HTMLTableElement
  const cellText = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? ''
    if (node.nodeName === 'BR') return '\n'
    const text = Array.from(node.childNodes, cellText).join('')
    return ['P', 'LI'].includes(node.nodeName) ? `${text}\n` : text
  }
  const quoteCell = (text: string): string => /[\t\n\r"]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"` : text
  return {
    text: Array.from(copy.rows, row => Array.from(row.cells, cell => quoteCell(cellText(cell).trim())).join('\t')).join('\n'),
    html: copy.outerHTML
  }
}
