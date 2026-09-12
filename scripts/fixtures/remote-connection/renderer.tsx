import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Dialog from '@radix-ui/react-dialog'
import type { HostWebApi, AppearanceSnapshot, GeneralPreferencesApi, GeneralPreferencesSnapshot, WindowControlsApi } from '@contracts'
import { CampNavigation, SETTINGS_SIDEBAR_GROUPS, SettingsSidebarNavigation } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/BusinessApp'
import { GeneralSettings } from '../../../apps/desktop/src/renderer/src/GeneralSettings'
import { AppearanceSettings } from '../../../apps/desktop/src/renderer/src/AppearanceSettings'
import { HostWebSettings } from '../../../apps/desktop/src/renderer/src/HostWebSettings'
import { RemoteConnectionStatus } from '../../../apps/desktop/src/renderer/src/RemoteConnectionStatus'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from '../../../apps/desktop/src/renderer/src/AppDialog'
import { CampClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { applyAppearanceSnapshot } from '../../../apps/desktop/src/renderer/src/theme'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import { createReviewModel } from '../host-web-parity/model'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import '../../../apps/desktop/src/renderer/src/remote-connection.css'

// Design-only adapter. No Host, native bridge, filesystem or credential is used.
const query = new URL(location.href).searchParams
const data = document.documentElement.dataset
const surface = data.reviewSurface ?? query.get('surface') ?? 'desktop'
const initialState = data.reviewState ?? query.get('state') ?? 'enabled'
const initialTheme = data.reviewTheme ?? query.get('theme') ?? 'day'
const initialPage = data.reviewPage ?? query.get('page') ?? 'remote'
document.documentElement.dataset.platform = 'darwin'
const model = createReviewModel('web', 'camp')
const note = (message: string) => parent.postMessage({ type: 'remote-review-note', message }, '*')
let preferences: GeneralPreferencesSnapshot = structuredClone(DEFAULT_GENERAL_PREFERENCES)
const save = async (patch: Partial<GeneralPreferencesSnapshot>) => {
  preferences = { ...preferences, ...patch }; note('模拟：已保存在本页内存。'); return structuredClone(preferences)
}
const preferenceApi: GeneralPreferencesApi = {
  get: async () => structuredClone(preferences),
  setStartupLocationMode: startupLocationMode => save({ startupLocationMode }),
  setLastSettingsSection: lastSettingsSection => save({ lastSettingsSection }),
  setExecutionConsolePlacement: executionConsolePlacement => save({ executionConsolePlacement }),
  setNewConversationDefaults: newConversationDefaults => save({ newConversationDefaults }),
  setOneClickNewConversationEnabled: oneClickNewConversationEnabled => save({ oneClickNewConversationEnabled }),
  setWorldMapEnabled: worldMapEnabled => save({ worldMapEnabled }),
  invalidateNewConversationDefaults: () => save({ newConversationDefaultsRequireConfirmation: true })
}
const windowControls = { getResetCapability: async () => ({ canReset: true, reason: null }), resetBounds: async () => {
  note('模拟：重置窗口，不操作浏览器或系统窗口。'); return { performed: true }
} } as WindowControlsApi

let token = 'review-only-not-a-real-administrator-token'
let hostStatus = { enabled: ['enabled', 'empty'].includes(initialState), sessions: initialState === 'enabled' ? 2 : 0,
  origin: 'http://192.168.1.12:4317', addresses: initialState === 'empty' ? [] : addresses('4317') }
function addresses(port: string) { return [
  { origin: `http://192.168.1.12:${port}`, interface: 'en0', recommended: true },
  { origin: `http://192.168.2.12:${port}`, interface: 'en1', recommended: true },
  { origin: `http://127.0.0.1:${port}`, interface: 'lo0', recommended: false }
] }
const delay = () => new Promise(resolve => setTimeout(resolve, 450))
let failRead = initialState === 'error'
const hostApi: HostWebApi = {
  status: async () => { if (failRead) { failRead = false; throw new Error('暂时无法读取 Host 状态，请重试。') }; if (initialState === 'loading') await new Promise(() => {}); return structuredClone(hostStatus) },
  token: async () => ({ administratorToken: token }),
  start: async input => { await delay(); if (initialState === 'error') throw new Error('端口已被占用，请更换端口后重试。'); const port = input.listen.split(':').at(-1)!; hostStatus = { enabled: true, sessions: 0, origin: `http://192.168.1.12:${port}`, addresses: addresses(port) }; return { ...structuredClone(hostStatus), administratorToken: token } },
  rotate: async () => { await delay(); token = 'review-only-replacement-not-a-real-token'; hostStatus.sessions = 0; return { ...structuredClone(hostStatus), administratorToken: token } },
  stop: async () => { await delay(); hostStatus.enabled = false; hostStatus.sessions = 0; return structuredClone(hostStatus) }
}
function Review() {
  const [page, setPage] = useState(initialPage)
  const [appearance, setAppearance] = useState<AppearanceSnapshot>({ ...DEFAULT_APPEARANCE, preference: initialTheme === 'night' ? 'night' : 'day', resolvedTheme: initialTheme === 'night' ? 'night' : 'day' })
  const [connection, setConnection] = useState<'live' | 'offline' | 'expired'>(initialState === 'offline' ? 'offline' : initialState === 'expired' ? 'expired' : 'live')
  const [loginOpen, setLoginOpen] = useState(false)
  const desktop = surface === 'desktop'
  useEffect(() => { applyAppearanceSnapshot(document.documentElement, appearance) }, [appearance])
  return <CampClientProvider client={model.client}><CurrentUserProfileContext.Provider value={{ profile: { displayName: '维护者', avatarDataUrl: null }, ready: true, error: null, reload: () => note('模拟资料'), save: async profile => profile }}><div className="app-shell">
    <WindowDragStrip page="settings" />
    <CampNavigation navigation={null} view="settings" state="ready" activeCampId={null} pendingMemoryCount={0}
      settingsNavigation={<SettingsSidebarNavigation groups={SETTINGS_SIDEBAR_GROUPS} section={page} updateBadge={null} onSectionChange={value => { if (['general', 'appearance', 'remote'].includes(value)) setPage(value) }} onBack={() => note('模拟：返回 App')} />}
      onNewConversation={() => {}} onMembers={() => {}} onMemory={() => {}} onSettings={() => {}} onOpenProject={() => {}}
      onCamp={() => {}} onRemoveProject={async () => {}} onRename={async () => {}} onDelete={async () => {}} onError={error => note(String(error))} />
    <main className="content settings-content"><div className="settings-workbench"><div className={`settings-panel settings-panel-${page}`}>
      {page === 'general' && <GeneralSettings api={preferenceApi} windowControls={desktop ? windowControls : undefined} />}
      {page === 'appearance' && <AppearanceSettings appearance={appearance} disabled={false} zoomManagedBy={desktop ? 'desktop' : 'browser'} onChange={async value => { const next = { ...value, resolvedTheme: value.preference === 'night' ? 'night' as const : 'day' as const }; setAppearance(next); return next }} />}
      {page === 'remote' && (desktop ? <HostWebSettings api={hostApi} /> : <RemoteConnectionStatus origin={hostStatus.origin} state={connection} onLogout={() => setConnection('expired')} onLogin={() => setLoginOpen(true)} />)}
    </div></div></main>
    <Dialog.Root open={loginOpen} onOpenChange={setLoginOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent><AppDialogHeader title="重新登录" description="模拟登录，保留页面内编辑。" /><form onSubmit={event => { event.preventDefault(); setConnection('live'); setLoginOpen(false) }}><AppDialogBody><label>管理令牌<input type="password" required /></label></AppDialogBody><AppDialogFooter><button type="submit" className="primary-button">登录</button></AppDialogFooter></form></AppDialogContent></Dialog.Portal></Dialog.Root>
  </div></CurrentUserProfileContext.Provider></CampClientProvider>
}
createRoot(document.getElementById('root')!).render(<Review />)
