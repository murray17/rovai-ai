import { newCommandId } from '../../shared/command-id'
import { useThreadClient } from './camp-client'
import { useEffect, useId, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterKind, HealthStatus, RuntimeApiKeyChange, RuntimeStartupInspection } from '@contracts'
import { configurationFromSnapshot, conflictValue, editableSnapshot, initialConfiguration, withSnapshotValue, type FieldConflict, type RuntimeStartupConfiguration, type RuntimeStartupSettings as StartupSettings } from './runtime-connection-editor'
import { AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { adapterLabel, PRODUCT_RUNTIME_LOGOS } from './runtime-products'
import { customApiError, emptyCustomApi, nativeConnectionChange, normalizedStartupConfiguration, runtimeEnvironmentErrors, runtimeStartupKey, startupEdits } from './runtime-startup-draft'
import { RuntimeCustomApiFields } from './RuntimeCustomApiFields'
import { readErrorMessage } from './error-message'
import { UiText, uiAttribute } from './interface-language'

const EMPTY: RuntimeStartupConfiguration = { programPath: null, environment: [] }
const INSPECTION_LABELS: Record<RuntimeStartupInspection['status'], string> = {
  missing: '未检测到程序', recognized: '已识别程序', version_unverified: '已识别程序，版本检查未完成',
  authentication_required: '已识别程序，需要登录', ready: '检查通过', check_failed: '检查未通过，请确认登录和运行环境'
}

export function RuntimeStartupSettings({ runtimeKind, health, onBack, onReload }: {
  runtimeKind: AdapterKind; health: HealthStatus | null; onBack(): void; onReload(): Promise<void>
}): React.JSX.Element {
  const client = useThreadClient()
  const [saved, setSaved] = useState<StartupSettings | null>(null)
  const [draft, setDraft] = useState<RuntimeStartupConfiguration>(EMPTY)
  const [apiKey, setApiKey] = useState<RuntimeApiKeyChange>({ action: 'keep' })
  const [formGeneration, setFormGeneration] = useState(0)
  const [rowIds, setRowIds] = useState<string[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'load' | 'save' | 'pick' | 'inspect' | 'check' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [inspection, setInspection] = useState<RuntimeStartupInspection | null>(null)
  const [confirmAction, setConfirmAction] = useState<'back' | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const sequence = useRef(0)
  const loaded = useRef(false)
  const state = useRef({ draft, busy, dirty: false })
  const id = useId()
  const dirty = saved !== null && (apiKey.action !== 'keep' || runtimeStartupKey(draft) !== runtimeStartupKey(initialConfiguration(saved)))
  const customApi = draft.customApi ?? emptyCustomApi(runtimeKind)
  const canSave = dirty && conflicts.length === 0
  state.current = { draft, busy, dirty }
  const item = health?.runtimeAvailability.find((candidate) => candidate.runtimeKind === runtimeKind)
  const initialPath = item?.discovery.executablePath ?? null
  const label = adapterLabel(runtimeKind)

  const applySaved = (settings: StartupSettings): void => {
    setSaved(settings)
    setDraft(initialConfiguration(settings))
    setApiKey({ action: 'keep' })
    setFormGeneration((value) => value + 1)
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
    setSaveNotice(null)
    void client.request<StartupSettings>('runtime.startup.get', { runtimeKind }).then((settings) => {
      if (active) { applySaved(settings); loaded.current = true }
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
    sequence.current += 1
    setDraft(next)
    setInspection(null)
    setError(null)
    setSaveNotice(null)
    setErrors({})
  }

  const validate = (next: RuntimeStartupConfiguration): boolean => {
    const nextErrors = runtimeEnvironmentErrors(next, health?.hostPlatform === 'windows-x64')
    setErrors(nextErrors)
    const connectionChanged = saved ? nativeConnectionChange(saved, next, apiKey) !== null : false
    const apiError = connectionChanged ? customApiError(next, apiKey, saved?.credential ?? undefined) : null
    setError(apiError ? uiAttribute(apiError) : null)
    return Object.keys(nextErrors).length === 0 && !apiError
  }

  const inspect = async (next: RuntimeStartupConfiguration, deep = false): Promise<void> => {
    if (!validate(next)) return
    const request = ++sequence.current
    setBusy(deep ? 'check' : 'inspect')
    setError(null)
    setInspection(null)
    try {
      const result = await client.request<RuntimeStartupInspection>(deep ? 'runtime.startup.check' : 'runtime.startup.inspect', {
        runtimeKind, configuration: normalizedStartupConfiguration(next), apiKey
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
    setError(null)
    try {
      const edits = startupEdits(saved, next, apiKey)
      const settings = await client.request<StartupSettings | { status: 'conflict'; latest: StartupSettings; conflicts: FieldConflict[] }>('runtime.startup.save', {
        runtimeKind, edits, apiKey
      })
      if ('status' in settings && settings.status === 'conflict') {
        // Rebase untouched fields from the new read, preserving every local edit and the write-only Key input.
        let merged = editableSnapshot(initialConfiguration(settings.latest))
        for (const edit of edits) if (edit.path[0] !== 'credentialVersion') merged = withSnapshotValue(merged, edit.path, edit.after)
        const rebased = configurationFromSnapshot(next, merged)
        setSaved(settings.latest)
        setDraft(rebased)
        setRowIds(rebased.environment.map(variable => rowIds[next.environment.findIndex(row => row.name === variable.name)] ?? newCommandId()))
        setConflicts(settings.conflicts)
        return
      }
      if ('status' in settings) return
      applySaved(settings)
      setSaveNotice(settings.reconnectRequired ? settings.nativeWritten ? '已写入原生配置。运行中的实例需重新连接。' : '连接方式已保存。运行中的实例需重新连接。' : '已保存。')
      try { await onReload() } catch { setError(uiAttribute('已保存，列表刷新失败。')) }
    } catch (nextError) { setError(readErrorMessage(nextError)) }
    finally { setBusy(null) }
  }

  const discard = (): void => {
    if (!saved) return
    sequence.current += 1
    applySaved(saved)
    setInspection(null)
    setError(null)
    setSaveNotice(null)
  }

  const retryRead = (): void => {
    loaded.current = false
    setLoadAttempt((value) => value + 1)
  }

  const resolveConflict = (conflict: FieldConflict, keepMine: boolean): void => {
    if (!keepMine) {
      if (conflict.path[0] === 'credentialVersion') setApiKey({ action: 'keep' })
      else setDraft(current => configurationFromSnapshot(current, withSnapshotValue(editableSnapshot(current), conflict.path, conflict.current)))
    }
    setConflicts(current => current.filter(item => item !== conflict))
    setError(null)
  }

  const status = error ? null : inspection?.status ?? (!dirty
    ? item?.status === 'authentication_required' ? 'authentication_required'
      : initialPath ? 'recognized' : item?.discovery.discoveryStatus === 'missing' ? 'missing' : null
    : null)
  const statusLabel = busy === 'inspect' ? uiAttribute('正在验证程序…') : busy === 'check' ? uiAttribute('正在检查状态…') : status ? uiAttribute(INSPECTION_LABELS[status]) : null
  const locked = busy !== null || saved === null || loadError !== null
  const displayedPath = draft.programPath ?? (inspection ? inspection.executablePath :
    !dirty && !error && busy !== 'inspect' && busy !== 'check' ? initialPath : null)
  const environmentIncomplete = (inspection?.searchEnvironment?.diagnosticCodes?.length ?? 0) > 0

  return <section className="runtime-startup-page" aria-busy={busy === 'load' || busy === 'save'}>
    <button className="quiet-button runtime-startup-back" type="button" disabled={busy !== null}
      onClick={() => dirty ? setConfirmAction('back') : onBack()}><DialogControlIcon name="back" /><UiText zh={"智能体"} /></button>
    <header className="runtime-startup-heading">
      <span className="runtime-product-logo" aria-hidden="true"><img src={PRODUCT_RUNTIME_LOGOS[runtimeKind]} alt="" /></span>
      <div><h1>{label}</h1><p><UiText zh={"启动设置"} /></p></div>
    </header>
    {busy === 'load' && <p role="status"><UiText zh={"正在读取…"} /></p>}
    {loadError && <div className="runtime-native-read-error" role="alert"><span>{loadError}</span><button className="quiet-button" type="button" onClick={retryRead} disabled={busy !== null}><UiText zh={"重试"} /></button></div>}
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
      {saved?.connectionReadError && <div className="runtime-native-read-error" role="alert"><span>{saved.connectionReadError}</span><button className="quiet-button" type="button" disabled={busy !== null || dirty} onClick={retryRead}><UiText zh="重试" /></button></div>}
      {!saved?.connectionReadError && customApi && <RuntimeCustomApiFields key={formGeneration} value={customApi} apiKey={apiKey}
        credential={saved?.credential ?? undefined} disabled={locked}
        observation={saved?.connectionObservation ?? undefined}
        onChange={(customApi) => change({ ...draft, customApi })}
        onKeyChange={(value) => { change({ ...draft, customApi }); setApiKey(value) }} />}
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
        <p className="runtime-conflict-value"><UiText zh={"外部值："} />{conflictValue(conflict, editableSnapshot(initialConfiguration(saved!)))}</p>
        <div className="runtime-conflict-actions">
          <button className="quiet-button runtime-conflict-use-mine" type="button" disabled={locked} onClick={() => resolveConflict(conflict, true)}><UiText zh={"保留我的修改"} /></button>
          <button className="quiet-button runtime-conflict-use-external" type="button" disabled={locked} onClick={() => resolveConflict(conflict, false)}><UiText zh={"采用外部修改"} /></button>
        </div>
      </div>)}
      {saveNotice && <p className="runtime-native-save-notice" role="status">{uiAttribute(saveNotice)}</p>}
      <footer className="runtime-startup-actions">
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
