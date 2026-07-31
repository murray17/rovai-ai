import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AdapterInstallation,
  AgentProfile,
  ContextSummaryModelConfig,
  ContextSummaryModelPreference,
  ModelSelection
} from '@contracts'
import { localizeExecutionEngineTerms } from './product-copy'

const UNSELECTED_MODEL = ''
const RUNTIME_DEFAULT = '__runtime_default__'
const OTHER_MEMBER_SELECTION = '__other_member_selection__'

export async function loadSummaryModelConfig(): Promise<ContextSummaryModelConfig> {
  return window.rovai.request<ContextSummaryModelConfig>('context.summaryModel.get')
}

export async function saveSummaryModelConfig(
  config: ContextSummaryModelConfig,
  preference: ContextSummaryModelPreference | null
): Promise<ContextSummaryModelConfig> {
  return window.rovai.request<ContextSummaryModelConfig>(
    'context.summaryModel.set',
    { expectedVersion: config.version, preference }
  )
}

export function SummaryModelSettings({ installations, agent }: {
  installations: AdapterInstallation[]
  agent: AgentProfile
}): React.JSX.Element {
  const [config, setConfig] = useState<ContextSummaryModelConfig | null>(null)
  const [modelId, setModelId] = useState(UNSELECTED_MODEL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runtimeInstallationId = agent.runtimePreference?.installationId ?? null
  const installation = installations.find(
    (candidate) => candidate.id === runtimeInstallationId
  ) ?? null
  const models = useMemo(
    () => (installation?.snapshot?.models ?? []).filter((model) => !model.hidden && !model.deprecated),
    [installation]
  )
  const runtimeReady = Boolean(
    installation?.enabled
    && installation.snapshot
    && !installation.snapshot.staleAt
  )

  useEffect(() => {
    let cancelled = false
    setError(null)
    void loadSummaryModelConfig()
      .then((nextConfig) => {
        if (cancelled) return
        applyConfig(nextConfig, runtimeInstallationId, setConfig, setModelId)
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError))
      })
    return () => { cancelled = true }
  }, [runtimeInstallationId])

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!config) return
    if (modelId === UNSELECTED_MODEL || modelId === OTHER_MEMBER_SELECTION) return
    setBusy(true)
    setError(null)
    try {
      if (!runtimeReady || !installation) {
        throw new Error('请先为当前队员配置可用的 Agent 运行时')
      }
      const model: ModelSelection = modelId === RUNTIME_DEFAULT
        ? { mode: 'runtime_default' }
        : {
            mode: 'explicit',
            modelId,
            options: Object.fromEntries(
              (models.find((candidate) => candidate.id === modelId)?.options ?? [])
                .filter((option) => option.defaultValue !== null)
                .map((option) => [option.key, option.defaultValue])
            )
          }
      const preference: ContextSummaryModelPreference = { installationId: installation.id, model }
      const nextConfig = await saveSummaryModelConfig(config, preference)
      applyConfig(nextConfig, runtimeInstallationId, setConfig, setModelId)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  const selectedOtherMemberRuntime = modelId === OTHER_MEMBER_SELECTION

  return (
    <div className="summary-model-settings">
      <div className="member-section-heading">
        <div><h3>摘要模型</h3></div>
      </div>
      {!config && !error && <div className="runtime-empty">正在读取摘要模型设置…</div>}
      {config && (
        <form className="summary-model-settings-form" onSubmit={(event) => void save(event)}>
          <label className="field-label">
            模型
            <select value={modelId} disabled={busy} onChange={(event) => setModelId(event.target.value)}>
              <option value={UNSELECTED_MODEL} disabled>选择模型</option>
              {selectedOtherMemberRuntime && (
                <option value={OTHER_MEMBER_SELECTION}>当前配置来自其他队员；请选择后替换</option>
              )}
              <option value={RUNTIME_DEFAULT} disabled={!runtimeReady}>当前队员的 Agent 运行时默认模型</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </select>
          </label>
          <div className="dialog-actions">
            {config.updatedAt && <span>最近更新 {formatTime(config.updatedAt)}</span>}
            <button className="primary-button" disabled={busy || !runtimeReady || modelId === UNSELECTED_MODEL || selectedOtherMemberRuntime}>
              {busy ? '正在保存…' : '保存摘要模型'}
            </button>
          </div>
        </form>
      )}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  )
}

function applyConfig(
  config: ContextSummaryModelConfig,
  runtimeInstallationId: string | null,
  setConfig: (config: ContextSummaryModelConfig) => void,
  setModelId: (modelId: string) => void
): void {
  setConfig(config)
  if (!config.preference) {
    setModelId(UNSELECTED_MODEL)
    return
  }
  if (config.preference.installationId !== runtimeInstallationId) {
    setModelId(OTHER_MEMBER_SELECTION)
    return
  }
  setModelId(
    config.preference?.model.mode === 'explicit'
      ? config.preference.model.modelId
      : RUNTIME_DEFAULT
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
