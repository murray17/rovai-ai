import type { ThreadMessageView, StructuredThreadMessageContent, AgentRunImageView } from '@contracts'
import DOMPurify from 'dompurify'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, RootContent } from 'mdast'

export type MessageExportFormat = 'html' | 'png' | 'markdown'
export type MessageExportOptions = { avatars: boolean; authors: boolean; times: boolean; recipients: boolean }
export const defaultMessageExportOptions = (format: MessageExportFormat): MessageExportOptions => ({
  avatars: format !== 'markdown', authors: true, times: true, recipients: true
})
export type MessageExportEntry = {
  message: ThreadMessageView; author: string; avatarRef: string | null; recipients: string[]
  markdown: string; reply: string | null; excerpt?: string; runtimeImages?: AgentRunImageView[]; avatarDataUrl?: string | null
}
export function exportableMessages(messages: readonly ThreadMessageView[]): ThreadMessageView[] {
  return messages.filter(m => !m.withdrawn && !m.id.startsWith('optimistic:') && !m.missionStart
    && ['user', 'agent', 'external_principal'].includes(m.authorType)).sort((a, b) => a.sequence - b.sequence)
}
export function toggleExportSelection(ids: ReadonlySet<string>, messages: readonly ThreadMessageView[], id: string, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(ids), selecting = !ids.has(id)
  const start = messages.findIndex(m => m.id === anchor), end = messages.findIndex(m => m.id === id)
  if (end < 0) return next
  const targets = range && start >= 0 ? messages.slice(Math.min(start, end), Math.max(start, end) + 1) : [messages[end]]
  targets.forEach(m => selecting ? next.add(m.id) : next.delete(m.id))
  return next
}
export const literalMarkdown = (text: string): string => text.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1')
const markdownParser = unified().use(remarkParse)
/** Project internal/file links as text without rewriting fences or ordinary web links. */
function staticReferenceMarkdown(source: string): string {
  const tree = markdownParser.parse(source) as Root
  const definitions = new Map(tree.children.flatMap(n => n.type === 'definition' ? [[n.identifier, n.url]] as const : []))
  const edits: { from: number; to: number; text: string }[] = []
  const label = (node: RootContent): string => 'children' in node ? node.children.map(child => label(child as RootContent)).join('') : 'value' in node ? node.value : 'alt' in node ? node.alt ?? '' : ''
  const visit = (node: RootContent): void => {
    const url = node.type === 'link' || node.type === 'definition' ? node.url : node.type === 'linkReference' || node.type === 'imageReference' ? definitions.get(node.identifier) : undefined
    if (url !== undefined && !/^https?:\/\//i.test(url) && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      edits.push({ from: node.position.start.offset, to: node.position.end.offset, text: node.type === 'definition' ? '' : literalMarkdown(node.type === 'imageReference' ? `图片：${node.alt ?? ''}（${url}）` : label(node)) })
    } else if ('children' in node) node.children.forEach(child => visit(child as RootContent))
  }
  tree.children.forEach(visit)
  for (const edit of edits.sort((a, b) => b.from - a.from)) source = source.slice(0, edit.from) + edit.text + source.slice(edit.to)
  return source
}
export function exportMessageMarkdown(body: string, content: StructuredThreadMessageContent | null, names: ReadonlyMap<string, string>, currentUser: string): string {
  if (!content?.length) return staticReferenceMarkdown(body)
  return staticReferenceMarkdown(content.map(s => {
    if (s.kind === 'text') return s.text
    if (s.kind === 'member_mention') return literalMarkdown('@' + (names.get(s.agentId) ?? '不可用队员'))
    if (s.kind === 'current_user_mention') return literalMarkdown('@' + currentUser)
    if (s.kind === 'all_members_mention') return '@所有队员'
    if (s.kind === 'skill_mention') return literalMarkdown('/' + s.nameAtSend)
    if (s.kind === 'thread_reference' || s.kind === 'mission_reference') return literalMarkdown(s.titleAtSend)
    return '> ' + literalMarkdown(s.senderDisplayName + '：' + s.body).replaceAll('\n', '\n> ')
      + s.attachmentSummaries.map(a => '\n> ' + literalMarkdown(a.name)).join('')
  }).join(''))
}
export function messageExportMarkdown(title: string, source: string, entries: readonly MessageExportEntry[], options: MessageExportOptions): string {
  return '# ' + literalMarkdown(title) + '\n\n' + literalMarkdown(source) + '\n\n' + entries.map(e => {
    const heading = [options.authors ? e.author : '', options.times ? e.message.createdAt : ''].filter(Boolean).join(' · ')
    const attachments = e.excerpt !== undefined ? [] : e.message.attachments.map(a => literalMarkdown(
      `${a.previewKind === 'image' ? '图片' : '附件'}：${a.displayName}（${a.mediaType ?? a.kind}${a.byteSize !== null ? `，${a.byteSize} bytes` : ''}）`))
    return [heading ? '### ' + literalMarkdown(heading) : '', e.excerpt !== undefined ? literalMarkdown(e.excerpt) : e.reply ? '> ' + literalMarkdown(e.reply).replaceAll('\n', '\n> ') : '',
      e.excerpt === undefined ? e.markdown : '', ...attachments, ...(e.excerpt === undefined ? (e.runtimeImages ?? []).map(a => literalMarkdown(`图片：${a.displayName}（${a.mediaType}，${a.byteSize} bytes）`)) : []),
      e.excerpt === undefined && options.recipients && e.recipients.length ? '发送给 ' + e.recipients.map(n => literalMarkdown('@' + n)).join('、') : ''
    ].filter(Boolean).join('\n\n')
  }).join('\n\n---\n\n') + '\n'
}
export function exportFilename(title: string, format: MessageExportFormat): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100) || 'Rovai'
  return name + '.' + (format === 'markdown' ? 'md' : format)
}
export function downloadMessageExport(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const rasterDataURL = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i
const readDataURL = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})
/** Snapshot only the export reader. Never walk the timeline, execution cards or application shell. */
export async function snapshotExportDocument(root: HTMLElement, signal?: AbortSignal): Promise<HTMLElement> {
  const deadline = Date.now() + 10_000
  while (root.querySelector('[data-export-pending="true"], .member-avatar--loading') && Date.now() < deadline) {
    signal?.throwIfAborted(); await pause(30)
  }
  signal?.throwIfAborted()
  await Promise.race([document.fonts.ready, pause(2000)])
  const clone = root.cloneNode(true) as HTMLElement
  const originals = [root, ...root.querySelectorAll<HTMLElement>('*')]
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  for (let i = 0; i < originals.length; i++) {
    signal?.throwIfAborted()
    const from = originals[i], to = copies[i], style = getComputedStyle(from)
    for (const key of style) {
      const value = style.getPropertyValue(key)
      if (!key.startsWith('--') && !value.includes('url(') && !key.startsWith('animation') && !key.startsWith('transition')) to.style.setProperty(key, value)
    }
    for (const attr of [...to.attributes]) {
      if (attr.name.startsWith('on') || attr.name.startsWith('data-') || ['id', 'tabindex', 'title', 'aria-controls', 'aria-describedby', 'aria-haspopup', 'aria-expanded', 'srcset', 'srcdoc'].includes(attr.name)) to.removeAttribute(attr.name)
    }
    if (['button', 'link'].includes(to.getAttribute('role') ?? '')) to.removeAttribute('role')
    if (from instanceof HTMLImageElement) {
      try {
        await Promise.race([from.decode(), pause(5000)])
        signal?.throwIfAborted()
        if (!from.complete || !from.naturalWidth) throw new Error('image_unavailable')
        if (rasterDataURL.test(from.src)) to.setAttribute('src', from.src)
        else {
          // Attachment/avatar blobs come through the existing read boundary. Keep
          // their original bytes; never fetch a remote URL discovered in a message.
          const blob = from.src.startsWith('blob:') ? await fetch(from.src, { signal }).then(r => r.blob()) : null
          if (blob && /^image\/(?:png|jpeg|gif|webp|avif)$/i.test(blob.type)) to.setAttribute('src', await readDataURL(blob))
          else {
            const canvas = document.createElement('canvas')
            canvas.width = from.naturalWidth; canvas.height = from.naturalHeight
            if (canvas.width * canvas.height > 32_000_000) throw new Error('image_too_large')
            canvas.getContext('2d')!.drawImage(from, 0, 0)
            to.setAttribute('src', canvas.toDataURL('image/png')); canvas.width = canvas.height = 0
          }
        }
      } catch {
        signal?.throwIfAborted()
        to.replaceWith(document.createTextNode(from.alt || '图片不可用'))
      }
    }
  }
  clone.style.position = 'static'; clone.style.margin = '0'; clone.style.maxHeight = 'none'; clone.style.height = `${Math.ceil(root.scrollHeight)}px`; clone.style.overflow = 'visible'
  clone.querySelectorAll('script,iframe,object,embed,form,input,textarea,video,audio,.markdown-code-copy,.markdown-table-copy,.sr-only').forEach(n => n.remove())
  clone.querySelectorAll('button,a').forEach(node => {
    if (node.tagName === 'A' && /^https?:\/\//i.test(node.getAttribute('href') ?? '')) {
      node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); return
    }
    const span = document.createElement('span'); span.className = node.className; span.setAttribute('style', node.getAttribute('style') ?? '')
    span.style.cursor = 'default'; span.append(...node.childNodes); node.replaceWith(span)
  })
  // Allow only self-contained raster images. No local paths, scriptable SVG images or future network reads.
  clone.querySelectorAll('img').forEach(img => { if (!rasterDataURL.test(img.src)) img.removeAttribute('src') })
  const safe = DOMPurify.sanitize(clone.outerHTML, { RETURN_DOM: true, ADD_TAGS: ['svg', 'path'], FORBID_TAGS: ['style', 'script', 'foreignObject'], FORBID_ATTR: ['srcset', 'srcdoc'] })
  return (safe as HTMLElement).firstElementChild as HTMLElement
}
const escapeHTML = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
// Trusted, fixed script; message content is never interpolated into executable code.
const exportScript = `document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy-code]');if(b){const t=b.parentElement.querySelector('code')?.textContent??'';try{await navigator.clipboard.writeText(t);b.textContent='已复制'}catch{const r=document.createRange();r.selectNodeContents(b.parentElement.querySelector('code'));getSelection().removeAllRanges();getSelection().addRange(r);b.textContent='请复制已选代码'}return}const im=e.target.closest('img');if(im&&!im.closest('.member-avatar,.local-message-avatar')){const d=document.querySelector('dialog');d.querySelector('img').src=im.src;d.showModal()}});document.querySelector('dialog').addEventListener('click',e=>e.currentTarget.close());`
export function standaloneExportHTML(title: string, root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement
  copy.querySelectorAll('pre:has(code)').forEach(pre => { const b = document.createElement('button'); b.type = 'button'; b.dataset.copyCode = ''; b.textContent = '复制代码'; pre.prepend(b) })
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-rovai-export'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title><style>body{margin:0;display:flex;justify-content:center;background:${root.style.backgroundColor};color:${root.style.color};font-family:system-ui}body>article{max-width:100%}pre{position:relative}button[data-copy-code]{position:absolute;right:8px;top:8px;border:1px solid currentColor;border-radius:4px;background:inherit;color:inherit;cursor:pointer;padding:4px 8px}dialog{max-width:95vw;max-height:95vh;padding:0;border:0}dialog img{display:block;max-width:95vw;max-height:95vh;object-fit:contain}dialog::backdrop{background:#000b}</style></head><body>${copy.outerHTML}<dialog aria-label="放大图片"><img alt="点击关闭图片"></dialog><script nonce="rovai-export">${exportScript}</script></body></html>`
}
export async function exportDocumentPNG(root: HTMLElement): Promise<Blob> {
  const width = 720, height = Math.ceil(root.getBoundingClientRect().height || parseFloat(root.style.height))
  if (!height || height > 8192 || width * height * 4 > 24_000_000) throw new Error('长图过长，请减少选中消息或改用 HTML。')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(root)}</foreignObject></svg>`
  const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2
  const context = canvas.getContext('2d'); if (!context) throw new Error('图片生成失败，请重试或改用 HTML。')
  context.drawImage(image, 0, 0)
  try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请重试。')), 'image/png')) }
  finally { canvas.width = canvas.height = 0 }
}
