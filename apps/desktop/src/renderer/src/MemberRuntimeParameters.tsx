import type {
  AdapterInstallation,
  AdapterKind,
  AdapterPermissionConfig,
  AgentProfile,
  MemberRuntimeConfiguration,
  ModelDescriptor,
  ModelSelection,
  PermissionOptionDescriptor
} from '@contracts'

export type MemberRuntimeDraft = {
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

type RuntimeParameterProps = {
  snapshot: NonNullable<AdapterInstallation['snapshot']>
  draft: MemberRuntimeDraft
  disabled: boolean
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
  onChange
}: {
  adapterKind: AdapterKind
  installation: AdapterInstallation | null
  draft: MemberRuntimeDraft | null
  disabled: boolean
  onChange(draft: MemberRuntimeDraft): void
}): React.JSX.Element {
  const snapshot = installation?.snapshot ?? null
  const content = snapshot && draft
    ? runtimeParametersFor(adapterKind, { snapshot, draft, disabled, onChange })
    : (
        <p className="runtime-parameter-empty">
          当前还没有可编辑的能力快照。你仍可保存 Agent 运行时选择；检查完成后需要回来保存运行参数。
        </p>
      )
  return (
    <section className="member-runtime-parameters" aria-labelledby="member-runtime-parameters-title">
      <header>
        <span>
          <strong id="member-runtime-parameters-title">运行参数</strong>
          <small>模型、模型参数与 Agent 运行时原生权限</small>
        </span>
      </header>
      <div className="member-runtime-parameters-body">
        {content}
      </div>
    </section>
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
    case 'antigravity-app':
      return <AntigravityRuntimeParameters {...props} />
  }
}

function CodexRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
      <PermissionSelect {...props} fieldKey="sandbox_mode" label="文件系统访问" />
      <PermissionSelect {...props} fieldKey="approval_policy" label="审批策略" />
    </div>
  )
}

function OpenCodeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
      <PermissionSelect {...props} fieldKey="permission" label="工具权限" />
    </div>
  )
}

function CopilotRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
      <PermissionSwitch {...props} fieldKey="allow_all" label="自动允许全部操作" />
    </div>
  )
}

function ClaudeRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="effort" optionLabel="思考强度" />
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function KiroRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} />
    </div>
  )
}

function QoderRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function CodeBuddyRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
      <PermissionSelect {...props} fieldKey="permission_mode" label="权限模式" />
    </div>
  )
}

function QwenRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} optionKey="reasoning_effort" optionLabel="推理强度" />
      <PermissionSelect {...props} fieldKey="approval_mode" label="审批模式" />
    </div>
  )
}

function AntigravityRuntimeParameters(props: RuntimeParameterProps): React.JSX.Element {
  return (
    <div className="runtime-parameter-form">
      <ModelFields {...props} />
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

function ModelFields({
  snapshot,
  draft,
  disabled,
  onChange,
  optionKey,
  optionLabel
}: ModelFieldsProps): React.JSX.Element {
  const models = snapshot.models.filter((model) => (
    !model.hidden
    && !model.deprecated
    && !model.id.endsWith('://runtime-default')
  ))
  const explicit = draft.model.mode === 'explicit' ? draft.model : null
  const selectedModel = explicit
    ? snapshot.models.find((model) => model.id === explicit.modelId) ?? null
    : null
  const option = optionKey && selectedModel
    ? selectedModel.options.find((candidate) => candidate.key === optionKey) ?? null
    : null

  const setStrategy = (mode: ModelSelection['mode']): void => {
    if (mode === 'runtime_default') {
      onChange({ ...draft, model: { mode: 'runtime_default' } })
      return
    }
    const model = models.find((candidate) => candidate.isDefault) ?? models[0]
    if (!model) return
    onChange({
      ...draft,
      model: explicitSelection(model)
    })
  }

  const setModel = (modelId: string): void => {
    const model = models.find((candidate) => candidate.id === modelId)
    if (!model) return
    onChange({
      ...draft,
      model: explicitSelection(model)
    })
  }

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

  const modelInvalid = explicit && !models.some((model) => model.id === explicit.modelId)
  const optionValue = explicit && optionKey
    ? stringValue(explicit.options[optionKey])
    : ''
  const optionInvalid = optionValue
    ? !option?.values.some((candidate) => candidate.value === optionValue)
    : false

  return (
    <>
      <label className="field-label">模型策略
        <select
          value={draft.model.mode}
          disabled={disabled}
          onChange={(event) => setStrategy(event.target.value as ModelSelection['mode'])}
        >
          <option value="runtime_default">跟随 Runtime 默认</option>
          <option value="explicit" disabled={models.length === 0}>固定模型</option>
        </select>
      </label>

      {explicit && (
        <label className="field-label">模型
          <select
            value={explicit.modelId}
            disabled={disabled}
            onChange={(event) => setModel(event.target.value)}
          >
            {modelInvalid && (
              <option value={explicit.modelId} disabled>已失效 · {explicit.modelId}</option>
            )}
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.displayName}</option>
            ))}
          </select>
        </label>
      )}

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
