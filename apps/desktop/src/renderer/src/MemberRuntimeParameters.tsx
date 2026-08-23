import { useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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

export type MemberRuntimeDraft = {
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

type RuntimeParameterProps = {
  adapterKind: AdapterKind
  installation: AdapterInstallation
  snapshot: NonNullable<AdapterInstallation['snapshot']>
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
  if (!installation.modelCatalog || !modelCatalogIsServiceable(installation.modelCatalog)) {
    return false
  }
  const descriptor = installation.snapshot?.models.find((candidate) => (
    candidate.id === model.modelId
    && !candidate.hidden
    && !candidate.deprecated
    && !candidate.id.endsWith('://runtime-default')
  ))
  return descriptor !== undefined
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
          mode: 'explicit',
          modelId: draft.model.modelId,
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
  adapterKind,
  installation,
  draft,
  disabled,
  onOpenModelCatalog,
  onChange
}: {
  adapterKind: AdapterKind
  installation: AdapterInstallation | null
  draft: MemberRuntimeDraft | null
  disabled: boolean
  onOpenModelCatalog?: () => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
}): React.JSX.Element {
  const snapshot = installation?.snapshot ?? null
  const content = installation && snapshot && draft
    ? runtimeParametersFor(adapterKind, {
        adapterKind,
        installation,
        snapshot,
        draft,
        disabled,
        onOpenModelCatalog,
        onChange
      })
    : (
        <p className="runtime-parameter-empty">
          当前还没有可编辑的能力快照。你仍可保存 Agent 运行时选择；检查完成后需要回来保存运行参数。
        </p>
      )
  return (
    <section className="member-runtime-parameters" aria-labelledby="member-runtime-parameters-title">
      <header className="member-runtime-parameters-heading">
        <strong id="member-runtime-parameters-title">运行参数</strong>
        <small>模型、模型参数与 Agent 运行时原生权限。</small>
      </header>
      <div className="member-runtime-parameters-body" aria-labelledby="member-runtime-parameters-title">
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
  const snapshot = installation?.snapshot ?? null
  const defaults = installation?.memberRuntimeDefaults ?? null
  if (!installation || !snapshot || !defaults || !model) {
    return (
      <p className="runtime-parameter-empty">
        当前没有可编辑的模型目录；如果 Agent 运行时已准备好，将使用它的默认模型。
      </p>
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
        snapshot,
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
    case 'antigravity-app':
      return <AntigravityRuntimeParameters {...props} />
  }
}

function CodexRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('codex-cli', props)}
      <PermissionSelect {...props} fieldKey="sandbox_mode" label="文件系统访问" />
      <PermissionSelect {...props} fieldKey="approval_policy" label="审批策略" />
    </div>
  )
}

function OpenCodeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('opencode-cli', props)}
      <PermissionSelect {...props} fieldKey="permission" label="工具权限" />
    </div>
  )
}

function CopilotRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('copilot-cli', props)}
      <PermissionSwitch {...props} fieldKey="allow_all" label="自动允许全部操作" />
    </div>
  )
}

function ClaudeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('claude-code-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function KiroRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('kiro-cli', props)}
      <PermissionSwitch {...props} fieldKey="trust_all_tools" label="自动允许全部工具" />
    </div>
  )
}

function QoderRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('qoder-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function CodeBuddyRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('codebuddy-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function QwenRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('qwen-code', props)}
      <PermissionSelect {...props} fieldKey="approval_mode" label="审批模式" />
    </div>
  )
}

function TraeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('trae-cn-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function CursorRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('cursor-agent', props)}
      <PermissionSelect {...props} fieldKey="execution_mode" label="执行模式" />
      <PermissionSelect {...props} fieldKey="approval_policy" label="审批策略" />
    </div>
  )
}

function KimiRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('kimi-code-cli', props)}
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function AntigravityRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      {modelFieldsFor('antigravity-app', props)}
      <PermissionSelect {...props} fieldKey="mode" label="执行模式" />
      <PermissionSelect {...props} fieldKey="sandbox" label="终端沙箱" />
      <PermissionSwitch
        {...props}
        fieldKey="dangerously_skip_permissions"
        label="自动通过权限请求"
      />
    </div>
  )
}

function modelFieldsFor(
  adapterKind: AdapterKind,
  props: RuntimeParameterProps
): React.JSX.Element {
  switch (adapterKind) {
    case 'claude-code-cli':
      return <ModelFields {...props} optionKey="effort" optionLabel="思考强度" />
    case 'codex-cli':
    case 'opencode-cli':
    case 'copilot-cli':
    case 'qoder-cli':
    case 'codebuddy-cli':
    case 'qwen-code':
      return <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
    case 'kiro-cli':
    case 'trae-cn-cli':
    case 'cursor-agent':
    case 'kimi-code-cli':
    case 'antigravity-app':
      return <ModelFields {...props} />
  }
}

function ModelFields({
  adapterKind,
  installation,
  snapshot,
  draft,
  disabled,
  onOpenModelCatalog,
  onChange,
  optionKey,
  optionLabel
}: ModelFieldsProps): React.JSX.Element {
  const explicit = draft.model.mode === 'explicit' ? draft.model : null
  const initialModels = modelCatalogIsServiceable(installation.modelCatalog)
    ? selectableModels(snapshot.models)
    : []
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
        adapterKind={adapterKind}
        installation={installation}
        draft={draft}
        disabled={disabled}
        onOpenModelCatalog={onOpenModelCatalog}
        onChange={onChange}
      />

      {explicit && option && optionKey && (
        <label className="field-label">{optionLabel ?? option.label}
          <select
            value={optionValue}
            disabled={disabled}
            onChange={(event) => setOption(event.target.value)}
          >
            <option value="">跟随模型默认值</option>
            {optionInvalid && (
              <option value={optionValue} disabled>已失效 · {optionValue}</option>
            )}
            {option.values.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        </label>
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
  onChange
}: {
  adapterKind: AdapterKind
  installation: AdapterInstallation
  draft: MemberRuntimeDraft
  disabled: boolean
  onOpenModelCatalog?: () => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [liveCatalog, setLiveCatalog] = useState<RuntimeModelCatalogView | null>(null)
  const requestGeneration = useRef(0)
  const initialCache = installation.modelCatalog
  const initialModels = modelCatalogIsServiceable(initialCache)
    ? selectableModels(installation.snapshot?.models ?? [])
    : []
  const cache = liveCatalog?.cache ?? initialCache
  const models = liveCatalog
    ? (modelCatalogIsServiceable(liveCatalog.cache) ? selectableModels(liveCatalog.models) : [])
    : initialModels
  const explicit = draft.model.mode === 'explicit' ? draft.model : null
  const selectedModel = explicit
    ? models.find((model) => model.id === explicit.modelId) ?? null
    : null
  const selectedValue = explicit?.modelId ?? 'runtime_default'
  const persistedRefreshFailed = latestCatalogRefreshFailed(installation)

  useEffect(() => {
    requestGeneration.current += 1
    setOpen(false)
    setLoading(false)
    setRefreshFailed(false)
    setLiveCatalog(null)
  }, [
    adapterKind,
    installation.id,
    installation.lastProbeAttempt?.attemptedAt,
    installation.lastProbeAttempt?.status,
    initialCache.observedAt,
    initialCache.status
  ])

  const loadCatalog = (): void => {
    if (!onOpenModelCatalog) return
    const generation = ++requestGeneration.current
    setLoading(models.length === 0)
    setRefreshFailed(false)
    void onOpenModelCatalog()
      .then((catalog) => {
        if (generation !== requestGeneration.current || catalog.runtimeKind !== adapterKind) return
        setLiveCatalog(catalog)
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
    if (value === 'runtime_default') {
      onChange({ ...draft, model: { mode: 'runtime_default' } })
      return
    }
    const model = models.find((candidate) => candidate.id === value)
    if (model) onChange({ ...draft, model: explicitSelection(model) })
  }

  const statusCopy = modelCatalogStatusCopy(cache, {
    loading,
    refreshFailed: refreshFailed || persistedRefreshFailed,
    servingCachedModels: models.length > 0,
    refreshStatus: liveCatalog?.refreshStatus ?? null
  })
  const missingSelectionLabel = explicit && !selectedModel
    ? missingModelLabel(explicit.modelId, cache.status)
    : null
  const triggerLabel = draft.model.mode === 'runtime_default'
    ? '跟随 Agent 运行时默认'
    : selectedModel?.displayName ?? missingSelectionLabel ?? draft.model.modelId

  return (
    <div className="field-label runtime-model-field">
      <span>模型策略</span>
      <DropdownMenu.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (nextOpen) loadCatalog()
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            className="runtime-model-picker-trigger"
            type="button"
            disabled={disabled}
            aria-label={`模型，${triggerLabel}`}
          >
            <span>
              <strong>{triggerLabel}</strong>
              <small>{explicit ? `固定模型 · ${statusCopy}` : statusCopy}</small>
            </span>
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="runtime-model-picker-menu"
            align="start"
            sideOffset={5}
            collisionPadding={10}
            loop
          >
            <DropdownMenu.Label className="runtime-model-picker-heading">
              <strong>选择模型</strong>
              <small>{statusCopy}</small>
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={selectedValue} onValueChange={selectModel}>
              <RuntimeModelPickerItem value="runtime_default" label="跟随 Agent 运行时默认" />
              {missingSelectionLabel && (
                <RuntimeModelPickerItem
                  value={explicit?.modelId ?? ''}
                  label={missingSelectionLabel}
                  disabled
                  code
                />
              )}
              {models.map((model) => (
                <RuntimeModelPickerItem
                  key={model.id}
                  value={model.id}
                  label={model.displayName}
                  detail={model.id === model.displayName ? undefined : model.id}
                  code
                />
              ))}
            </DropdownMenu.RadioGroup>
            {loading && (
              <DropdownMenu.Label className="runtime-model-picker-state">
                <i aria-hidden="true" />正在获取当前模型目录…
              </DropdownMenu.Label>
            )}
            {!loading && models.length === 0 && (
              <DropdownMenu.Label className={`runtime-model-picker-state ${refreshFailed || persistedRefreshFailed ? 'error' : ''}`}>
                {refreshFailed || persistedRefreshFailed
                  ? '暂时无法获取模型目录；可以稍后重试。'
                  : '当前没有可选的固定模型。'}
              </DropdownMenu.Label>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function RuntimeModelPickerItem({
  value,
  label,
  detail,
  disabled = false,
  code = false
}: {
  value: string
  label: string
  detail?: string
  disabled?: boolean
  code?: boolean
}): React.JSX.Element {
  return (
    <DropdownMenu.RadioItem
      className="runtime-model-picker-item"
      value={value}
      disabled={disabled}
    >
      <span className="runtime-model-picker-copy">
        <strong>{label}</strong>
        {detail && <small className={code ? 'is-code' : ''}>{detail}</small>}
      </span>
      <DropdownMenu.ItemIndicator className="runtime-model-picker-check">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg>
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
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

function latestCatalogRefreshFailed(installation: AdapterInstallation): boolean {
  const attempt = installation.lastProbeAttempt
  if (attempt?.status !== 'failed') return false
  const observedAt = installation.modelCatalog.observedAt
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
  if (status === 'fresh') return `当前目录未提供 · ${modelId}`
  if (status === 'stale') return `缓存中未找到 · ${modelId}`
  return `尚未核对 · ${modelId}`
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
  if (state.loading) return '正在获取当前模型目录'
  if (state.refreshFailed) {
    return state.servingCachedModels
      ? '刷新失败，继续显示上次成功结果'
      : '获取失败，打开后重试'
  }
  if (state.refreshStatus === 'scheduled' || state.refreshStatus === 'joined') {
    return '显示上次成功结果，正在后台刷新'
  }
  if (state.refreshStatus === 'deferred') {
    return state.servingCachedModels
      ? '运行环境正在更新，继续显示上次成功结果'
      : '运行环境正在更新，稍后重新获取'
  }
  switch (cache.status) {
    case 'fresh': return '模型目录刚刚核对'
    case 'stale': return '显示上次成功结果，打开时后台刷新'
    case 'expired': return '缓存已超过 24 小时，打开后重新获取'
    case 'invalidated': return '运行环境已变化，打开后重新获取'
    case 'unavailable': return '尚未获取目录，打开后检查'
  }
}

function explicitSelection(model: ModelDescriptor): ModelSelection {
  return {
    mode: 'explicit',
    modelId: model.id,
    options: {}
  }
}

function PermissionSelect({
  snapshot,
  draft,
  disabled,
  onChange,
  fieldKey,
  label
}: RuntimeParameterProps & {
  fieldKey: string
  label: string
}): React.JSX.Element {
  const descriptor = permissionDescriptor(snapshot.permissionOptions, fieldKey)
  if (!descriptor) {
    return <p className="runtime-parameter-unavailable">当前能力快照未提供“{label}”。</p>
  }
  const currentValue = stringValue(draft.permissions.values[fieldKey])
  const invalid = Boolean(currentValue)
    && !descriptor.choices.some((choice) => choice.value === currentValue)
  return (
    <label className="field-label">{label}
      <select
        value={currentValue}
        disabled={disabled}
        onChange={(event) => updatePermission(draft, fieldKey, event.target.value, onChange)}
      >
        {!currentValue && <option value="">请选择</option>}
        {invalid && <option value={currentValue} disabled>已失效 · {currentValue}</option>}
        {descriptor.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
    </label>
  )
}

function PermissionSwitch({
  snapshot,
  draft,
  disabled,
  onChange,
  fieldKey,
  label
}: RuntimeParameterProps & {
  fieldKey: string
  label: string
}): React.JSX.Element {
  const descriptor = permissionDescriptor(snapshot.permissionOptions, fieldKey)
  const checked = draft.permissions.values[fieldKey] === 'on'
  return (
    <label className="runtime-parameter-switch">
      <span>
        <strong>{label}</strong>
        <small>{checked ? '开启' : '关闭'}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || !descriptor}
        onChange={(event) => updatePermission(
          draft,
          fieldKey,
          event.target.checked ? 'on' : 'off',
          onChange
        )}
      />
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
