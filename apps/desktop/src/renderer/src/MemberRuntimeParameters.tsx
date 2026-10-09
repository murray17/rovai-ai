import { useEffect, useId, useRef, useState } from 'react'
import { RuntimeModelSearch } from './RuntimeModelSearch'
import { RuntimeParameterSelect } from './RuntimeParameterSelect'
import type {
  AdapterInstallation,
  AdapterKind,
  AdapterPermissionConfig,
  AgentProfile,
  MemberRuntimeConfiguration,
  ModelDescriptor,
  ModelSelection,
  PermissionOptionDescriptor,
  RuntimeModelCatalogCache,
  RuntimeModelCatalogView
} from '@contracts'
import { UiText, uiAttribute, useInterfaceLanguage } from './interface-language'

export type MemberRuntimeDraft = {
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

type RuntimeParameterProps = {
  adapterKind: AdapterKind
  installation: AdapterInstallation
  permissionOptions: PermissionOptionDescriptor[]
  draft: MemberRuntimeDraft
  disabled: boolean
  onOpenModelCatalog?: () => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
}

type ModelFieldsProps = RuntimeParameterProps & {
  optionKey?: 'reasoning_effort' | 'effort'
  optionLabel?: string
}

export function runtimeEditorInstallation(
  installations: AdapterInstallation[],
  adapterKind: AdapterKind
): AdapterInstallation | null {
  return installations.find((installation) => (
    installation.adapterKind === adapterKind
    && installation.installationClass === 'managed_default'
    && installation.authScope === 'default'
  )) ?? null
}

export function runtimeModelSelectionAvailable(
  installation: AdapterInstallation | null,
  model: ModelSelection | null
): boolean {
  if (!installation?.memberRuntimeDefaults || !model) return false
  if (model.mode === 'runtime_default') return true
  return model.modelId.trim().length > 0 && typeof model.options === 'object' && model.options !== null

}

export function runtimeDraftForMember(
  agent: AgentProfile,
  adapterKind: AdapterKind,
  installation: AdapterInstallation | null,
  usePersistedPreference: boolean
): MemberRuntimeDraft | null {
  if (
    usePersistedPreference
    && agent.runtimeConfiguration?.adapterKind === adapterKind
    && agent.runtimeConfiguration?.permissions.adapterKind === adapterKind
  ) {
    return cloneRuntimeDraft({
      model: agent.runtimeConfiguration.model,
      permissions: agent.runtimeConfiguration.permissions
    })
  }
  return installation?.memberRuntimeDefaults
    ? draftFromDefaults(installation.memberRuntimeDefaults)
    : null
}

export function draftFromDefaults(
  defaults: MemberRuntimeConfiguration
): MemberRuntimeDraft {
  return cloneRuntimeDraft({
    model: defaults.model,
    permissions: defaults.permissions
  })
}

function cloneRuntimeDraft(draft: MemberRuntimeDraft): MemberRuntimeDraft {
  return {
    model: draft.model.mode === 'runtime_default'
      ? { mode: 'runtime_default' }
      : {
          ...draft.model,
          options: { ...draft.model.options }
        },
    permissions: {
      adapterKind: draft.permissions.adapterKind,
      schemaVersion: draft.permissions.schemaVersion,
      values: { ...draft.permissions.values }
    }
  }
}

export function MemberRuntimeParameters({
  inline = false,
  adapterKind,
  installation,
  draft,
  disabled,
  onOpenModelCatalog,
  onChange
}: {
  inline?: boolean
  adapterKind: AdapterKind
  installation: AdapterInstallation | null
  draft: MemberRuntimeDraft | null
  disabled: boolean
  onOpenModelCatalog?: () => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
}): React.JSX.Element {
  useInterfaceLanguage()
  const titleId = useId()
  const permissionOptions = installation?.permissionOptions ?? installation?.snapshot?.permissionOptions ?? []
  const content = installation && draft
    ? runtimeParametersFor(adapterKind, {
        adapterKind,
        installation,
        permissionOptions,
        draft,
        disabled,
        onOpenModelCatalog,
        onChange
      })
    : (
        <p className="runtime-parameter-empty"><UiText zh={"请先选择已安装的智能体。运行时会验证模型和权限设置。"} /></p>
      )
  return (
    <section className={inline ? 'member-runtime-parameters member-editor-runtime-fields' : 'member-runtime-parameters'} aria-label={inline ? uiAttribute("运行参数") : undefined} aria-labelledby={inline ? undefined : titleId}>
      {!inline && <header className="member-runtime-parameters-heading">
        <strong id={titleId}><UiText zh={"运行参数"} /></strong>
        <small><UiText zh={"模型、模型参数与智能体原生权限。"} /></small>
      </header>}
      <div className="member-runtime-parameters-body" aria-labelledby={inline ? undefined : titleId}>
        {content}
      </div>
    </section>
  )
}

export function MemberModelParameters({
  adapterKind,
  installation,
  model,
  disabled,
  onOpenModelCatalog,
  onChange
}: {
  adapterKind: AdapterKind
  installation: AdapterInstallation | null
  model: ModelSelection | null
  disabled: boolean
  onOpenModelCatalog?: () => Promise<RuntimeModelCatalogView>
  onChange(model: ModelSelection): void
}): React.JSX.Element {
  const permissionOptions = installation?.permissionOptions ?? installation?.snapshot?.permissionOptions ?? []
  const defaults = installation?.memberRuntimeDefaults ?? null
  if (!installation || !defaults || !model) {
    return (
      <p className="runtime-parameter-empty"><UiText zh={"当前没有可编辑的模型目录；如果智能体已准备好，将使用它的默认模型。"} /></p>
    )
  }
  const draft: MemberRuntimeDraft = {
    model,
    permissions: defaults.permissions
  }
  return (
    <div className="runtime-parameter-form onboarding-model-parameter-form">
      {modelFieldsFor(adapterKind, {
        adapterKind,
        installation,
        permissionOptions,
        draft,
        disabled,
        onOpenModelCatalog,
        onChange: (nextDraft) => onChange(nextDraft.model)
      })}
    </div>
  )
}

function runtimeParametersFor(
  adapterKind: AdapterKind,
  props: RuntimeParameterProps
): React.JSX.Element {
  switch (adapterKind) {
    case 'codex-cli':
      return <CodexRuntimeParameters {...props} />
    case 'pi':
      return <PiRuntimeParameters {...props} />
    case 'opencode-cli':
      return <OpenCodeRuntimeParameters {...props} />
    case 'copilot-cli':
      return <CopilotRuntimeParameters {...props} />
    case 'claude-code-cli':
      return <ClaudeRuntimeParameters {...props} />
    case 'kiro-cli':
      return <KiroRuntimeParameters {...props} />
    case 'qoder-cli':
      return <QoderRuntimeParameters {...props} />
    case 'codebuddy-cli':
      return <CodeBuddyRuntimeParameters {...props} />
    case 'qwen-code':
      return <QwenRuntimeParameters {...props} />
    case 'trae-cn-cli':
      return <TraeRuntimeParameters {...props} />
    case 'cursor-agent':
      return <CursorRuntimeParameters {...props} />
    case 'kimi-code-cli':
      return <KimiRuntimeParameters {...props} />
    case 'grok-build':
      return <GrokRuntimeParameters {...props} />
    case 'deepseek-harness':
      return <DeepseekHarnessRuntimeParameters {...props} />
    case 'cline-cli':
      return (
        <div className="runtime-parameter-form">
          {modelFieldsFor('cline-cli', props)}
          <PermissionSelect {...props} fieldKey="mode" label={uiAttribute("执行模式")} />
          <PermissionSwitch {...props} fieldKey="auto_approve" label={uiAttribute("自动通过权限请求")} enabledValue="true" disabledValue="false" />
        </div>
      )
    case 'command-code-cli':
      return <div className="runtime-parameter-form">{modelFieldsFor('command-code-cli', props)}<PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} /></div>
    case 'zcode-app':
      return <div className="runtime-parameter-form">{modelFieldsFor('zcode-app', props)}<PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} /></div>
    case 'antigravity-app':
      return <AntigravityRuntimeParameters {...props} />
  }
}

function DeepseekHarnessRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('deepseek-harness', props)}
      <PermissionSelect
        {...props}
        fieldKey="sandbox_mode"
        label="sandbox_mode"
        choiceDescriptions={{
          'read-only': '仅允许读取文件',
          'workspace-write': '允许写入当前工作区',
          'danger-full-access': '不限制文件系统访问'
        }}
      />
      <PermissionSelect
        {...props}
        fieldKey="approval_policy"
        label="approval_policy"
        choiceDescriptions={{
          ask: '需要确认时由 DSH 发起询问',
          never: '不询问；需要升级权限时由 DSH 拒绝'
        }}
      />
    </div>
  )
}

function PiRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('pi', props)}
    </div>
  )
}

function CodexRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('codex-cli', props)}
      <PermissionSelect {...props} fieldKey="sandbox_mode" label={uiAttribute("文件系统访问")} />
      <PermissionSelect {...props} fieldKey="approval_policy" label={uiAttribute("审批策略")} />
    </div>
  )
}

function OpenCodeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('opencode-cli', props)}
      <PermissionSelect {...props} fieldKey="permission" label={uiAttribute("工具权限")} />
    </div>
  )
}

function CopilotRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('copilot-cli', props)}
      <PermissionSwitch {...props} fieldKey="allow_all" label={uiAttribute("自动允许全部操作")} />
    </div>
  )
}

function ClaudeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('claude-code-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} />
    </div>
  )
}

function KiroRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('kiro-cli', props)}
      <PermissionSwitch {...props} fieldKey="trust_all_tools" label={uiAttribute("自动允许全部工具")} />
    </div>
  )
}

function QoderRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('qoder-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} />
    </div>
  )
}

function CodeBuddyRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('codebuddy-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} />
    </div>
  )
}

function QwenRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('qwen-code', props)}
      <PermissionSelect {...props} fieldKey="approval_mode" label={uiAttribute("审批模式")} />
    </div>
  )
}

function TraeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('trae-cn-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} />
    </div>
  )
}

function CursorRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('cursor-agent', props)}
      <PermissionSelect {...props} fieldKey="execution_mode" label={uiAttribute("执行模式")} />
      <PermissionSelect {...props} fieldKey="approval_policy" label={uiAttribute("审批策略")} />
    </div>
  )
}

function KimiRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('kimi-code-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} />
    </div>
  )
}

function GrokRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('grok-build', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} />
    </div>
  )
}

function AntigravityRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('antigravity-app', props)}
      <PermissionSelect {...props} fieldKey="mode" label={uiAttribute("执行模式")} />
      <PermissionSelect {...props} fieldKey="sandbox" label={uiAttribute("终端沙箱")} />
      <PermissionSwitch
        {...props}
        fieldKey="dangerously_skip_permissions"
        label={uiAttribute("自动通过权限请求")}
      />
    </div>
  )
}

function modelFieldsFor(
  adapterKind: AdapterKind,
  props: RuntimeParameterProps
): React.JSX.Element {
  switch (adapterKind) {
    case 'command-code-cli':
    case 'claude-code-cli':
      return <ModelFields {...props} optionKey="effort" optionLabel={uiAttribute("思考强度")} />
    case 'codex-cli':
    case 'opencode-cli':
    case 'copilot-cli':
    case 'qoder-cli':
    case 'codebuddy-cli':
    case 'qwen-code':
    case 'deepseek-harness':
      return <ModelFields {...props} optionKey="reasoning_effort" optionLabel={uiAttribute("推理强度")} />
    case 'kiro-cli':
    case 'pi':
    case 'trae-cn-cli':
    case 'cursor-agent':
    case 'kimi-code-cli':
    case 'grok-build':
    case 'zcode-app':
    case 'cline-cli':
    case 'antigravity-app':
      return <ModelFields {...props} />
  }
}

function ModelFields({
  adapterKind,
  installation,
  draft,
  disabled,
  onOpenModelCatalog,
  onChange,
  optionKey,
  optionLabel
}: ModelFieldsProps): React.JSX.Element {
  const identity = catalogInstallationIdentity(installation)
  const [live, setLive] = useState<{ identity: string; catalog: RuntimeModelCatalogView } | null>(null)
  const explicit = draft.model.mode === 'explicit' ? draft.model : null
  const initialModels = live?.identity === identity
    && liveCatalogIsAtLeastAsRecent(live.catalog, installation.modelCatalog)
    ? selectableModels(live.catalog.models)
    : displayableInstallationModels(installation)
  const selectedModel = explicit
    ? initialModels.find((model) => model.id === explicit.modelId) ?? null
    : null
  const option = optionKey && selectedModel
    ? selectedModel.options.find((candidate) => candidate.key === optionKey) ?? null
    : null

  const setOption = (value: string): void => {
    if (!explicit || !optionKey) return
    const options = { ...explicit.options }
    if (value) options[optionKey] = value
    else delete options[optionKey]
    onChange({
      ...draft,
      model: { ...explicit, options }
    })
  }

  const optionValue = explicit && optionKey
    ? stringValue(explicit.options[optionKey])
    : ''
  const optionInvalid = optionValue
    ? !option?.values.some((candidate) => candidate.value === optionValue)
    : false

  return (
    <>
      <RuntimeModelPicker
        key={identity}
        adapterKind={adapterKind}
        installation={installation}
        draft={draft}
        disabled={disabled}
        onOpenModelCatalog={onOpenModelCatalog}
        onChange={onChange}
        onCatalogChange={(catalog) => setLive({ identity, catalog })}
      />

      {explicit && optionKey && (option || optionValue) && (
        <RuntimeParameterSelect
          label={optionLabel ?? option?.label ?? optionKey}
          value={optionValue}
          disabled={disabled}
          onChange={setOption}
          defaultChoice={{ value: '', label:uiAttribute("跟随模型默认值") }}
          choices={[
            ...(optionInvalid ? [{ value: optionValue, label: uiAttribute("当前目录未提供 · {0}", String(optionValue)), disabled: true }] : []),
            ...(option?.values ?? [])
          ]}
        />
      )}
    </>
  )
}

function RuntimeModelPicker({
  adapterKind,
  installation,
  draft,
  disabled,
  onOpenModelCatalog,
  onChange,
  onCatalogChange
}: {
  adapterKind: AdapterKind
  installation: AdapterInstallation
  draft: MemberRuntimeDraft
  disabled: boolean
  onOpenModelCatalog?: () => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
  onCatalogChange(catalog: RuntimeModelCatalogView): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [liveCatalog, setLiveCatalog] = useState<RuntimeModelCatalogView | null>(null)
  const requestGeneration = useRef(0)
  const initialCache = installation.modelCatalog
  const initialModels = displayableInstallationModels(installation)
  const activeLiveCatalog = liveCatalogIsAtLeastAsRecent(liveCatalog, initialCache)
    ? liveCatalog
    : null
  const cache = activeLiveCatalog?.cache ?? initialCache
  const models = activeLiveCatalog
    ? selectableModels(activeLiveCatalog.models)
    : initialModels
  const canFilterOptions = modelCatalogCanValidateOptions(initialCache, liveCatalog)
  const explicit = draft.model.mode === 'explicit' ? draft.model : null
  const selectedModel = explicit
    ? models.find((model) => model.id === explicit.modelId) ?? null
    : null
  const selectedValue = explicit?.modelId ?? 'runtime_default'
  const persistedRefreshFailed = latestCatalogRefreshFailed(installation, cache)

  useEffect(() => {
    requestGeneration.current += 1
    setOpen(false)
    setLoading(false)
    setRefreshFailed(false)
    setLiveCatalog(null)
  }, [adapterKind, installation.id])

  const loadCatalog = (): void => {
    if (!onOpenModelCatalog) return
    const startedAt = performance.now()
    const generation = ++requestGeneration.current
    const recordFirstDisplay = (cached: boolean): void => {
      requestAnimationFrame(() => {
        if (generation === requestGeneration.current) console.info('[model-catalog] display', {
          runtimeKind: adapterKind, cached, firstDisplayMs: Math.round(performance.now() - startedAt)
        })
      })
    }
    if (models.length > 0) recordFirstDisplay(true)
    setLoading(true)
    setRefreshFailed(false)
    void onOpenModelCatalog()
      .then((catalog) => {
        if (generation !== requestGeneration.current || catalog.runtimeKind !== adapterKind) return
        setLiveCatalog(catalog)
        onCatalogChange(catalog)
        if (models.length === 0 && catalog.models.length > 0) recordFirstDisplay(false)
        setRefreshFailed(catalog.refreshStatus === 'failed')
      })
      .catch(() => {
        if (generation !== requestGeneration.current) return
        setRefreshFailed(true)
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoading(false)
      })
  }

  const selectModel = (value: string): void => {
    if (value === selectedValue) return
    if (value === 'runtime_default') {
      onChange({ ...draft, model: { mode: 'runtime_default' } })
      return
    }
    const model = models.find((candidate) => candidate.id === value)
    if (model) onChange({ ...draft, model: explicitSelection(model, draft.model, canFilterOptions) })
  }

  const statusCopy = modelCatalogStatusCopy(cache, {
    loading: loading && models.length === 0,
    refreshFailed: !loading && (refreshFailed || persistedRefreshFailed),
    servingCachedModels: models.length > 0,
    refreshStatus: loading ? 'joined' : activeLiveCatalog?.refreshStatus ?? null
  })
  const missingSelectionLabel = explicit && !selectedModel ? missingModelLabel(explicit.modelId, cache.status)
    : null
  const triggerLabel = draft.model.mode === 'runtime_default'
    ? uiAttribute('默认')
    : selectedModel?.displayName ?? draft.model.modelId

  return (
    <div className="field-label runtime-model-field">
      <span><UiText zh={"模型"} /></span>
      <RuntimeModelSearch
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (nextOpen) loadCatalog()
        }}
        models={models}
        value={selectedValue}
        label={triggerLabel}
        missingLabel={missingSelectionLabel}
        disabled={disabled}
        loading={loading}
        failed={refreshFailed || persistedRefreshFailed}
        onSelect={selectModel}
        notice={!loading && (refreshFailed || persistedRefreshFailed) ? statusCopy : null}
        onRetry={loadCatalog}
      />

    </div>
  )
}

function selectableModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.filter((model) => (
    !model.hidden
    && !model.deprecated
    && !model.id.endsWith('://runtime-default')
  ))
}

function modelCatalogIsServiceable(cache: RuntimeModelCatalogCache): boolean {
  return cache.status === 'fresh' || cache.status === 'stale'
}

function catalogInstallationIdentity(installation: AdapterInstallation): string {
  return [installation.id, installation.generation, installation.snapshot?.executableFingerprint,
    installation.snapshot?.staleAt].join(':')
}

// Display policy only. Never use this to approve a new saved model selection.
export function displayableInstallationModels(installation: AdapterInstallation): ModelDescriptor[] {
  const cache = installation.modelCatalog
  const snapshot = installation.snapshot
  const sameEnvironmentHistory = cache.status === 'expired'
    && snapshot?.probeStatus === 'ready' && !snapshot.staleAt
  return modelCatalogIsServiceable(cache) || sameEnvironmentHistory
    ? selectableModels(snapshot?.models ?? []) : []
}

export function liveCatalogIsAtLeastAsRecent(
  liveCatalog: RuntimeModelCatalogView | null,
  initialCache: RuntimeModelCatalogCache
): boolean {
  if (!liveCatalog) return false
  const liveObservedAt = liveCatalog.cache.observedAt
  const initialObservedAt = initialCache.observedAt
  if (liveObservedAt === initialObservedAt) return true
  if (liveObservedAt === null) return false
  if (initialObservedAt === null) return true
  return Date.parse(liveObservedAt) >= Date.parse(initialObservedAt)
}

export function modelCatalogCanValidateOptions(
  installationCache: RuntimeModelCatalogCache,
  liveCatalog: RuntimeModelCatalogView | null
): boolean {
  const activeLiveCatalog = liveCatalogIsAtLeastAsRecent(liveCatalog, installationCache)
    ? liveCatalog
    : null
  const cache = activeLiveCatalog?.cache ?? installationCache
  // A local response for the same observation cannot undo Core's later expiry.
  return modelCatalogIsServiceable(cache)
    && (cache.observedAt !== installationCache.observedAt || modelCatalogIsServiceable(installationCache))
}

function latestCatalogRefreshFailed(installation: AdapterInstallation, cache: RuntimeModelCatalogCache): boolean {
  const attempt = installation.lastProbeAttempt
  if (attempt?.status !== 'failed') return false
  const observedAt = cache.observedAt
  if (!observedAt) return true
  const attemptedTime = Date.parse(attempt.attemptedAt)
  const observedTime = Date.parse(observedAt)
  return Number.isNaN(attemptedTime)
    || Number.isNaN(observedTime)
    || attemptedTime >= observedTime
}

function missingModelLabel(
  modelId: string,
  status: RuntimeModelCatalogCache['status']
): string {
  if (status === 'fresh') return uiAttribute("当前目录未提供 · {0}", String(modelId))
  if (status === 'stale') return uiAttribute("缓存中未找到 · {0}", String(modelId))
  return uiAttribute("尚未核对 · {0}", String(modelId))
}

export function modelCatalogStatusCopy(
  cache: RuntimeModelCatalogCache,
  state: {
    loading: boolean
    refreshFailed: boolean
    servingCachedModels: boolean
    refreshStatus: RuntimeModelCatalogView['refreshStatus'] | null
  }
): string {
  if (state.loading) return uiAttribute("正在获取模型列表…")
  if (state.refreshFailed) {
    return state.servingCachedModels
      ?uiAttribute("暂时无法更新模型列表，已保留上次结果。")
      :uiAttribute("暂时无法获取模型列表，请重试。")
  }
  if (state.refreshStatus === 'scheduled' || state.refreshStatus === 'joined') {
    return uiAttribute("正在更新模型列表…")
  }
  if (state.refreshStatus === 'deferred') {
    return state.servingCachedModels
      ?uiAttribute("运行环境正在更新，继续显示上次成功结果")
      :uiAttribute("运行环境正在更新，稍后重新获取")
  }
  return ''
}

export function explicitSelection(
  model: ModelDescriptor,
  previous: ModelSelection,
  canFilterOptions: boolean
): ModelSelection {
  const previousOptions = previous.mode === 'explicit' ? previous.options : {}
  // Expired history can form a draft, but cannot prove that an override is unsupported.
  const options = canFilterOptions
    ? Object.fromEntries(Object.entries(previousOptions).filter(([key, value]) => (
        typeof value === 'string'
        && model.options.some((option) => (
          option.key === key
          && option.values.some((choice) => choice.value === value)
        ))
      )))
    : { ...previousOptions }
  return {
    mode: 'explicit',
    modelId: model.id,
    options,
    ...(model.runtimeMetadata?.dshSource === 'native' || model.runtimeMetadata?.dshSource === 'web'
      ? { dshSource: model.runtimeMetadata.dshSource }
      : {})
  }
}

function PermissionSelect({
  installation,
  permissionOptions,
  draft,
  disabled,
  onChange,
  fieldKey,
  label,
  choiceDescriptions
}: RuntimeParameterProps & {
  fieldKey: string
  label: string
  choiceDescriptions?: Record<string, string>
}): React.JSX.Element {
  const descriptor = permissionDescriptor(permissionOptions, fieldKey)
  if (!descriptor) {
    return <p className="runtime-parameter-unavailable"><UiText zh={"当前能力快照未提供“"} />{label}”。</p>
  }
  const currentValue = stringValue(draft.permissions.values[fieldKey])
  const invalid = Boolean(currentValue)
    && !descriptor.choices.some((choice) => choice.value === currentValue)
  return (
    <RuntimeParameterSelect
      label={label}
      recommendedValue={stringValue(installation.memberRuntimeDefaults?.permissions.values[fieldKey]) || undefined}
      menuGuidance={uiAttribute("建议使用最高权限，体验更顺畅。")}
      value={currentValue}
      disabled={disabled}
      onChange={(value) => updatePermission(draft, fieldKey, value, onChange)}
      choices={[
        ...(!currentValue ? [{ value: '', label:uiAttribute("请选择") }] : []),
        ...(invalid ? [{ value: currentValue, label: uiAttribute("已失效 · {0}", String(currentValue)), disabled: true }] : []),
        ...descriptor.choices.map((choice) => ({
          ...choice,
          description: choiceDescriptions?.[choice.value] ? uiAttribute(choiceDescriptions[choice.value]) : undefined
        }))
      ]}
    />
  )
}

function PermissionSwitch({
  installation,
  permissionOptions,
  draft,
  disabled,
  onChange,
  fieldKey,
  label,
  enabledValue = 'on',
  disabledValue = 'off'
}: RuntimeParameterProps & {
  fieldKey: string
  label: string
  enabledValue?: string
  disabledValue?: string
}): React.JSX.Element {
  const language = useInterfaceLanguage()
  const hintId = useId()
  const descriptor = permissionDescriptor(permissionOptions, fieldKey)
  const checked = draft.permissions.values[fieldKey] === enabledValue
  const recommendEnabling = descriptor?.choices.some(choice => choice.value === enabledValue) === true
    && installation.memberRuntimeDefaults?.permissions.values[fieldKey] === enabledValue
  return (
    <label className="field-label runtime-parameter-switch-field">
      <span className="permission-switch-label">{label}</span>
      <span className="runtime-parameter-switch">
        <span className="runtime-parameter-switch-state" aria-hidden="true">
          {checked ? uiAttribute("开启") : uiAttribute(language === 'en' ? "已关闭" : "关闭")}
        </span>
        <input
          type="checkbox"
          aria-label={label}
          aria-describedby={recommendEnabling ? hintId : undefined}
          checked={checked}
          disabled={disabled || !descriptor}
          onChange={(event) => updatePermission(
            draft,
            fieldKey,
            event.target.checked ? enabledValue : disabledValue,
            onChange
          )}
        />
      </span>
      {recommendEnabling && <span id={hintId} className="permission-switch-guidance"><UiText zh={"建议开启，体验更顺畅。"} /></span>}
    </label>
  )
}

function permissionDescriptor(
  descriptors: PermissionOptionDescriptor[],
  key: string
): PermissionOptionDescriptor | null {
  return descriptors.find((descriptor) => descriptor.key === key && descriptor.supported) ?? null
}

function updatePermission(
  draft: MemberRuntimeDraft,
  key: string,
  value: string,
  onChange: (draft: MemberRuntimeDraft) => void
): void {
  onChange({
    ...draft,
    permissions: {
      ...draft.permissions,
      values: {
        ...draft.permissions.values,
        [key]: value
      }
    }
  })
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
