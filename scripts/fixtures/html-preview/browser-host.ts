import { HtmlPreviewHostChannel } from '../../../packages/html-preview/src/host-channel'
import type { HtmlPreviewDescriptor } from '../../../packages/html-preview/src/protocol'

const results: { name: string; text: string; diagnostics: unknown[] }[] = []
Object.assign(window, { previewBrowserResults: results })
for (const preview of (window as unknown as { previews: (HtmlPreviewDescriptor & { name: string })[] }).previews) {
  const frame = document.createElement('iframe')
  frame.title = preview.name; frame.sandbox.add('allow-scripts', 'allow-same-origin'); frame.referrerPolicy = 'no-referrer'
  const channel = new HtmlPreviewHostChannel(preview, () => frame.contentWindow)
  const diagnostics: unknown[] = []
  channel.subscribe(message => {
    if (message.type === 'diagnostic') diagnostics.push(message.diagnostic)
    if (message.type === 'state' && message.document === 'loaded') setTimeout(() => channel.send('find-snapshot', { requestId: 1 }), 300)
    if (message.type === 'find-document' && message.requestId === 1 && typeof message.text === 'string') {
      const index = results.findIndex(item => item.name === preview.name)
      const value = { name: preview.name, text: message.text, diagnostics }
      if (index < 0) results.push(value); else results[index] = value
      document.querySelector('#result')!.textContent = JSON.stringify(results)
    }
  })
  frame.onload = () => channel.connect()
  document.body.append(frame); channel.attach(window); frame.src = preview.entryUrl
}
