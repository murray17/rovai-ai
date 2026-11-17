import { useEffect, useId, useRef, useState } from 'react'
import { RuntimeModelSearch } from './RuntimeModelSearch'
import { RuntimeParameterSelect } from './RuntimeParameterSelect'
import { runtimeEffortOption } from './runtime-model-presentation'
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
  RuntimeModelCatalogTarget,
  RuntimeModelCatalogView
} from '@contracts'
import { UiText, uiAttribute, useInterfaceLanguage } from './interface-language'

export type MemberRuntimeDraft = {
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

type RuntimeParameterProps = {
  active?: boolean
  adapterKind: AdapterKind
  installation: AdapterInstallation
  permissionOptions: PermissionOptionDescriptor[]
  draft: MemberRuntimeDraft
  disabled: boolean
  onOpenModelCatalog?: (target?: RuntimeModelCatalogTarget) => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
}

type ModelFieldsProps = RuntimeParameterProps & {
  optionKey?: ReturnType<typeof runtimeEffortOption>['key']
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
  active = true,
  adapterKind,
  installation,
  draft,
  disabled,
  onOpenModelCatalog,
  onChange
}: {
  inline?: boolean
  active?: boolean
  adapterKind: AdapterKind
  installation: AdapterInstallation | null
  draft: MemberRuntimeDraft | null
  disabled: boolean
  onOpenModelCatalog?: (target?: RuntimeModelCatalogTarget) => Promise<RuntimeModelCatalogView>
  onChange(draft: MemberRuntimeDraft): void
}): React.JSX.Element {
  useInterfaceLanguage()
  const titleId = useId()
  const permissionOptions = installation?.permissionOptions ?? installation?.snapshot?.permissionOptions ?? []
  const content = installation && draft
    ? runtimeParametersFor(adapterKind, {
        active,
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
  active = true,
  adapterKind,
  installation,
  model,
  disabled,
  onOpenModelCatalog,
  onChange
}: {
  active?: boolean
  adapterKind: AdapterKind
  installation: AdapterInstallation | null
  model: ModelSelection | null
  disabled: boolean
  onOpenModelCatalog?: (target?: RuntimeModelCatalogTarget) => Promise<RuntimeModelCatalogView>
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
        active,
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
    case 'goose-cli':
      return <div className="runtime-parameter-form">{modelFieldsFor('goose-cli', props)}<PermissionSelect {...props} fieldKey="mode" label={uiAttribute("执行模式")} /></div>
    case 'kilo-cli':
      return <div className="runtime-parameter-form">{modelFieldsFor('kilo-cli', props)}</div>
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
    case 'hermes-cli':
      return <div className="runtime-parameter-form">{modelFieldsFor('hermes-cli', props)}<PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("文件编辑审批")} /></div>
    case 'minimax-code-cli':
      return <div className="runtime-parameter-form">{modelFieldsFor('minimax-code-cli', props)}<PermissionSelect {...props} fieldKey="mode" label={uiAttribute("执行模式")} /><PermissionSelect {...props} fieldKey="permission_mode" label={uiAttribute("权限模式")} /></div>
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
    case 'goose-cli':
    case 'minimax-code-cli':
    case 'command-code-cli':
    case 'claude-code-cli':
    case 'codebuddy-cli':
    case 'kilo-cli':
    case 'codex-cli':
    case 'opencode-cli':
    case 'copilot-cli':
    case 'qoder-cli':
    case 'qwen-code':
    case 'deepseek-harness':
    case 'hermes-cli':
    case 'pi': {
      const { key, label } = runtimeEffortOption(adapterKind)
      return <ModelFields {...props} optionKey={key} optionLabel={label} />
    }
    case 'kiro-cli':
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
  active: pageActive = true, adapterKind, installation, draft, disabled,
  onOpenModelCatalog, onChange, optionKey, optionLabel
}: ModelFieldsProps): React.JSX.Element {
  const installationIdentity = catalogInstallationIdentity(installation)
  // Core clears its success time only for actual identity/configuration changes.
  // Track that transition without treating health metadata or new observations
  // as a new visit; no directory data is stored in this request fence.
  const projection = useRef({ identity: installationIdentity, observedAt: installation.modelCatalog.observedAt, scope: 0 })
  if (projection.current.identity !== installationIdentity) {
    projection.current = { identity: installationIdentity, observedAt: installation.modelCatalog.observedAt, scope: 0 }
  } else {
    if (projection.current.observedAt !== null && installation.modelCatalog.observedAt === null) projection.current.scope += 1
    projection.current.observedAt = installation.modelCatalog.observedAt
  }
  const identity = `${installationIdentity}:${projection.current.scope}`
  const explicit = draft.model.mode === 'explicit' ? draft.model : null
  const isDsh = adapterKind === 'deepseek-harness'
  const supportsTargetOptions = isDsh || adapterKind === 'minimax-code-cli' || adapterKind === 'goose-cli'
  const isPi = adapterKind === 'pi'
  const target = supportsTargetOptions && explicit
    ? { modelId: explicit.modelId, ...(isDsh ? { dshSource: explicit.dshSource } : {}) } : undefined
  const key = JSON.stringify([identity, target?.modelId, target?.dshSource])
  const [live, setLive] = useState<{ identity: string; catalog: RuntimeModelCatalogView } | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retryNeeded, setRetryNeeded] = useState(false)
  const generation = useRef(0)
  const attempted = useRef<{ key: string; startedAt: number } | null>(null)
  const pending = useRef<{ key: string; generation: number; promise: Promise<RuntimeModelCatalogView> } | null>(null)
  const catalog = live?.identity === identity && liveCatalogIsAtLeastAsRecent(live.catalog, installation.modelCatalog)
    ? live.catalog : null
  const models = catalog ? selectableModels(catalog.models) : displayableInstallationModels(installation)
  const selectedModel = explicit ? models.find(model => model.id === explicit.modelId) ?? null : null
  const optionsKnown = isPi
    ? selectedModel?.runtimeMetadata?.piThinkingSchemaVersion === 1 && selectedModel.runtimeMetadata.piThinkingState === 'known'
    : !supportsTargetOptions || targetModelOptionsResolved(adapterKind, selectedModel, explicit?.dshSource)
  const option = optionKey && selectedModel
    ? selectedModel.options.find(candidate => candidate.key === optionKey) ?? null : null
  // A shared projection may age the same observation after this local response.
  const cache = catalog && catalog.cache.observedAt !== installation.modelCatalog.observedAt
    ? catalog.cache : installation.modelCatalog
  const latest = useRef({ onOpenModelCatalog, cache, target, pageActive, key, retryNeeded })
  latest.current = { onOpenModelCatalog, cache, target, pageActive, key, retryNeeded }

  // Both controls subscribe to one in-flight read. Shared installation updates
  // update presentation only; they are deliberately absent from the visit effect.
  const ensureCatalog = (retry = false, opened = false): void => {
    const current = latest.current
    if (!current.pageActive || !current.onOpenModelCatalog) return
    const now = Date.now()
    const due = Date.parse(current.cache.revalidateAfter ?? '')
    // An explicit target has its own success time. Directory freshness cannot
    // postpone its revalidation; on user access Core decides target freshness.
    const targetAccess = opened && current.target && !current.retryNeeded
    if (!retry && !targetAccess && attempted.current?.key === current.key
      && (!opened || current.retryNeeded || !(due > attempted.current.startedAt && now >= due))) return
    if (!current.target && !retry && runtimeModelCatalogIsFresh(current.cache, now)) {
      setLoading(false)
      setRetryNeeded(false)
      return
    }
    attempted.current = { key: current.key, startedAt: now }
    const request = generation.current
    const publishCatalog = (result: RuntimeModelCatalogView) => {
      setLive(previous => previous?.identity === identity
        && !liveCatalogIsAtLeastAsRecent(result, previous.catalog.cache) ? previous : { identity, catalog: result })
    }
    setLoading(true)
    setRetryNeeded(false)
    if (pending.current?.key !== current.key || pending.current.generation !== request) {
      const read = current.onOpenModelCatalog
      const ownsRequest = () => request === generation.current && current.key === latest.current.key && latest.current.pageActive
      const promise = Promise.resolve().then(async () => {
        if (retry) {
          // The model-menu button always refreshes the directory. Target options may
          // then need its existing selected-model read; Core owns that cache.
          const catalog = await read({ forceRefresh: true })
          if (!current.target || !ownsRequest()) return catalog
          if (catalog.runtimeKind !== adapterKind) throw new Error(uiAttribute('读取结果与当前选择不一致，请重试。'))
          if (catalog.refreshStatus === 'failed' || catalog.refreshStatus === 'deferred') {
            throw new Error(uiAttribute('暂时无法读取该模型的可选项，请重试。'))
          }
          publishCatalog(catalog)
          return read(current.target)
        }
        if (!current.target) return read()
        const cached = await read({ ...current.target, cacheOnly: true })
        if (!ownsRequest()) return cached
        if (cached.runtimeKind !== adapterKind || cached.selectedModelId !== current.target.modelId) throw new Error(uiAttribute('读取结果与当前选择不一致，请重试。'))
        const model = cached.models.find(model => model.id === current.target!.modelId) ?? null
        if (cached.refreshStatus === 'not_required' && targetModelOptionsResolved(adapterKind, model, current.target.dshSource)) return cached
        // Goose parameter reads do not fetch the directory. Load a missing or
        // expired directory once before subscribing to its target observation.
        if (adapterKind === 'goose-cli' && !['fresh', 'stale'].includes(cached.cache.status)) {
          const catalog = await read()
          if (!ownsRequest()) return catalog
          if (catalog.runtimeKind !== adapterKind || ['failed', 'deferred'].includes(catalog.refreshStatus)) {
            throw new Error(uiAttribute('暂时无法读取该模型的可选项，请重试。'))
          }
          publishCatalog(catalog)
        }
        return read(current.target)
      })
      const owner = { key: current.key, generation: request, promise }
      pending.current = owner
      void promise.finally(() => { if (pending.current === owner) pending.current = null }).catch(() => undefined)
    }
    void pending.current.promise.then(result => {
      if (request !== generation.current || current.key !== latest.current.key || !latest.current.pageActive) return
      if (result.runtimeKind !== adapterKind || (current.target && result.selectedModelId !== current.target.modelId)) {
        throw new Error(uiAttribute('读取结果与当前选择不一致，请重试。'))
      }
      if (current.target && result.refreshStatus !== 'deferred'
        && !targetModelOptionsResolved(adapterKind, result.models.find(model => model.id === current.target!.modelId) ?? null, current.target.dshSource)) {
        throw new Error(uiAttribute('暂时无法读取该模型的可选项，请重试。'))
      }
      const incomplete = result.refreshStatus === 'failed' || result.refreshStatus === 'deferred'
      if (!incomplete || result.models.length > 0) {
        publishCatalog(result)
      }
      setRetryNeeded(incomplete)
    }).catch(() => {
      if (request === generation.current && current.key === latest.current.key && latest.current.pageActive) {
        setRetryNeeded(true)
      }
    }).finally(() => {
      if (request === generation.current && current.key === latest.current.key) setLoading(false)
    })
  }
  const ensure = useRef(ensureCatalog)
  ensure.current = ensureCatalog
  useEffect(() => {
    generation.current += 1
    attempted.current = null
    setOpen(false)
    setLoading(false)
    setRetryNeeded(false)
    if (pageActive) ensure.current()
    return () => { generation.current += 1 }
  }, [pageActive, key])

  const selectModel = (value: string): void => {
    if (value === (explicit?.modelId ?? 'runtime_default')) return
    if (value === 'runtime_default') {
      onChange({ ...draft, model: { mode: 'runtime_default' } })
      return
    }
    const model = models.find(candidate => candidate.id === value)
    onChange({ ...draft, model: model ? explicitSelection(model, draft.model)
      : { mode: 'explicit', modelId: value, options: { ...explicit?.options } } })
  }
  const setOption = (value: string): void => {
    if (!explicit || !optionKey) return
    const options = { ...explicit.options }
    if (value) options[optionKey] = value
    else delete options[optionKey]
    onChange({ ...draft, model: { ...explicit, options } })
  }
  const storedOptionValue = explicit && optionKey ? stringValue(explicit.options[optionKey]) : ''
  const optionValue = adapterKind === 'hermes-cli' && ['runtime_default', 'default'].includes(storedOptionValue) ? '' : storedOptionValue
  const optionChoices = (option?.values ?? []).filter(choice => adapterKind !== 'hermes-cli'
    || (choice.value !== 'default' && choice.value !== 'runtime_default'))
  const missing = optionValue && !optionChoices.some(choice => choice.value === optionValue)
  const showOption = isPi
    ? optionValue || (optionsKnown && option?.values.some(choice => choice.value !== 'off'))
    : supportsTargetOptions ? !optionsKnown || option || optionValue : option || storedOptionValue
  const refresh = onOpenModelCatalog ? () => ensureCatalog(true) : undefined

  return <>
    <div className="field-label runtime-model-field">
      <span><UiText zh="模型" /></span>
      <RuntimeModelSearch key={identity} open={open}
        onOpenChange={next => { setOpen(next); if (next) ensureCatalog(false, true) }}
        models={models} value={explicit?.modelId ?? 'runtime_default'}
        label={explicit ? selectedModel?.displayName ?? explicit.modelId : uiAttribute('默认')}
        disabled={disabled} loading={loading}
        onRefresh={refresh} onSelect={selectModel} />
    </div>
    {explicit && optionKey && showOption && <RuntimeParameterSelect
      label={optionLabel ?? option?.label ?? optionKey} value={optionValue}
      disabled={disabled} onChange={setOption}
      onOpen={() => ensureCatalog(false, true)} loading={supportsTargetOptions && loading}
      defaultChoice={{ value: '', label: uiAttribute('跟随模型默认值') }}
      choices={[
        ...(missing ? [{ value: optionValue, label: optionValue }] : []),
        ...optionChoices.map(choice => ({ ...choice, disabled: supportsTargetOptions && !optionsKnown }))
      ]} />}
  </>
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

export function runtimeModelCatalogIsFresh(cache: RuntimeModelCatalogCache, now = Date.now()): boolean {
  return cache.status === 'fresh' && now < Date.parse(cache.revalidateAfter ?? '')
}

function catalogInstallationIdentity(installation: AdapterInstallation): string {
  const installationIdentity = [installation.id, installation.generation, installation.snapshot?.executableFingerprint].join(':')
  if (installation.adapterKind !== 'pi') return installationIdentity
  // Pi's catalog can be invalidated independently of the shared health fields.
  // A prior local response must not outlive Core's new ownership projection.
  const catalogIdentity = installation.snapshot?.models.find(model => model.id === 'pi://runtime-default')
    ?.runtimeMetadata?.piCatalogIdentity
  return JSON.stringify([installationIdentity, installation.modelCatalog.status === 'invalidated', catalogIdentity])
}

// Display policy only. Never use this to approve a new saved model selection.
export function displayableInstallationModels(installation: AdapterInstallation): ModelDescriptor[] {
  const cache = installation.modelCatalog
  const snapshot = installation.snapshot
  const sameEnvironmentHistory = cache.status === 'expired'
    && Boolean(snapshot)
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

export function explicitSelection(
  model: ModelDescriptor,
  previous: ModelSelection
): ModelSelection {
  const previousOptions = previous.mode === 'explicit' ? previous.options : {}
  // Discovery never removes explicit native options, including unlisted values.
  const options = { ...previousOptions }
  return {
    mode: 'explicit',
    modelId: model.id,
    options,
    ...(model.runtimeMetadata?.dshSource === 'native' || model.runtimeMetadata?.dshSource === 'web'
      ? { dshSource: model.runtimeMetadata.dshSource }
      : {})
  }
}

export function targetModelOptionsResolved(kind: AdapterKind, model: ModelDescriptor | null, source?: 'native' | 'web'): boolean {
  return (kind === 'minimax-code-cli' || kind === 'goose-cli') ? model?.runtimeMetadata?.modelOptionsResolved === true
    : kind === 'deepseek-harness' && dshModelOptionsResolved(model, source)
}

export function dshModelOptionsResolved(model: ModelDescriptor | null, source?: 'native' | 'web'): boolean {
  return model?.runtimeMetadata?.dshOptionsResolved === true
    && model.runtimeMetadata.dshSource === (source ?? 'native')
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
