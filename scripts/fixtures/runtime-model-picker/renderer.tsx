import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, AdapterKind, RuntimeModelCatalogTarget, RuntimeModelCatalogView } from '@contracts'
import { MemberRuntimeParameters, MemberModelParameters, draftFromDefaults, type MemberRuntimeDraft } from '../../../apps/desktop/src/renderer/src/MemberRuntimeParameters'
import { onboardingRuntimeSelectionFor } from '../../../apps/desktop/src/renderer/src/OnboardingFlow'
import { MemberRuntimePicker } from '../../../apps/desktop/src/renderer/src/MemberRuntimePicker'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'

const clockStartedAt = Date.now()
let clockNow = clockStartedAt
Date.now = () => clockNow
const observedAt = new Date(clockStartedAt).toISOString()
const cacheTimes = (at = observedAt) => ({
  observedAt: at,
  revalidateAfter: new Date(Date.parse(at) + 60000).toISOString(),
  expiresAt: new Date(Date.parse(at) + 86400000).toISOString()
})
function fixture(kind: AdapterKind, empty: boolean, generation: number, expired = false): AdapterInstallation {
  const installation = {
    id: `fixture-${kind}`, adapterKind: kind, generation, installationClass: 'managed_default', authScope: 'default',
    modelCatalog: { status: empty ? 'unavailable' : expired ? 'expired' : 'fresh', ...cacheTimes() },
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
  if (kind === 'pi') for (const [index, model] of installation.snapshot!.models.entries()) {
    model.runtimeMetadata = { piThinkingSchemaVersion: 1, piThinkingState: index === 3 ? 'unknown' : 'known' }
    model.options = index === 3 ? [] : [{ key: 'thinking_level', label: '思考强度', valueType: 'enum', scope: 'session', defaultValue: null,
      values: (index === 2 ? ['off'] : index === 0 ? ['off', 'high', 'max'] : ['off', 'low', 'high']).map(value => ({ value, label: value })) }]
  }
  if (kind === 'pi') installation.lastProbeAttempt = { id: 'old-health-failure', installationId: installation.id,
    status: 'failed', failureClass: 'transient', diagnosticCode: 'runtime_check_timed_out',
    candidatePath: '/fixture/pi', executableFingerprint: 'fixture', attemptedAt: new Date(clockStartedAt + 1000).toISOString(),
    retryAfter: null, failure: null }
  return installation
}

function Fixture(): React.JSX.Element {
  const [kind, setKind] = useState<AdapterKind>('codex-cli')
  const [page, setPage] = useState('member')
  const [visible, setVisible] = useState(true)
  const [mode, setMode] = useState('normal')
  const [generation, setGeneration] = useState(1)
  const [catalogExpired, setCatalogExpired] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [dshReadMode, setDshReadMode] = useState('normal')
  const [observation, setObservation] = useState(0)
  const [projection, setProjection] = useState<RuntimeModelCatalogView | null>(null)
  const installation = fixture(kind, mode === 'empty' || mode === 'pending', generation,
    mode === 'failed' || mode === 'failed-empty' || mode === 'expired-pending' || (mode === 'aging-pending' && catalogExpired))
  const [draft, setDraft] = useState<MemberRuntimeDraft>(() => draftFromDefaults(installation.memberRuntimeDefaults!))
  const state = (window as any).runtimeTest ?? { calls: 0, changes: 0, pending: [] }
  if (projection?.runtimeKind === kind) {
    installation.modelCatalog = projection.cache
    installation.snapshot!.models = projection.models
  }
  if (state.healthStale) installation.snapshot!.staleAt = state.healthStale
  if (kind === 'pi' && state.piInvalidated) installation.modelCatalog.status = 'invalidated'
  const nativeDshModels = kind === 'deepseek-harness' ? fixture(kind, false, generation).snapshot!.models : []
  if (kind === 'deepseek-harness' && state.dshCacheShape) {
    installation.snapshot!.models = state.dshCacheShape === 'empty' ? []
      : nativeDshModels.filter(model => model.id !== 'vendor/model-1')
  }
  if (kind === 'deepseek-harness' && observation) installation.modelCatalog.observedAt = new Date(clockStartedAt + (observation + 2) * 1000).toISOString()
  Object.assign(window, { runtimeTest: Object.assign(state, {
    draft, kind, generation, catalogStatus: installation.modelCatalog.status, setDisabled, setVisible,
    advanceClock: (milliseconds: number) => { clockNow += milliseconds },
    expireCatalog: () => setCatalogExpired(true),
    expireLive: () => { clockNow = Date.parse(state.lastCatalog.cache.revalidateAfter) + 1; setObservation(value => value + 1) },
    publishExpired: () => setProjection({ ...state.lastCatalog, cache: { ...state.lastCatalog.cache, status: 'expired', revalidateAfter: new Date(Date.now() - 1).toISOString() } }),
    publishFresh: () => setProjection({ ...state.lastCatalog, cache: { ...state.lastCatalog.cache, status: 'fresh', revalidateAfter: new Date(Date.now() + 60000).toISOString() } }),
    publishHealthFailure: () => { state.healthStale = new Date().toISOString(); setObservation(value => value + 1) },
    clearCatalogSuccess: () => setProjection({ ...state.lastCatalog, cache: { status: 'unavailable', observedAt: null, revalidateAfter: null, expiresAt: null } }),
    invalidatePiCatalog: () => { state.piInvalidated = true; setObservation(value => value + 1) },
    setDshReadMode,
    setDshCacheShape: (shape: string | null) => { state.dshCacheShape = shape; state.dshCache = {}; setObservation(value => value + 1) },
    refreshDshCatalog: () => { state.dshContext = (state.dshContext ?? 0) + 1; setGeneration(value => value + 1) },
    setModel: (model: MemberRuntimeDraft['model']) => setDraft(previous => ({ ...previous, model })),
    switchKind: (next: AdapterKind) => { setKind(next); setDraft(draftFromDefaults(fixture(next, false, generation).memberRuntimeDefaults!)) },
    reset: (nextPage = 'member', nextMode = 'normal', nextVisible = true) => {
      clockNow = clockStartedAt
      state.changes = 0
      state.lastCatalog = null; state.healthStale = null; state.holdDshCache = false; state.dshCacheReads = []; setProjection(null)
      state.piInvalidated = false; state.piCatalogModels = null; setObservation(0)
      setPage(nextPage); setVisible(nextVisible); setMode(nextMode); setGeneration(value => value + 1); setCatalogExpired(false); setDisabled(false)
      const item = fixture('codex-cli', false, 1); setKind('codex-cli')
      setDraft({ model: onboardingRuntimeSelectionFor('codex-cli', [item]).model!, permissions: item.memberRuntimeDefaults!.permissions })
    },
    settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))
  }) })
  const catalog = (target?: RuntimeModelCatalogTarget): Promise<RuntimeModelCatalogView> => {
    state.calls++
    if (kind === 'pi' && state.piCatalogModels) return Promise.resolve({ runtimeKind: kind,
      cache: { status: 'fresh', ...cacheTimes(new Date(clockStartedAt + 2000).toISOString()) }, models: state.piCatalogModels,
      refreshStatus: 'completed', diagnosticCode: null })
    if (kind === 'deepseek-harness' && target) {
      state.dshReads ??= []
      state.dshCache ??= {}
      const context = state.dshContext ?? 0
      const cachedModels = () => nativeDshModels.map(item => {
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
      if (target.cacheOnly) {
        const cachedView = view(fresh ? 'not_required' : 'deferred')
        if (state.dshCacheShape) cachedView.models = state.dshCacheShape === 'empty' ? []
          : cachedView.models.filter(model => model.id !== target.modelId)
        if (state.dshWrongIdentity) cachedView.selectedModelId = 'wrong-target'
        if (state.holdDshCache) return new Promise(resolve => {
          state.dshCacheReads.push({ modelId: target.modelId, resolve: () => resolve(cachedView) })
        })
        return Promise.resolve(cachedView)
      }
      if (fresh) return Promise.resolve(view('not_required'))
      state.dshPending ??= {}
      const pendingKey = JSON.stringify([target.modelId, context])
      if (state.dshPending[pendingKey]) return state.dshPending[pendingKey]
      const model = nativeDshModels.find(item => item.id === target.modelId)!
      const values = state.dshValues?.[target.modelId] ?? (target.modelId.endsWith('-2') ? [] : ['high', 'xhigh'])
      const pending = new Promise<RuntimeModelCatalogView>((resolve, reject) => {
        const done = () => {
          if (context !== (state.dshContext ?? 0)) { resolve(view('deferred')); return }
          state.dshCache[target.modelId] = { ...model,
            runtimeMetadata: { dshSource: 'native', dshOptionsResolved: true, dshOptionsContext: String(context), dshOptionsObservedAt: new Date(Date.now()).toISOString() },
            options: values.length ? [{ key: 'reasoning_effort', label: 'Effort', valueType: 'enum', scope: 'run', defaultValue: null,
              values: values.map((value: string) => ({ value, label: value })) }] : [] }
          state.dshPublished = view('completed')
          if (state.dshNextObservation) state.dshPublished.cache.observedAt = state.dshNextObservation
          if (state.dshMissingActual) state.dshPublished.models = state.dshPublished.models.filter((item: { id: string }) => item.id !== target.modelId)
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
    if (kind === 'deepseek-harness' && state.holdDshCatalog) {
      const captured = { runtimeKind: kind, cache: { ...installation.modelCatalog },
        models: installation.snapshot!.models, refreshStatus: 'not_required' as const, diagnosticCode: null }
      return new Promise(resolve => { state.resolveDshCatalog = () => resolve(captured) })
    }
    if (kind === 'deepseek-harness' && state.dshPublished) return Promise.resolve(state.dshPublished)
    if (mode === 'failed') return Promise.reject(new Error('fixture unavailable'))
    if (mode === 'failed-empty') return Promise.resolve({ runtimeKind: kind, cache: { ...installation.modelCatalog, ...cacheTimes(new Date(clockStartedAt + 3000).toISOString()) }, models: [], refreshStatus: 'failed', diagnosticCode: 'runtime_model_catalog_refresh_failed' })
    if (mode === 'clock-expiry') {
      const result: RuntimeModelCatalogView = { runtimeKind: kind, cache: { status: 'fresh', ...cacheTimes(new Date(Date.now()).toISOString()) },
        models: installation.snapshot!.models, refreshStatus: 'completed', diagnosticCode: null }
      return new Promise(resolve => state.pending.push(() => resolve(result)))
    }
    const modelsWithLowOnlyTarget = installation.snapshot!.models.map(model => model.id === 'vendor/model-1'
      ? { ...model, options: [{ ...model.options[0], values: [{ value: 'low', label: 'Low' }] }] }
      : model)
    const result = mode === 'expired-pending' || (mode === 'aging-pending' && catalogExpired)
      ? {
          runtimeKind: kind,
          cache: { status: 'fresh' as const, ...cacheTimes(new Date(clockStartedAt + 1000).toISOString()) },
          models: modelsWithLowOnlyTarget,
          refreshStatus: 'completed' as const,
          diagnosticCode: null
        }
      : { runtimeKind: kind, cache: { ...installation.modelCatalog, status: mode === 'aging-pending' ? 'stale' as const : installation.modelCatalog.status },
          models: mode === 'aging-pending' ? modelsWithLowOnlyTarget : installation.snapshot!.models,
          refreshStatus: 'not_required' as const, diagnosticCode: null }
    state.lastCatalog = result
    if (mode === 'pending' || mode === 'expired-pending' || (mode === 'aging-pending' && catalogExpired)) {
      return new Promise(resolve => state.pending.push(() => resolve(result)))
    }
    return Promise.resolve(result)
  }
  return <main style={{ height: '100%', overflow: 'auto', padding: 24 }}>
    <section style={{ width: 'min(740px, 100%)', margin: '0 auto' }}>
      <h1>运行配置</h1>
      <button id="before" type="button">前一项</button>
      {page === 'member' && <MemberRuntimePicker id="runtime" value={kind} disabled={disabled} isDisabled={next => !['codex-cli', 'claude-code-cli', 'command-code-cli'].includes(next)} onChange={next => { if (next) state.switchKind(next) }} />}
      {page === 'member'
        ? <div className="member-editor-runtime-fields"><MemberRuntimeParameters active={visible} adapterKind={kind} installation={installation} draft={draft} disabled={disabled} onOpenModelCatalog={catalog} onChange={next => { state.changes++; setDraft(next) }} /></div>
        : <MemberModelParameters active={visible} adapterKind={kind} installation={installation} model={draft.model} disabled={disabled} onOpenModelCatalog={catalog} onChange={model => { state.changes++; setDraft({ ...draft, model }) }} />}
      <button id="after" type="button">下一项</button>
      <p style={{ marginTop: 360 }}>原生输入集成夹具；不启动 Core 或 Runtime。</p>
    </section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
