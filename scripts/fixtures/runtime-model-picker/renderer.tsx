import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, AdapterKind, RuntimeModelCatalogTarget, RuntimeModelCatalogView } from '@contracts'
import { MemberRuntimeParameters, MemberModelParameters, draftFromDefaults, type MemberRuntimeDraft } from '../../../apps/desktop/src/renderer/src/MemberRuntimeParameters'
import { onboardingRuntimeSelectionFor } from '../../../apps/desktop/src/renderer/src/OnboardingFlow'
import { MemberRuntimePicker } from '../../../apps/desktop/src/renderer/src/MemberRuntimePicker'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'

const observedAt = '2026-09-13T00:00:00Z'
function fixture(kind: AdapterKind, empty: boolean, generation: number, expired = false): AdapterInstallation {
  const installation = {
    id: `fixture-${kind}`, adapterKind: kind, generation, installationClass: 'managed_default', authScope: 'default',
    modelCatalog: { status: empty ? 'unavailable' : expired ? 'expired' : 'fresh', observedAt, revalidateAfter: observedAt, expiresAt: observedAt },
    snapshot: { probeStatus: 'ready', staleAt: null, models: empty ? [] : Array.from({ length: 24 }, (_, i) => ({ id: `vendor/model-${i}`, displayName: `${kind} 模型 ${i}`, description: i === 0 ? '模型说明' : undefined, hidden: false, deprecated: false, isDefault: i === 0,
      options: i === 2 ? [] : [{ key: kind === 'claude-code-cli' ? 'effort' : 'reasoning_effort', label: 'Effort', valueType: 'enum', values: [
        { value: 'low', label: 'Low' }, { value: 'high', label: 'High' }, ...(i === 0 ? [{ value: 'xhigh', label: 'Xhigh' }] : [])
      ], defaultValue: 'high', scope: 'run' }] })),
      permissionOptions: [{ key: kind === 'codex-cli' ? 'sandbox_mode' : 'permission_mode', label: 'permission', supported: true, choices: [{ value: 'safe', label: 'Safe' }, { value: 'full', label: 'Full' }] }, { key: 'approval_policy', supported: true, choices: [{ value: 'never', label: 'Never' }] }] },
    memberRuntimeDefaults: { adapterKind: kind, model: { mode: 'runtime_default' }, permissions: { adapterKind: kind, schemaVersion: 1, values: kind === 'codex-cli' ? { sandbox_mode: 'safe', approval_policy: 'never' } : { permission_mode: 'safe' } } },
    lastProbeAttempt: null
  } as AdapterInstallation
  if (kind === 'deepseek-harness') for (const model of installation.snapshot!.models) {
    model.runtimeMetadata = { dshSource: 'native', ...(model.isDefault ? { dshOptionsResolved: true } : {}) }
    model.options = model.isDefault ? [{ key: 'reasoning_effort', label: 'Effort', valueType: 'enum', values: [{ value: 'max', label: 'max' }], scope: 'run', defaultValue: null }] : []
  }
  return installation
}

function Fixture(): React.JSX.Element {
  const [kind, setKind] = useState<AdapterKind>('codex-cli')
  const [page, setPage] = useState('member')
  const [mode, setMode] = useState('normal')
  const [generation, setGeneration] = useState(1)
  const [catalogExpired, setCatalogExpired] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [dshReadMode, setDshReadMode] = useState('normal')
  const [observation, setObservation] = useState(0)
  const installation = fixture(kind, mode === 'empty' || mode === 'pending', generation,
    mode === 'expired-pending' || (mode === 'aging-pending' && catalogExpired))
  const [draft, setDraft] = useState<MemberRuntimeDraft>(() => draftFromDefaults(installation.memberRuntimeDefaults!))
  const state = (window as any).runtimeTest ?? { calls: 0, changes: 0, pending: [] }
  if (kind === 'deepseek-harness' && observation) installation.modelCatalog.observedAt = `2026-09-${15 + observation}T00:00:00Z`
  Object.assign(window, { runtimeTest: Object.assign(state, {
    draft, kind, generation, catalogStatus: installation.modelCatalog.status, setDisabled,
    expireCatalog: () => setCatalogExpired(true),
    setDshReadMode,
    refreshDshCatalog: () => { state.dshContext = (state.dshContext ?? 0) + 1; setObservation(value => value + 1) },
    setModel: (model: MemberRuntimeDraft['model']) => setDraft(previous => ({ ...previous, model })),
    switchKind: (next: AdapterKind) => { setKind(next); setDraft(draftFromDefaults(fixture(next, false, generation).memberRuntimeDefaults!)) },
    reset: (nextPage = 'member', nextMode = 'normal') => {
      state.changes = 0
      setPage(nextPage); setMode(nextMode); setGeneration(value => value + 1); setCatalogExpired(false); setDisabled(false)
      const item = fixture('codex-cli', false, 1); setKind('codex-cli')
      setDraft({ model: onboardingRuntimeSelectionFor('codex-cli', [item]).model!, permissions: item.memberRuntimeDefaults!.permissions })
    },
    settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))
  }) })
  const catalog = (target?: RuntimeModelCatalogTarget): Promise<RuntimeModelCatalogView> => {
    state.calls++
    if (kind === 'deepseek-harness' && target) {
      state.dshReads ??= []
      state.dshCache ??= {}
      const context = state.dshContext ?? 0
      const cachedModels = () => installation.snapshot!.models.map(item => {
        const cached = state.dshCache[item.id]
        return cached ? { ...cached, runtimeMetadata: { ...cached.runtimeMetadata,
          dshOptionsResolved: cached.runtimeMetadata.dshOptionsContext === String(state.dshContext ?? 0) } } : item
      })
      const view = (refreshStatus: RuntimeModelCatalogView['refreshStatus']): RuntimeModelCatalogView => ({
        runtimeKind: kind, selectedModelId: target.modelId, cache: { ...installation.modelCatalog },
        models: cachedModels(), refreshStatus, diagnosticCode: null
      })
      const cached = cachedModels().find(item => item.id === target.modelId)!
      const fresh = cached.runtimeMetadata?.dshOptionsResolved === true
        && Date.now() - Date.parse(String(cached.runtimeMetadata.dshOptionsObservedAt)) < 60000
      if (target.cacheOnly || fresh) return Promise.resolve(view(fresh ? 'not_required' : 'deferred'))
      state.dshPending ??= {}
      const pendingKey = JSON.stringify([target.modelId, context])
      if (state.dshPending[pendingKey]) return state.dshPending[pendingKey]
      const model = installation.snapshot!.models.find(item => item.id === target.modelId)!
      const values = state.dshValues?.[target.modelId] ?? (target.modelId.endsWith('-2') ? [] : ['high', 'xhigh'])
      const pending = new Promise<RuntimeModelCatalogView>((resolve, reject) => {
        const done = () => {
          if (context !== (state.dshContext ?? 0)) { resolve(view('deferred')); return }
          state.dshCache[target.modelId] = { ...model,
            runtimeMetadata: { dshSource: 'native', dshOptionsResolved: true, dshOptionsContext: String(context), dshOptionsObservedAt: new Date().toISOString() },
            options: values.length ? [{ key: 'reasoning_effort', label: 'Effort', valueType: 'enum', scope: 'run', defaultValue: null,
              values: values.map((value: string) => ({ value, label: value })) }] : [] }
          state.dshPublished = view('completed')
          resolve(state.dshPublished)
        }
        state.dshReads.push({ modelId: target.modelId, resolve: done, reject: () => reject(new Error('fixture unavailable')) })
        if (dshReadMode === 'failed') reject(new Error('fixture unavailable'))
        else if (dshReadMode !== 'pending') done()
      })
      state.dshPending[pendingKey] = pending
      void pending.then(() => { delete state.dshPending[pendingKey] }, () => { delete state.dshPending[pendingKey] })
      return pending
    }
    if (kind === 'deepseek-harness' && state.dshPublished) return Promise.resolve(state.dshPublished)
    if (mode === 'failed') return Promise.reject(new Error('fixture unavailable'))
    const modelsWithLowOnlyTarget = installation.snapshot!.models.map(model => model.id === 'vendor/model-1'
      ? { ...model, options: [{ ...model.options[0], values: [{ value: 'low', label: 'Low' }] }] }
      : model)
    const result = mode === 'expired-pending' || (mode === 'aging-pending' && catalogExpired)
      ? {
          runtimeKind: kind,
          cache: { ...installation.modelCatalog, status: 'fresh' as const, observedAt: '2026-09-14T00:00:00Z' },
          models: modelsWithLowOnlyTarget,
          refreshStatus: 'completed' as const,
          diagnosticCode: null
        }
      : { runtimeKind: kind, cache: { ...installation.modelCatalog, status: mode === 'aging-pending' ? 'stale' as const : installation.modelCatalog.status },
          models: mode === 'aging-pending' ? modelsWithLowOnlyTarget : installation.snapshot!.models,
          refreshStatus: 'not_required' as const, diagnosticCode: null }
    if (mode === 'pending' || mode === 'expired-pending' || (mode === 'aging-pending' && catalogExpired)) {
      return new Promise(resolve => state.pending.push(() => resolve(result)))
    }
    return Promise.resolve(result)
  }
  return <main style={{ height: '100%', overflow: 'auto', padding: 24 }}>
    <section style={{ width: 'min(740px, 100%)', margin: '0 auto' }}>
      <h1>运行配置</h1>
      <button id="before" type="button">前一项</button>
      {page === 'member' && <MemberRuntimePicker id="runtime" value={kind} disabled={disabled} isDisabled={next => !['codex-cli', 'claude-code-cli'].includes(next)} onChange={next => { if (next) state.switchKind(next) }} />}
      {page === 'member'
        ? <div className="member-editor-runtime-fields"><MemberRuntimeParameters adapterKind={kind} installation={installation} draft={draft} disabled={disabled} onOpenModelCatalog={catalog} onChange={next => { state.changes++; setDraft(next) }} /></div>
        : <MemberModelParameters adapterKind={kind} installation={installation} model={draft.model} disabled={disabled} onOpenModelCatalog={catalog} onChange={model => { state.changes++; setDraft({ ...draft, model }) }} />}
      <button id="after" type="button">下一项</button>
      <p style={{ marginTop: 360 }}>原生输入集成夹具；不启动 Core 或 Runtime。</p>
    </section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
