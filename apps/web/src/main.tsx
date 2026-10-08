import { browserAuthStorage } from './auth-storage'
import { acquireTabRecovery } from './tab-recovery'
import { takeLoginTicket } from './login-ticket'
import { StrictMode, useEffect, useState } from 'react'
import { RemoteConnectionStatus } from '../../desktop/src/renderer/src/RemoteConnectionStatus'
import { HostWorkspacePicker } from './HostWorkspacePicker'
import { WebLogin } from './WebLogin'
import '../../desktop/src/renderer/src/remote-connection.css'
import type { WorkspaceSelection } from '@contracts'
import { createRoot } from 'react-dom/client'
import { BusinessApp } from '../../desktop/src/renderer/src/BusinessApp'
import { ThreadClientProvider } from '../../desktop/src/renderer/src/camp-client'
import { CurrentUserProfileProvider } from '../../desktop/src/renderer/src/CurrentUserProfile'
import { ConsoleClient, type ConnectionState } from './client'
import { createThreadAdapter, browserPlatform } from './camp-adapter'
import '../../desktop/src/renderer/src/styles.css'
import '../../desktop/src/renderer/src/member-editor.css'
import './styles.css'
import './mobile.css'

const transport = new ConsoleClient(window.location.origin, fetch, sessionStorage, browserAuthStorage(window.location.origin))
const entryKind = document.querySelector<HTMLMetaElement>('meta[name="rovai-host-kind"]')?.content
const hostKind = entryKind === 'desktop' || entryKind === 'server' ? entryKind : null
document.documentElement.dataset.platform = browserPlatform()
document.documentElement.dataset.rovaiSurface = 'web'
const loginTheme = matchMedia('(prefers-color-scheme: dark)')
function applyLoginTheme(): void {
  document.documentElement.dataset.theme = loginTheme.matches ? 'night' : 'day'
  document.documentElement.style.colorScheme = loginTheme.matches ? 'dark' : 'light'
}
applyLoginTheme()
let startupScanning = false
let retryStartup: (() => Promise<boolean>) | null = null
const recovery = (async () => {
  // Synchronous fragment removal happens before the first await. StrictMode
  // remounts subscribe to this one promise, never redeem the ticket twice.
  let ticket: string | null = null
  let ticketError: unknown
  try { ticket = takeLoginTicket(); startupScanning = ticket !== null } catch (error) { ticketError = error }
  const owner = await acquireTabRecovery()
  let restored = false
  try { restored = await transport.restore(owner.fork, owner.assert, ticket === null && !ticketError) }
  catch (error) {
    if (ticket === null && !ticketError) retryStartup = () => transport.restore(owner.fork, owner.assert)
    throw error
  }
  if (ticketError) throw ticketError
  if (ticket !== null) {
    try { await transport.loginTicket(ticket) } finally { ticket = null }
    return true
  }
  return restored
})()

function WebEntry() {
  const [workspaceChoice, setWorkspaceChoice] = useState<{ resolve(value: WorkspaceSelection | null): void } | null>(null)
  const selectWorkspace = async (): Promise<WorkspaceSelection | null> => {
    return new Promise(resolve => setWorkspaceChoice({ resolve }))
  }
  const finishWorkspace = (value: WorkspaceSelection | null): void => { workspaceChoice?.resolve(value); setWorkspaceChoice(null) }
  const [adapter, setAdapter] = useState<ReturnType<typeof createThreadAdapter> | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [authGeneration, setAuthGeneration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(startupScanning)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  useEffect(() => {
    // Once mounted, BusinessApp owns the scoped appearance, including re-login.
    if (adapter) return
    loginTheme.addEventListener('change', applyLoginTheme)
    return () => loginTheme.removeEventListener('change', applyLoginTheme)
  }, [adapter])
  useEffect(() => transport.onAuthenticationChanged(() => {
    setAuthenticated(transport.authenticated)
    setAuthGeneration(value => value + 1)
  }), [])
  useEffect(() => {
    if (!authenticated) return
    return transport.subscribe(change => adapter?.invalidate(change), setConnection)
  }, [authenticated, authGeneration, adapter])
  useEffect(() => {
    let cancelled = false
    void recovery.then(restored => {
      if (cancelled) return
      if (restored && transport.authenticated) {
        setAdapter(current => current ?? createThreadAdapter(transport, selectWorkspace))
        setAuthenticated(true)
      }
    }).catch(e => { if (!cancelled) setError(e instanceof TypeError ? '暂时无法连接，网络恢复后会重试。' : e instanceof Error ? e.message : '恢复失败，请重试。') })
      .finally(() => { if (!cancelled) { setRestoring(false); setScanning(false) } })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (restoring || authenticated) return
    let active = true, pending = false
    const retry = async (): Promise<void> => {
      if (!retryStartup || pending || document.visibilityState !== 'visible') return
      pending = true
      try {
        const restored = await retryStartup()
        retryStartup = null
        if (active && restored && transport.authenticated) {
          setAdapter(current => current ?? createThreadAdapter(transport, selectWorkspace))
          setAuthenticated(true); setError(null)
        }
      } catch { /* Keep credentials and the visible connection error for retry. */ }
      finally { pending = false }
    }
    const timer = setInterval(() => { void retry() }, 30_000)
    const online = (): void => { void retry() }
    window.addEventListener('online', online)
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', online) }
  }, [restoring, authenticated])
  useEffect(() => transport.onRecovered(() => adapter?.invalidate()), [adapter])
  useEffect(() => {
    if (!authenticated) return
    const renew = (): void => {
      if (document.visibilityState === 'visible') void transport.renewIfNeeded().catch(() => undefined)
    }
    renew()
    const timer = setInterval(renew, 60_000)
    window.addEventListener('online', renew)
    document.addEventListener('visibilitychange', renew)
    return () => { clearInterval(timer); window.removeEventListener('online', renew); document.removeEventListener('visibilitychange', renew) }
  }, [authenticated])
  useEffect(() => {
    let active = true
    const scanned = (): void => {
      let ticket: string | null
      try { ticket = takeLoginTicket() } catch (e) { setError(e instanceof Error ? e.message : '扫码登录失败。'); return }
      if (ticket === null) return
      setBusy(true); setScanning(true); setError(null)
      // Same-document scans reuse this tab's verified editor. Copied tabs were
      // already separated by startup recovery before this handler can sign in.
      void recovery.catch(() => false).then(() => transport.loginTicket(ticket!)).then(() => {
        if (!active) return
        setAdapter(current => current ?? createThreadAdapter(transport, selectWorkspace)); setAuthenticated(true)
      }).catch(e => { if (active) setError(e instanceof Error ? e.message : '扫码登录失败。') })
        .finally(() => { ticket = null; if (active) { setBusy(false); setScanning(false) } })
    }
    window.addEventListener('hashchange', scanned)
    return () => { active = false; window.removeEventListener('hashchange', scanned) }
  }, [])
  const login = async (token: string): Promise<void> => {
    if (busy || restoring) return
    setBusy(true); setError(null)
    retryStartup = null
    try {
      await transport.login(token)
      setAdapter(current => current ?? createThreadAdapter(transport, selectWorkspace))
      setAuthenticated(true)
    } catch (e) { setError(e instanceof TypeError ? '暂时无法连接，请检查网络后重试。' : e instanceof Error ? e.message : '登录失败，请重试。') }
    finally { setBusy(false) }
  }
  const current = adapter
  return <>
    {current && <div className="web-authenticated-shell" hidden={!authenticated} inert={!authenticated}><ThreadClientProvider client={current.environment.client}>
      <CurrentUserProfileProvider api={current.profile}>
        <BusinessApp environment={current.environment} remoteConnection={<RemoteConnectionStatus origin={transport.origin} state={authenticated ? connection : 'expired'} onLogout={() => { setError(null); void transport.logout().catch(e => setError(e instanceof Error ? e.message : '退出未完成，请重试。')) }} />} sidebarFooter={authenticated && connection === 'offline' ? <div className="web-connection" role="status">
          <span>连接中断，编辑保留</span>
        </div> : undefined} />
      </CurrentUserProfileProvider>
    </ThreadClientProvider></div>}
    {authenticated && error && <div className="web-recovery-error" role="alert">{error}<button type="button" className="quiet-button compact" onClick={() => setError(null)}>关闭</button></div>}
    {workspaceChoice && <HostWorkspacePicker transport={transport} onSelect={finishWorkspace} />}
    {!authenticated && <WebLogin hostKind={hostKind}
      status={scanning ? 'scanning' : restoring ? 'restoring' : busy ? 'submitting' : null}
      error={error} onLogin={token => { void login(token) }} />}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><WebEntry /></StrictMode>)
