import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, AdapterKind, RuntimeModelCatalogView } from '@contracts'
import { MemberRuntimeParameters, MemberModelParameters, draftFromDefaults, type MemberRuntimeDraft } from '../../../apps/desktop/src/renderer/src/MemberRuntimeParameters'
import { onboardingRuntimeSelectionFor } from '../../../apps/desktop/src/renderer/src/OnboardingFlow'
import { MemberRuntimePicker } from '../../../apps/desktop/src/renderer/src/MemberRuntimePicker'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'

const observedAt = '2026-09-13T00:00:00Z'
function fixture(kind: AdapterKind, empty: boolean, generation: number, expired = false): AdapterInstallation {
  return {
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
}

function Fixture(): React.JSX.Element {
  const [kind, setKind] = useState<AdapterKind>('codex-cli')
  const [page, setPage] = useState('member')
  const [mode, setMode] = useState('normal')
  const [generation, setGeneration] = useState(1)
  const [disabled, setDisabled] = useState(false)
  const installation = fixture(kind, mode === 'empty' || mode === 'pending', generation, mode === 'expired-pending')
  const [draft, setDraft] = useState<MemberRuntimeDraft>(() => draftFromDefaults(installation.memberRuntimeDefaults!))
  const state = (window as any).runtimeTest ?? { calls: 0, changes: 0, pending: [] }
  Object.assign(window, { runtimeTest: Object.assign(state, {
    draft, kind, setDisabled,
    setModel: (model: MemberRuntimeDraft['model']) => setDraft(previous => ({ ...previous, model })),
    switchKind: (next: AdapterKind) => { setKind(next); setDraft(draftFromDefaults(fixture(next, false, generation).memberRuntimeDefaults!)) },
    reset: (nextPage = 'member', nextMode = 'normal') => {
      state.changes = 0
      setPage(nextPage); setMode(nextMode); setGeneration(value => value + 1); setDisabled(false)
      const item = fixture('codex-cli', false, 1); setKind('codex-cli')
      setDraft({ model: onboardingRuntimeSelectionFor('codex-cli', [item]).model!, permissions: item.memberRuntimeDefaults!.permissions })
    },
    settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))
  }) })
  const catalog = (): Promise<RuntimeModelCatalogView> => {
    state.calls++
    if (mode === 'failed') return Promise.reject(new Error('fixture unavailable'))
    const result = mode === 'expired-pending'
      ? {
          runtimeKind: kind,
          cache: { ...installation.modelCatalog, status: 'fresh' as const, observedAt: '2026-09-14T00:00:00Z' },
          models: installation.snapshot!.models.map(model => model.id === 'vendor/model-1'
            ? { ...model, options: [{ ...model.options[0], values: [{ value: 'low', label: 'Low' }] }] }
            : model),
          refreshStatus: 'completed' as const,
          diagnosticCode: null
        }
      : { runtimeKind: kind, cache: installation.modelCatalog, models: installation.snapshot!.models, refreshStatus: 'not_required' as const, diagnosticCode: null }
    if (mode === 'pending' || mode === 'expired-pending') return new Promise(resolve => state.pending.push(() => resolve(result)))
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
