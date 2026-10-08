import { useEffect, useRef, useState } from 'react'
import { useThreadClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { UiText, uiAttribute } from './interface-language'

type Attempt = { attemptId: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'cleanup_unconfirmed'; output: string }
const LABELS: Record<Attempt['status'], string> = {
  running: '请按 Cline 提示完成浏览器授权。', completed: '原生登录流程已完成。',
  failed: '原生登录未完成，可重新尝试。', cancelled: '登录已取消。', expired: '登录已超时，请重新尝试。',
  cleanup_unconfirmed: '原生登录进程尚未退出，请重试取消。'
}

export function ClineNativeLogin({ disabled, onCheck, onActiveChange }: { disabled: boolean; onCheck(): void; onActiveChange(active: boolean): void }): React.JSX.Element {
  const client = useThreadClient()
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const current = useRef<Attempt | null>(null)
  const checked = useRef<string | null>(null)
  const alive = useRef(true)
  const active = attempt?.status === 'running' || attempt?.status === 'cleanup_unconfirmed'
  const apply = (next: Attempt): void => { current.current = next; if (alive.current) setAttempt(next) }
  useEffect(() => { onActiveChange(Boolean(active) || busy) }, [active, busy, onActiveChange])
  useEffect(() => {
    if (attempt?.status === 'completed' && checked.current !== attempt.attemptId) {
      checked.current = attempt.attemptId
      onCheck()
    }
  }, [attempt?.attemptId, attempt?.status, onCheck])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      const pending = current.current
      if (pending?.status === 'running' || pending?.status === 'cleanup_unconfirmed') {
        void client.request('runtime.clineLogin.cancel', { attemptId: pending.attemptId }).catch(() => undefined)
      }
    }
  }, [client])

  useEffect(() => {
    if (attempt?.status !== 'running') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      try {
        const next = await client.request<Attempt>('runtime.clineLogin.read', { attemptId: attempt.attemptId })
        if (cancelled) return
        apply(next)
        if (next.status === 'running') timer = setTimeout(() => void read(), 500)
      } catch (error) { if (!cancelled) setError(readErrorMessage(error)) }
    }
    void read()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [client, attempt?.attemptId, attempt?.status])

  const start = async (): Promise<void> => {
    setBusy(true); setError(null); setInput('')
    try {
      const next = await client.request<Attempt>('runtime.clineLogin.start', {})
      if (!alive.current) { await client.request('runtime.clineLogin.cancel', { attemptId: next.attemptId }); return }
      apply(next)
    } catch (error) { if (alive.current) setError(readErrorMessage(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  const cancel = async (): Promise<void> => {
    if (!attempt) return
    setBusy(true); setError(null); setInput('')
    try { apply(await client.request<Attempt>('runtime.clineLogin.cancel', { attemptId: attempt.attemptId })) }
    catch (error) { setError(readErrorMessage(error)) }
    finally { setBusy(false) }
  }
  const send = async (): Promise<void> => {
    if (!attempt || !input || busy) return
    setBusy(true); setError(null)
    const answer = input; setInput('')
    try { apply(await client.request<Attempt>('runtime.clineLogin.input', { attemptId: attempt.attemptId, input: answer })) }
    catch (error) { setError(readErrorMessage(error)) }
    finally { setBusy(false) }
  }
  return <section className="runtime-startup-section cline-native-login" aria-label={uiAttribute('Cline 原生登录')}>
    <div className="runtime-startup-section-heading"><h2><UiText zh="ChatGPT 账号" /></h2>
      {active ? <button type="button" className="quiet-button" disabled={busy} onClick={() => void cancel()}><UiText zh="取消登录" /></button>
        : <button type="button" className="quiet-button" disabled={disabled || busy} onClick={() => void start()}>{busy ? uiAttribute('正在启动…') : uiAttribute('登录／重新登录')}</button>}
    </div>
    <p><UiText zh="使用所选 Cline 的原生账号。登录和刷新会由 Cline 更新其凭据文件。" /></p>
    {attempt && <p role="status">{uiAttribute(LABELS[attempt.status])}</p>}
    {active && attempt?.output && <pre className="cline-native-login-output" tabIndex={0} aria-label={uiAttribute('Cline 登录输出')}>{attempt.output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')}</pre>}
    {attempt?.status === 'running' && <div className="runtime-startup-path">
      <input aria-label={uiAttribute('原生终端输入')} placeholder={uiAttribute('仅在 Cline 提示时输入')} autoComplete="off" value={input} maxLength={4096}
        onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void send() } }} disabled={busy} />
      <button type="button" className="quiet-button" disabled={busy || !input} onClick={() => void send()}><UiText zh="提交" /></button>
    </div>}
    {attempt?.status === 'completed' && <button type="button" className="quiet-button" disabled={disabled} onClick={onCheck}><UiText zh="检查状态" /></button>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>
}
