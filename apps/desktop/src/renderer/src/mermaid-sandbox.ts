// Classic local assets also satisfy the Web host's inherited script-src 'self'.
// Nothing executes in the host; no-inline keeps CSP-incompatible data URLs out.
import mermaidUrl from 'mermaid/dist/mermaid.min.js?url&no-inline'
import purifierUrl from 'dompurify/dist/purify.min.js?url&no-inline'
import bootstrapUrl from './mermaid-sandbox-entry.js?url&no-inline'
import { MERMAID_CHANNEL, MERMAID_MAX_EDGES, MERMAID_MAX_TEXT_SIZE } from './mermaid-renderer-policy'

const assets = [mermaidUrl, purifierUrl, bootstrapUrl]
let fileScripts: string[] | null = null

export async function sandboxDocument(generation: number): Promise<string> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('')
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  // Opaque file frames cannot read local scripts. Their trusted parent reads the
  // same packaged assets. HTTP hosts use external classic scripts to honor CSP.
  // Cache only completed text. A read that outlives its renderer generation must
  // not hold a later manual retry behind the same unresolved Promise.
  const inline = location.protocol === 'file:' ? fileScripts ?? await Promise.all(assets.map(async url => {
    const response = await fetch(url)
    if (!response.ok) throw new Error('mermaid-asset-load')
    return response.text()
  })) : null
  if (inline) fileScripts = inline
  const script = (index: number, data = '') => inline
    ? `<script nonce="${nonce}" ${data}>${inline[index].replace(/<\/script/giu, '<\\/script')}</script>`
    : `<script nonce="${nonce}" src="${new URL(assets[index], location.href).href.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')}" ${data}></script>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>`
    + script(0) + script(1)
    + script(2, `data-channel="${MERMAID_CHANNEL}" data-generation="${generation}" data-max-text-size="${MERMAID_MAX_TEXT_SIZE}" data-max-edges="${MERMAID_MAX_EDGES}"`)
    + '</body></html>'
}
