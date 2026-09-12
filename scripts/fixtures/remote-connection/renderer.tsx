import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Dialog from '@radix-ui/react-dialog'
import type { AppearanceSnapshot, GeneralPreferencesApi, GeneralPreferencesSnapshot, WindowControlsApi } from '@contracts'
import { CampNavigation, SETTINGS_SIDEBAR_GROUPS, SettingsSidebarNavigation, type SettingsSidebarGroup } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/BusinessApp'
import { SettingsPageHeader } from '../../../apps/desktop/src/renderer/src/SettingsPageHeader'
import { GeneralSettings } from '../../../apps/desktop/src/renderer/src/GeneralSettings'
import { AppearanceSettings } from '../../../apps/desktop/src/renderer/src/AppearanceSettings'
import { NavigationIcon } from '../../../apps/desktop/src/renderer/src/NavigationIcon'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from '../../../apps/desktop/src/renderer/src/AppDialog'
import { CampClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { applyAppearanceSnapshot } from '../../../apps/desktop/src/renderer/src/theme'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import { createReviewModel } from '../host-web-parity/model'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import './review.css'

// Design-only adapter. No Host, native bridge, filesystem or credential is used.
const query = new URL(location.href).searchParams
const data = document.documentElement.dataset
const surface = data.reviewSurface ?? query.get('surface') ?? 'desktop'
const initialState = data.reviewState ?? query.get('state') ?? 'enabled'
const initialTheme = data.reviewTheme ?? query.get('theme') ?? 'day'
const initialPage = data.reviewPage ?? query.get('page') ?? 'remote'
document.documentElement.dataset.platform = 'darwin'
const model = createReviewModel('web', 'camp')
const groups: SettingsSidebarGroup<string>[] = SETTINGS_SIDEBAR_GROUPS.map(group => group.key === 'application'
  ? { ...group, items: [...group.items, { key: 'remote', icon: 'monitor-smartphone', label: '远程连接' }] }
  : group)
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

function Review() {
  const [page, setPage] = useState(initialPage)
  const pageRef = useRef(initialPage)
  const [appearance, setAppearance] = useState<AppearanceSnapshot>({ ...DEFAULT_APPEARANCE, preference: initialTheme === 'night' ? 'night' : 'day', resolvedTheme: initialTheme === 'night' ? 'night' : 'day' })
  const [status, setStatus] = useState(initialState)
  const [sessions, setSessions] = useState(initialState === 'enabled' ? 2 : 0)
  const [access, setAccess] = useState(initialState === 'off' ? 'local' : 'lan')
  const [port, setPort] = useState('4317')
  const [origin, setOrigin] = useState('http://192.168.1.12:4317')
  const [riskAccepted, setRiskAccepted] = useState(initialState === 'enabled')
  const [paths, setPaths] = useState(['/Users/owner/Projects/rovai-ai', '/Users/owner/Projects/notes'])
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [confirm, setConfirm] = useState<'stop' | 'rotate' | 'logout' | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginToken, setLoginToken] = useState('')
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(initialState === 'error' ? { field: 'remote-port', message: '端口 4317 已被占用，请更换端口后重试。' } : null)
  const [feedback, setFeedback] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const desktop = surface === 'desktop'
  const enabled = status === 'enabled'
  const loading = status === 'loading'
  const address = access === 'local' ? `http://127.0.0.1:${port}` : origin
  const choosePage = (next: string) => {
    if (!['general', 'appearance', 'remote'].includes(next)) { note('此页未纳入本次设计稿，当前操作没有修改任何设置。'); return }
    pageRef.current = next; setPage(next); setToken(''); setVisible(false); setFeedback('')
  }
  useEffect(() => { applyAppearanceSnapshot(document.documentElement, appearance) }, [appearance])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => { note('可点击「通用」「外观」对照现有生产页面；远程连接仅为模拟交互。') }, [])
  const report = (message: string) => { setFeedback(message); note(`模拟：${message}`) }
  const validate = (): boolean => {
    let error: { field: string; message: string } | null = null
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) error = { field: 'remote-port', message: '请输入 1–65535 之间的端口。' }
    else if (access === 'lan') {
      try {
        const url = new URL(origin)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]'].includes(url.hostname)) throw Error()
      } catch { error = { field: 'remote-origin', message: '请输入其他设备可访问的完整地址，例如 http://192.168.1.12:4317。' } }
      if (!error && !riskAccepted) error = { field: 'remote-risk', message: '请先确认允许明文局域网访问。' }
    }
    setFieldError(error)
    if (error) { requestAnimationFrame(() => document.getElementById(error.field)?.focus()); return false }
    return true
  }
  const change = (operation: 'start' | 'stop' | 'rotate' | 'logout' | 'login') => {
    if (busy || (operation === 'start' && !validate())) return
    setBusy(true); setFieldError(null); setFeedback('')
    timer.current = setTimeout(() => {
      setBusy(false); setConfirm(null); setVisible(false)
      if (operation === 'start' || operation === 'login') { setStatus('enabled'); setLoginOpen(false); setLoginToken(''); if (desktop) { setSessions(0); if (pageRef.current === 'remote') setToken('review-only-not-a-real-administrator-token') }; report(desktop ? '浏览器访问已开启。' : '已重新连接，页面内编辑保留。') }
      if (operation === 'rotate') { setSessions(0); if (pageRef.current === 'remote') setToken('review-only-replacement-not-a-real-token'); report('令牌已更换，原会话已退出。') }
      if (operation === 'stop') { setStatus('off'); setSessions(0); setToken(''); report('浏览器访问已关闭，对话与执行继续。') }
      if (operation === 'logout') { setStatus('expired'); report('已退出当前登录，页面内编辑保留。') }
    }, 650)
  }
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); report(`${label}已复制。`) }
    catch { report(`无法自动复制，请选择${label}后手动复制。`) }
  }
  const fieldMessage = (field: string) => fieldError?.field === field ? <p id={`${field}-error`} className="remote-error" role="alert">{fieldError.message}</p> : null
  const statusLabel = loading ? '正在读取…' : enabled ? (desktop ? '已开启' : '已连接') : status === 'error' ? '开启失败' : status === 'offline' ? '连接中断' : status === 'expired' ? '需要登录' : '未开启'
  return <CampClientProvider client={model.client}>
    <CurrentUserProfileContext.Provider value={{ profile: { displayName: '维护者', avatarDataUrl: null }, ready: true, error: null, reload: () => note('模拟资料'), save: async profile => profile }}>
    <div className="app-shell">
      <WindowDragStrip page="settings" />
      <CampNavigation view="settings" state="ready" navigation={null} activeCampId={null} pendingMemoryCount={0}
        settingsNavigation={<SettingsSidebarNavigation groups={groups} section={page} updateBadge={null} onSectionChange={choosePage} onBack={() => note('返回 App：复用原导航返回行为。本稿停留在设置。')} />}
        onNewConversation={() => {}} onMembers={() => {}} onMemory={() => {}} onSettings={() => {}} onOpenProject={() => {}}
        onCamp={() => {}} onRemoveProject={async () => {}} onRename={async () => {}} onDelete={async () => {}} onError={error => note(String(error))} />
      <main className="content settings-content"><div className="settings-workbench"><div className={`settings-panel settings-panel-${page === 'remote' ? 'general' : page}`}>
        {page === 'general' && <GeneralSettings api={preferenceApi} windowControls={desktop ? windowControls : undefined} />}
        {page === 'appearance' && <AppearanceSettings appearance={appearance} disabled={false} zoomManagedBy={desktop ? 'desktop' : 'browser'} onChange={async value => {
          const next = { ...value, resolvedTheme: value.preference === 'night' ? 'night' as const : 'day' as const }
          setAppearance(next); return next
        }} />}
        {page === 'remote' && <div className="general-settings remote-connection-page">
          <SettingsPageHeader eyebrow="Settings / Remote connection" title="远程连接" description={desktop ? '在其他设备的浏览器中，继续使用这台电脑上的 Rovai AI。' : '查看当前浏览器连接，管理本页的登录状态。'} />
          <div className="general-settings-body">
            <section className="general-settings-section remote-status-section" aria-labelledby="remote-status-title">
              <div className="remote-status-row">
                <div className="remote-service-icon"><NavigationIcon name="monitor-smartphone" /></div>
                <div className="remote-copy"><div className="remote-title-row"><h2 id="remote-status-title">{desktop ? '浏览器访问' : '当前连接'}</h2><span className={`remote-state ${enabled ? 'is-on' : ''}`} role="status"><i aria-hidden="true" />{busy ? '正在更新…' : statusLabel}</span></div><p>{desktop ? '开启后，通过连接地址与管理令牌登录。' : status === 'offline' ? '正在尝试重新连接，当前页面的编辑仍然保留。' : status === 'expired' ? '重新登录后继续核对原提交，当前页面的编辑仍然保留。' : '对话与执行由所连接的 Host 继续处理。'}</p></div>
                {desktop && <input type="checkbox" role="switch" aria-label="开启浏览器访问" checked={enabled} disabled={busy || loading} onChange={() => enabled ? setConfirm('stop') : change('start')} />}
              </div>
              <p className="remote-footnote">{desktop ? '保持这台电脑上的 Rovai AI 运行。重启应用后，浏览器访问默认关闭。' : '关闭这个浏览器页面后，Host 上正在进行的执行仍会继续。'}</p>
            </section>
            {loading ? <section className="general-settings-section"><p className="remote-footnote" role="status">正在读取连接地址与服务状态…</p><button className="quiet-button compact" type="button" onClick={() => setStatus('off')}>重新读取</button></section> : <>
              {desktop && !enabled && <section className="general-settings-section" aria-labelledby="remote-connection-heading">
                <div className="section-heading"><h2 id="remote-connection-heading">连接方式</h2></div>
                <fieldset className="remote-fields" disabled={busy}>
                  <legend className="sr-only">连接方式</legend>
                  <div className="remote-setting-row"><div className="remote-copy"><label htmlFor="remote-access">访问范围</label><p>选择可以从哪里打开 Rovai AI。</p></div><select id="remote-access" value={access} onChange={event => { setAccess(event.target.value); setRiskAccepted(false); setFieldError(null) }}><option value="local">仅此电脑</option><option value="lan">局域网</option></select></div>
                  <div className="remote-setting-row"><div className="remote-copy"><label htmlFor="remote-port">端口</label><p>其他应用占用时，可更换端口。</p></div><input id="remote-port" className="remote-port" type="text" inputMode="numeric" value={port} aria-invalid={fieldError?.field === 'remote-port'} aria-describedby={fieldError?.field === 'remote-port' ? 'remote-port-error' : undefined} onChange={event => { setPort(event.target.value); setFieldError(null) }} onBlur={event => { if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-remote-enable]')) return; if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) setFieldError({ field: 'remote-port', message: '请输入 1–65535 之间的端口。' }) }} /></div>
                  {fieldMessage('remote-port')}
                  {access === 'lan' && <>
                    <div className="remote-field"><label htmlFor="remote-origin">控制台地址</label><input id="remote-origin" type="url" value={origin} autoComplete="off" spellCheck={false} aria-invalid={fieldError?.field === 'remote-origin'} aria-describedby="remote-origin-help" onChange={event => { setOrigin(event.target.value); setFieldError(null) }} /><p id="remote-origin-help">填写这台电脑在局域网中的地址，供其他设备打开。</p>{fieldMessage('remote-origin')}</div>
                    <div className="remote-network-note"><p>HTTP 会明文传输令牌和内容。仅在可信局域网使用；跨网络连接请使用 HTTPS 或 VPN。</p><label><input id="remote-risk" type="checkbox" checked={riskAccepted} onChange={event => { setRiskAccepted(event.target.checked); setFieldError(null) }} />我了解风险，允许明文局域网访问</label>{fieldMessage('remote-risk')}</div>
                  </>}
                  {access === 'local' && <p className="remote-footnote">仅此电脑可打开 <code>http://127.0.0.1:{port || '4317'}</code>。其他设备访问请选择“局域网”。</p>}
                </fieldset>
              </section>}
              {(enabled || !desktop) && <section className="general-settings-section" aria-labelledby="remote-address-heading">
                <div className="section-heading"><h2 id="remote-address-heading">连接地址</h2></div>
                <div className="remote-address-row"><code>{address}</code><button className="quiet-button compact" type="button" onClick={() => void copy(address, '连接地址')}>复制地址</button></div>
                <p className="remote-footnote">{desktop ? '在其他设备的浏览器中打开此地址，然后输入管理令牌。地址不包含令牌。' : '本页只连接此地址。管理令牌和登录凭据仅保留在页面内存中。'}</p>
              </section>}
              {desktop && <section className="general-settings-section" aria-labelledby="remote-workspaces-heading">
                <div className="section-heading remote-section-heading"><h2 id="remote-workspaces-heading">可访问的工作区</h2>{!enabled && <button className="quiet-button compact" type="button" disabled={busy || paths.length >= 3} onClick={() => { setPaths(current => [...new Set([...current, '/Users/owner/Projects/design-notes'])]); report('已添加示例工作区；正式入口使用本机目录选择器。') }}>＋ 添加工作区</button>}</div>
                <p className="remote-footnote">{enabled ? '开启访问时已授权以下目录。关闭浏览器访问后可更改。' : '浏览器可在这些目录中创建对话和阅读文件。不添加目录也可以使用快速对话。'}</p>
                <div className="remote-workspaces">{paths.length ? paths.map(path => <div className="remote-workspace" key={path}><FolderIcon /><div><strong>{path.split('/').at(-1)}</strong><code>{path}</code></div>{!enabled && <button className="quiet-button compact" type="button" disabled={busy} aria-label={`移除 ${path.split('/').at(-1)}`} onClick={() => setPaths(current => current.filter(item => item !== path))}>移除</button>}</div>) : <p className="remote-empty">尚未添加工作区，浏览器仍可使用快速对话。</p>}</div>
              </section>}
              {desktop && enabled && <section className="general-settings-section" aria-labelledby="remote-login-heading">
                <div className="section-heading remote-section-heading"><h2 id="remote-login-heading">登录与会话</h2><span className="remote-footnote">{sessions} 个已登录会话</span></div>
                <div className="remote-setting-row"><div className="remote-copy"><strong>管理令牌</strong><p>{token ? '新令牌仅在本页显示，离开此页后不再保留。' : '如需登录其他设备，可更换令牌。原有会话会同时退出。'}</p></div><button className="quiet-button compact" type="button" disabled={busy} onClick={() => setConfirm('rotate')}>更换令牌</button></div>
                {token && <div className="remote-token"><label htmlFor="remote-token" className="sr-only">管理令牌</label><input id="remote-token" type={visible ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} /><button className="quiet-button compact" type="button" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? '隐藏' : '显示'}</button><button className="quiet-button compact" type="button" onClick={() => void copy(token, '示例令牌')}>复制令牌</button></div>}
                <p className="remote-footnote">不要把令牌发送到对话或放进连接链接。关闭访问会退出全部浏览器会话，对话与执行继续。</p>
              </section>}
              {!desktop && <section className="general-settings-section" aria-labelledby="remote-session-heading"><div className="section-heading"><h2 id="remote-session-heading">登录状态</h2></div><div className="remote-setting-row"><div className="remote-copy"><strong>{status === 'expired' ? '登录已失效' : '仅此浏览器页面'}</strong><p>{status === 'expired' ? '使用管理令牌重新登录，恢复当前页面。' : '退出登录只结束本页会话，不会关闭 Host 或取消执行。'}</p></div><button className="quiet-button" type="button" disabled={busy || status === 'offline'} onClick={() => status === 'expired' ? setLoginOpen(true) : setConfirm('logout')}>{status === 'expired' ? '重新登录' : '退出登录'}</button></div><p className="remote-footnote">访问范围、授权目录和管理令牌由 Host 本机设置。</p></section>}
              {desktop && !enabled && <div className="remote-start-row"><span className="remote-footnote">设置就绪后，即可开启浏览器访问。</span><button className="primary-button" type="button" data-remote-enable disabled={busy} onClick={() => change('start')}>{busy ? '正在开启…' : '开启浏览器访问'}</button></div>}
            </>}
            {feedback && <p className="remote-feedback" role="status">{feedback}</p>}
          </div>
        </div>}
      </div></div></main>
      <Dialog.Root open={confirm !== null} onOpenChange={open => { if (!open && !busy) setConfirm(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" /><AppDialogContent aria-describedby="remote-confirm-description">
        <AppDialogHeader description={null} title={confirm === 'rotate' ? '更换管理令牌？' : confirm === 'logout' ? '退出当前登录？' : '关闭浏览器访问？'} closeDisabled={busy} />
        <AppDialogBody><p id="remote-confirm-description">{confirm === 'rotate' ? '现有浏览器会话将退出，新登录需要使用新令牌。对话与正在进行的执行不会停止。' : confirm === 'logout' ? '当前页面的编辑会保留，重新登录后可以继续。Host 上的执行不会停止。' : '所有浏览器会话将断开。当前对话与执行仍在这台电脑上继续。'}</p></AppDialogBody>
        <AppDialogFooter><button className="quiet-button" type="button" disabled={busy} data-dialog-autofocus onClick={() => setConfirm(null)}>取消</button><button className="danger-button" type="button" disabled={busy} onClick={() => confirm && change(confirm)}>{busy ? '正在处理…' : confirm === 'rotate' ? '更换令牌并退出会话' : confirm === 'logout' ? '退出登录' : '关闭浏览器访问'}</button></AppDialogFooter>
      </AppDialogContent></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={loginOpen} onOpenChange={open => { if (!busy) { setLoginOpen(open); if (!open) setLoginToken('') } }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" /><AppDialogContent aria-describedby="remote-login-description">
        <AppDialogHeader title="重新登录 Rovai AI" description="当前页面的编辑仍保留。登录后继续读取 Host 状态。" descriptionId="remote-login-description" closeDisabled={busy} />
        <form onSubmit={event => { event.preventDefault(); if (loginToken.trim()) { setLoginToken(''); change('login') } }}>
          <AppDialogBody><label className="app-dialog-field"><span>管理令牌</span><input type="password" value={loginToken} required autoComplete="off" data-dialog-autofocus onChange={event => setLoginToken(event.target.value)} disabled={busy} /></label></AppDialogBody>
          <AppDialogFooter><button className="quiet-button" type="button" disabled={busy} onClick={() => { setLoginOpen(false); setLoginToken('') }}>取消</button><button className="primary-button" type="submit" disabled={busy || !loginToken.trim()}>{busy ? '正在登录…' : '登录'}</button></AppDialogFooter>
        </form>
      </AppDialogContent></Dialog.Portal></Dialog.Root>
    </div>
    </CurrentUserProfileContext.Provider>
  </CampClientProvider>
}
function FolderIcon() { return <svg className="remote-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg> }
createRoot(document.getElementById('root')!).render(<Review />)
