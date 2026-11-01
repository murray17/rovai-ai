import { CommonEnvironmentEditor, useCommonEnvironment } from './CommonEnvironmentEditor'
import { useThreadClient } from './camp-client'
import { Activity, useCallback, useEffect, useId, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterKind, RuntimeStatus, RuntimeStartupInspection } from '@contracts'
import { configurationFromSnapshot, conflictValue, editableSnapshot, withSnapshotValue, type FieldConflict, type RuntimeStartupConfiguration, type RuntimeStartupSettings as StartupSettings } from './runtime-startup-editor'
import { AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { adapterLabel, PRODUCT_RUNTIME_LOGOS } from './runtime-products'
import { normalizedStartupConfiguration, runtimeStartupKey, startupEdits } from './runtime-startup-draft'
import { readErrorMessage } from './error-message'
import { UiText, uiAttribute } from './interface-language'

const EMPTY: RuntimeStartupConfiguration = { programPath: null, environment: [] }
const INSPECTION_LABELS: Record<RuntimeStartupInspection['status'], string> = {
  missing: '未检测到程序', recognized: '已识别程序', version_unverified: '已识别程序，版本检查未完成',
  authentication_required: '认证未通过，请检查登录状态或凭据配置', ready: '检查通过', check_failed: '检查未通过，请检查运行环境'
}

export type RuntimeStartupLeaveGuard = () => Promise<boolean>

export function RuntimeStartupSettings({ runtimeKind, health, onBack, backLabel, active = true, onLeaveGuardChange }: {
  runtimeKind: AdapterKind; health: RuntimeStatus | null; onBack(): void; backLabel?: string; active?: boolean
  onLeaveGuardChange?(guard: RuntimeStartupLeaveGuard | null): void
}): React.JSX.Element {
  const client = useThreadClient()
  const common = useCommonEnvironment(runtimeKind, health?.hostPlatform === 'windows-x64')
  const [saved, setSaved] = useState<StartupSettings | null>(null)
  const [draft, setDraft] = useState<RuntimeStartupConfiguration>(EMPTY)
  const [busy, setBusy] = useState<'load' | 'save' | 'pick' | 'inspect' | 'check' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [inspection, setInspection] = useState<RuntimeStartupInspection | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const pendingLeave = useRef<{ promise: Promise<boolean>; resolve(allowed: boolean): void } | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveCompleted, setSaveCompleted] = useState(false)
  const sequence = useRef(0)
  const loaded = useRef(false)
  const state = useRef({ draft, busy, dirty: false, saved })
  const id = useId()
  const startupDirty = saved !== null && (runtimeStartupKey(draft) !== runtimeStartupKey(saved.configuration) || Boolean(saved.configuration.configurationError && !draft.configurationError))
  const dirty = startupDirty || common.dirty
  const canSave = dirty && conflicts.length === 0 && (!saved?.configuration.configurationError || startupDirty)
  state.current = { draft, busy, dirty, saved }
  const item = health?.runtimeAvailability.find((candidate) => candidate.runtimeKind === runtimeKind)
  const initialPath = item?.discovery.executablePath ?? null
  const label = adapterLabel(runtimeKind)

  const requestLeave = useCallback((): Promise<boolean> => {
    if (pendingLeave.current) return pendingLeave.current.promise
    if (state.current.busy) return Promise.resolve(false)
    if (!state.current.dirty) return Promise.resolve(true)
    let resolve!: (allowed: boolean) => void
    const promise = new Promise<boolean>(complete => { resolve = complete })
    pendingLeave.current = { promise, resolve }
    setConfirmLeave(true)
    return promise
  }, [])

  useEffect(() => {
    onLeaveGuardChange?.(requestLeave)
    return () => {
      onLeaveGuardChange?.(null)
      pendingLeave.current?.resolve(false)
      pendingLeave.current = null
    }
  }, [onLeaveGuardChange, requestLeave])

  const applySaved = (settings: StartupSettings): void => {
    setSaved(settings)
    setDraft(settings.configuration)
    common.accept(settings.commonEnvironment ?? { revision: 0, environment: {} })
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
    setDraft({ ...next, configurationError: undefined })
    setInspection(null)
    setError(null)
  }

  const inspect = async (next: RuntimeStartupConfiguration, deep = false): Promise<void> => {
    if (next.configurationError) return
    const request = ++sequence.current
    setBusy(deep ? 'check' : 'inspect')
    setError(null)
    setInspection(null)
    try {
      const result = await client.request<RuntimeStartupInspection>(deep ? 'runtime.startup.check' : 'runtime.startup.inspect', {
        runtimeKind, configuration: normalizedStartupConfiguration({ programPath: next.programPath, environment: next.environment }),
        commonEnvironment: common.edit()
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
        const next = { ...state.current.draft, programPath: path, configurationError: undefined }
        change(next)
        setBusy(null)
        await inspect(next)
      } else setBusy(null)
    } catch (nextError) { setError(readErrorMessage(nextError)); setBusy(null) }
  }

  const save = async (): Promise<void> => {
    if (!saved || !canSave || busy) return
    const next = normalizedStartupConfiguration(draft)
    try { common.edit() } catch { return }
    setBusy('save')
    setSaveCompleted(false)
    setError(null)
    try {
      const edits = startupEdits(saved, next)
      const response = await client.request<StartupSettings | { status: 'conflict'; latest: StartupSettings; conflicts: FieldConflict[] }>('runtime.startup.save', {
        runtimeKind, edits, expectedRevision: saved.configuration.configurationError ? saved.revision : undefined, commonEnvironment: common.dirty ? common.edit() : undefined
      })
      if ('status' in response) {
        let merged = editableSnapshot(response.latest.configuration)
        for (const edit of edits) merged = withSnapshotValue(merged, edit.path, edit.after)
        const rebased = configurationFromSnapshot(merged)
        setSaved(response.latest)
        setDraft(rebased)
        setConflicts(response.conflicts)
        return
      }
      applySaved(response)
      if (response.commonEnvironment) common.saved(response.commonEnvironment)
      setSaveCompleted(true)
    } catch (nextError) {
      const message = readErrorMessage(nextError)
      if (message.includes('Common environment changed')) common.fail(uiAttribute('通用配置已在其他位置更新，请重新读取。'))
      else setError(message)
    }
    finally { setBusy(null) }
  }

  const discard = (): void => {
    if (!saved) return
    sequence.current += 1
    setSaveCompleted(false)
    setDraft(saved.configuration)
    setConflicts([])
    // Common settings can reload their saved baseline independently.
    common.discard()
    setInspection(null)
    setError(null)
  }

  const retryRead = (): void => {
    loaded.current = false
    setLoadAttempt((value) => value + 1)
  }

  const finishLeave = (allowed: boolean): void => {
    if (allowed) {
      discard()
      // A local Back can immediately enter the App's navigation guard again.
      state.current.dirty = false
    }
    const pending = pendingLeave.current
    pendingLeave.current = null
    setConfirmLeave(false)
    pending?.resolve(allowed)
  }

  const resolveConflict = (conflict: FieldConflict, keepMine: boolean): void => {
    if (!keepMine) {
      setDraft(current => configurationFromSnapshot(withSnapshotValue(editableSnapshot(current), conflict.path, conflict.current)))
    }
    setConflicts(current => current.filter(item => item !== conflict))
    setError(null)
  }

  const status = error || draft.configurationError ? null : inspection?.status ?? (!dirty && !saved?.reconnectRequired
    ? item?.status === 'authentication_required' ? 'authentication_required'
      : initialPath ? 'recognized' : item?.discovery.discoveryStatus === 'missing' ? 'missing' : null
    : null)
  const statusLabel = busy === 'inspect' ? uiAttribute('正在验证程序…') : busy === 'check' ? uiAttribute('正在检查状态…') : status ? uiAttribute(INSPECTION_LABELS[status]) : null
  const locked = busy !== null || saved === null || loadError !== null
  const displayedPath = draft.programPath ?? (inspection ? inspection.executablePath :
    !startupDirty && !saved?.configuration.configurationError && !saved?.reconnectRequired && !error && busy !== 'inspect' && busy !== 'check' ? initialPath : null)
  const environmentIncomplete = (inspection?.searchEnvironment?.diagnosticCodes?.length ?? 0) > 0

  // Hidden settings categories retain their draft, leave guard and confirmation dialog.
  return <><Activity mode={active ? 'visible' : 'hidden'}><section className="runtime-startup-page" aria-busy={busy === 'load' || busy === 'save'}>
    <button className="quiet-button runtime-startup-back" type="button" disabled={busy !== null}
      onClick={() => { void requestLeave().then(allowed => { if (allowed) onBack() }) }}><DialogControlIcon name="back" />{backLabel ?? uiAttribute('智能体')}</button>
    <header className="runtime-startup-heading">
      <span className="runtime-product-logo" aria-hidden="true"><img src={PRODUCT_RUNTIME_LOGOS[runtimeKind]} alt="" /></span>
      <div><h1>{label}</h1><p><UiText zh={"启动设置"} /></p></div>
    </header>
    {busy === 'load' && <p role="status"><UiText zh={"正在读取…"} /></p>}
    {loadError && <div className="runtime-startup-read-error" role="alert"><span>{loadError}</span><button className="quiet-button" type="button" onClick={retryRead} disabled={busy !== null}><UiText zh={"重试"} /></button></div>}
    {saved?.configuration.configurationError && <p className="runtime-startup-read-error" role="alert"><UiText zh="启动设置已损坏，请重新选择程序或恢复自动检测后保存。" /></p>}
    <form className="runtime-startup-form" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="runtime-startup-section">
        <div className="runtime-startup-section-heading"><label htmlFor={`${id}-path`}><UiText zh={"程序路径"} /></label>
          <button className="quiet-button" type="button" disabled={locked || (draft.programPath === null && !saved?.configuration.configurationError)}
            onClick={() => { const next = { ...draft, programPath: null, configurationError: undefined }; change(next); void inspect(next) }}><UiText zh={"恢复自动"} /></button></div>
        <div className="runtime-startup-path">
          <input id={`${id}-path`} value={displayedPath ?? ''} placeholder={client.selectRuntimeExecutable ? uiAttribute("自动检测") : uiAttribute("本机程序的绝对路径")} readOnly={Boolean(client.selectRuntimeExecutable)} disabled={locked} onChange={(event) => change({ ...draft, programPath: event.target.value || null })} title={displayedPath ?? undefined} />
          {client.selectRuntimeExecutable && <button className="quiet-button" type="button" disabled={locked} onClick={() => void choose()}><UiText zh={"选择文件"} /><DialogControlIcon name="folder" /></button>}
        </div>
        <div className="runtime-startup-inspection">
          <span role="status" className={`runtime-startup-result${status === 'authentication_required' || status === 'version_unverified' ? ' is-warning' : status === 'missing' || status === 'check_failed' ? ' is-error' : ''}`}>
            {statusLabel}{statusLabel && inspection?.reportedVersion && <span className="runtime-startup-version">{inspection.reportedVersion}</span>}
          </span>
          <button className="quiet-button" type="button" disabled={locked || Boolean(draft.configurationError)} onClick={() => void inspect(draft, true)}><UiText zh={"检查状态"} /><DialogControlIcon name="refresh" /></button>
        </div>
        {environmentIncomplete && <p className="runtime-startup-result is-warning" role="status"><UiText zh={"部分查找来源不可用，本次结果使用已读取的可用环境。"} /></p>}
      </section>

      <CommonEnvironmentEditor environment={common} disabled={locked} onChange={() => { sequence.current++; setInspection(null); setError(null); setSaveCompleted(false) }}/>
      {saved && error && <p className="inline-error" role="alert">{error}</p>}
      {conflicts.map((conflict) => <div className="runtime-save-conflict" role="alert" key={JSON.stringify(conflict.path)}>
        <p>{conflict.label}<UiText zh={"也在外部修改过，请选择保留哪一项。其他编辑已保留。"} /></p>
        <p className="runtime-conflict-value"><UiText zh={"外部值："} />{conflictValue(conflict)}</p>
        <div className="runtime-conflict-actions">
          <button className="quiet-button runtime-conflict-use-mine" type="button" disabled={locked} onClick={() => resolveConflict(conflict, true)}><UiText zh={"保留我的修改"} /></button>
          <button className="quiet-button runtime-conflict-use-external" type="button" disabled={locked} onClick={() => resolveConflict(conflict, false)}><UiText zh={"采用外部修改"} /></button>
        </div>
      </div>)}
      <footer className="runtime-startup-actions member-editor-save-row">
        <span className="member-editor-save-status" role="status">{saveCompleted && <UiText zh="已保存" />}</span>
        <div>
          <button className="quiet-button" type="button" disabled={!dirty || locked} onClick={discard}><UiText zh={"放弃更改"} /></button>
          <button className="quiet-button member-editor-save" type="submit" disabled={!canSave || locked}><DialogControlIcon name="save" />{busy === 'save' ? uiAttribute("正在保存…") : uiAttribute("保存")}</button>
        </div>
      </footer>
    </form>
  </section></Activity>
    <Dialog.Root open={confirmLeave} onOpenChange={(open) => { if (!open) finishLeave(false) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" /><AppDialogContent width="compact" tone="attention">
      <AppDialogHeader title={uiAttribute("放弃更改？")} description={uiAttribute("当前编辑的启动设置尚未保存。")} />
      <AppDialogFooter><button className="quiet-button" data-dialog-autofocus onClick={() => finishLeave(false)}><UiText zh={"继续编辑"} /></button><button className="danger-button" onClick={() => finishLeave(true)}><UiText zh={"放弃更改"} /></button></AppDialogFooter>
    </AppDialogContent></Dialog.Portal></Dialog.Root>
  </>
}
