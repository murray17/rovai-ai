import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FilePreviewApi, ResolvedTheme, ShortcutPreferencesApi } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { FilePreviewWorkspace, FilePreviewResizeHandle, useOptionalFilePreviewLayout } from '../../../apps/desktop/src/renderer/src/FilePreviewLayout'
import { FilePreviewPane } from '../../../apps/desktop/src/renderer/src/FilePreviewPane'
import { ShortcutProvider } from '../../../apps/desktop/src/renderer/src/ShortcutProvider'
import { shortcutDefaults } from '../../../apps/desktop/src/shared/shortcuts'
import { initializeInterfaceLanguage, useInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { createReviewModel } from '../host-web-parity/model'
import '../../../apps/desktop/src/renderer/src/styles.css'

const bridge = (window as unknown as { fixtureApi: { files: FilePreviewApi; platform: NodeJS.Platform; thread(): Promise<string> } }).fixtureApi
document.documentElement.dataset.rovaiPlatform = bridge.platform
const chromeClient = createReviewModel('desktop', 'running').client
const shortcutApi: ShortcutPreferencesApi = { get: async () => ({ revision: 0, preferences: shortcutDefaults(), degraded: false }), save: async () => { throw new Error('unused') }, onChanged: () => () => {}, setRecording: async () => {}, onMouseSide: () => () => {} }
function Workspace(): React.JSX.Element {
  const preview = useFilePreview()
  const layout = useOptionalFilePreviewLayout()
  Object.assign(window, { projectFilesTest: { sidecarWidth: (width: number) => layout?.commitWidth(width), closeAll: async () => { for (const tab of [...preview.tabs]) await preview.close(tab.id) }, state: () => ({ visible: preview.paneVisible, tabs: preview.tabs.map(tab => ({ id: tab.id, kind: tab.kind, name: tab.kind === 'file' ? tab.file?.fileName : '' })) }) } })
  return <section className="workspace-shell camp-workspace"><FilePreviewWorkspace>
    <section className="timeline-pane" tabIndex={-1}><div className="thread-timeline" style={{ padding: '32px' }}><p>请检查路由配置，确认本地开发入口。</p><p>配置使用现有的开发服务器，启动方式保持不变。</p><button onClick={() => { void preview.open({ kind: 'camp_workspace', threadId: thread, rawReference: 'package.json' }) }}>package.json</button></div></section>
    <FilePreviewResizeHandle onClose={preview.hidePane}/><FilePreviewPane />
    <section className="conversation-controls"><textarea aria-label="草稿" defaultValue="下一步检查移动端布局" style={{ width: '100%', height: 90 }}/></section>
  </FilePreviewWorkspace></section>
}
let thread = ''
function Fixture(): React.JSX.Element {
  const [theme, setTheme] = useState<ResolvedTheme>('day')
  const [context, setContext] = useState({ threadId: thread, directory: true, name: 'project' })
  useInterfaceLanguage()
  Object.assign(window, { fixtureContext: (threadId: string, directory: boolean, name = directory ? 'project' : '快速对话') => { thread = threadId; setContext({ threadId, directory, name }) }, fixtureTheme: (value: ResolvedTheme, id = value) => { document.documentElement.dataset.themeId = id; document.documentElement.dataset.theme = value; setTheme(value) }, fixtureEnglish: () => initializeInterfaceLanguage({ interfaceLanguage: 'en', interfaceLanguagePreference: 'en', systemLanguage: 'en', languageRevision: 1, readError: false }) })
  return <ThreadClientProvider client={chromeClient}><ShortcutProvider api={shortcutApi} platform={bridge.platform}><FilePreviewProvider api={bridge.files} threadId={context.threadId} resolvedTheme={theme} projectFilesEnabled={context.directory}>
    <div className="app-shell app-shell-camp"><aside style={{ gridRow: '1 / -1', padding: 24, background: 'var(--rail)' }}>Rovai AI</aside><AppHeader thread={null} threadTitle="本地开发入口" contextLabel={context.name} onFocusApprovals={() => {}}/><main className="content task-content"><Workspace/></main></div>
  </FilePreviewProvider></ShortcutProvider></ThreadClientProvider>
}
bridge.thread().then(id => { thread = id; createRoot(document.getElementById('root')!).render(<Fixture/>) })
