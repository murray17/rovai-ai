import { languageTestApi } from '../../../apps/desktop/src/renderer/src/interface-language-test-api'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Dialog from '@radix-ui/react-dialog'
import { ConsoleClient } from '../../../apps/web/src/client'
import { WebConnectionRecovery } from '../../../apps/web/src/WebConnectionRecovery'
import { browserMemberAvatars } from '../../../apps/web/src/member-avatars'
import { MemberAvatar } from '../../../apps/desktop/src/renderer/src/MemberAvatar'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '../../../apps/desktop/src/renderer/src/AppDialog'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import type { GeneralPreferencesApi } from '@contracts'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/styles.css'
import '../../../apps/web/src/mobile.css'

// Real production transport, boundary, dialog and theme CSS. The small form is
// an acceptance fixture, not a substitute implementation of Camp/Composer.
const transport = new ConsoleClient(location.origin, fetch, sessionStorage)
const login = transport.restore().then(restored => restored || transport.login('fixture-only'))
const avatarClient = {
  memberAvatars: browserMemberAvatars(transport),
  connection: { subscribe: (listener: () => void) => transport.onConnectionChanged(listener), getSnapshot: () => transport.connectionState === 'live' },
  request: async () => ({ enabled: false, headsUpAfterSequence: 0, observedThroughChangeSequence: 0 })
} as unknown as ThreadClient
const observations = { mounts: 0, shortcuts: 0, results: [] as unknown[], connections: [] as string[] }
Object.assign(window, { connectionFixture: { transport, observations,
  language: (language: 'en' | 'zh-CN') => changeInterfaceLanguage(languageTestApi as GeneralPreferencesApi, language)
} })

function Form() {
  const [avatars, setAvatars] = useState<string[]>([])
  const [draft, setDraft] = useState('保留这段未发送的草稿')
  const [title, setTitle] = useState('尚未创建的对话')
  const [dialog, setDialog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    Object.assign(window, { showRecoveryAvatars: setAvatars })
    observations.mounts++
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' || event.key === 'F2') observations.shortcuts++ }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  const send = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      observations.results.push(await transport.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: 'fixture-thread', body: draft, execution: null }))
      setDraft('')
    } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  return <main style={{ padding: '40px', maxWidth: '800px', margin: 'auto' }}>
    <h1>连接恢复验收</h1>
    <p>此表单使用正式 Web 传输和断线遮罩，服务响应由隔离的测试服务器提供。</p>
    <label>草稿<textarea id="draft" value={draft} onChange={event => setDraft(event.target.value)} style={{ display: 'block', width: '100%', minHeight: '120px', marginBlock: '16px' }} /></label>
    <button id="send" className="primary-button conversation-primary-button" disabled={busy || !draft} onClick={() => { void send() }}>发送</button>
    <button id="create" className="quiet-button" onClick={() => setDialog(true)}>新建对话</button>
    <div id="avatars">{avatars.map((ref, i) => <MemberAvatar key={ref} agentId={`avatar-${i}`} avatarRef={ref} displayName={`Avatar ${i}`} />)}</div>
    {error && <p role="alert">{error}</p>}
    <Dialog.Root open={dialog} onOpenChange={setDialog}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent>
        <AppDialogHeader title="新建对话" description="保留输入与弹窗状态" />
        <AppDialogBody><input id="dialog-title" aria-label="对话名称" value={title} onChange={event => setTitle(event.target.value)} /></AppDialogBody>
      </AppDialogContent></Dialog.Portal>
    </Dialog.Root>
  </main>
}

function Fixture() {
  const [enabled, setEnabled] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { void login.then(() => setEnabled(true)) }, [])
  useEffect(() => {
    if (!enabled) return
    return transport.subscribe(() => undefined, state => observations.connections.push(state))
  }, [enabled])
  return <WebConnectionRecovery transport={transport} enabled={enabled} onNotice={setNotice}>
    {enabled && <ThreadClientProvider client={avatarClient}><Form /></ThreadClientProvider>}{notice && <p role="alert">{notice}</p>}
  </WebConnectionRecovery>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
