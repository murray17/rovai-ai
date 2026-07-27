import { useEffect, useMemo, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentCampMembership,
  AgentProfile,
  AgentRuntimeProbeResult,
  AgentRuntimePreference,
  CreateAgentProfileCommand,
  HealthStatus,
  ModelDescriptor,
  RuntimeReadinessStatus,
  StoredCommandResult,
  UpdateAgentProfileCommand
} from '@contracts'
import { identityColorToken } from './theme'

type MembersViewProps = {
  agents: AgentProfile[]
  installations: AdapterInstallation[]
  runtimeCandidates: AgentRuntimeProbeResult[]
  runtimeDiscoveryPending: boolean
  onReload(): Promise<void>
  onOpenRuntimeSettings(): void
}

type IdentityDraft = {
  handle: string
  displayName: string
  personaLabel: string
  roleTitle: string
  roleDescription: string
  instructions: string
  memoryProposalEnabled: boolean
}

type RuntimeDraft = {
  installationId: string
  modelMode: 'runtime_default' | 'explicit'
  modelId: string
  modelOptions: Record<string, string>
  permissions: Record<string, string>
}

const EMPTY_IDENTITY: IdentityDraft = {
  handle: '',
  displayName: '',
  personaLabel: '',
  roleTitle: '',
  roleDescription: '',
  instructions: '',
  memoryProposalEnabled: true
}

export function MembersView({ agents, installations, runtimeCandidates, runtimeDiscoveryPending, onReload, onOpenRuntimeSettings }: MembersViewProps): React.JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [identityDialog, setIdentityDialog] = useState<'create' | 'edit' | null>(null)
  const [memberships, setMemberships] = useState<AgentCampMembership[]>([])
  const [membershipsLoading, setMembershipsLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null)
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null

  useEffect(() => {
    if (selectedAgentId && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null)
    }
  }, [agents, selectedAgentId])

  useEffect(() => {
    let cancelled = false
    setMemberships([])
    if (!selectedAgentId) return undefined
    setMembershipsLoading(true)
    void window.rovai.request<AgentCampMembership[]>('agents.memberships.list', {
      agentProfileId: selectedAgentId
    }).then((nextMemberships) => {
      if (!cancelled) setMemberships(nextMemberships)
    }).catch((nextError) => {
      if (!cancelled) setError(errorMessage(nextError))
    }).finally(() => {
      if (!cancelled) setMembershipsLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedAgentId])

  const runCommand = async (
    busyKey: string,
    method: 'agents.create' | 'agents.update' | 'agents.runtime.set' | 'agents.runtime.clear' | 'agents.status.set' | 'agents.reorder',
    command: unknown
  ): Promise<StoredCommandResult> => {
    setBusy(busyKey)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>(method, {
        commandId: crypto.randomUUID(),
        command
      })
      assertApplied(result)
      await onReload()
      return result
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const saveIdentity = async (draft: IdentityDraft): Promise<void> => {
    const identity = identityCommand(draft, selectedAgent)
    const method = selectedAgent ? 'agents.update' : 'agents.create'
    const result = await runCommand('identity', method, identity)
    if (!selectedAgent) {
      const createdId = result.resultEntity?.entityId ?? stringField(result.payload, 'agentProfileId')
      if (createdId) setSelectedAgentId(createdId)
    }
    setIdentityDialog(null)
  }

  const saveRuntime = async (runtime: AgentRuntimePreference): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime', 'agents.runtime.set', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      runtime
    })
  }

  const clearRuntime = async (): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime-clear', 'agents.runtime.clear', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version
    })
  }

  const registerRuntime = async (candidate: AgentRuntimeProbeResult): Promise<AdapterInstallation> => {
    if (!candidate.executablePath) throw new Error('该 Runtime 没有可用的本机启动路径。')
    setBusy(`runtime-register-${candidate.runtimeKind}`)
    setError(null)
    try {
      const installationId = await createAndRefreshRuntimeInstallation(
        candidate.runtimeKind,
        candidate.executablePath,
        'discovered',
        'default'
      )
      const nextInstallations = await window.rovai.request<AdapterInstallation[]>('runtime.installations.list')
      const registered = nextInstallations.find((installation) => installation.id === installationId)
      if (!registered) throw new Error('Runtime 已完成登记，但无法读取最新安装信息。')
      await onReload()
      return registered
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const changeStatus = async (status: 'active' | 'disabled' | 'archived'): Promise<void> => {
    if (!selectedAgent) return
    await runCommand(`status-${status}`, 'agents.status.set', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      status,
      defaultLeadSuccessors: []
    })
  }

  const dropReorder = async (targetAgentId: string): Promise<void> => {
    const sourceAgentId = dragAgentId
    setDragAgentId(null)
    setDragOverAgentId(null)
    if (!sourceAgentId || sourceAgentId === targetAgentId) return
    const orderedAgentProfileIds = agents.map((agent) => agent.id)
    const from = orderedAgentProfileIds.indexOf(sourceAgentId)
    const to = orderedAgentProfileIds.indexOf(targetAgentId)
    if (from < 0 || to < 0) return
    orderedAgentProfileIds.splice(from, 1)
    orderedAgentProfileIds.splice(to, 0, sourceAgentId)
    await runCommand('reorder', 'agents.reorder', { orderedAgentProfileIds }).catch(() => undefined)
  }

  return (
    <>
      <section className="project-hero member-hero">
        <div>
          <h2>成员</h2>
          <p>成员保存长期身份和默认 Runtime；加入 Camp、Default Lead 与 Camp 权限仍由具体 Camp 管理。</p>
        </div>
        <div className="project-actions">
          <button className="primary-button" onClick={() => setIdentityDialog('create')}>＋ 新增成员</button>
        </div>
      </section>

      {error && (
        <div className="inline-error member-page-error" role="alert">
          <strong>成员配置未保存</strong><span>{error}</span>
        </div>
      )}

      <section className="member-workbench">
        <aside className="member-list" aria-label="成员列表">
          <div className="member-list-heading"><strong>{agents.length} 位成员</strong><span>选择后编辑</span></div>
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`member-list-row ${dragOverAgentId === agent.id && dragAgentId !== agent.id ? 'drag-over' : ''}`}
              draggable={busy === null}
              onDragStart={(event) => {
                setDragAgentId(agent.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOverAgentId(agent.id)
              }}
              onDragLeave={() => setDragOverAgentId((current) => current === agent.id ? null : current)}
              onDrop={(event) => {
                event.preventDefault()
                void dropReorder(agent.id)
              }}
              onDragEnd={() => {
                setDragAgentId(null)
                setDragOverAgentId(null)
              }}
            >
              <span className="member-drag-handle" title="拖拽调整 Member Order" aria-hidden="true">⋮⋮</span>
              <button
                type="button"
                className={`member-list-item ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
                aria-current={selectedAgent?.id === agent.id ? 'true' : undefined}
                onClick={() => setSelectedAgentId(agent.id)}
                style={{ '--agent-accent': identityColorToken(agent.id) } as React.CSSProperties}
              >
                <span className="member-list-accent" aria-hidden="true" />
                <span className="member-list-avatar" aria-hidden="true">{agent.displayName.slice(0, 1)}</span>
                <span className="member-list-copy">
                  <strong>{agent.displayName}</strong>
                  <small>@{agent.handle} · {profileStatusLabel(agent.status)}</small>
                </span>
                <RuntimeReadinessMark status={agent.runtimeReadiness.status} />
              </button>
            </div>
          ))}
          <p className="member-order-note">⋮⋮ 拖拽调整 Member Order —— 只影响展示与新 Camp 初始顺序，不代表能力或权限。</p>
        </aside>

        <div className="member-detail">
          {!selectedAgent && (
            <div className="member-empty">
              <span aria-hidden="true">◎</span>
              <h3>选择一位成员</h3>
              <p>这里不会自动选中成员，也不会替新成员绑定 Runtime。请选择已有成员，或新建一个长期身份。</p>
            </div>
          )}
          {selectedAgent && (
            <>
              <MemberIdentitySummary
                agent={selectedAgent}
                busy={busy}
                onEdit={() => setIdentityDialog('edit')}
                onStatus={changeStatus}
              />
              <MemberRuntimeForm
                key={`${selectedAgent.id}:${selectedAgent.version}`}
                agent={selectedAgent}
                installations={installations}
                runtimeCandidates={runtimeCandidates}
                runtimeDiscoveryPending={runtimeDiscoveryPending}
                busy={busy}
                onSave={saveRuntime}
                onClear={clearRuntime}
                onRegister={registerRuntime}
                onOpenRuntimeSettings={onOpenRuntimeSettings}
              />
              <MemberCampMemberships memberships={memberships} loading={membershipsLoading} />
            </>
          )}
        </div>
      </section>

      <MemberIdentityDialog
        open={identityDialog !== null}
        agent={identityDialog === 'edit' ? selectedAgent : null}
        busy={busy === 'identity'}
        onOpenChange={(open) => !open && setIdentityDialog(null)}
        onSubmit={saveIdentity}
      />
    </>
  )
}

function MemberIdentitySummary({ agent, busy, onEdit, onStatus }: {
  agent: AgentProfile
  busy: string | null
  onEdit(): void
  onStatus(status: 'active' | 'disabled' | 'archived'): Promise<void>
}): React.JSX.Element {
  return (
    <section className="member-section member-identity-section">
      <div className="member-section-heading">
        <div className="member-profile-heading" style={{ '--agent-accent': identityColorToken(agent.id) } as React.CSSProperties}>
          <span className="member-profile-avatar">{agent.displayName.slice(0, 1)}</span>
          <div><p className="eyebrow">@{agent.handle}</p><h3>{agent.displayName}</h3><span>{agent.roleTitle ?? '自定义成员'}{agent.personaLabel ? ` · ${agent.personaLabel}` : ''}</span></div>
        </div>
        <button className="quiet-button" onClick={onEdit}>编辑身份</button>
      </div>
      <p className="member-role-description">{agent.roleDescription}</p>
      {agent.instructions && <details className="member-instructions"><summary>查看注入 Runtime 的成员指令</summary><pre>{agent.instructions}</pre></details>}
      <div className="member-status-actions">
        <span>状态：<strong>{profileStatusLabel(agent.status)}</strong></span>
        {agent.status === 'active' && <button className="quiet-button" disabled={busy !== null} onClick={() => void onStatus('disabled').catch(() => undefined)}>禁用</button>}
        {agent.status === 'disabled' && <button className="quiet-button" disabled={busy !== null} onClick={() => void onStatus('active').catch(() => undefined)}>重新启用</button>}
        {agent.status !== 'archived' && <button className="danger-button" disabled={busy !== null} onClick={() => void onStatus('archived').catch(() => undefined)}>归档</button>}
      </div>
      {agent.status !== 'active' && <div className="member-status-note" role="status">该成员不能启动新的 AgentRun；历史消息、Task 与 Run 会继续保留。</div>}
    </section>
  )
}

export function MemberRuntimeForm({ agent, installations, runtimeCandidates, runtimeDiscoveryPending = false, busy, onSave, onClear, onRegister, onOpenRuntimeSettings }: {
  agent: AgentProfile
  installations: AdapterInstallation[]
  runtimeCandidates: AgentRuntimeProbeResult[]
  runtimeDiscoveryPending?: boolean
  busy: string | null
  onSave(runtime: AgentRuntimePreference): Promise<void>
  onClear(): Promise<void>
  onRegister(candidate: AgentRuntimeProbeResult): Promise<AdapterInstallation>
  onOpenRuntimeSettings(): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<RuntimeDraft>(() => runtimeDraft(agent, installations))
  const [submitError, setSubmitError] = useState<string | null>(null)
  const unregisteredCandidates = runtimeCandidates.filter((candidate) => candidate.executablePath && !installations.some(
    (installation) => installation.adapterKind === candidate.runtimeKind && installation.executablePath === candidate.executablePath
  ))
  const installation = installations.find((candidate) => candidate.id === draft.installationId) ?? null
  const snapshot = installation?.snapshot ?? null
  const models = snapshot?.models.filter((model) =>
    !model.hidden && !model.id.endsWith('://runtime-default')
  ) ?? []
  const selectedModel = models.find((model) => model.id === draft.modelId) ?? null
  const usable = Boolean(installation?.enabled && snapshot?.probeStatus === 'ready' && !snapshot.staleAt)
  const dangerous = draft.permissions.sandbox_mode === 'danger-full-access'
    || draft.permissions.approval_policy === 'never'
    || draft.permissions.permission === 'allow'
    || draft.permissions.allow_all === 'on'
    || draft.permissions.permission_mode === 'bypassPermissions'
    || draft.permissions.dangerously_skip_permissions === 'on'

  const chooseInstallation = (installationId: string, registeredInstallation: AdapterInstallation | null = null): void => {
    const nextInstallation = registeredInstallation
      ?? installations.find((candidate) => candidate.id === installationId)
      ?? null
    setDraft({
      installationId,
      modelMode: 'runtime_default',
      modelId: '',
      modelOptions: {},
      permissions: recommendedPermissionValues(nextInstallation)
    })
    setSubmitError(null)
  }

  const chooseRuntime = async (value: string): Promise<void> => {
    if (!value.startsWith('candidate:')) {
      chooseInstallation(value)
      return
    }
    const candidate = unregisteredCandidates.find((item) => runtimeCandidateValue(item) === value)
    if (!candidate) {
      setSubmitError('检测到的 Runtime 已发生变化，请重新选择。')
      return
    }
    setSubmitError(null)
    try {
      const registered = await onRegister(candidate)
      chooseInstallation(registered.id, registered)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  const chooseModel = (modelId: string): void => {
    const model = models.find((candidate) => candidate.id === modelId) ?? null
    setDraft((current) => ({
      ...current,
      modelId,
      modelOptions: defaultModelOptions(model)
    }))
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    try {
      if (!installation || !snapshot) throw new Error('请先选择一个已经完成探测的本机 Runtime。')
      if (!usable) throw new Error('当前 Runtime 快照不可用于启动，请先在诊断页刷新。')
      if (draft.modelMode === 'explicit' && !selectedModel) throw new Error('请选择当前安装实际报告的模型。')
      const missingPermission = snapshot.permissionOptions.find((option) =>
        option.supported && option.required && !draft.permissions[option.key]
      )
      if (missingPermission) throw new Error(`请选择 ${missingPermission.label}。`)
      await onSave({
        installationId: installation.id,
        model: draft.modelMode === 'runtime_default'
          ? { mode: 'runtime_default' }
          : { mode: 'explicit', modelId: draft.modelId, options: draft.modelOptions },
        permissions: {
          adapterKind: installation.adapterKind,
          schemaVersion: snapshot.permissionSchemaVersion,
          values: draft.permissions
        }
      })
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <section className="member-section">
      <div className="member-section-heading">
        <div><h3>运行配置</h3></div>
        <RuntimeReadinessBadge agent={agent} />
      </div>

      {agent.runtimeReadiness.blockers.length > 0 && (
        <div className="runtime-blockers" role="status">
          {agent.runtimeReadiness.blockers.map((blocker) => (
            <span key={blocker.code}><strong>{runtimeBlockerLabel(blocker.code)}</strong>{blocker.detail ? ` · ${blocker.detail}` : ''}</span>
          ))}
        </div>
      )}

      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label">Adapter Installation
          <select value={draft.installationId} disabled={busy !== null || (runtimeDiscoveryPending && installations.length === 0)} onChange={(event) => void chooseRuntime(event.target.value)}>
            <option value="">{runtimeDiscoveryPending && installations.length === 0 ? '正在检测本机 Runtime…' : '不选择 Runtime'}</option>
            {installations.length > 0 && <optgroup label="已纳入 Rovai-ai">
              {installations.map((candidate) => (
                <option key={candidate.id} value={candidate.id} disabled={!candidate.enabled}>
                  {adapterLabel(candidate.adapterKind)} · {candidate.snapshot?.reportedVersion ?? '未探测'} · {candidate.executablePath}
                </option>
              ))}
            </optgroup>}
            {unregisteredCandidates.length > 0 && <optgroup label="本机已检测到 · 选择后纳入 Rovai-ai">
              {unregisteredCandidates.map((candidate) => (
                <option key={runtimeCandidateValue(candidate)} value={runtimeCandidateValue(candidate)}>
                  {adapterLabel(candidate.runtimeKind)} · {candidate.reportedVersion ?? runtimeProbeLabel(candidate.status)} · {candidate.executablePath}
                </option>
              ))}
            </optgroup>}
          </select>
          {unregisteredCandidates.length > 0 && <span className="field-help">选择本机已检测到的 CLI 后，Rovai-ai 会先登记并探测实际模型与权限；不会自动绑定，确认配置后仍需保存。</span>}
        </label>

        {installations.length === 0 && unregisteredCandidates.length === 0 && runtimeDiscoveryPending && (
          <div className="runtime-empty member-runtime-empty" role="status">
            <span>正在检测本机支持的 Agent Runtime…</span>
          </div>
        )}

        {installations.length === 0 && unregisteredCandidates.length === 0 && !runtimeDiscoveryPending && (
          <div className="runtime-empty member-runtime-empty">
            <span>没有发现可选择的本机 Runtime。请先安装受支持的 CLI，或在设置中添加自定义可执行文件路径。</span>
            <button className="quiet-button" type="button" onClick={onOpenRuntimeSettings}>前往设置</button>
          </div>
        )}

        {draft.installationId && !installation && <div className="inline-error">此前选择的安装已不存在，请重新选择。</div>}
        {installation && (
          <>
            <div className="runtime-installation-summary">
              <span><strong>{adapterLabel(installation.adapterKind)}</strong>{installation.snapshot?.reportedVersion ?? '版本未知'}</span>
              <code>{installation.executablePath}</code>
              <small>{runtimeSnapshotSummary(installation)}</small>
            </div>

            <label className="field-label">模型策略
              <select value={draft.modelMode} onChange={(event) => setDraft((current) => ({
                ...current,
                modelMode: event.target.value as RuntimeDraft['modelMode'],
                modelId: '',
                modelOptions: {}
              }))}>
                <option value="runtime_default">runtime_default（每个新 Run 使用当前默认模型）</option>
                <option value="explicit">explicit（固定模型 ID 与参数）</option>
              </select>
            </label>

            {draft.modelMode === 'explicit' && (
              <>
                <label className="field-label">模型
                  <select value={draft.modelId} onChange={(event) => chooseModel(event.target.value)}>
                    <option value="">选择模型</option>
                    {models.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.id}{model.deprecated ? '（已弃用）' : ''}</option>)}
                  </select>
                </label>
                {selectedModel?.options.map((option) => (
                  <label className="field-label" key={option.key}>{option.label} <code>{option.key}</code>
                    <select value={draft.modelOptions[option.key] ?? ''} onChange={(event) => setDraft((current) => ({
                      ...current,
                      modelOptions: { ...current.modelOptions, [option.key]: event.target.value }
                    }))}>
                      <option value="">使用模型默认值</option>
                      {option.values.map((choice) => <option key={choice.value} value={choice.value}>{choice.label} · {choice.value}</option>)}
                    </select>
                  </label>
                ))}
              </>
            )}

            {snapshot?.permissionOptions.filter((option) => option.supported).map((option) => (
              <label className="field-label" key={option.key}>{option.label} <code>{option.key}</code>
                <span className="field-help">{option.description} · {option.scope} scope</span>
                <select value={draft.permissions[option.key] ?? ''} onChange={(event) => setDraft((current) => ({
                  ...current,
                  permissions: { ...current.permissions, [option.key]: event.target.value }
                }))}>
                  {!option.required && <option value="">不设置</option>}
                  {option.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
              </label>
            ))}
          </>
        )}

        {dangerous && <div className="danger-notice" role="alert"><strong>当前包含开放权限值</strong><span>Rovai-ai 会按原值传给该 Agent。请确认你理解其原生权限语义和作用域。</span></div>}
        {submitError && <div className="inline-error">{submitError}</div>}
        <div className="member-form-actions">
          {agent.runtimePreference && <button className="quiet-button" type="button" disabled={busy !== null} onClick={() => void onClear().catch(() => undefined)}>清除 Runtime</button>}
          <button className="primary-button" disabled={!draft.installationId || !usable || busy !== null}>{busy === 'runtime' ? '正在保存…' : '保存运行配置'}</button>
        </div>
      </form>
    </section>
  )
}

function MemberCampMemberships({ memberships, loading }: { memberships: AgentCampMembership[]; loading: boolean }): React.JSX.Element {
  return (
    <section className="member-section">
      <div className="member-section-heading"><div><h3>已加入的 Camp</h3></div></div>
      {loading && <p className="member-muted">正在读取 Camp 关系…</p>}
      {!loading && memberships.length === 0 && <p className="member-muted">尚未加入任何 Camp。成员身份不会因为创建而自动加入项目。</p>}
      {!loading && memberships.length > 0 && (
        <div className="membership-list">
          {memberships.map((membership) => (
            <div key={membership.campId}>
              <code>{membership.projectPath}</code>
              <span>{membership.isDefaultLead ? 'Default Lead · ' : ''}{membershipStatusLabel(membership.membershipStatus)} · Camp {membership.campStatus}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MemberIdentityDialog({ open, agent, busy, onOpenChange, onSubmit }: {
  open: boolean
  agent: AgentProfile | null
  busy: boolean
  onOpenChange(open: boolean): void
  onSubmit(draft: IdentityDraft): Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState<IdentityDraft>(EMPTY_IDENTITY)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(agent ? {
      handle: agent.handle,
      displayName: agent.displayName,
      personaLabel: agent.personaLabel ?? '',
      roleTitle: agent.roleTitle ?? '',
      roleDescription: agent.roleDescription,
      instructions: agent.instructions,
      memoryProposalEnabled: agent.defaultCapabilities.includes('memory.propose_change')
    } : EMPTY_IDENTITY)
    setSubmitError(null)
  }, [agent, open])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    try {
      await onSubmit(draft)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content member-dialog" aria-describedby="member-dialog-description">
          <div className="dialog-heading"><div><Dialog.Title>{agent ? '编辑成员身份' : '新增成员'}</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭成员编辑" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="member-dialog-description">身份与角色会长期保留；新成员不会自动选择 Runtime，也不会自动加入 Camp。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <div className="member-form-grid">
              <label className="field-label">显示名称<input required maxLength={80} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} autoFocus /></label>
              <label className="field-label">@handle<input required minLength={2} maxLength={32} pattern="[a-z0-9][a-z0-9_-]+" value={draft.handle} onChange={(event) => setDraft({ ...draft, handle: event.target.value })} placeholder="builder" /></label>
              <label className="field-label">角色标题<input value={draft.roleTitle} onChange={(event) => setDraft({ ...draft, roleTitle: event.target.value })} placeholder="例如：前端工程师" /></label>
              <label className="field-label">身份标签<input value={draft.personaLabel} onChange={(event) => setDraft({ ...draft, personaLabel: event.target.value })} placeholder="可选" /></label>
            </div>
            <label className="field-label">长期角色描述<textarea required maxLength={4000} rows={4} value={draft.roleDescription} onChange={(event) => setDraft({ ...draft, roleDescription: event.target.value })} placeholder="说明这位成员长期负责什么、擅长什么。" /></label>
            <label className="field-label">Runtime 指令<textarea maxLength={32000} rows={7} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="这些指令会注入该成员的新 AgentRun。" /></label>
            <label className="memory-capability-toggle"><input type="checkbox" checked={draft.memoryProposalEnabled} onChange={(event) => setDraft({ ...draft, memoryProposalEnabled: event.target.checked })} /><span><strong>允许提出共同记忆</strong><small>只决定未来 AgentRun 是否具备提案资格；符合全局策略的新增伙伴经验可先作为“未确认”生效，其他提案仍需逐条确认。</small></span></label>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={busy || !draft.displayName.trim() || !draft.roleDescription.trim()}>{busy ? '正在保存…' : agent ? '保存身份' : '创建成员'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function RuntimeInstallationsPanel({ health, installations, onReload }: {
  health: HealthStatus | null
  installations: AdapterInstallation[]
  onReload(): Promise<void>
}): React.JSX.Element {
  const [customOpen, setCustomOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runtimeCandidates = health?.runtimeCandidates ?? (health ? [health.codex] : [])
  const unregisteredCandidates = runtimeCandidates.filter((candidate) => candidate.executablePath && !installations.some(
    (installation) => installation.adapterKind === candidate.runtimeKind && installation.executablePath === candidate.executablePath
  ))

  const refresh = async (installationId: string): Promise<void> => {
    setBusy(`refresh-${installationId}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('runtime.installations.refresh', {
        commandId: crypto.randomUUID(),
        installationId
      })
      assertApplied(result)
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const create = async (adapterKind: AdapterKind, executablePath: string, source: 'discovered' | 'custom', authScope: string): Promise<void> => {
    setBusy('create-installation')
    setError(null)
    try {
      await createAndRefreshRuntimeInstallation(adapterKind, executablePath, source, authScope)
      setCustomOpen(false)
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (installation: AdapterInstallation): Promise<void> => {
    setBusy(`toggle-${installation.id}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('runtime.installations.update', {
        commandId: crypto.randomUUID(),
        command: {
          installationId: installation.id,
          expectedVersion: installation.version,
          executablePath: installation.executablePath,
          source: installation.source,
          authScope: installation.authScope,
          enabled: !installation.enabled
        }
      })
      assertApplied(result)
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="section-block runtime-installations">
      <div className="section-heading">
        <div><h2>本机 Runtime</h2></div>
        <button className="quiet-button" onClick={() => setCustomOpen(true)}>添加自定义路径</button>
      </div>
      <p className="section-intro">Rovai-ai 只引用并探测本机已有 CLI，不负责安装、升级，也不会读取或保存上游 Token。</p>

      {unregisteredCandidates.map((candidate) => candidate.executablePath && (
        <div className="runtime-candidate" key={`${candidate.runtimeKind}:${candidate.executablePath}`}>
          <div><strong>检测到 {adapterLabel(candidate.runtimeKind)}</strong><code>{candidate.executablePath}</code><span>{candidate.reportedVersion ?? '版本未知'} · {adapterMaturityLabel(candidate.runtimeKind)} · {runtimeProbeLabel(candidate.status)}</span></div>
          <button className="primary-button" disabled={busy !== null} onClick={() => void create(candidate.runtimeKind, candidate.executablePath!, 'discovered', 'default').catch(() => undefined)}>纳入 Rovai-ai</button>
        </div>
      ))}
      {unregisteredCandidates.length === 0 && installations.length === 0 && <div className="runtime-empty">没有发现可用 Runtime。你可以安装 Codex CLI、OpenCode CLI、Copilot CLI、Claude Code CLI 或 Antigravity App，或添加自定义可执行文件路径。</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="runtime-installation-list">
        {installations.map((installation) => (
          <article key={installation.id} className={`runtime-installation-row ${installation.enabled ? '' : 'disabled'}`}>
            <div className="runtime-installation-main">
              <div><strong>{adapterLabel(installation.adapterKind)}</strong><RuntimeSnapshotBadge installation={installation} /></div>
              <code>{installation.executablePath}</code>
              <span>{installation.snapshot?.reportedVersion ?? '尚未探测'} · {adapterMaturityLabel(installation.adapterKind)} · {installation.source} · auth scope: {installation.authScope}</span>
            </div>
            <dl>
              <div><dt>模型</dt><dd>{reportedModelCount(installation)}</dd></div>
              <div><dt>引用成员</dt><dd>{installation.referencedProfileCount}</dd></div>
              <div><dt>最近探测</dt><dd>{formatTimestamp(installation.snapshot?.lastAttemptedAt)}</dd></div>
            </dl>
            <div className="runtime-row-actions">
              <button className="quiet-button" disabled={busy !== null || !installation.enabled} onClick={() => void refresh(installation.id)}>{busy === `refresh-${installation.id}` ? '探测中…' : '刷新能力'}</button>
              <button className={installation.enabled ? 'danger-button' : 'quiet-button'} disabled={busy !== null} onClick={() => void toggle(installation)}>{installation.enabled ? '停用' : '启用'}</button>
            </div>
          </article>
        ))}
      </div>

      <CustomRuntimeDialog open={customOpen} busy={busy === 'create-installation'} onOpenChange={setCustomOpen} onSubmit={create} />
    </section>
  )
}

async function createAndRefreshRuntimeInstallation(
  adapterKind: AdapterKind,
  executablePath: string,
  source: 'discovered' | 'custom',
  authScope: string
): Promise<string> {
  const result = await window.rovai.request<StoredCommandResult>('runtime.installations.create', {
    commandId: crypto.randomUUID(),
    command: { adapterKind, executablePath, source, authScope }
  })
  assertApplied(result)
  const installationId = result.resultEntity?.entityId ?? stringField(result.payload, 'installationId')
  if (!installationId) throw new Error('Core 没有返回新 Installation ID。')
  const refreshed = await window.rovai.request<StoredCommandResult>('runtime.installations.refresh', {
    commandId: crypto.randomUUID(),
    installationId
  })
  assertApplied(refreshed)
  return installationId
}

function runtimeCandidateValue(candidate: AgentRuntimeProbeResult): string {
  return `candidate:${candidate.runtimeKind}:${candidate.executablePath ?? ''}`
}

function CustomRuntimeDialog({ open, busy, onOpenChange, onSubmit }: {
  open: boolean
  busy: boolean
  onOpenChange(open: boolean): void
  onSubmit(adapterKind: AdapterKind, executablePath: string, source: 'custom', authScope: string): Promise<void>
}): React.JSX.Element {
  const [adapterKind, setAdapterKind] = useState<AdapterKind>('codex-cli')
  const [path, setPath] = useState('')
  const [authScope, setAuthScope] = useState('default')
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAdapterKind('codex-cli')
    setPath('')
    setAuthScope('default')
    setSubmitError(null)
  }, [open])

  const browse = async (): Promise<void> => {
    setSubmitError(null)
    try {
      const selected = await window.rovai.selectRuntimeExecutable()
      if (selected) setPath(selected)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    try {
      await onSubmit(adapterKind, path.trim(), 'custom', authScope.trim())
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content runtime-dialog" aria-describedby="runtime-dialog-description">
          <div className="dialog-heading"><div><Dialog.Title>添加本机 Runtime</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭 Runtime 编辑" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="runtime-dialog-description">选择本机已有 CLI。Rovai-ai 会使用稳定路径启动当前安装版本，并通过各自协议读取实际模型与权限选项。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label">Adapter<select value={adapterKind} onChange={(event) => setAdapterKind(event.target.value as AdapterKind)}><option value="codex-cli">Codex CLI</option><option value="opencode-cli">OpenCode CLI</option><option value="copilot-cli">GitHub Copilot CLI</option><option value="claude-code-cli">Claude Code CLI</option><option value="antigravity-app">Antigravity App（通过 agy companion）</option></select></label>
            <label className="field-label">可执行文件路径
              <span className="path-field"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder={runtimePathPlaceholder(adapterKind)} autoFocus /><button className="quiet-button" type="button" onClick={() => void browse()}>浏览…</button></span>
            </label>
            <label className="field-label">认证 / 配置作用域<input value={authScope} onChange={(event) => setAuthScope(event.target.value)} placeholder="default" /></label>
            <div className="authorization-box"><strong>边界说明</strong><ul><li>Rovai-ai 保存的是这个启动入口，不固定上游版本。</li><li>刷新会启动 CLI 做握手、认证与模型能力探测。</li><li>Rovai-ai 不修改 CLI 的全局配置或凭据。</li></ul></div>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={busy || !path.trim() || !authScope.trim()}>{busy ? '正在探测…' : '添加并探测'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RuntimeReadinessMark({ status }: { status: RuntimeReadinessStatus }): React.JSX.Element {
  return <span className={`runtime-readiness-mark readiness-${status}`} aria-label={runtimeReadinessLabel(status)} title={runtimeReadinessLabel(status)}>{status === 'ready' ? '✓' : status === 'runtime_not_configured' ? '○' : '!'}</span>
}

function RuntimeReadinessBadge({ agent }: { agent: AgentProfile }): React.JSX.Element {
  const status = agent.runtimeReadiness.status
  return <span className={`runtime-readiness-badge readiness-${status}`}><RuntimeReadinessMark status={status} />{runtimeReadinessLabel(status)}</span>
}

function RuntimeSnapshotBadge({ installation }: { installation: AdapterInstallation }): React.JSX.Element {
  const snapshot = installation.snapshot
  const ready = installation.enabled && snapshot?.probeStatus === 'ready' && !snapshot.staleAt
  return <span className={`runtime-snapshot-badge ${ready ? 'ready' : 'attention'}`}>{installation.enabled ? ready ? 'Ready' : 'Needs attention' : 'Disabled'}</span>
}

function identityCommand(draft: IdentityDraft, agent: AgentProfile | null): CreateAgentProfileCommand | UpdateAgentProfileCommand {
  const capabilities = new Set(agent?.defaultCapabilities ?? [])
  if (draft.memoryProposalEnabled) capabilities.add('memory.propose_change')
  else capabilities.delete('memory.propose_change')
  const identity: CreateAgentProfileCommand = {
    handle: draft.handle.trim(),
    displayName: draft.displayName.trim(),
    avatarRef: agent?.avatarRef ?? null,
    personaLabel: draft.personaLabel.trim() || null,
    accent: agent?.accent ?? null,
    roleTitle: draft.roleTitle.trim() || null,
    roleDescription: draft.roleDescription.trim(),
    instructions: draft.instructions,
    defaultCapabilities: [...capabilities]
  }
  return agent ? { ...identity, agentProfileId: agent.id, expectedVersion: agent.version } : identity
}

function runtimeDraft(agent: AgentProfile, installations: AdapterInstallation[]): RuntimeDraft {
  const preference = agent.runtimePreference
  if (!preference) return { installationId: '', modelMode: 'runtime_default', modelId: '', modelOptions: {}, permissions: {} }
  const installation = installations.find((candidate) => candidate.id === preference.installationId) ?? null
  return {
    installationId: preference.installationId,
    modelMode: preference.model.mode,
    modelId: preference.model.mode === 'explicit' ? preference.model.modelId : '',
    modelOptions: preference.model.mode === 'explicit'
      ? stringifyValues(preference.model.options)
      : {},
    permissions: {
      ...recommendedPermissionValues(installation),
      ...stringifyValues(preference.permissions.values)
    }
  }
}

export function recommendedPermissionValues(installation: AdapterInstallation | null): Record<string, string> {
  const result: Record<string, string> = {}
  for (const option of installation?.snapshot?.permissionOptions ?? []) {
    if (!option.supported || typeof option.recommendedValue !== 'string') continue
    result[option.key] = option.recommendedValue
  }
  return result
}

function defaultModelOptions(model: ModelDescriptor | null): Record<string, string> {
  return Object.fromEntries(model?.options.flatMap((option) => option.defaultValue ? [[option.key, option.defaultValue]] : []) ?? [])
}

function stringifyValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []))
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  const detail = stringField(result.payload, 'message') ?? stringField(result.payload, 'detail')
  throw new Error(detail ? `${commandCodeLabel(result.code)}：${detail}` : commandCodeLabel(result.code))
}

function commandCodeLabel(code: string): string {
  return ({
    'agent_profile.handle_conflict': '该 @handle 已被其他成员使用',
    'agent_profile.version_conflict': '成员已被其他操作更新，请刷新后重试',
    'agent_profile.default_lead_successor_required': '该成员仍是 Camp 的 Default Lead，请先在 Camp 中指定继任者',
    'adapter_installation.already_exists': '这个 Runtime 安装已经存在',
    'adapter_installation.version_conflict': 'Runtime 安装已被更新，请刷新后重试'
  } as Record<string, string>)[code] ?? `Core 拒绝了操作：${code}`
}

function runtimeBlockerLabel(code: string): string {
  return ({
    runtime_not_configured: '尚未配置 Runtime',
    runtime_configuration_incomplete: 'Runtime 配置不完整',
    runtime_probe_required: '需要探测 Runtime',
    runtime_snapshot_stale: 'CLI 已变化或能力快照已过期',
    runtime_authentication_required: '需要先完成上游 CLI 登录',
    runtime_model_unavailable: '显式模型当前不可用',
    runtime_model_option_unknown: '模型参数已不受支持',
    runtime_model_option_invalid: '模型参数值已失效',
    runtime_permission_schema_mismatch: '权限结构已升级，需要重新确认',
    runtime_permission_option_unknown: '权限字段已不受支持',
    runtime_permission_option_unsupported: '所选权限值当前不能执行',
    runtime_permission_value_invalid: '权限值已失效',
    runtime_permission_value_required: '缺少必填权限值',
    runtime_permission_adapter_mismatch: '权限配置属于另一个 Adapter',
    adapter_installation_missing: '引用的 Runtime 安装不存在',
    adapter_installation_disabled: '引用的 Runtime 安装已停用',
    profile_inactive: '成员当前未启用'
  } as Record<string, string>)[code] ?? code
}

function adapterLabel(kind: AdapterKind): string {
  return ({
    'codex-cli': 'Codex CLI',
    'opencode-cli': 'OpenCode CLI',
    'copilot-cli': 'GitHub Copilot CLI',
    'claude-code-cli': 'Claude Code CLI',
    'antigravity-app': 'Antigravity App'
  })[kind]
}

function adapterMaturityLabel(kind: AdapterKind): string {
  return ({
    'codex-cli': 'stable',
    'opencode-cli': 'beta',
    'copilot-cli': 'beta',
    'claude-code-cli': 'beta',
    'antigravity-app': 'experimental'
  })[kind]
}

function runtimePathPlaceholder(kind: AdapterKind): string {
  return ({
    'codex-cli': '/opt/homebrew/bin/codex',
    'opencode-cli': '/opt/homebrew/bin/opencode',
    'copilot-cli': '/opt/homebrew/bin/copilot',
    'claude-code-cli': '/opt/homebrew/bin/claude',
    'antigravity-app': '~/.local/bin/agy'
  })[kind]
}

function runtimeReadinessLabel(status: RuntimeReadinessStatus): string {
  return ({
    runtime_not_configured: '未配置 Runtime',
    needs_attention: '需要处理',
    ready: '可启动',
    profile_inactive: '成员未启用'
  })[status]
}

function profileStatusLabel(status: AgentProfile['status']): string {
  return ({ active: '已启用', disabled: '已禁用', archived: '已归档' })[status]
}

function membershipStatusLabel(status: AgentCampMembership['membershipStatus']): string {
  return status === 'active' ? '当前成员' : '已离开'
}

function runtimeSnapshotSummary(installation: AdapterInstallation): string {
  const snapshot = installation.snapshot
  if (!installation.enabled) return '该安装已停用'
  if (!snapshot) return '尚未探测能力'
  if (snapshot.staleAt) return `快照已过期 · ${snapshot.lastError ?? '请刷新'}`
  if (snapshot.probeStatus !== 'ready') return `${snapshot.probeStatus} · ${snapshot.lastError ?? '请刷新'}`
  return `${reportedModelCount(installation)} 个模型 · ${snapshot.permissionOptions.length} 个权限字段`
}

function reportedModelCount(installation: AdapterInstallation): number {
  return installation.snapshot?.models.filter((model) =>
    !model.id.endsWith('://runtime-default')
  ).length ?? 0
}

function runtimeProbeLabel(status: HealthStatus['codex']['status'] | undefined): string {
  return ({
    ready: '能力探测通过',
    not_installed: '未安装',
    authentication_required: '需要登录',
    missing_capabilities: '缺少必需能力',
    probe_failed: '探测失败'
  } as Record<string, string>)[status ?? ''] ?? '等待检测'
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
