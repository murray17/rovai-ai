import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HostWebApi, HostWebStatus } from '@contracts'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from './AppDialog'
import { SettingsPageHeader } from './SettingsPageHeader'
import { QRCodeSVG } from 'qrcode.react'
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
      setFeedback(operation === 'rotate' ? '令牌已重新生成，原浏览器会话已退出。' : operation === 'start' ? '' : '服务已关闭，对话与执行继续。')
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
    catch { setFeedback(label === '连接地址' ? `无法自动复制，请手动复制：${value}` : `无法自动复制，请选择${label}后手动复制。`) }
  }
  const addresses = status?.addresses ?? []
  const selected = addresses.some(item => item.origin === address) ? address : addresses[0]?.origin ?? ''
  return <div className="general-settings remote-connection-page">
    <SettingsPageHeader eyebrow="Settings / Remote connection" title="远程连接" description="在其他设备的浏览器中，继续使用这台电脑上的 Rovai AI。" />
    <div className="general-settings-body">
      <section className="general-settings-section remote-access-fields" aria-label="远程访问设置">
        <div className="remote-setting-row">
          <div className="remote-copy"><label htmlFor="remote-enabled">远程访问</label></div>
          {(busy || status === null) && <span className="remote-state" role="status">{busy ? '正在更新…' : error ? '读取失败' : '正在读取…'}</span>}
          <input id="remote-enabled" type="checkbox" role="switch" aria-label="远程访问" checked={enabled} disabled={busy || status === null} onChange={() => enabled ? setConfirm('stop') : void change('start')} />
        </div>
        {!enabled && <fieldset className="remote-fields" disabled={busy}>
          <legend className="sr-only">连接方式</legend>
          <div className="remote-setting-row"><div className="remote-copy"><label htmlFor="remote-access">访问范围</label></div><select id="remote-access" value={lan ? 'lan' : 'local'} onChange={event => setLan(event.target.value === 'lan')}><option value="local">仅此电脑</option><option value="lan">局域网</option></select></div>
          <div className="remote-setting-row"><div className="remote-copy"><label htmlFor="remote-port">端口</label></div><input id="remote-port" className="remote-port" inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} /></div>
          {lan && <p className="remote-footnote">HTTP 明文传输，仅在可信网络开启；跨网络请使用 HTTPS 或 VPN。</p>}
        </fieldset>}
        {enabled && <>
          <div className="remote-field">
            <label htmlFor="remote-address">连接地址</label>
            <div className="remote-address-controls">
              <select id="remote-address" className="remote-address-select" value={selected} disabled={!selected} onChange={event => { setAddress(event.target.value); setFeedback('') }}>
                {!selected && <option value="">暂未发现可用地址</option>}
                {addresses.map(item => <option key={item.origin} value={item.origin}>{item.origin} · {item.interface}{item.recommended ? ' · 推荐' : ''}</option>)}
              </select>
              <div className="remote-address-actions">
                <button type="button" className="quiet-button compact" disabled={!selected} onClick={() => void copy(selected, '连接地址')}>复制地址</button>
                <Dialog.Root><Dialog.Trigger asChild><button type="button" className="quiet-button compact" disabled={!selected}>二维码</button></Dialog.Trigger>
                  {selected && <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent onCloseAutoFocus={() => {}}>
                    <AppDialogHeader title="扫码打开" description="在另一设备扫码后，使用管理令牌登录。" />
                    <AppDialogBody className="remote-qr"><QRCodeSVG value={selected} size={208} marginSize={4} level="M" role="img" title="连接地址二维码" /><code>{selected}</code></AppDialogBody>
                  </AppDialogContent></Dialog.Portal>}
                </Dialog.Root>
              </div>
            </div>
          </div>
          <div className="remote-field">
            <label htmlFor="remote-token">管理令牌</label>
            <div className="remote-token"><input id="remote-token" type={visible ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} /><button type="button" className="quiet-button compact" disabled={!token} onClick={() => setVisible(value => !value)} aria-pressed={visible}>{visible ? '隐藏' : '显示'}</button><button type="button" className="quiet-button compact" disabled={!token} onClick={() => void copy(token, '管理令牌')}>复制令牌</button><button type="button" className="quiet-button compact" disabled={busy} onClick={() => setConfirm('rotate')}>重新生成</button></div>
          </div>
        </>}
      </section>
      {error && <div><p className="remote-error" role="alert">{error}</p><button type="button" className="quiet-button compact" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button></div>}
      {feedback && <p className="remote-feedback" role="status">{feedback}</p>}
    </div>
    <Dialog.Root open={confirm !== null} onOpenChange={open => { if (!open && !busy) setConfirm(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent onOpenAutoFocus={event => { event.preventDefault(); cancelButton.current?.focus() }} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <AppDialogHeader title={confirm === 'rotate' ? '重新生成管理令牌？' : '关闭远程访问？'} description="所有浏览器会话将退出，Host 上的对话与执行仍会继续。" />
      <AppDialogBody><p>{confirm === 'rotate' ? '旧令牌会立即失效。复制新令牌后，可在原浏览器页面重新登录并保留编辑。' : '之后可以在此处重新开启服务。'}</p></AppDialogBody>
      <AppDialogFooter><button ref={cancelButton} type="button" className="quiet-button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => confirm && void change(confirm)}>{busy ? '正在更新…' : '确认'}</button></AppDialogFooter>
    </AppDialogContent></Dialog.Portal></Dialog.Root>
  </div>
}
