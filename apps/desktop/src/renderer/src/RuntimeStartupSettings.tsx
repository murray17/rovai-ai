import { newCommandId } from '../../shared/command-id'
import { useThreadClient } from './camp-client'
import { useEffect, useId, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterKind, HealthStatus, RuntimeStartupInspection } from '@contracts'
import { configurationFromSnapshot, conflictValue, editableSnapshot, withSnapshotValue, type FieldConflict, type RuntimeStartupConfiguration, type RuntimeStartupSettings as StartupSettings } from './runtime-startup-editor'
import { AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { adapterLabel, PRODUCT_RUNTIME_LOGOS } from './runtime-products'
import { normalizedStartupConfiguration, runtimeEnvironmentErrors, runtimeStartupKey, startupEdits } from './runtime-startup-draft'
import { readErrorMessage } from './error-message'
import { UiText, uiAttribute } from './interface-language'
import { ClineNativeLogin } from './ClineNativeLogin'

const EMPTY: RuntimeStartupConfiguration = { programPath: null, environment: [] }
const INSPECTION_LABELS: Record<RuntimeStartupInspection['status'], string> = {
  missing: '未检测到程序', recognized: '已识别程序', version_unverified: '已识别程序，版本检查未完成',
  authentication_required: '已识别程序，需要登录', ready: '检查通过', check_failed: '检查未通过，请确认登录和运行环境'
}

export function RuntimeStartupSettings({ runtimeKind, health, onBack }: {
  runtimeKind: AdapterKind; health: HealthStatus | null; onBack(): void
}): React.JSX.Element {
  const client = useThreadClient()
  const [saved, setSaved] = useState<StartupSettings | null>(null)
  const [draft, setDraft] = useState<RuntimeStartupConfiguration>(EMPTY)
  const [rowIds, setRowIds] = useState<string[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'load' | 'save' | 'pick' | 'inspect' | 'check' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [inspection, setInspection] = useState<RuntimeStartupInspection | null>(null)
  const [confirmAction, setConfirmAction] = useState<'back' | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveCompleted, setSaveCompleted] = useState(false)
  const [nativeLoginActive, setNativeLoginActive] = useState(false)
  const sequence = useRef(0)
  const loaded = useRef(false)
  const state = useRef({ draft, busy, dirty: false, saved })
  const id = useId()
  const dirty = saved !== null && runtimeStartupKey(draft) !== runtimeStartupKey(saved.configuration)
  const canSave = dirty && conflicts.length === 0
  state.current = { draft, busy, dirty, saved }
  const item = health?.runtimeAvailability.find((candidate) => candidate.runtimeKind === runtimeKind)
  const initialPath = item?.discovery.executablePath ?? null
  const label = adapterLabel(runtimeKind)

  const applySaved = (settings: StartupSettings): void => {
    setSaved(settings)
    setDraft(settings.configuration)
    setRowIds(settings.configuration.environment.map(() => newCommandId()))
    setRevealed(new Set())
    setErrors({})
    setConflicts([])
  }

  useEffect(() => {
    if (loaded.current) return
    let active = true
    setBusy('load')
    setError(null)
    setLoadError(null)
    void client.request<StartupSettings>('runtime.startup.get', { runtimeKind }).then((settings) => {
      if (!active) return
      applySaved(settings); loaded.current = true
    }).catch((nextError) => { if (active) setLoadError(readErrorMessage(nextError)) })
      .finally(() => { if (active) setBusy(null) })
    return () => { active = false; if (!state.current.dirty) loaded.current = false }
  }, [client, runtimeKind, loadAttempt])

  useEffect(() => {
    return () => { sequence.current += 1 }
  }, [runtimeKind])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent): void => {
      if (state.current.dirty || state.current.busy === 'save') { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const change = (next: RuntimeStartupConfiguration): void => {
    setSaveCompleted(false)
    sequence.current += 1
    setDraft(next)
    setInspection(null)
    setError(null)
    setErrors({})
  }

  const validate = (next: RuntimeStartupConfiguration): boolean => {
    const nextErrors = runtimeEnvironmentErrors(next, health?.hostPlatform === 'windows-x64', runtimeKind)
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const inspect = async (next: RuntimeStartupConfiguration, deep = false): Promise<void> => {
    const nextErrors = runtimeEnvironmentErrors(next, health?.hostPlatform === 'windows-x64', runtimeKind)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const request = ++sequence.current
    setBusy(deep ? 'check' : 'inspect')
    setError(null)
    setInspection(null)
    try {
      const result = await client.request<RuntimeStartupInspection>(deep ? 'runtime.startup.check' : 'runtime.startup.inspect', {
        runtimeKind, configuration: normalizedStartupConfiguration({ programPath: next.programPath, environment: next.environment })
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
      const path = await client.selectRuntimeExecutable?.()
      if (path) {
        const next = { ...state.current.draft, programPath: path }
        change(next)
        setBusy(null)
        await inspect(next)
      } else setBusy(null)
    } catch (nextError) { setError(readErrorMessage(nextError)); setBusy(null) }
  }

  const save = async (): Promise<void> => {
    if (!saved || !canSave || busy || !validate(draft)) return
    const next = normalizedStartupConfiguration(draft)
    setBusy('save')
    setSaveCompleted(false)
    setError(null)
    try {
      const edits = startupEdits(saved, next)
      const response = await client.request<StartupSettings | { status: 'conflict'; latest: StartupSettings; conflicts: FieldConflict[] }>('runtime.startup.save', {
        runtimeKind, edits
      })
      if ('status' in response) {
        let merged = editableSnapshot(response.latest.configuration)
        for (const edit of edits) merged = withSnapshotValue(merged, edit.path, edit.after)
        const rebased = configurationFromSnapshot(merged)
        setSaved(response.latest)
        setDraft(rebased)
        setRowIds(rebased.environment.map(variable => rowIds[next.environment.findIndex(row => row.name === variable.name)] ?? newCommandId()))
        setConflicts(response.conflicts)
        return
      }
      applySaved(response)
      setSaveCompleted(true)
    } catch (nextError) { setError(readErrorMessage(nextError)) }
    finally { setBusy(null) }
  }

  const discard = (): void => {
    if (!saved) return
    sequence.current += 1
    setSaveCompleted(false)
    applySaved(saved)
    setInspection(null)
    setError(null)
  }

  const retryRead = (): void => {
    loaded.current = false
    setLoadAttempt((value) => value + 1)
  }

  const resolveConflict = (conflict: FieldConflict, keepMine: boolean): void => {
    if (!keepMine) {
      setDraft(current => configurationFromSnapshot(withSnapshotValue(editableSnapshot(current), conflict.path, conflict.current)))
    }
    setConflicts(current => current.filter(item => item !== conflict))
    setError(null)
  }

  const status = error ? null : inspection?.status ?? (!dirty && !saved?.reconnectRequired
    ? item?.status === 'authentication_required' ? 'authentication_required'
      : initialPath ? 'recognized' : item?.discovery.discoveryStatus === 'missing' ? 'missing' : null
    : null)
  const statusLabel = busy === 'inspect' ? uiAttribute('正在验证程序…') : busy === 'check' ? uiAttribute('正在检查状态…') : status ? uiAttribute(INSPECTION_LABELS[status]) : null
  const locked = busy !== null || saved === null || loadError !== null || nativeLoginActive
  const displayedPath = draft.programPath ?? (inspection ? inspection.executablePath :
    !dirty && !saved?.reconnectRequired && !error && busy !== 'inspect' && busy !== 'check' ? initialPath : null)
  const environmentIncomplete = (inspection?.searchEnvironment?.diagnosticCodes?.length ?? 0) > 0

  return <section className="runtime-startup-page" aria-busy={busy === 'load' || busy === 'save'}>
    <button className="quiet-button runtime-startup-back" type="button" disabled={busy !== null || nativeLoginActive}
      onClick={() => dirty ? setConfirmAction('back') : onBack()}><DialogControlIcon name="back" /><UiText zh={"智能体"} /></button>
    <header className="runtime-startup-heading">
      <span className="runtime-product-logo" aria-hidden="true"><img src={PRODUCT_RUNTIME_LOGOS[runtimeKind]} alt="" /></span>
      <div><h1>{label}</h1><p><UiText zh={"启动设置"} /></p></div>
    </header>
    {busy === 'load' && <p role="status"><UiText zh={"正在读取…"} /></p>}
    {loadError && <div className="runtime-startup-read-error" role="alert"><span>{loadError}</span><button className="quiet-button" type="button" onClick={retryRead} disabled={busy !== null}><UiText zh={"重试"} /></button></div>}
    <form className="runtime-startup-form" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="runtime-startup-section">
        <div className="runtime-startup-section-heading"><label htmlFor={`${id}-path`}><UiText zh={"程序路径"} /></label>
          <button className="quiet-button" type="button" disabled={locked || draft.programPath === null}
            onClick={() => { const next = { ...draft, programPath: null }; change(next); void inspect(next) }}><UiText zh={"恢复自动"} /></button></div>
        <div className="runtime-startup-path">
          <input id={`${id}-path`} value={displayedPath ?? ''} placeholder={client.selectRuntimeExecutable ? uiAttribute("自动检测") : uiAttribute("本机程序的绝对路径")} readOnly={Boolean(client.selectRuntimeExecutable)} disabled={locked} onChange={(event) => change({ ...draft, programPath: event.target.value || null })} title={displayedPath ?? undefined} />
          {client.selectRuntimeExecutable && <button className="quiet-button" type="button" disabled={locked} onClick={() => void choose()}><UiText zh={"选择文件"} /><DialogControlIcon name="folder" /></button>}
        </div>
        <div className="runtime-startup-inspection">
          <span role="status" className={`runtime-startup-result${status === 'authentication_required' || status === 'version_unverified' ? ' is-warning' : status === 'missing' || status === 'check_failed' ? ' is-error' : ''}`}>
            {statusLabel}{statusLabel && inspection?.reportedVersion && <span className="runtime-startup-version">{inspection.reportedVersion}</span>}
          </span>
          <button className="quiet-button" type="button" disabled={locked} onClick={() => void inspect(draft, true)}><UiText zh={"检查状态"} /><DialogControlIcon name="refresh" /></button>
        </div>
        {environmentIncomplete && <p className="runtime-startup-result is-warning" role="status"><UiText zh={"部分查找来源不可用，本次结果使用已读取的可用环境。"} /></p>}
      </section>
      {runtimeKind === 'cline-cli' && <ClineNativeLogin disabled={locked || dirty} onCheck={() => void inspect(draft, true)} onActiveChange={setNativeLoginActive} />}
      <section className="runtime-startup-section runtime-startup-environment-section">
        <div className="runtime-startup-section-heading"><h2><UiText zh={"环境变量"} /></h2><button className="quiet-button" type="button" disabled={locked || draft.environment.length >= 128}
          onClick={() => { setRowIds([...rowIds, newCommandId()]); change({ ...draft, environment: [...draft.environment, { name: '', value: '' }] }) }}><DialogControlIcon name="plus" /><UiText zh={"添加变量"} /></button></div>
        {draft.environment.length > 0 && <div className="runtime-startup-environment">
          <div className="runtime-environment-labels" aria-hidden="true"><span><UiText zh={"变量名"} /></span><span><UiText zh={"值"} /></span></div>
          {draft.environment.map((variable, index) => <div key={rowIds[index]} className="runtime-environment-row">
            <input aria-label={uiAttribute("变量名 {0}", String(index + 1))} autoComplete="off" spellCheck={false} disabled={locked} value={variable.name}
              aria-invalid={Boolean(errors[index])} aria-describedby={errors[index] ? `${id}-error-${index}` : undefined}
              onChange={(event) => change({ ...draft, environment: draft.environment.map((entry, position) => position === index ? { ...entry, name: event.target.value } : entry) })} />
            <div className="runtime-environment-value"><input aria-label={uiAttribute("变量值 {0}", String(index + 1))} autoComplete="off" spellCheck={false} disabled={locked}
              type={revealed.has(rowIds[index]) ? 'text' : 'password'} value={variable.value}
              onChange={(event) => change({ ...draft, environment: draft.environment.map((entry, position) => position === index ? { ...entry, value: event.target.value } : entry) })} />
              <button className="quiet-button runtime-startup-icon" type="button" disabled={locked} aria-label={uiAttribute("{0}变量值 {1}", String(revealed.has(rowIds[index]) ? uiAttribute("隐藏") : uiAttribute("显示")), String(index + 1))} aria-pressed={revealed.has(rowIds[index])}
                onClick={() => setRevealed((current) => { const next = new Set(current); if (next.has(rowIds[index])) next.delete(rowIds[index]); else next.add(rowIds[index]); return next })}><DialogControlIcon name={revealed.has(rowIds[index]) ? 'eye-off' : 'eye'} /></button></div>
            <button className="quiet-button runtime-startup-icon" type="button" disabled={locked} aria-label={uiAttribute("删除变量 {0}", String(index + 1))} onClick={() => {
              setRowIds(rowIds.filter((_, position) => position !== index)); change({ ...draft, environment: draft.environment.filter((_, position) => position !== index) })
            }}><DialogControlIcon name="trash" /></button>
            {errors[index] && <p className="runtime-environment-error" id={`${id}-error-${index}`} role="alert">{errors[index]}</p>}
          </div>)}
        </div>}
      </section>
      {saved && error && <p className="inline-error" role="alert">{error}</p>}
      {conflicts.map((conflict) => <div className="runtime-save-conflict" role="alert" key={JSON.stringify(conflict.path)}>
        <p>{conflict.label}<UiText zh={"也在外部修改过，请选择保留哪一项。其他编辑已保留。"} /></p>
        <p className="runtime-conflict-value"><UiText zh={"外部值："} />{conflictValue(conflict)}</p>
        <div className="runtime-conflict-actions">
          <button className="quiet-button runtime-conflict-use-mine" type="button" disabled={locked} onClick={() => resolveConflict(conflict, true)}><UiText zh={"保留我的修改"} /></button>
          <button className="quiet-button runtime-conflict-use-external" type="button" disabled={locked} onClick={() => resolveConflict(conflict, false)}><UiText zh={"采用外部修改"} /></button>
        </div>
      </div>)}
      <footer className="runtime-startup-actions">
        {saveCompleted && <span className="runtime-startup-result" role="status"><UiText zh="已保存" /></span>}
        <button className="quiet-button" type="button" disabled={!dirty || locked} onClick={discard}><UiText zh={"放弃更改"} /></button>
        <button className="quiet-button member-editor-save" type="submit" disabled={!canSave || locked}><DialogControlIcon name="save" />{busy === 'save' ? uiAttribute("正在保存…") : uiAttribute("保存")}</button>
      </footer>
    </form>
    <Dialog.Root open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" /><AppDialogContent width="compact" tone="attention">
      <AppDialogHeader title={uiAttribute("放弃更改？")} description={uiAttribute("当前编辑的启动设置尚未保存。")} />
      <AppDialogFooter><button className="quiet-button" data-dialog-autofocus onClick={() => setConfirmAction(null)}><UiText zh={"继续编辑"} /></button><button className="danger-button" onClick={onBack}><UiText zh={"放弃更改"} /></button></AppDialogFooter>
    </AppDialogContent></Dialog.Portal></Dialog.Root>
  </section>
}
