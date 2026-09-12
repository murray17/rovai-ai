import { parse, type DefaultTreeAdapterMap } from 'parse5'

export interface HtmlInjectionMap { line: number; column: number; length: number }

/** Insert one blocking diagnostic script, without serializing the author's DOM
 * or moving their scripts. No newlines are inserted into the original document. */
export function injectPreviewScript(html: string, scriptPath: string): { html: string; map: HtmlInjectionMap } {
  const tree = parse(html, { sourceCodeLocationInfo: true })
  let head: number | undefined, htmlStart: number | undefined, doctype = 0, firstScript = Infinity
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node) {
      if (node.tagName === 'head') head = node.sourceCodeLocation?.startTag?.endOffset
      if (node.tagName === 'html') htmlStart = node.sourceCodeLocation?.startTag?.endOffset
      if (node.tagName === 'script') firstScript = Math.min(firstScript, node.sourceCodeLocation?.startOffset ?? Infinity)
    }
    if (node.nodeName === '#documentType') doctype = node.sourceCodeLocation?.endOffset ?? 0
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(tree)
  const offset = Math.min(head ?? htmlStart ?? doctype, firstScript)
  const prefix = html.slice(0, offset)
  const tag = `<script src="${scriptPath}" data-rovai-preview-diagnostic></script>`
  return { html: prefix + tag + html.slice(offset), map: {
    line: prefix.split(/\r\n|\r|\n/u).length, column: (prefix.match(/[^\r\n]*$/u)?.[0].length ?? 0) + 1, length: tag.length
  } }
}

export function originalPreviewPosition(map: HtmlInjectionMap, line: number | null, column: number | null): { line: number | null; column: number | null } {
  if (line !== map.line || column === null || column < map.column) return { line, column }
  if (column < map.column + map.length) return { line: null, column: null }
  return { line, column: column - map.length }
}
