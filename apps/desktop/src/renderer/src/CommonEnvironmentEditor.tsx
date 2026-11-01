import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { AdapterKind } from '@contracts'
import { useThreadClient } from './camp-client'
import { uiAttribute as t, useInterfaceLanguage } from './interface-language'
import { readErrorMessage } from './error-message'
import { COMMON_ENVIRONMENT_CHANGED, ENVIRONMENT_PLACEHOLDER, environmentText, parseMemberEnvironment, type EnvironmentSnapshot } from './member-environment'
import './member-environment.css'

export function EnvironmentJson({ value, onChange, id, label, disabled, readOnly = false, error, placeholder = ENVIRONMENT_PLACEHOLDER }: {
  value: string; onChange(value: string): void; id: string; label: string; disabled: boolean; readOnly?: boolean; error?: string; placeholder?: string
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (): void => {
      if (!el.clientWidth) return
      el.style.height = 'auto'
      const style = getComputedStyle(el)
      el.style.height = `${el.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`
    }
    fit()
    let width = el.clientWidth
    const observer = new ResizeObserver(() => { if (width !== el.clientWidth) { width = el.clientWidth; fit() } })
    observer.observe(el)
    return () => observer.disconnect()
  }, [value])
  return <textarea ref={ref} id={id} className="member-environment-json" value={value} onChange={e => onChange(e.target.value)}
    aria-label={label} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} readOnly={readOnly} disabled={disabled}
    placeholder={placeholder} rows={4} spellCheck={false} autoComplete="off"/>
}

export function useCommonEnvironment(kind: AdapterKind, windows: boolean) {
  const client = useThreadClient()
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot | null>(null)
  const [text, setText] = useState(''), [error, setError] = useState('')
  const sequence = useRef(0)
  let parsed: Record<string,string> = {}, parseError = ''
  try { parsed = parseMemberEnvironment(text, windows, kind, undefined) } catch (e) { parseError = readErrorMessage(e) }
  const accept = (next: EnvironmentSnapshot): void => {
    sequence.current++; setSnapshot(next); setText(environmentText(next.environment)); setError(next.error ? t('通用环境变量无法读取。原记录已保留，请重新填写后保存。') : '')
  }
  const edit = (): { expectedRevision: number; json: string } => {
    const problem = parseError || (snapshot?.error && text === environmentText(snapshot.environment) ? t('通用环境变量无法读取。原记录已保留，请重新填写后保存。') : '')
    if (problem || !snapshot) { setError(problem || t('正在读取…')); throw new Error(problem) }
    return { expectedRevision: snapshot.revision, json: JSON.stringify(parsed) }
  }
  return {
    text, error, loading: snapshot === null, dirty: snapshot !== null && text !== environmentText(snapshot.environment),
    accept, edit, fail: setError,
    async reload() {
      const request = ++sequence.current
      try { const next = await client.request<EnvironmentSnapshot>('runtime.environment.get', { runtimeKind: kind }); if (request === sequence.current) accept(next) }
      catch (e) { if (request === sequence.current) setError(readErrorMessage(e)) }
    },
    update(value: string) { sequence.current++; setText(value); setError('') },
    discard() { if (snapshot) accept(snapshot) },
    saved(next: EnvironmentSnapshot) { accept(next); window.dispatchEvent(new CustomEvent(COMMON_ENVIRONMENT_CHANGED, { detail: kind })) },
  }
}

export function CommonEnvironmentEditor({ environment: env, disabled, onChange }: {
  environment: ReturnType<typeof useCommonEnvironment>; disabled: boolean; onChange(): void
}): React.JSX.Element {
  useInterfaceLanguage()
  const id = useId(), [help, setHelp] = useState(false)
  return <section className="runtime-startup-section common-environment-section">
    <div className="runtime-startup-section-heading"><div className="common-environment-heading">
      <label htmlFor={id}>{t('通用环境变量')}</label>
      <button className="common-environment-help" type="button" aria-label={t('通用环境变量说明')} aria-describedby={help ? `${id}-help` : undefined}
        onMouseEnter={() => setHelp(true)} onMouseLeave={e => { if (document.activeElement !== e.currentTarget) setHelp(false) }} onFocus={() => setHelp(true)} onBlur={() => setHelp(false)} onClick={() => setHelp(true)}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setHelp(false) } }}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M7.8 7.2a2.2 2.2 0 0 1 4.4.2c0 1.6-2.2 1.8-2.2 3.3M10 13.7v.1"/></svg>
      </button>
      {help && <span id={`${id}-help`} role="tooltip" className="common-environment-tooltip">{t('用于在不同队员之间共享一些配置变量。')}</span>}
    </div></div>
    <EnvironmentJson id={id} value={env.text} onChange={value => { env.update(value); onChange() }} disabled={disabled || env.loading} error={env.error} label={t('通用环境变量 JSON')}/>
    {env.error && <p id={`${id}-error`} className="environment-error" role="alert">{env.error}<button type="button" className="quiet-button" disabled={disabled} onClick={() => { onChange(); void env.reload() }}>{t('重新读取')}</button></p>}
  </section>
}
