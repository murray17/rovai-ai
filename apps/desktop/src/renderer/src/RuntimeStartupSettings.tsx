import { useEffect, useId, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterKind, HealthStatus, RuntimeStartupConfiguration, RuntimeStartupInspection, RuntimeStartupSettings as StartupSettings } from '@contracts'
import { AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { adapterLabel, PRODUCT_RUNTIME_LOGOS } from './runtime-products'
import { normalizedStartupConfiguration, runtimeEnvironmentErrors, runtimeStartupKey } from './runtime-startup-draft'
import { readErrorMessage } from './error-message'

const EMPTY: RuntimeStartupConfiguration = { programPath: null, environment: [] }
const INSPECTION_LABELS: Record<RuntimeStartupInspection['status'], string> = {
  missing: '未检测到程序', recognized: '已识别程序', version_unverified: '已识别程序，版本检查未完成',
  authentication_required: '已识别程序，需要登录', ready: '检查通过', check_failed: '检查未通过，请确认登录和运行环境'
}

export function RuntimeStartupSettings({ runtimeKind, health, onBack, onReload }: {
  runtimeKind: AdapterKind; health: HealthStatus | null; onBack(): void; onReload(): Promise<void>
}): React.JSX.Element {
  const [saved, setSaved] = useState<StartupSettings | null>(null)
  const [draft, setDraft] = useState<RuntimeStartupConfiguration>(EMPTY)
  const [rowIds, setRowIds] = useState<string[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'load' | 'save' | 'pick' | 'inspect' | 'check' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [inspection, setInspection] = useState<RuntimeStartupInspection | null>(null)
  const [confirmBack, setConfirmBack] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const sequence = useRef(0)
  const loaded = useRef(false)
  const state = useRef({ draft, busy, dirty: false })
  const id = useId()
  const dirty = saved !== null && runtimeStartupKey(draft) !== runtimeStartupKey(saved.configuration)
  state.current = { draft, busy, dirty }
  const item = health?.runtimeAvailability.find((candidate) => candidate.runtimeKind === runtimeKind)
  const initialPath = item?.discovery.executablePath ?? null
  const label = adapterLabel(runtimeKind)

  const applySaved = (settings: StartupSettings): void => {
    setSaved(settings)
    setDraft(settings.configuration)
    setRowIds(settings.configuration.environment.map(() => crypto.randomUUID()))
    setRevealed(new Set())
    setErrors({})
  }

  useEffect(() => {
    if (loaded.current) return
    let active = true
    setBusy('load')
    setError(null)
    void window.rovai.request<StartupSettings>('runtime.startup.get', { runtimeKind }).then((settings) => {
      if (active) { applySaved(settings); loaded.current = true }
    }).catch((nextError) => { if (active) setError(readErrorMessage(nextError)) })
      .finally(() => { if (active) setBusy(null) })
    return () => { active = false }
  }, [runtimeKind, loadAttempt])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent): void => {
      if (state.current.dirty || state.current.busy === 'save') { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const change = (next: RuntimeStartupConfiguration): void => {
    sequence.current += 1
    setDraft(next)
    setInspection(null)
    setError(null)
    setErrors({})
  }

  const validate = (next: RuntimeStartupConfiguration): boolean => {
    const nextErrors = runtimeEnvironmentErrors(next, health?.hostPlatform === 'windows-x64')
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const inspect = async (next: RuntimeStartupConfiguration, deep = false): Promise<void> => {
    if (!validate(next)) return
    const request = ++sequence.current
    setBusy(deep ? 'check' : 'inspect')
    setError(null)
    setInspection(null)
    try {
      const result = await window.rovai.request<RuntimeStartupInspection>(deep ? 'runtime.startup.check' : 'runtime.startup.inspect', {
        runtimeKind, configuration: normalizedStartupConfiguration(next)
      })
      if (sequence.current === request) setInspection(result)
    } catch (nextError) {
      if (sequence.current === request) setError(readErrorMessage(nextError))
    } finally {
      if (sequence.current === request) setBusy(null)
    }
  }

  const choose = async (): Promise<void> => {
    setBusy('pick')
    setError(null)
    try {
      const path = await window.rovai.selectRuntimeExecutable()
      if (path) {
        const next = { ...state.current.draft, programPath: path }
        change(next)
        setBusy(null)
        await inspect(next)
      } else setBusy(null)
    } catch (nextError) { setError(readErrorMessage(nextError)); setBusy(null) }
  }

  const save = async (): Promise<void> => {
    if (!saved || !dirty || busy || !validate(draft)) return
    const next = normalizedStartupConfiguration(draft)
    setBusy('save')
    setError(null)
    try {
      const settings = await window.rovai.request<StartupSettings>('runtime.startup.save', {
        runtimeKind, expectedRevision: saved.revision, configuration: next
      })
      applySaved(settings)
      try { await onReload() } catch { setError('已保存，列表刷新失败。') }
    } catch (nextError) { setError(readErrorMessage(nextError)) }
    finally { setBusy(null) }
  }

  const discard = (): void => {
    if (!saved) return
    sequence.current += 1
    applySaved(saved)
    setInspection(null)
    setError(null)
  }

  const status = inspection?.status ?? (!dirty
    ? item?.status === 'authentication_required' ? 'authentication_required'
      : initialPath ? 'recognized' : item?.discovery.discoveryStatus === 'missing' ? 'missing' : null
    : null)
  const statusLabel = busy === 'inspect' ? '正在验证程序…' : busy === 'check' ? '正在检查状态…' : status ? INSPECTION_LABELS[status] : null
  const locked = busy !== null || saved === null

  return <section className="runtime-startup-page" aria-busy={busy === 'load' || busy === 'save'}>
    <button className="quiet-button runtime-startup-back" type="button" disabled={busy !== null}
      onClick={() => dirty ? setConfirmBack(true) : onBack()}><DialogControlIcon name="back" />运行时</button>
    <header className="runtime-startup-heading">
      <span className="runtime-product-logo" aria-hidden="true"><img src={PRODUCT_RUNTIME_LOGOS[runtimeKind]} alt="" /></span>
      <div><h1>{label}</h1><p>启动设置</p></div>
    </header>
    {busy === 'load' && <p role="status">正在读取…</p>}
    <form className="runtime-startup-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="runtime-startup-section">
        <div className="runtime-startup-section-heading"><label htmlFor={`${id}-path`}>程序路径</label>
          <button className="quiet-button" type="button" disabled={locked || draft.programPath === null}
            onClick={() => { const next = { ...draft, programPath: null }; change(next); void inspect(next) }}>恢复自动</button></div>
        <div className="runtime-startup-path">
          <input id={`${id}-path`} value={draft.programPath ?? (inspection ? inspection.executablePath ?? '' : initialPath ?? '')} placeholder="自动检测" readOnly title={draft.programPath ?? inspection?.executablePath ?? initialPath ?? undefined} />
          <button className="quiet-button" type="button" disabled={locked} onClick={() => void choose()}>选择文件<DialogControlIcon name="folder" /></button>
        </div>
        <div className="runtime-startup-inspection">
          <span role="status" className={`runtime-startup-result${status === 'authentication_required' || status === 'version_unverified' ? ' is-warning' : status === 'missing' || status === 'check_failed' ? ' is-error' : ''}`}>
            {statusLabel}{statusLabel && inspection?.reportedVersion && <span className="runtime-startup-version">{inspection.reportedVersion}</span>}
          </span>
          <button className="quiet-button" type="button" disabled={locked} onClick={() => void inspect(draft, true)}>检查状态<DialogControlIcon name="refresh" /></button>
        </div>
      </section>
      <section className="runtime-startup-section">
        <div className="runtime-startup-section-heading"><h2>环境变量</h2><button className="quiet-button" type="button" disabled={locked || draft.environment.length >= 128}
          onClick={() => { setRowIds([...rowIds, crypto.randomUUID()]); change({ ...draft, environment: [...draft.environment, { name: '', value: '' }] }) }}><DialogControlIcon name="plus" />添加变量</button></div>
        {draft.environment.length > 0 && <div className="runtime-startup-environment">
          <div className="runtime-environment-labels" aria-hidden="true"><span>变量名</span><span>值</span></div>
          {draft.environment.map((variable, index) => <div key={rowIds[index]} className="runtime-environment-row">
            <input aria-label={`变量名 ${index + 1}`} autoComplete="off" spellCheck={false} disabled={locked} value={variable.name}
              aria-invalid={Boolean(errors[index])} aria-describedby={errors[index] ? `${id}-error-${index}` : undefined}
              onChange={(event) => change({ ...draft, environment: draft.environment.map((entry, position) => position === index ? { ...entry, name: event.target.value } : entry) })} />
            <div className="runtime-environment-value"><input aria-label={`变量值 ${index + 1}`} autoComplete="off" spellCheck={false} disabled={locked}
              type={revealed.has(rowIds[index]) ? 'text' : 'password'} value={variable.value}
              onChange={(event) => change({ ...draft, environment: draft.environment.map((entry, position) => position === index ? { ...entry, value: event.target.value } : entry) })} />
              <button className="quiet-button runtime-startup-icon" type="button" disabled={locked} aria-label={`${revealed.has(rowIds[index]) ? '隐藏' : '显示'}变量值 ${index + 1}`} aria-pressed={revealed.has(rowIds[index])}
                onClick={() => setRevealed((current) => { const next = new Set(current); if (next.has(rowIds[index])) next.delete(rowIds[index]); else next.add(rowIds[index]); return next })}><DialogControlIcon name={revealed.has(rowIds[index]) ? 'eye-off' : 'eye'} /></button></div>
            <button className="quiet-button runtime-startup-icon" type="button" disabled={locked} aria-label={`删除变量 ${index + 1}`} onClick={() => {
              setRowIds(rowIds.filter((_, position) => position !== index)); change({ ...draft, environment: draft.environment.filter((_, position) => position !== index) })
            }}><DialogControlIcon name="trash" /></button>
            {errors[index] && <p className="runtime-environment-error" id={`${id}-error-${index}`} role="alert">{errors[index]}</p>}
          </div>)}
        </div>}
      </section>
      {saved && error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="runtime-startup-actions">
        <button className="quiet-button" type="button" disabled={!dirty || locked} onClick={discard}>放弃更改</button>
        <button className="quiet-button member-editor-save" type="submit" disabled={!dirty || locked}><DialogControlIcon name="save" />{busy === 'save' ? '正在保存…' : '保存'}</button>
      </footer>
    </form>
    {!saved && error && <div className="inline-error" role="alert">{error}<button className="quiet-button" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取</button></div>}
    <Dialog.Root open={confirmBack} onOpenChange={setConfirmBack}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" /><AppDialogContent width="compact" tone="attention">
      <AppDialogHeader title="放弃更改？" description="当前编辑的启动设置尚未保存。" />
      <AppDialogFooter><button className="quiet-button" data-dialog-autofocus onClick={() => setConfirmBack(false)}>继续编辑</button><button className="danger-button" onClick={onBack}>放弃更改</button></AppDialogFooter>
    </AppDialogContent></Dialog.Portal></Dialog.Root>
  </section>
}
