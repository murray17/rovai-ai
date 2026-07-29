import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AdapterInstallation,
  AgentProfile,
  ContextSummaryModelConfig,
  ContextSummaryModelPreference,
  ModelSelection
} from '@contracts'
import { localizeExecutionEngineTerms } from './product-copy'

const AUTO_FALLBACK = '__auto_fallback__'
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
  const [modelId, setModelId] = useState(AUTO_FALLBACK)
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
    setBusy(true)
    setError(null)
    try {
      let preference: ContextSummaryModelPreference | null = null
      if (modelId !== AUTO_FALLBACK) {
        if (!runtimeReady || !installation) {
          throw new Error('请先为当前成员配置可用的 Agent运行时')
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
        preference = { installationId: installation.id, model }
      }
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
        <div>
          <h3>摘要模型</h3>
          <p>这是所有 Camp 共享摘要使用的模型配置，只能从当前成员「{agent.displayName}」自己的 Agent运行时中选择。</p>
        </div>
      </div>
      <p className="section-intro">自动回退时，异步摘要使用 Default Lead 的有效 Agent运行时，按需摘要使用等待者自身的 Agent运行时；明确配置时只能使用当前成员的运行时默认模型或模型列表。</p>
      {!config && !error && <div className="runtime-empty">正在读取摘要模型设置…</div>}
      {config && (
        <form className="summary-model-settings-form" onSubmit={(event) => void save(event)}>
          <label className="field-label">
            模型
            <select value={modelId} disabled={busy} onChange={(event) => setModelId(event.target.value)}>
              <option value={AUTO_FALLBACK}>自动回退</option>
              {selectedOtherMemberRuntime && (
                <option value={OTHER_MEMBER_SELECTION}>当前配置来自其他成员；请选择后替换</option>
              )}
              <option value={RUNTIME_DEFAULT} disabled={!runtimeReady}>当前成员的 Agent运行时默认模型</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </select>
          </label>
          <div className="runtime-empty">
            {runtimeReady && installation
              ? `模型来源：${agent.displayName} · ${adapterLabel(installation)}`
              : `${agent.displayName} 尚未配置可用的 Agent运行时；当前只能保存自动回退。`}
          </div>
          <div className="dialog-actions">
            <span>{config.updatedAt ? `最近更新 ${formatTime(config.updatedAt)}` : '尚未配置'}</span>
            <button className="primary-button" disabled={busy || selectedOtherMemberRuntime}>
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
    setModelId(AUTO_FALLBACK)
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

function adapterLabel(installation: AdapterInstallation): string {
  return ({
    'codex-cli': 'Codex CLI',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'antigravity-app': 'Antigravity'
  })[installation.adapterKind]
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
