import { RovaiBrandMark } from '../../desktop/src/renderer/src/RovaiBrandMark'
import type { InterfaceLanguageApi } from '@contracts'
import { LanguagePreferenceOptions } from '../../desktop/src/renderer/src/LanguagePreferenceControl'
import { changeInterfaceLanguage, useUiText } from '../../desktop/src/renderer/src/interface-language'
import { useEffect, useRef, useState } from 'react'

type LoginStatus = 'restoring' | 'scanning' | 'submitting' | null

/** Authentication presentation only; session and editor ownership stay in WebEntry/ConsoleClient. */
export function WebLogin({ hostKind, status, error, onLogin, languageApi }: {
  languageApi: InterfaceLanguageApi
  hostKind: 'desktop' | 'server' | null
  status: LoginStatus
  error: string | null
  onLogin(token: string): void
}) {
  const t = useUiText()
  const [languageError, setLanguageError] = useState(false)
  const languageRequest = useRef(0)
  const [credential, setCredential] = useState('')
  const [revealed, setRevealed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pending = status === 'restoring' || status === 'scanning'
  useEffect(() => {
    if (status === null) input.current?.focus()
    else { setRevealed(false); setCredential('') }
  }, [status])

  return <main className="web-login-overlay">
    <div className="web-login-language">
      <LanguagePreferenceOptions name="web-login-language" className="onboarding-language" onChange={preference => {
        const request = ++languageRequest.current
        setLanguageError(false)
        void changeInterfaceLanguage(languageApi, preference).catch(() => { if (request === languageRequest.current) setLanguageError(true) })
      }} />
      {languageError && <p className="web-login-error" role="alert">{t('语言偏好未能保存，请重试。')}</p>}
    </div>
    <div className="web-login-stage">
      <section className="web-login" aria-labelledby="web-login-title">
        <header className="web-login-identity">
          <RovaiBrandMark className="web-login-mark" />
          <h1 id="web-login-title">{t('登录 Rovai AI')}</h1>
          <p className="web-login-description">{t('继续你的协作。')}</p>
        </header>
        {pending ? <div className="web-login-pending" role="status">
          <span className="web-login-spinner" aria-hidden="true" />
          <span>{status === 'scanning' ? t('正在扫码登录…') : t('正在恢复登录…')}</span>
        </div> : <form onSubmit={event => {
          event.preventDefault()
          if (status !== null || !credential.trim()) return
          const token = credential.trim()
          setCredential(''); setRevealed(false)
          onLogin(token)
        }}>
          <label className="web-login-label" htmlFor="administrator-token">{t('登录 Token')}</label>
          <div className="web-login-field">
            <input ref={input} id="administrator-token" name="password" type={revealed ? 'text' : 'password'}
              placeholder={t('输入 64 位的 Token')} value={credential} autoComplete="current-password"
              spellCheck={false} autoCapitalize="off" aria-invalid={!!error}
              aria-describedby={error ? 'web-login-error web-login-help' : 'web-login-help'}
              onChange={event => setCredential(event.target.value)} required disabled={status !== null} />
            <button className="web-login-reveal" type="button" disabled={status !== null}
              aria-label={revealed ? t('隐藏登录 Token') : t('显示登录 Token')} title={revealed ? t('隐藏登录 Token') : t('显示登录 Token')}
              aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                {revealed && <path d="m3 3 18 18" />}
              </svg>
            </button>
          </div>
          {error && <p id="web-login-error" className="web-login-error" role="alert">{t(error)}</p>}
          <button className="web-login-submit" type="submit" disabled={status !== null || !credential.trim()}>
            {status === 'submitting' ? t('正在登录…') : t('登录')}
          </button>
          <p id="web-login-help" className="web-login-help">{hostKind === 'desktop'
            ? t('在 Desktop「设置 → 能力 → 远程连接」中查看。')
            : hostKind === 'server' ? t('在 Server 启动终端中查看。') : t('请输入此服务的登录 Token。')}</p>
        </form>}
      </section>
    </div>
  </main>
}
