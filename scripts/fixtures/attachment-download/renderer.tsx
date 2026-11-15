import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AttachmentCard } from '../../../apps/desktop/src/renderer/src/AttachmentCard'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { FilePreviewProvider } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { applyAppearanceSnapshot } from '../../../apps/desktop/src/renderer/src/theme'
import { DEFAULT_APPEARANCE, THEME_MODES } from '../../../apps/desktop/src/shared/appearance'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import { languageTestApi } from '../../../apps/desktop/src/renderer/src/interface-language-test-api'
import { createReviewModel } from '../host-web-parity/model'
import '../../../apps/desktop/src/renderer/src/styles.css'

const model = createReviewModel('desktop', 'camp')
const threadId = model.get().snapshot.thread.id
const pending: Array<{ mode: string; locator: any; resolve: (value: any) => void }> = []
const opened: any[] = []
const api = { ...model.fileApi, open: async (request: any) => { opened.push(request); return model.fileApi.open(request) } }
function perform(mode: 'native' | 'web', locator: any) {
  return new Promise<any>(resolve => pending.push({ mode, locator, resolve }))
}
const theme = (value: keyof typeof THEME_MODES) => applyAppearanceSnapshot(document.documentElement,
  { ...DEFAULT_APPEARANCE, preference: value, resolvedTheme: THEME_MODES[value] })
theme('day')
function App() {
  const [mode, setMode] = useState<'native' | 'web'>('native')
  const [replacement, setReplacement] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [, setLanguage] = useState('zh-CN')
  const client = useMemo(() => ({ ...model.client,
    attachmentLocation: async (locator: any) => ({ path: '/fixture/' + locator.attachmentRefId + '.md', location: 'local' as const }),
    attachments: mode === 'native' ? { kind: 'native' as const, open: model.client.attachments.kind === 'native' ? model.client.attachments.open : async () => { throw Error('Wrong fixture surface') },
      reveal: async () => ({ revealed: true, availability: 'available' as const, error: null }), save: (locator: any) => perform('native', locator) }
      : { kind: 'download' as const, download: (locator: any) => perform('web', locator) }
  }), [mode])
  Object.assign(window, { downloadQA: { pending, opened, setMode, replace: () => setReplacement(true), setDisabled, theme,
    language: async (value: 'zh-CN' | 'en') => { await changeInterfaceLanguage(languageTestApi, value); setLanguage(value) },
    complete: (index: number, outcome: 'success' | 'cancel' | 'error' | 'missing') => {
      const operation = pending[index]
      operation.resolve({ [operation.mode === 'native' ? 'saved' : 'opened']: outcome === 'success',
        error: outcome === 'error' ? 'save_failed' : outcome === 'missing' ? 'target_unavailable' : null,
        availability: outcome === 'missing' ? 'missing' : 'available' })
    } } })
  const attachment = { id: replacement ? 'replacement' : 'review-attachment', displayName: '交付说明.md', kind: 'file' as const,
    fileCount: 1, byteSize: 381, mediaType: 'text/markdown', previewKind: 'none' as const, availability: 'available' as const }
  const locator = (id: string) => ({ owner: 'message' as const, threadId, messageId: 'download-message', attachmentRefId: id })
  return <ThreadClientProvider client={client}><FilePreviewProvider threadId={threadId} resolvedTheme="day" api={api}>
    <main className="app-shell" style={{ display: 'block', padding: 24 }}>
      <section className="agent-output-files"><div className="agent-output-file-grid">
        <AttachmentCard attachment={attachment} locator={locator(attachment.id)} presentation="agent-timeline" disabled={disabled} />
        <AttachmentCard attachment={{ ...attachment, id: 'long-file', displayName: '会话附件下载交互与验收记录（含键盘和触屏场景）.md' }}
          locator={locator('long-file')} presentation="agent-timeline" disabled={disabled} />
        <AttachmentCard attachment={{ ...attachment, id: 'directory', displayName: '参考资料', kind: 'directory' }} locator={locator('directory')} presentation="agent-timeline" />
      </div></section>
      <div style={{ marginTop: 24 }}><AttachmentCard attachment={attachment} locator={locator(attachment.id)} presentation="user-timeline" /></div>
      <div className="composer-attachment-strip" style={{ marginTop: 24 }}><AttachmentCard attachment={attachment} locator={locator(attachment.id)} presentation="composer" /></div>
    </main>
  </FilePreviewProvider></ThreadClientProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
