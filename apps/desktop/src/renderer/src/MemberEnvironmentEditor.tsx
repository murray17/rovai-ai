import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AdapterKind, ModelSelection } from '@contracts'
import { useThreadClient } from './camp-client'
import { DialogControlIcon } from './AppDialog'
import { uiAttribute as t, useInterfaceLanguage } from './interface-language'
import { readErrorMessage } from './error-message'
import { ENVIRONMENT_PLACEHOLDER, SAVED_ENVIRONMENT_VALUE, environmentNeedsConsent, environmentText, parseMemberEnvironment, sensitiveEnvironmentName, type MemberEnvironmentEdit, type MemberEnvironmentSnapshot } from './member-environment'
import './member-environment.css'

type Draft = { snapshot: MemberEnvironmentSnapshot; text: string; error: string; loading: boolean; revealed: boolean; consent: boolean; saved: boolean }
const empty = (): Draft => ({ snapshot: { revision: 0, environment: {} }, text: '', error: '', loading: true, revealed: false, consent: false, saved: false })

export function useMemberEnvironment(memberId: string, kind: AdapterKind | '', memberVersion: number, model: ModelSelection | undefined, windows: boolean) {
  const client = useThreadClient()
  const key = `${memberId}:${kind}`
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const current = drafts[key] ?? empty()
  const state = useRef({ key, current }); state.current = { key, current }
  const sequence = useRef(0)
  const revealSequence = useRef(0)
  const patch = useCallback((change: Partial<Draft>): void => setDrafts(all => ({ ...all, [key]: { ...(all[key] ?? empty()), ...change } })), [key])
  const load = useCallback(async (force = false): Promise<void> => {
    if (!kind) return
    const request = ++sequence.current
    try {
      const snapshot = await client.request<MemberEnvironmentSnapshot>('member.runtimeEnvironment.get', { memberId, adapterKind: kind })
      if (request !== sequence.current) return
      setDrafts(all => {
        const previous = all[key]
        if (!force && previous && previous.text !== environmentText(previous.snapshot.environment)) {
          return { ...all, [key]: { ...previous, loading: false, error: snapshot.revision !== previous.snapshot.revision ? t('运行环境已在其他位置更新，请重新读取。') : previous.error } }
        }
        return { ...all, [key]: { ...empty(), snapshot, text: environmentText(snapshot.environment), loading: false } }
      })
    } catch (error) { if (request === sequence.current) patch({ error: readErrorMessage(error), loading: true }) }
  }, [client, key, kind, memberId, patch])
  useEffect(() => { void load(); return () => { sequence.current++ } }, [load, memberVersion])
  let parsed: Record<string, string> = {}, parseError = ''
  try { parsed = parseMemberEnvironment(current.text, windows, kind, model) } catch (error) { parseError = readErrorMessage(error) }
  const dirty = current.text !== environmentText(current.snapshot.environment)
  const needsConsent = !parseError && environmentNeedsConsent(current.snapshot.environment, parsed)
  const mask = (): void => {
    revealSequence.current++
    if (current.revealed && !parseError) {
      for (const [name, value] of Object.entries(current.snapshot.environment)) if (sensitiveEnvironmentName(name) && value !== '' && parsed[name] === value) parsed[name] = SAVED_ENVIRONMENT_VALUE
      const masked = Object.fromEntries(Object.entries(current.snapshot.environment).map(([name,value]) => [name, sensitiveEnvironmentName(name) && value !== '' ? SAVED_ENVIRONMENT_VALUE : value]))
      patch({ text: environmentText(parsed), snapshot: { ...current.snapshot, environment: masked }, revealed: false })
    }
  }
  return {
    ...current, dirty, needsConsent, count: Object.keys(current.snapshot.environment).length,
    hasSecrets: Object.entries(current.snapshot.environment).some(([name, value]) => sensitiveEnvironmentName(name) && value !== ''),
    update(text: string) { patch({ text, consent: false, error: '', saved: false }) },
    setConsent(consent: boolean) { patch({ consent, error: '' }) },
    reset() { revealSequence.current++; setDrafts({}); void load(true) },
    async savedSuccessfully() { await load(true); patch({ saved: true }) },
    edit(): MemberEnvironmentEdit | undefined {
      const invalidMarker = Object.entries(parsed).some(([name,value]) => value === SAVED_ENVIRONMENT_VALUE && (!sensitiveEnvironmentName(name) || !Object.hasOwn(current.snapshot.environment, name)))
      const error = parseError || (invalidMarker ? t('请填写真实值；“<saved>”仅用于保留已有凭据。') : '') || (needsConsent && !current.consent ? t('请确认原凭据仍适用于新地址，或直接替换 JSON 中的凭据。') : '')
      if (error) { patch({ error }); throw new Error(error) }
      if (!dirty) return undefined
      return { expectedRevision: current.snapshot.revision, json: current.text, confirmTargetChange: current.consent }
    },
    async toggleReveal() {
      if (current.revealed) { mask(); return }
      if (parseError) { patch({ error: parseError }); return }
      const originalText = current.text
      const revealRequest = ++revealSequence.current
      try {
        const snapshot = await client.request<MemberEnvironmentSnapshot>('member.runtimeEnvironment.get', { memberId, adapterKind: kind, reveal: true })
        if (revealRequest !== revealSequence.current || state.current.key !== key || state.current.current.text !== originalText) return
        if (snapshot.revision !== current.snapshot.revision) throw new Error(t('运行环境已在其他位置更新，请重新读取。'))
        for (const [name, value] of Object.entries(snapshot.environment)) if (parsed[name] === SAVED_ENVIRONMENT_VALUE) parsed[name] = value
        patch({ text: environmentText(parsed), snapshot, revealed: true })
      } catch (error) { patch({ error: readErrorMessage(error) }) }
    }, mask
  }
}

export function MemberEnvironmentEditor({ environment: env, disabled }: { environment: ReturnType<typeof useMemberEnvironment>; disabled: boolean }): React.JSX.Element {
  useInterfaceLanguage()
  const id = useId(), textarea = useRef<HTMLTextAreaElement>(null), [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element || !open) return
    const fit = (): void => {
      if (!element.clientWidth) return
      element.style.height = 'auto'
      const style = getComputedStyle(element)
      element.style.height = `${element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`
    }
    fit()
    let previousWidth = -1
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width !== previousWidth) { previousWidth = entry.contentRect.width; fit() } })
    observer.observe(element)
    return () => observer.disconnect()
  }, [env.text, open])
  useEffect(() => { if (env.error) setOpen(true) }, [env.error])
  return <details className="member-environment-disclosure" open={open} onToggle={event => { setOpen(event.currentTarget.open); if (!event.currentTarget.open) env.mask() }}>
    <summary className="member-environment-entry"><DialogControlIcon name="chevron"/><span>{t('环境变量')}</span>{env.count > 0 && <small>{t('{0} 项', env.count)}</small>}</summary>
    <div className="member-environment-body">
      <textarea ref={textarea} id={id} className="member-environment-json" aria-label={t('环境变量 JSON')} aria-invalid={!!env.error} aria-describedby={env.error ? `${id}-error` : undefined} placeholder={ENVIRONMENT_PLACEHOLDER} value={env.text} disabled={disabled || env.loading} spellCheck={false} autoComplete="off" rows={4} onChange={event => env.update(event.target.value)}/>
      {env.error && <p id={`${id}-error`} className="environment-error" role="alert">{env.error}{env.loading && <button type="button" className="quiet-button" onClick={env.reset}>{t('重试')}</button>}</p>}
      {env.hasSecrets && <div className="environment-caption"><button type="button" className="quiet-button environment-reveal" onClick={() => void env.toggleReveal()} disabled={disabled || env.loading} aria-pressed={env.revealed}><DialogControlIcon name={env.revealed ? 'eye-off' : 'eye'}/>{env.revealed ? t('隐藏密钥') : t('显示密钥')}</button></div>}
      {env.hasSecrets && !env.revealed && <p className="environment-secret-hint">{t('保留“<saved>”沿用原凭据，替换其内容即可更新。')}</p>}
      {env.needsConsent && <label className="environment-consent"><input type="checkbox" checked={env.consent} disabled={disabled} onChange={event => env.setConsent(event.target.checked)}/>{t('原凭据仍适用于新地址')}</label>}
      {env.saved && <p className="environment-saved" role="status">{t('已保存，将在后续运行中生效。')}</p>}
    </div>
  </details>
}
