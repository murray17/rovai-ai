import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HostWebApi, HostWebStatus } from '@contracts'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from './AppDialog'
import { SettingsPageHeader } from './SettingsPageHeader'
import { NavigationIcon } from './NavigationIcon'
import { readErrorMessage } from './error-message'
import './remote-connection.css'

export function HostWebSettings({ api }: { api: HostWebApi }): React.JSX.Element {
  const [status, setStatus] = useState<HostWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [port, setPort] = useState('4317')
  const [lan, setLan] = useState(false)
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [confirm, setConfirm] = useState<'stop' | 'rotate' | null>(null)
  const generation = useRef(0)
  const changing = useRef(false)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const enabled = status?.enabled === true

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      if (changing.current) return
      const current = ++generation.current
      void (async () => {
        try {
          const next = await api.status()
          if (!active || current !== generation.current) return
          setStatus(next)
          const credential = next.enabled ? (await api.token()).administratorToken : ''
          if (!active || current !== generation.current) return
          setToken(credential)
          setError('')
        } catch (failure) {
          if (active && current === generation.current) { setError(readErrorMessage(failure)); setToken('') }
        }
      })()
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; generation.current++; window.removeEventListener('focus', refresh) }
  }, [api, reload])

  async function change(operation: 'start' | 'stop' | 'rotate'): Promise<void> {
    if (changing.current) return
    if (operation === 'start' && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
      setError('请输入 1–65535 之间的端口。'); document.getElementById('remote-port')?.focus(); return
    }
    changing.current = true
    const current = ++generation.current
    setBusy(true); setError(''); setFeedback(''); setVisible(false)
    try {
      const next = operation === 'start'
        ? await api.start({ listen: `${lan ? '0.0.0.0' : '127.0.0.1'}:${port}`, allowInsecureLan: lan })
        : await api[operation]()
      if (current !== generation.current) return
      setStatus(next)
      setToken('administratorToken' in next ? next.administratorToken as string : '')
      if (operation !== 'rotate') setAddress('')
      setConfirm(null)
      setFeedback(operation === 'rotate' ? '令牌已重新生成，原浏览器会话已退出。' : operation === 'start' ? '服务已开启。复制地址与令牌，在另一设备登录。' : '服务已关闭，对话与执行继续。')
    } catch (failure) {
      if (current !== generation.current) return
      setError(readErrorMessage(failure))
      // Resolve an uncertain response by reading, never repeat the mutation.
      try {
        const next = await api.status()
        const credential = next.enabled ? (await api.token()).administratorToken : ''
        if (current === generation.current) { setStatus(next); setToken(credential) }
      } catch { if (current === generation.current) { setStatus(null); setToken('') } }
    } finally { changing.current = false; if (current === generation.current) setBusy(false) }
  }
  async function copy(value: string, label: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setFeedback(`${label}已复制。`) }
    catch { setFeedback(`无法自动复制，请选择${label}后手动复制。`) }
  }
  const addresses = status?.addresses ?? (status?.origin ? [{ origin: status.origin, interface: 'Host', recommended: false }] : [])
  const selected = addresses.some(item => item.origin === address) ? address : addresses[0]?.origin ?? ''
  return <div className="general-settings remote-connection-page">
    <SettingsPageHeader eyebrow="Settings / Remote connection" title="远程连接" description="在其他设备的浏览器中，继续使用这台电脑上的 Rovai AI。" />
    <div className="general-settings-body">
      <section className="general-settings-section" aria-labelledby="remote-status-title">
        <div className="remote-status-row">
          <div className="remote-service-icon"><NavigationIcon name="monitor-smartphone" /></div>
          <div className="remote-copy"><div className="remote-title-row"><h2 id="remote-status-title">浏览器访问</h2><span className={`remote-state ${enabled ? 'is-on' : ''}`} role="status"><i aria-hidden="true" />{busy ? '正在更新…' : status ? enabled ? '已开启' : '未开启' : error ? '读取失败' : '正在读取…'}</span></div><p>开启后，通过连接地址与管理令牌登录。</p></div>
          <input type="checkbox" role="switch" aria-label="开启浏览器访问" checked={enabled} disabled={busy || status === null} onChange={() => enabled ? setConfirm('stop') : void change('start')} />
        </div>
        <p className="remote-footnote">保持这台电脑上的 Rovai AI 运行。重启应用后，浏览器访问默认关闭。</p>
      </section>
      {!enabled && <section className="general-settings-section" aria-labelledby="remote-config-heading">
        <div className="section-heading"><h2 id="remote-config-heading">连接方式</h2></div>
        <fieldset className="remote-fields" disabled={busy}>
          <legend className="sr-only">连接方式</legend>
          <div className="remote-setting-row"><div className="remote-copy"><label htmlFor="remote-access">访问范围</label><p>选择可以从哪里打开 Rovai AI。</p></div><select id="remote-access" value={lan ? 'lan' : 'local'} onChange={event => setLan(event.target.value === 'lan')}><option value="local">仅此电脑</option><option value="lan">局域网</option></select></div>
          <div className="remote-setting-row"><div className="remote-copy"><label htmlFor="remote-port">端口</label><p>其他应用占用时，可更换端口。</p></div><input id="remote-port" className="remote-port" inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} /></div>
          {lan && <div className="remote-network-note"><p>HTTP 会明文传输令牌和内容。仅在可信网络开启；跨不可信网络请使用 HTTPS 或 VPN。</p></div>}
        </fieldset>
      </section>}
      {enabled && <>
        <section className="general-settings-section" aria-labelledby="remote-address-heading">
          <div className="section-heading"><h2 id="remote-address-heading">连接地址</h2></div>
          <div className="remote-field"><label htmlFor="remote-address">Host 网络接口</label><select id="remote-address" className="remote-address-select" value={selected} onChange={event => { setAddress(event.target.value); setFeedback('') }}>{addresses.map(item => <option key={item.origin} value={item.origin}>{item.interface} · {item.origin}{item.recommended ? ' · 推荐' : ''}</option>)}</select><p>选择另一地址只更改展示与复制内容，不改变访问权限、令牌或服务状态。</p></div>
          <div className="remote-address-row"><code>{selected || '暂未发现可用地址'}</code><button type="button" className="quiet-button compact" disabled={!selected} onClick={() => void copy(selected, '连接地址')}>复制地址</button></div>
          <p className="remote-footnote">{status.sessions ?? 0} 个浏览器会话 · 登录后可选择这台 Host 有权访问的工作目录。</p>
        </section>
        <section className="general-settings-section" aria-labelledby="remote-token-heading">
          <div className="section-heading remote-section-heading"><div><h2 id="remote-token-heading">管理令牌</h2><p>可随时查看或复制。重新生成会退出原浏览器会话。</p></div><button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirm('rotate')}>重新生成</button></div>
          <div className="remote-token"><label htmlFor="remote-token" className="sr-only">管理令牌</label><input id="remote-token" type={visible ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} /><button type="button" className="quiet-button compact" disabled={!token} onClick={() => setVisible(value => !value)} aria-pressed={visible}>{visible ? '隐藏' : '显示'}</button><button type="button" className="quiet-button compact" disabled={!token} onClick={() => void copy(token, '管理令牌')}>复制令牌</button></div>
          <p className="remote-footnote">不要把令牌发送到对话或放进连接链接。</p>
        </section>
      </>}
      {!enabled && <div className="remote-start-row"><span className="remote-footnote">设置就绪后，即可开启浏览器访问。</span><button type="button" className="primary-button" disabled={busy || status === null} onClick={() => void change('start')}>{busy ? '正在开启…' : '开启浏览器访问'}</button></div>}
      {error && <div><p className="remote-error" role="alert">{error}</p><button type="button" className="quiet-button compact" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button></div>}
      {feedback && <p className="remote-feedback" role="status">{feedback}</p>}
    </div>
    <Dialog.Root open={confirm !== null} onOpenChange={open => { if (!open && !busy) setConfirm(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent onOpenAutoFocus={event => { event.preventDefault(); cancelButton.current?.focus() }} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <AppDialogHeader title={confirm === 'rotate' ? '重新生成管理令牌？' : '关闭浏览器访问？'} description="所有浏览器会话将退出，Host 上的对话与执行仍会继续。" />
      <AppDialogBody><p>{confirm === 'rotate' ? '旧令牌会立即失效。复制新令牌后，可在原浏览器页面重新登录并保留编辑。' : '之后可以在此处重新开启服务。'}</p></AppDialogBody>
      <AppDialogFooter><button ref={cancelButton} type="button" className="quiet-button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => confirm && void change(confirm)}>{busy ? '正在更新…' : '确认'}</button></AppDialogFooter>
    </AppDialogContent></Dialog.Portal></Dialog.Root>
  </div>
}
