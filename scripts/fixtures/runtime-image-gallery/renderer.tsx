import { createRoot } from 'react-dom/client'
import { decodeImageUrl, ImageGallery } from '../../../apps/desktop/src/renderer/src/ImageGallery'
import '../../../apps/desktop/src/renderer/src/styles.css'

const calls: unknown[] = []
let realResultSequence = 0
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360"><rect width="720" height="360" fill="#f7f7f5"/><rect x="1" y="1" width="718" height="358" fill="none" stroke="#777"/><text x="32" y="65" font-size="26" fill="#222">登录态恢复检查</text><text x="32" y="116" font-size="18" fill="#333">01　断网后保留会话</text><text x="32" y="160" font-size="18" fill="#333">02　重新连接后读取身份</text><text x="32" y="204" font-size="18" fill="#333">03　重启后无需再次扫码</text><text x="32" y="306" font-size="15" fill="#555">图片内容用于验证 contain、中文和细线清晰度</text></svg>'
const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(svg)))
Object.assign(window, { rovai: {
  platform: 'darwin',
  request: async (method: string, params: { imageId: string }) => {
    calls.push({ method, params })
    return { mediaType: 'image/svg+xml', data: params.imageId === 'broken' ? btoa('not an image') : encoded }
  },
  composerAttachments: { preview: async (id: string) => ({ mediaType: 'image/svg+xml', bytes: new TextEncoder().encode(id === 'attachment-broken' ? 'not an image' : svg) }) },
  attachments: {
    open: async (...args: string[]) => { calls.push({ open: args }); return {} },
    reveal: async (...args: string[]) => { calls.push({ reveal: args }); return {} }
  }
} })
const image = (id: string) => ({ id, displayName: id === 'broken' ? '已失效的图片.png' : '登录态恢复检查.svg', mediaType: 'image/svg+xml', byteSize: svg.length })
const root = createRoot(document.getElementById('root')!)
root.render(
  <main style={{ maxWidth: 880, margin: '32px auto', padding: '0 24px' }}>
    <p style={{ marginBottom: 18 }}>检查结果如下，图片只展示在本地运行记录中。</p>
    <ImageGallery label="运行图片 · 3" images={['first', 'second', 'broken'].map(id => ({ kind: 'runtime', campId: 'fixture', image: image(id) }))} />
    <p style={{ margin: '24px 0 12px' }}>这张图片已作为消息附件发送。</p>
    <ImageGallery images={['attachment', 'attachment-broken'].map(id => ({ kind: 'attachment', campId: 'fixture', image: {
      ...image(id), kind: 'file', fileCount: 1, previewKind: 'image', runtimeProjectionState: 'available'
    } }))} />
  </main>
)
Object.assign(window, { imageGalleryTest: {
  calls,
  showRuntimeResults: (results: { displayName: string; mediaType: string; data: string }[]) => {
    const sequence = ++realResultSequence
    Object.assign(window, { rovai: { request: async (_method: string, params: { imageId: string }) => results[Number(params.imageId)] } })
    root.render(<main style={{ maxWidth: 880, margin: '32px auto', padding: '0 24px' }}>
      <ImageGallery key={sequence} label="真实 Runtime 图片验收" images={results.map((result, index) => ({
        kind: 'runtime', campId: `runtime-acceptance-${sequence}`, image: {
          id: String(index), displayName: result.displayName, mediaType: result.mediaType, byteSize: atob(result.data).length
        }
      }))} />
    </main>)
  },
  verifyDecoderFormats: async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 2; canvas.height = 2
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2)
    for (const format of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), format))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      URL.revokeObjectURL(await decodeImageUrl(bytes, format))
      // Missing MIME / extension must not block a structured, genuinely decodable local image.
      URL.revokeObjectURL(await decodeImageUrl(bytes, 'application/octet-stream'))
    }
    return true
  },
  state: () => ({
    decoded: document.querySelectorAll('.image-tile-preview img').length,
    failed: [...document.querySelectorAll('.image-tile-placeholder')].filter(node => node.textContent === '图片已不可用').length,
    columns: getComputedStyle(document.querySelector('.image-gallery-grid')!).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
    fit: [...document.querySelectorAll('.image-tile-preview img')].map(node => getComputedStyle(node).objectFit),
    dialog: Boolean(document.querySelector('[role="dialog"]')),
    active: document.activeElement?.getAttribute('aria-label')
  })
} })
