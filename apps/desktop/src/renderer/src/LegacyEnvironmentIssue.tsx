import { useRef, useState } from 'react'
import type { AdapterKind, DiagnosticCheck } from '@contracts'
import { useThreadClient } from './camp-client'
import { DialogControlIcon } from './AppDialog'
import { adapterLabel } from './runtime-products'
import { readErrorMessage } from './error-message'
import { useUiText } from './interface-language'
import './member-environment.css'

export function LegacyEnvironmentIssue({ check, disabled, onHandled }: { check: DiagnosticCheck; disabled: boolean; onHandled(): Promise<void> }): React.JSX.Element {
  const client = useThreadClient(), t = useUiText()
  const kind = check.subjectId as AdapterKind, handled = check.status === 'ok'
  const count = check.facts.find(fact => fact.key === 'variableCount')?.value ?? '0'
  const identity = check.facts.find(fact => fact.key === 'identity')?.value
  const [open, setOpen] = useState(false), [revealed, setRevealed] = useState(false)
  const [values, setValues] = useState<Record<string,string> | null>(null)
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  const read = async (reveal: boolean): Promise<void> => {
    const request = ++sequence.current
    setError(null)
    try {
      const next = await client.request<Record<string,string>>('runtime.environmentLegacy.get', { runtimeKind: kind, reveal })
      if (request !== sequence.current) return
      setValues(next); setRevealed(reveal)
    } catch (error) { if (request === sequence.current) setError(readErrorMessage(error)) }
  }
  const acknowledge = async (): Promise<void> => {
    setBusy(true); setError(null)
    try { await client.request('runtime.environmentLegacy.acknowledge', { runtimeKind: kind, identity }); await onHandled() }
    catch (error) { setError(readErrorMessage(error)) } finally { setBusy(false) }
  }
  return <article className="diagnostics-issue legacy-environment-issue">
    <span className="diagnostics-issue-mark" aria-label={handled ? t('已标记处理') : t('需要处理')}><DialogControlIcon name="settings"/></span>
    <div className="diagnostics-issue-copy"><div><h3>{handled ? t('{0} 的旧环境变量配置', adapterLabel(kind)) : t('{0} 的环境变量需要迁移', adapterLabel(kind))}</h3><span>{handled ? t('已标记处理') : t('用户操作')}</span></div>
      <p>{handled ? t('{0} 项旧配置仍保留，可按需查阅。', count) : t('环境变量配置已从“智能体”页移至“队员”页。保留的 {0} 项旧配置已停用，请将仍需使用的变量手动复制到相应队员的“环境变量”中并保存。', count)}</p>
      {!handled && <small>{t('标记已处理不会迁移配置或删除旧值。')}</small>}
    </div>
    <div className="diagnostics-issue-action">{!handled && <button type="button" className="quiet-button compact" disabled={disabled || busy} onClick={() => void acknowledge()}>{busy ? t('正在记录…') : t('标记已处理')}</button>}</div>
    <details className="diagnostics-details legacy-environment-details" open={open} onToggle={event => {
      const expanded = event.currentTarget.open; setOpen(expanded)
      if (expanded) void read(false)
      else { sequence.current++; setValues(null); setRevealed(false) }
    }}><summary><span>{t('查看旧配置')}</span><DialogControlIcon name="chevron"/></summary>
      {open && <div className="legacy-json-view"><textarea readOnly aria-label={t('{0} 旧环境配置 JSON', adapterLabel(kind))} rows={Math.min(Number(count) + 2, 12)} value={values ? JSON.stringify(values, null, 2) : ''} spellCheck={false}/><div><span>{t('只读配置')}</span><button type="button" className="quiet-button environment-reveal" disabled={!values} aria-pressed={revealed} onClick={() => void read(!revealed)}><DialogControlIcon name={revealed ? 'eye-off' : 'eye'}/>{revealed ? t('隐藏密钥') : t('显示密钥')}</button></div></div>}
    </details>
    {error && <p className="environment-error legacy-error" role="alert">{error}</p>}
  </article>
}
