import { StrictMode, useEffect, useState } from 'react'
import { RemoteConnectionStatus } from '../../desktop/src/renderer/src/RemoteConnectionStatus'
import { HostWorkspacePicker } from './HostWorkspacePicker'
import '../../desktop/src/renderer/src/remote-connection.css'
import type { WorkspaceSelection } from '@contracts'
import { createRoot } from 'react-dom/client'
import { BusinessApp } from '../../desktop/src/renderer/src/BusinessApp'
import { CampClientProvider } from '../../desktop/src/renderer/src/camp-client'
import { CurrentUserProfileProvider } from '../../desktop/src/renderer/src/CurrentUserProfile'
import { ConsoleClient, type ConnectionState } from './client'
import { createCampAdapter, browserPlatform } from './camp-adapter'
import '../../desktop/src/renderer/src/styles.css'
import '../../desktop/src/renderer/src/member-editor.css'
import './styles.css'

const transport = new ConsoleClient(window.location.origin)
document.documentElement.dataset.platform = browserPlatform()

function WebEntry() {
  const [workspaceChoice, setWorkspaceChoice] = useState<{ resolve(value: WorkspaceSelection | null): void } | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => transport.onPendingCommandsChanged(() => setPendingCount(transport.pendingCommandCount)), [])
  const selectWorkspace = async (): Promise<WorkspaceSelection | null> => {
    return new Promise(resolve => setWorkspaceChoice({ resolve }))
  }
  const finishWorkspace = (value: WorkspaceSelection | null): void => { workspaceChoice?.resolve(value); setWorkspaceChoice(null) }
  const [adapter, setAdapter] = useState<ReturnType<typeof createCampAdapter> | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [authGeneration, setAuthGeneration] = useState(0)
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  useEffect(() => transport.onAuthenticationChanged(() => {
    setAuthenticated(transport.authenticated)
    setAuthGeneration(value => value + 1)
  }), [])
  useEffect(() => {
    if (!authenticated) return
    return transport.subscribe(() => adapter?.invalidate(), setConnection)
  }, [authenticated, authGeneration, adapter])
  const login = async (): Promise<void> => {
    setBusy(true); setError(null)
    const token = credential; setCredential('')
    try {
      await transport.login(token)
      setAdapter(current => current ?? createCampAdapter(transport, selectWorkspace))
      setAuthenticated(true)
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败，请重试。') }
    finally { setBusy(false) }
  }
  const current = adapter
  return <>
    {current && <CampClientProvider client={current.environment.client}>
      <CurrentUserProfileProvider api={current.profile}>
        <BusinessApp environment={current.environment} remoteConnection={<RemoteConnectionStatus origin={transport.origin} state={authenticated ? connection : 'expired'} onLogout={() => void transport.logout().catch(() => undefined)} />} sidebarFooter={authenticated ? <div className="web-connection" role="status">
          <span>{connection === 'live' ? '已连接 Host' : connection === 'offline' ? '连接中断，编辑保留' : '正在连接 Host'}</span>
          <button type="button" className="quiet-button compact" onClick={() => void transport.logout().catch(() => undefined)}>退出登录</button>
          {pendingCount > 0 && <>
            <button type="button" className="quiet-button compact" onClick={() => void transport.reconcilePending()}>核对 {pendingCount} 项提交</button>
            <button type="button" className="quiet-button compact" title="使用原命令编号和内容重试；Host 已保存的结果会直接返回。" onClick={() => void transport.retryPending().catch(() => undefined)}>重试原提交</button>
          </>}
        </div> : undefined} />
      </CurrentUserProfileProvider>
    </CampClientProvider>}
    {workspaceChoice && <HostWorkspacePicker transport={transport} onSelect={finishWorkspace} />}
    {!authenticated && <div className="web-login-overlay">
      <form className="web-login" onSubmit={event => { event.preventDefault(); void login() }}>
        <h1>{current ? '重新登录 Rovai AI' : '登录 Rovai AI'}</h1>
        <p>{current ? '当前页面的编辑仍保留。认证后重新读取 Host 状态。' : '使用 Host 的管理令牌登录。'}</p>
        <label htmlFor="administrator-token">管理令牌</label>
        <input id="administrator-token" type="password" value={credential} autoComplete="off" autoFocus
          onChange={event => setCredential(event.target.value)} required disabled={busy} />
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy || !credential.trim()}>{busy ? '正在登录…' : '登录'}</button>
      </form>
    </div>}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><WebEntry /></StrictMode>)
