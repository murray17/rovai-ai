import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AdapterInstallation,
  ContextSummaryModelConfig,
  ContextSummaryModelPreference,
  ModelSelection
} from '@contracts'

const RUNTIME_DEFAULT = '__runtime_default__'

export function ContextSettings({ installations }: {
  installations: AdapterInstallation[]
}): React.JSX.Element {
  const [config, setConfig] = useState<ContextSummaryModelConfig | null>(null)
  const [installationId, setInstallationId] = useState('')
  const [modelId, setModelId] = useState(RUNTIME_DEFAULT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const installation = installations.find((candidate) => candidate.id === installationId) ?? null
  const models = useMemo(
    () => (installation?.snapshot?.models ?? []).filter((model) => !model.hidden && !model.deprecated),
    [installation]
  )

  useEffect(() => {
    let cancelled = false
    setError(null)
    void window.rovai.request<ContextSummaryModelConfig>('context.summaryModel.get')
      .then((nextConfig) => {
        if (cancelled) return
        setConfig(nextConfig)
        setInstallationId(nextConfig.preference?.installationId ?? '')
        setModelId(
          nextConfig.preference?.model.mode === 'explicit'
            ? nextConfig.preference.model.modelId
            : RUNTIME_DEFAULT
        )
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError))
      })
    return () => { cancelled = true }
  }, [])

  const chooseInstallation = (nextInstallationId: string): void => {
    setInstallationId(nextInstallationId)
    setModelId(RUNTIME_DEFAULT)
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!config) return
    setBusy(true)
    setError(null)
    try {
      let preference: ContextSummaryModelPreference | null = null
      if (installation) {
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
      const nextConfig = await window.rovai.request<ContextSummaryModelConfig>(
        'context.summaryModel.set',
        { expectedVersion: config.version, preference }
      )
      setConfig(nextConfig)
      setInstallationId(nextConfig.preference?.installationId ?? '')
      setModelId(
        nextConfig.preference?.model.mode === 'explicit'
          ? nextConfig.preference.model.modelId
          : RUNTIME_DEFAULT
      )
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  const usableInstallations = installations.filter((candidate) =>
    candidate.enabled
    && candidate.snapshot?.probeStatus === 'ready'
    && candidate.snapshot.models.some((model) => !model.hidden && !model.deprecated)
  )
  const missingSelection = installationId !== '' && installation === null

  return (
    <>
      <section className="project-hero">
        <div>
          <h2>上下文</h2>
          <p>选择 Camp 共享摘要使用的隔离模型；摘要会被所有成员复用。</p>
        </div>
      </section>
      <section className="section-block context-summary-settings">
        <div className="section-heading"><div><h2>摘要模型</h2></div></div>
        <p className="section-intro">未配置时，异步摘要使用 Default Lead 的有效 Runtime，按需摘要使用等待者自身的 Runtime；已配置时两条路径都使用指定模型。压缩会话不暴露工具、附件正文或私有消息。</p>
        {!config && !error && <div className="runtime-empty">正在读取摘要模型设置…</div>}
        {config && (
          <form className="context-summary-settings-form" onSubmit={(event) => void save(event)}>
            <label className="field-label">
              Adapter
              <select value={installationId} disabled={busy} onChange={(event) => chooseInstallation(event.target.value)}>
                <option value="">自动回退</option>
                {missingSelection && <option value={installationId}>此前选择的安装已不存在</option>}
                {usableInstallations.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {adapterLabel(candidate)} · {candidate.snapshot?.reportedVersion ?? '版本未知'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              模型
              <select value={modelId} disabled={busy || !installation} onChange={(event) => setModelId(event.target.value)}>
                <option value={RUNTIME_DEFAULT}>Runtime 默认模型</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
              </select>
            </label>
            <div className="dialog-actions">
              <span>{config.updatedAt ? `最近更新 ${formatTime(config.updatedAt)}` : '尚未配置'}</span>
              <button className="primary-button" disabled={busy || missingSelection}>
                {busy ? '正在保存…' : '保存摘要模型'}
              </button>
            </div>
          </form>
        )}
        {error && <div className="inline-error" role="alert">{error}</div>}
      </section>
    </>
  )
}

function adapterLabel(installation: AdapterInstallation): string {
  return installation.adapterKind
    .replace('-cli', ' CLI')
    .replace('antigravity-app', 'Antigravity App')
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
