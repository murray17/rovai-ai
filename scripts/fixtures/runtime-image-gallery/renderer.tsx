import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { decodeImageUrl, ImageGallery } from '../../../apps/desktop/src/renderer/src/ImageGallery'
import '../../../apps/desktop/src/renderer/src/styles.css'

const calls: unknown[] = []
const attachmentCalls: string[] = []
const revokedUrls: string[] = []
const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL)
URL.revokeObjectURL = (url) => { revokedUrls.push(url); nativeRevokeObjectUrl(url) }
let realResultSequence = 0
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360"><rect width="720" height="360" fill="#f7f7f5"/><rect x="1" y="1" width="718" height="358" fill="none" stroke="#777"/><text x="32" y="65" font-size="26" fill="#222">登录态恢复检查</text><text x="32" y="116" font-size="18" fill="#333">01　断网后保留会话</text><text x="32" y="160" font-size="18" fill="#333">02　重新连接后读取身份</text><text x="32" y="204" font-size="18" fill="#333">03　重启后无需再次扫码</text><text x="32" y="306" font-size="15" fill="#555">图片内容用于验证 contain、中文和细线清晰度</text></svg>'
const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(svg)))
let scenarioRuntimeResult: { mediaType: string; data: string } | null | 'throw' = { mediaType: 'image/svg+xml', data: encoded }
let scenarioAttachmentResult: { mediaType: string; data: string } | null | 'throw' = { mediaType: 'image/svg+xml', data: encoded }
Object.assign(window, { rovai: {
  platform: 'darwin',
  request: async (method: string, params: { imageId: string }) => {
    calls.push({ method, params })
    if (params.imageId.startsWith('cache-')) {
      if (scenarioRuntimeResult === 'throw') throw new Error('core_temporarily_unavailable')
      return scenarioRuntimeResult
    }
    return { mediaType: 'image/svg+xml', data: params.imageId === 'broken' ? btoa('not an image') : encoded }
  },
  composerAttachments: { preview: async (id: string) => {
    attachmentCalls.push(id)
    if (id.startsWith('cache-')) {
      if (scenarioAttachmentResult === 'throw') throw new Error('attachment_temporarily_unavailable')
      return scenarioAttachmentResult && {
        mediaType: scenarioAttachmentResult.mediaType,
        bytes: Uint8Array.from(atob(scenarioAttachmentResult.data), character => character.charCodeAt(0))
      }
    }
    return { mediaType: 'image/svg+xml', bytes: new TextEncoder().encode(id === 'attachment-broken' ? 'not an image' : svg) }
  } }
} })
const image = (id: string) => ({ id, displayName: id === 'broken' ? '已失效的图片.png' : '登录态恢复检查.svg', mediaType: 'image/svg+xml', byteSize: svg.length })
const root = createRoot(document.getElementById('root')!)
function imageFrame(node: HTMLImageElement) {
  const frame = node.parentElement!.getBoundingClientRect()
  const style = getComputedStyle(node.parentElement!)
  return {
    width: frame.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height: frame.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }
}
root.render(
  <main style={{ maxWidth: 880, margin: '32px auto', padding: '0 24px' }}>
    <p style={{ marginBottom: 18 }}>检查结果如下，图片只展示在本地运行记录中。</p>
    <ImageGallery images={['first', 'second', 'broken'].map(id => ({ kind: 'runtime', campId: 'fixture', image: image(id) }))} />
    <p style={{ margin: '24px 0 12px' }}>这张图片已作为消息附件发送。</p>
    <ImageGallery variant="user-attachment" images={['attachment', 'attachment-broken'].map(id => ({ kind: 'attachment', campId: 'fixture', image: {
      ...image(id), kind: 'file', fileCount: 1, previewKind: 'image', availability: 'unknown'
    }, locator: {
      owner: 'message', campId: 'fixture', messageId: `message-${id}`, attachmentRefId: id
    } }))} />
  </main>
)
Object.assign(window, { imageGalleryTest: {
  calls,
  attachmentCalls,
  revokedUrls,
  hideScenario: () => flushSync(() => root.render(<main />)),
  setScenarioResult: (kind: 'runtime' | 'attachment', result: { mediaType: string; data: string } | null | 'throw') => {
    if (kind === 'runtime') scenarioRuntimeResult = result
    else scenarioAttachmentResult = result
  },
  showScenario: (kind: 'runtime' | 'attachment', id: string) => {
    const runtimeImage = image(id)
    const source = kind === 'runtime'
      ? { kind, campId: 'cache-fixture', image: runtimeImage }
      : { kind, campId: 'cache-fixture', image: {
          ...runtimeImage, kind: 'file', fileCount: 1, previewKind: 'image', availability: 'unknown'
        }, locator: {
          owner: 'message', campId: 'cache-fixture', messageId: `message-${id}`, attachmentRefId: id
        } }
    flushSync(() => root.render(<StrictMode><main><ImageGallery images={[source]} /></main></StrictMode>))
    return {
      decoded: document.querySelectorAll('.image-tile-preview img').length,
      loading: [...document.querySelectorAll('.image-tile-placeholder')]
        .filter(node => node.textContent === '正在读取图片…').length,
      failed: [...document.querySelectorAll('.image-tile-placeholder')]
        .filter(node => node.textContent === '图片已不可用').length,
      src: document.querySelector<HTMLImageElement>('.image-tile-preview img')?.src ?? null
    }
  },
  scenarioState: () => ({
    decoded: document.querySelectorAll('.image-tile-preview img').length,
    loading: [...document.querySelectorAll('.image-tile-placeholder')]
      .filter(node => node.textContent === '正在读取图片…').length,
    failed: [...document.querySelectorAll('.image-tile-placeholder')]
      .filter(node => node.textContent === '图片已不可用').length,
    src: document.querySelector<HTMLImageElement>('.image-tile-preview img')?.src ?? null,
    naturalWidth: document.querySelector<HTMLImageElement>('.image-tile-preview img')?.naturalWidth ?? 0,
    runtimeReads: calls.length,
    attachmentReads: attachmentCalls.length
  }),
  showRuntimeResults: (results: { displayName: string; mediaType: string; data: string }[]) => {
    const sequence = ++realResultSequence
    window.rovai.request = async (_method: string, params: { imageId: string }) => results[Number(params.imageId)]
    root.render(<main style={{ maxWidth: 880, margin: '32px auto', padding: '0 24px' }}>
      <ImageGallery key={sequence} images={results.map((result, index) => ({
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
    fit: [...document.querySelectorAll('.image-gallery-agent-output .image-tile-preview img')].map(node => getComputedStyle(node).objectFit),
    userFit: [...document.querySelectorAll('.image-gallery-user-attachment .image-tile-preview img')].map(node => getComputedStyle(node).objectFit),
    frames: [...document.querySelectorAll<HTMLImageElement>('.image-gallery-agent-output .image-tile-preview img')].map(imageFrame),
    userFrames: [...document.querySelectorAll<HTMLImageElement>('.image-gallery-user-attachment .image-tile-preview img')].map(imageFrame),
    lightboxFrames: [...document.querySelectorAll<HTMLImageElement>('.image-gallery-lightbox img')].map(imageFrame),
    dialog: Boolean(document.querySelector('[role="dialog"]')),
    active: document.activeElement?.getAttribute('aria-label')
  })
} })
