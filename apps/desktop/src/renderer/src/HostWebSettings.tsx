import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HostWebApi, HostWebStatus } from '@contracts'
import { AppDialogContent, AppDialogHeader, AppDialogBody } from './AppDialog'
import { SettingsPageHeader } from './SettingsPageHeader'
import { QRCodeSVG } from 'qrcode.react'
import { CopyIcon } from './CopyIcon'
import { readErrorMessage } from './error-message'
import './remote-connection.css'
import { UiText, uiAttribute } from './interface-language'

export function HostWebSettings({ api, portDraft, onPortDraftChange }: {
  api: HostWebApi
  portDraft: string | null
  onPortDraftChange: Dispatch<SetStateAction<string | null>>
}): React.JSX.Element {
  const [status, setStatus] = useState<HostWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const port = portDraft ?? '8766'
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [feedback, setFeedback] = useState('')
  const generation = useRef(0)
  const changing = useRef(false)
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
          onPortDraftChange(current => current ?? next.listen?.split(':').at(-1) ?? '8766')
          const credential = (await api.token()).administratorToken
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
  }, [api, reload, onPortDraftChange])

  async function change(operation: 'start' | 'stop'): Promise<void> {
    if (changing.current) return
    if (operation === 'start' && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
      setError(uiAttribute('请输入 1–65535 之间的端口。')); document.getElementById('remote-port')?.focus(); return
    }
    changing.current = true
    const current = ++generation.current
    setBusy(true); setError(''); setFeedback(''); setVisible(false)
    try {
      const next = operation === 'start'
        ? await api.start({ listen: `0.0.0.0:${port}`, allowInsecureLan: true })
        : await api[operation]()
      if (current !== generation.current) return
      setStatus(next)
      const credential = (await api.token()).administratorToken
      if (current !== generation.current) return
      setToken(credential)
      setAddress('')
    } catch (failure) {
      if (current !== generation.current) return
      setError(readErrorMessage(failure))
      // Resolve an uncertain response by reading, never repeat the mutation.
      try {
        const next = await api.status()
        const credential = (await api.token()).administratorToken
        if (current === generation.current) { setStatus(next); setToken(credential) }
      } catch { if (current === generation.current) { setStatus(null); setToken('') } }
    } finally { changing.current = false; if (current === generation.current) setBusy(false) }
  }
  async function copy(value: string, label: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(value); setFeedback(''); return true }
    catch { setFeedback(label === '连接地址' ? uiAttribute("无法自动复制，请手动复制：{0}", String(value)) : uiAttribute("无法自动复制，请选择{0}后手动复制。", String(label))); return false }
  }
  const addresses = status?.addresses ?? []
  const localAddresses = addresses.filter(item => isLocalAddress(item.origin))
  const remoteAddresses = addresses.filter(item => !isLocalAddress(item.origin))
  const selected = remoteAddresses.some(item => item.origin === address) ? address : remoteAddresses[0]?.origin ?? ''
  const local = localAddresses[0]?.origin ?? ''
  return <div className="general-settings remote-connection-page">
    <SettingsPageHeader eyebrow="Settings / Remote connection" title={uiAttribute("远程连接")} description={uiAttribute("通过浏览器连接这台电脑。")} />
    <div className="general-settings-body">
      <section className="general-settings-section remote-access-fields" aria-label={uiAttribute("远程访问设置")}>
        <div className="remote-setting-row">
          <div className="remote-copy"><label htmlFor="remote-enabled"><UiText zh={"远程访问"} /></label></div>
          {(busy || status === null) && <span className="remote-state" role="status">{busy ? uiAttribute("正在更新…") : error ? uiAttribute("读取失败") : uiAttribute("正在读取…")}</span>}
          <input id="remote-enabled" type="checkbox" role="switch" aria-label={uiAttribute("远程访问")} checked={enabled} disabled={busy || status === null} onChange={() => void change(enabled ? 'stop' : 'start')} />
        </div>
        <div className="remote-setting-row">
          <div className="remote-copy"><label htmlFor="remote-port"><UiText zh={"端口"} /></label><p id="remote-port-note"><UiText zh={"修改后，下次开启时生效。"} /></p></div>
          <input id="remote-port" className="remote-port" inputMode="numeric" aria-describedby="remote-port-note" value={port} disabled={busy} onChange={event => onPortDraftChange(event.target.value)} />
        </div>
        <p className="remote-footnote"><UiText zh={"HTTP 明文连接，请仅在可信网络开启。"} /></p>
        {enabled &&
          <div className="remote-addresses">
            <RemoteAddress api={api} label={uiAttribute("本机地址")} description={uiAttribute("在这台电脑上访问")} value={local} onCopy={() => copy(local, uiAttribute('连接地址'))} />
            <RemoteAddress api={api} label={uiAttribute("远程地址")} description={uiAttribute("在其他设备上访问")} value={selected} onCopy={() => copy(selected, uiAttribute('连接地址'))}>
              {remoteAddresses.length > 1 && <select id="remote-address" aria-label={uiAttribute("选择远程地址")} className="remote-address-select" value={selected} onChange={event => { setAddress(event.target.value); setFeedback('') }}>{remoteAddresses.map(item => <option key={item.origin} value={item.origin}>{item.origin} · {item.interface}</option>)}</select>}
            </RemoteAddress>
          </div>
        }
        <div className="remote-field">
          <label htmlFor="remote-token"><UiText zh={"登录 Token"} /></label>
          <div className="remote-token">
            <input id="remote-token" type={visible ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} />
            <div className="remote-token-actions">
              <button type="button" className="message-copy-button" disabled={!token} onClick={() => setVisible(value => !value)} aria-pressed={visible} aria-label={visible ? uiAttribute("隐藏登录 Token") : uiAttribute("显示登录 Token")} title={visible ? uiAttribute("隐藏登录 Token") : uiAttribute("显示登录 Token")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{visible ? <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.4A10 10 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3 3.8M6 6.5A20 20 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5-1.4" /></> : <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>}</svg>
              </button>
              <RemoteCopyButton key={token} label={uiAttribute("复制登录 Token")} value={token} onCopy={() => copy(token, uiAttribute('登录 Token'))} />
            </div>
          </div>
        </div>
      </section>
      {error && <div><p className="remote-error" role="alert">{error}</p><button type="button" className="quiet-button compact" disabled={busy} onClick={() => setReload(value => value + 1)}><UiText zh={"重新读取"} /></button></div>}
      {feedback && <p className="remote-feedback" role="status">{feedback}</p>}
    </div>
  </div>
}

function isLocalAddress(origin: string): boolean {
  const host = new URL(origin).hostname
  return host === 'localhost' || host === '[::1]' || host.startsWith('127.') || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]+\]$/.test(host)
}

function RemoteAddress({ api, label, description, value, onCopy, children }: {
  api: HostWebApi
  label: string
  description: string
  value: string
  onCopy(): Promise<boolean>
  children?: React.ReactNode
}): React.JSX.Element {
  return <div className="remote-connection-address" data-address={value} aria-label={label}>
    <div className="remote-copy"><strong>{label}</strong><p>{description}</p></div>
    <div className="remote-address-value">{value ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : <span><UiText zh={"暂无可用地址"} /></span>}{children}</div>
    <div className="remote-address-actions">
      <RemoteCopyButton key={value} label={uiAttribute("复制{0}", String(label))} value={value} onCopy={onCopy} />
      <Dialog.Root><Dialog.Trigger asChild><button type="button" className="message-copy-button" aria-label={uiAttribute("{0}二维码", String(label))} title={uiAttribute("扫码登录")} disabled={!value}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h3v3h3v3h-6v-3M20 14h.01M7 7h.01M17 7h.01M7 17h.01" /></svg></button></Dialog.Trigger>
        {value && <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent onCloseAutoFocus={() => {}}>
          <AppDialogHeader title={uiAttribute("扫码登录")} description={uiAttribute("2 分钟内有效，仅可使用一次。")} />
          <LoginQr key={value} api={api} origin={value} label={label} />
        </AppDialogContent></Dialog.Portal>}
      </Dialog.Root>
    </div>
  </div>
}

function LoginQr({ api, origin, label }: { api: HostWebApi; origin: string; label: string }): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let expiry: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    setCode(null); setBusy(true); setError('')
    void api.loginTicket().then(result => {
      if (!active) return
      if (!/^[a-f0-9]{64}$/.test(result.ticket) || !Number.isFinite(result.expiresInSeconds) || result.expiresInSeconds <= 0) throw new Error('Invalid ticket response')
      const remaining = started + result.expiresInSeconds * 1000 - Date.now()
      if (remaining <= 0) return
      const url = new URL(origin)
      url.hash = `login-ticket=${result.ticket}`
      setCode(url.href)
      expiry = setTimeout(() => setCode(null), remaining)
    }).catch(() => { if (active) setError(uiAttribute('二维码未能生成，请重试。')) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; clearTimeout(expiry) }
  }, [api, origin, attempt])
  return <AppDialogBody className="remote-qr">
    <div className="remote-qr-frame">
      {code ? <QRCodeSVG value={code} size={208} marginSize={4} level="M" role="img" title={uiAttribute("{0}扫码登录", String(label))} />
        : <p role={error ? 'alert' : 'status'}>{busy ? uiAttribute("正在生成二维码…") : error ||uiAttribute("二维码已过期")}</p>}
    </div>
    <code>{origin}</code>
    <button type="button" className="quiet-button compact" disabled={busy} onClick={() => setAttempt(value => value + 1)}><UiText zh={"重新生成"} /></button>
  </AppDialogBody>
}

function RemoteCopyButton({ label, value, onCopy }: { label: string; value: string; onCopy(): Promise<boolean> }): React.JSX.Element {
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  const copied = copiedAt !== null
  useEffect(() => {
    if (copiedAt === null) return
    const timer = setTimeout(() => setCopiedAt(null), 1600)
    return () => clearTimeout(timer)
  }, [copiedAt])
  return <>
    <button type="button" className="message-copy-button" aria-label={label} title={copied ? uiAttribute("已复制") : label} disabled={!value} onClick={() => { void onCopy().then(success => setCopiedAt(success ? Date.now() : null)) }}><CopyIcon copied={copied} /></button>
    <span className="copy-feedback" role="status" aria-live="polite">{copied ? uiAttribute("已复制") : ''}</span>
  </>
}
