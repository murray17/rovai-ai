import { useEffect, useRef, useState } from 'react'
import type { HostWebApi, HostWebStatus } from '@contracts'
import { readErrorMessage } from './error-message'

export function HostWebSettings({ api }: { api: HostWebApi }): React.JSX.Element {
  const [status, setStatus] = useState<HostWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listen, setListen] = useState('127.0.0.1:4317')
  const [origin, setOrigin] = useState('')
  const [lan, setLan] = useState(false)
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const generation = useRef(0)
  const changing = useRef(false)

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      if (changing.current) return
      const current = ++generation.current
      void api.status().then((next) => {
        if (!active || current !== generation.current) return
        setStatus(next)
        setError('')
        if (!next.enabled) setToken('')
      }).catch((failure: unknown) => {
        if (active && current === generation.current) setError(readErrorMessage(failure))
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; generation.current++; window.removeEventListener('focus', refresh) }
  }, [api])

  async function change(operation: 'start' | 'stop' | 'rotate'): Promise<void> {
    if (changing.current) return
    changing.current = true
    const current = ++generation.current
    setBusy(true)
    setError('')
    setToken('')
    setVisible(false)
    try {
      const next = operation === 'start'
        ? await api.start({ listen, ...(origin.trim() ? { publicOrigin: origin.trim() } : {}), allowInsecureLan: lan })
        : await api[operation]()
      if (current !== generation.current) return
      setStatus(next)
      if ('administratorToken' in next && typeof next.administratorToken === 'string') {
        setToken(next.administratorToken)
      }
    } catch (failure) {
      if (current !== generation.current) return
      setError(readErrorMessage(failure))
      // Start may have succeeded before the reply was lost; read its status
      // instead of retrying the mutation or creating another Host.
      try {
        const next = await api.status()
        if (current === generation.current) setStatus(next)
      } catch { if (current === generation.current) setStatus(null) }
    } finally { changing.current = false; if (current === generation.current) setBusy(false) }
  }

  return <section className="section-block general-settings-section" aria-labelledby="host-web-heading">
    <div className="section-heading"><div><h2 id="host-web-heading">浏览器访问</h2><p>从浏览器连接当前工作区</p></div></div>
    <div className="general-section-body host-web-settings">
      <p role="status">{status ? (status.enabled ? '已开启' : '已关闭') : '正在读取服务状态…'}{busy ? ' · 正在更新…' : ''}</p>
      <p className="general-inline-status">预览版当前支持浏览记录。发送、上传和审批尚未开放。</p>
      {!status?.enabled && <fieldset disabled={busy} className="host-web-fields">
        <legend>访问地址</legend>
        <label>监听地址<input value={listen} onChange={(event) => setListen(event.target.value)} spellCheck={false} placeholder="127.0.0.1:4317" /></label>
        <label>控制台地址（局域网必填）<input value={origin} onChange={(event) => setOrigin(event.target.value)} spellCheck={false} placeholder="http://192.168.1.10:4317" /></label>
        <label className="host-web-lan"><input type="checkbox" checked={lan} onChange={(event) => setLan(event.target.checked)} />允许明文局域网访问</label>
        {lan && <p role="note">同一网络上的人可能截获令牌和内容。只在可信网络开启；跨不可信网络请使用 HTTPS 或 VPN。</p>}
      </fieldset>}
      {status?.enabled && <p>控制台：<a href={status.origin} target="_blank" rel="noreferrer">{status.origin}</a> · {status.sessions ?? 0} 个会话</p>}
      {token && <div className="host-web-fields">
        <label>管理令牌<input type={visible ? 'text' : 'password'} readOnly value={token} autoComplete="off" spellCheck={false} aria-describedby="host-web-token-help" /></label>
        <p id="host-web-token-help">在控制台登录时使用。此处仅在当前页面显示；再次需要时可更换令牌。不要将令牌发到对话中。</p>
        <button type="button" className="quiet-button compact" onClick={() => setVisible(!visible)}>{visible ? '隐藏令牌' : '显示令牌'}</button>
      </div>}
      <div className="host-web-actions">
        {status?.enabled ? <>
          <button className="quiet-button" disabled={busy} onClick={() => void change('rotate')}>更换令牌并退出所有会话</button>
          <button className="quiet-button" disabled={busy} onClick={() => void change('stop')}>关闭浏览器访问</button>
        </> : <button className="primary-button" disabled={busy || status === null} onClick={() => void change('start')}>开启浏览器访问</button>}
      </div>
      <p className="general-inline-status">关闭浏览器访问后，当前对话与执行仍会继续。重启应用后默认关闭。</p>
      {error && <p role="alert" className="general-inline-status is-error">{error}</p>}
    </div>
  </section>
}
