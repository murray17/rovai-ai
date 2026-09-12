import { SettingsPageHeader } from './SettingsPageHeader'
import './remote-connection.css'

export function RemoteConnectionStatus({ origin, state, onLogout, onLogin }: { origin: string; state: 'live' | 'connecting' | 'offline' | 'expired'; onLogout(): void; onLogin?(): void }) {
  return <div className="general-settings remote-connection-page">
    <SettingsPageHeader eyebrow="Settings / Remote connection" title="远程连接" description="查看当前浏览器连接，管理本页的登录状态。" />
    <div className="general-settings-body"><section className="general-settings-section"><div className="remote-title-row"><h2>当前连接</h2><span className={`remote-state ${state === 'live' ? 'is-on' : ''}`} role="status">{state === 'expired' ? '需要重新登录，编辑保留' : state === 'live' ? '已连接' : state === 'offline' ? '连接中断，编辑保留' : '正在连接…'}</span></div><div className="remote-address-row"><code>{origin}</code></div><p className="remote-footnote">可直接选择 Host 有权访问的工作目录。关闭浏览器不会中止 Host 上的执行。</p></section><section className="general-settings-section"><div className="section-heading"><h2>登录状态</h2></div><div className="remote-setting-row"><div className="remote-copy"><strong>仅此浏览器页面</strong><p>重新登录后保留当前页面的编辑，继续核对原提交。</p></div>{state === 'expired' ? onLogin && <button type="button" className="quiet-button" onClick={onLogin}>重新登录</button> : <button type="button" className="quiet-button" onClick={onLogout}>退出登录</button>}</div></section></div>
  </div>
}
