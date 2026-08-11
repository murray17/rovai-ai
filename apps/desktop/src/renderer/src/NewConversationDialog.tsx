import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  CampCreationPreflight,
  CreateCampRequest,
  NewConversationDefaults,
  ProjectNavigationGroup,
  WorkspaceInspection,
  WorkspaceSelection
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'

type CreateCampDraft = Omit<CreateCampRequest, 'commandId' | 'activationState'>
type WorkspaceChoice = WorkspaceSelection | WorkspaceInspection
type GitInspectionStatus = 'idle' | 'loading' | 'ready' | 'failed'

export function NewConversationDialog({
  open,
  initialWorkspace,
  initialSelection,
  attentionMessage,
  explainInitialSelectionAdjustments = false,
  projects,
  preflight,
  agents,
  busy,
  returnFocusElement,
  onOpenChange,
  onChooseWorkspaceDirectory,
  onWorkspaceSelected,
  onCreate
}: {
  open: boolean
  initialWorkspace: WorkspaceSelection | null
  initialSelection?: NewConversationDefaults | null
  attentionMessage?: string | null
  explainInitialSelectionAdjustments?: boolean
  projects: ProjectNavigationGroup[]
  preflight: CampCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  returnFocusElement: HTMLElement | null
  onOpenChange(open: boolean): void
  onChooseWorkspaceDirectory(): Promise<WorkspaceSelection | null>
  onWorkspaceSelected(workspace: WorkspaceSelection): Promise<void>
  onCreate(draft: CreateCampDraft): Promise<void>
}): React.JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceChoice | null>(initialWorkspace)
  const [gitInspectionStatus, setGitInspectionStatus] = useState<GitInspectionStatus>('idle')
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [memberMenuOpen, setMemberMenuOpen] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [leadId, setLeadId] = useState('')
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [name, setName] = useState('')
  const [memberError, setMemberError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent])),
    [agents]
  )
  const preferredInitialSelection = initialSelection ?? null
  const initialSelectionPlan = useMemo(
    () => planInitialCampSelection(preflight, preferredInitialSelection),
    [preferredInitialSelection, preflight.presentMembers]
  )
  const initialSelectionAttention = useMemo(
    () => explainInitialSelectionAdjustments
      ? describeInitialCampSelectionAdjustments(initialSelectionPlan, preferredInitialSelection, agents)
      : null,
    [agents, explainInitialSelectionAdjustments, initialSelectionPlan, preferredInitialSelection]
  )
  const selectedMembers = preflight.presentMembers.filter((member) =>
    selectedMemberIds.includes(member.agentId)
  )
  const normalizedName = normalizeDraftName(name)
  const nameLength = Array.from(normalizedName).length
  const nameError = nameLength > 80 ? '对话名称最多 80 个字符。' : null
  const lead = selectedMembers.find((member) => member.agentId === leadId) ?? null

  useEffect(() => {
    if (!open) return
    const { memberIds, leadId: recommendedLead } = initialSelectionPlan
    setWorkspace(initialWorkspace)
    setGitInspectionStatus(hasGitObservation(initialWorkspace) ? 'ready' : 'idle')
    setProjectMenuOpen(false)
    setMemberMenuOpen(false)
    setSelectedMemberIds(memberIds)
    setLeadId(recommendedLead)
    setOptionalOpen(false)
    setName('')
    setMemberError(null)
    setSubmitError(null)
    requestAnimationFrame(() => projectTriggerRef.current?.focus())
  }, [initialSelectionPlan, initialWorkspace, open])

  const pendingGitInspectionPath = workspace && !hasGitObservation(workspace)
    ? workspace.projectPath
    : null

  useEffect(() => {
    if (!open || !pendingGitInspectionPath) return
    let cancelled = false
    setGitInspectionStatus('loading')
    void window.rovai.request<WorkspaceInspection>('workspaces.inspect', {
      path: pendingGitInspectionPath
    }).then((inspection) => {
      if (cancelled || inspection.projectPath !== pendingGitInspectionPath) return
      setWorkspace(inspection)
      setGitInspectionStatus('ready')
    }).catch((error: unknown) => {
      if (cancelled) return
      setGitInspectionStatus('failed')
      setSubmitError(`Git 状态检查失败：${errorMessage(error)}`)
    })
    return () => { cancelled = true }
  }, [open, workspace])

  const toggleMember = (agentId: string): void => {
    if (busy) return
    setMemberError(null)
    setSelectedMemberIds((current) => {
      const next = toggleCampMemberSelection({
        memberIds: current,
        leadId,
        toggledMemberId: agentId,
        stableMemberOrder: preflight.presentMembers.map((member) => member.agentId)
      })
      if (next.blocked) {
        setMemberError('至少选择 1 位队员')
      } else {
        setLeadId(next.leadId)
      }
      return next.memberIds
    })
  }

  const chooseWorkspaceDirectory = async (): Promise<void> => {
    setSubmitError(null)
    try {
      const selected = await onChooseWorkspaceDirectory()
      if (selected) {
        await onWorkspaceSelected(selected)
        setWorkspace(selected)
        setGitInspectionStatus('idle')
        setProjectMenuOpen(false)
      }
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const selectKnownWorkspace = (project: ProjectNavigationGroup): void => {
    setSubmitError(null)
    setWorkspace({ name: project.name, projectPath: project.projectPath })
    setGitInspectionStatus('idle')
    setProjectMenuOpen(false)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || selectedMemberIds.length === 0 || !leadId || nameError) return
    setSubmitError(null)
    try {
      await onCreate({
        name: normalizedName || null,
        workspace: workspace ? { projectPath: workspace.projectPath } : null,
        memberAgentIds: selectedMemberIds,
        defaultLeadAgentId: leadId,
        collaborationMode: 'peer'
      })
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const projectLabel = workspace?.name ?? '使用快速对话'
  const projectDetail = workspace?.projectPath ?? 'Rovai-ai 管理的快速对话目录'
  const capability = workspaceCapability(workspace, gitInspectionStatus)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay new-camp-dialog-overlay" />
        <Dialog.Content
          className="new-camp-dialog"
          aria-describedby="new-camp-dialog-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusElement?.focus()
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <form className="new-camp-dialog-layout" onSubmit={(event) => void submit(event)}>
            <header className="new-camp-dialog-header">
              <div>
                <span className="new-camp-eyebrow"><i />NEW CAMP</span>
                <Dialog.Title>创建新对话</Dialog.Title>
                <Dialog.Description id="new-camp-dialog-description">
                  确定这段对话的工作环境与队员。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="dialog-close" type="button" aria-label="关闭创建新对话" disabled={busy}>×</button>
              </Dialog.Close>
            </header>

            <div className="new-camp-dialog-body">
              {attentionMessage && <p className="new-camp-attention" role="status">{attentionMessage}</p>}
              {initialSelectionAttention && (
                <div className="new-camp-attention new-camp-defaults-attention" role="status">
                  <strong>默认配置已失效</strong>
                  <ul>
                    {initialSelectionAttention.items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
                  </ul>
                  <p>{initialSelectionAttention.note}</p>
                </div>
              )}
              <section className="new-camp-section">
                <SectionHeading step="01" title="工作目录" optional detail="选择任意安全、可读目录；不选择则创建在快速对话。" />
                <div className="new-camp-picker">
                  <button
                    ref={projectTriggerRef}
                    className="new-camp-picker-trigger"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={projectMenuOpen}
                    disabled={busy}
                    onClick={() => setProjectMenuOpen((current) => !current)}
                  >
                    <span className="new-camp-picker-icon" aria-hidden="true">⌂</span>
                    <span><strong>{projectLabel}</strong><small>{projectDetail}</small></span>
                    <span className="new-camp-chevron" aria-hidden="true">⌄</span>
                  </button>
                  {projectMenuOpen && (
                    <div className="new-camp-picker-menu" role="listbox" aria-label="选择工作目录">
                      <ProjectOption
                        label="使用快速对话"
                        detail="Rovai-ai 管理的快速对话目录"
                        selected={workspace === null}
                        onSelect={() => {
                          setWorkspace(null)
                          setProjectMenuOpen(false)
                        }}
                      />
                      {projects.map((candidate) => {
                        return (
                          <ProjectOption
                            key={candidate.projectKey}
                            label={candidate.name}
                            detail={candidate.projectPath}
                            selected={workspace?.projectPath === candidate.projectPath}
                            onSelect={() => selectKnownWorkspace(candidate)}
                          />
                        )
                      })}
                      <button className="new-camp-project-option choose-local" type="button" role="option" aria-selected="false" onClick={() => void chooseWorkspaceDirectory()}>
                        <span aria-hidden="true">＋</span><span><strong>选择工作目录…</strong><small>普通目录与 Git worktree 均可</small></span>
                      </button>
                    </div>
                  )}
                </div>
                {workspace && (
                  <div className={`workspace-capability-note ${capability.tone}`} role="status">
                    <strong>{capability.label}</strong>
                    <span>{capability.detail}</span>
                  </div>
                )}
              </section>

              <section className="new-camp-section">
                <SectionHeading
                  step="02"
                  title="队员与 Lead"
                  suffix={`已选 ${selectedMembers.length} / ${preflight.presentMembers.length}`}
                  detail="默认选择全部在队的队员；Agent 运行时状态不影响结构选择。"
                />
                {preflight.presentMembers.length === 0
                  ? (
                      <div className="new-camp-empty-members" role="alert">
                        当前没有在队的队员，请先前往队员页调整队员状态。
                      </div>
                    )
                  : (
                      <>
                        <div className="new-camp-picker">
                          <button
                            className="new-camp-picker-trigger member-trigger"
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={memberMenuOpen}
                            disabled={busy}
                            onClick={() => setMemberMenuOpen((current) => !current)}
                          >
                            <span className="new-camp-member-stack" aria-hidden="true">
                              {selectedMembers.slice(0, 4).map((member) => {
                                const profile = profileById.get(member.agentId)
                                return profile
                                  ? <MemberAvatar key={profile.agentId} agentId={profile.agentId} avatarRef={profile.avatarRef} displayName={profile.displayName} size="mention" decorative />
                                  : null
                              })}
                            </span>
                            <span><strong>已选择 {selectedMembers.length} 位队员</strong><small>{selectedMembers.map((member) => member.displayName).join('、')}</small></span>
                            <span className="new-camp-chevron" aria-hidden="true">⌄</span>
                          </button>
                          {memberMenuOpen && (
                            <div className="new-camp-picker-menu member-menu" role="listbox" aria-label="选择队员" aria-multiselectable="true">
                              <div className="new-camp-member-toolbar">
                                <span>本次 Camp 队员</span>
                                <button
                                  type="button"
                                  disabled={busy || selectedMembers.length === preflight.presentMembers.length}
                                  onClick={() => {
                                    setSelectedMemberIds(preflight.presentMembers.map((member) => member.agentId))
                                    setMemberError(null)
                                  }}
                                >全选</button>
                              </div>
                              {preflight.presentMembers.map((member) => {
                                const profile = profileById.get(member.agentId)
                                const selected = selectedMemberIds.includes(member.agentId)
                                return (
                                  <label className={`new-camp-member-option ${selected ? '' : 'unselected'}`} key={member.agentId}>
                                    <input type="checkbox" checked={selected} disabled={busy} onChange={() => toggleMember(member.agentId)} />
                                    {profile && <MemberAvatar agentId={profile.agentId} avatarRef={profile.avatarRef} displayName={profile.displayName} size="list" decorative />}
                                    <span className="new-camp-member-copy">
                                      <strong>{member.displayName}<small>{profile?.teamRole || '队员'}</small></strong>
                                      <small>{runtimeDetail(profile)}</small>
                                    </span>
                                    <RuntimeReadiness status={member.runtimeReadiness} />
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        </div>
                        {memberError && <p className="new-camp-field-error" role="alert">{memberError}</p>}
                        <label className="new-camp-lead-field">
                          <span>Lead</span>
                          <select value={leadId} disabled={busy} onChange={(event) => setLeadId(event.target.value)}>
                            {selectedMembers.map((member) => (
                              <option key={member.agentId} value={member.agentId}>
                                {member.displayName} · {readinessLabel(member.runtimeReadiness)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
              </section>

              <section className="new-camp-section optional-section">
                <div className="new-camp-optional-shell">
                  <button
                    className="new-camp-optional-trigger"
                    type="button"
                    aria-expanded={optionalOpen}
                    aria-controls="new-camp-optional-panel"
                    disabled={busy}
                    onClick={() => {
                      const opening = !optionalOpen
                      setOptionalOpen(opening)
                      if (opening) requestAnimationFrame(() => nameInputRef.current?.focus())
                    }}
                  >
                    <span aria-hidden="true">☷</span>
                    <span><strong>可选配置</strong><small>补充对话名称，不影响上面的结构配置。</small></span>
                    <em>{normalizedName || '未设置'}</em>
                    <span className="new-camp-chevron" aria-hidden="true">⌄</span>
                  </button>
                  {optionalOpen && (
                    <div className="new-camp-optional-panel" id="new-camp-optional-panel">
                      <div className="new-camp-name-heading">
                        <label htmlFor="new-camp-name">对话名称 <span>· 非必填</span></label>
                        <span>{nameLength} / 80</span>
                      </div>
                      <div className="new-camp-name-input-shell">
                        <input
                          ref={nameInputRef}
                          id="new-camp-name"
                          value={name}
                          disabled={busy}
                          aria-invalid={Boolean(nameError)}
                          aria-describedby={nameError ? 'new-camp-name-error' : 'new-camp-name-hint'}
                          onChange={(event) => setName(limitDraftNameInput(event.target.value))}
                          placeholder="输入名称…"
                          autoComplete="off"
                        />
                        {name.length > 0 && (
                          <button
                            type="button"
                            aria-label="清空对话名称"
                            disabled={busy}
                            onClick={() => {
                              setName('')
                              nameInputRef.current?.focus()
                            }}
                          >×</button>
                        )}
                      </div>
                      {nameError
                        ? <small className="new-camp-field-error" id="new-camp-name-error" role="alert">{nameError}</small>
                        : <small id="new-camp-name-hint">留空将创建为「未命名对话」。</small>}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <footer className="new-camp-dialog-footer">
              <div>
                <span>{workspace?.name ?? '快速对话'} · <strong>{selectedMembers.length} 位队员</strong></span>
                {lead && <span> · Lead：{lead.displayName}</span>}
                {submitError && <p role="alert">{submitError}</p>}
              </div>
              <div>
                <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close>
                <button className="primary-button" type="submit" disabled={busy || selectedMembers.length === 0 || !leadId || Boolean(nameError)}>
                  {busy ? '正在创建…' : '创建'}
                </button>
              </div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SectionHeading({ step, title, detail, optional = false, suffix }: {
  step: string
  title: string
  detail: string
  optional?: boolean
  suffix?: string
}): React.JSX.Element {
  return (
    <div className="new-camp-section-heading">
      <span>{step}</span>
      <div><strong>{title}{optional && <em> · 可选</em>}{suffix && <em> · {suffix}</em>}</strong><small>{detail}</small></div>
    </div>
  )
}

function ProjectOption({ label, detail, selected, onSelect }: {
  label: string
  detail: string
  selected: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <button className={`new-camp-project-option ${selected ? 'selected' : ''}`} type="button" role="option" aria-selected={selected} onClick={onSelect}>
      <span aria-hidden="true">⌂</span><span><strong>{label}</strong><small>{detail}</small></span><b aria-hidden="true">✓</b>
    </button>
  )
}

function RuntimeReadiness({ status }: {
  status: CampCreationPreflight['presentMembers'][number]['runtimeReadiness']
}): React.JSX.Element {
  return <span className={`new-camp-runtime-status ${status === 'ready' ? 'ready' : 'attention'}`}><i />{readinessLabel(status)}</span>
}

function readinessLabel(status: CampCreationPreflight['presentMembers'][number]['runtimeReadiness']): string {
  return status === 'ready'
    ? '可用'
    : status === 'runtime_not_configured'
      ? '未配置 Agent 运行时'
      : '不可用'
}

function runtimeDetail(profile: AgentProfile | undefined): string {
  if (!profile?.runtimeConfiguration) return '尚未选择 Agent 运行时'
  return `${profile.runtimeConfiguration.adapterKind} · ${readinessLabel(profile.runtimeReadiness.status)}`
}

export function workspaceCapability(
  workspace: WorkspaceChoice | null,
  inspectionStatus: GitInspectionStatus = 'ready'
): {
  label: string
  detail: string
  tone: 'neutral' | 'clean' | 'attention'
} {
  if (workspace && !hasGitObservation(workspace)) {
    return inspectionStatus === 'failed'
      ? {
          label: 'Git 检测失败',
          detail: '目录仍可用于创建对话；Git 能力会在实际使用前重新检查。',
          tone: 'attention'
        }
      : {
          label: '正在检测 Git…',
          detail: '目录已经可用，你可以继续创建；Git 能力会在后台更新。',
          tone: 'neutral'
        }
  }
  if (!workspace || workspace.gitObservation.state === 'not_git') {
    return {
      label: '普通目录',
      detail: '你可以正常创建会话并处理文件；分支、提交和差异比较等 Git 功能当前不可用。',
      tone: 'neutral'
    }
  }
  if (workspace.gitObservation.state === 'git_invalid') {
    return {
      label: 'Git 状态异常',
      detail: '当前工作区的 Git 元数据不可用。普通文件工作仍可继续，Git 相关功能暂时禁用。',
      tone: 'attention'
    }
  }
  return workspace.gitObservation.headCommit
    ? {
        label: 'Git 仓库',
        detail: '当前可以使用分支、提交和差异比较等 Git 功能。',
        tone: 'clean'
      }
    : {
        label: '空 Git 仓库',
        detail: 'Git 能力可用；当前仓库尚未产生首个提交。',
        tone: 'clean'
      }
}

function hasGitObservation(
  workspace: WorkspaceChoice | null
): workspace is WorkspaceInspection {
  return workspace !== null && 'gitObservation' in workspace
}

export function initialCampSelection(
  preflight: CampCreationPreflight,
  preferred: NewConversationDefaults | null = null
): {
  memberIds: string[]
  leadId: string
} {
  const { memberIds, leadId } = planInitialCampSelection(preflight, preferred)
  return { memberIds, leadId }
}

export interface InitialCampSelectionPlan {
  memberIds: string[]
  leadId: string
  excludedMemberIds: string[]
  usedPresentMembersFallback: boolean
  leadChanged: boolean
}

export function planInitialCampSelection(
  preflight: CampCreationPreflight,
  preferred: NewConversationDefaults | null = null
): InitialCampSelectionPlan {
  const presentMemberIds = preflight.presentMembers.map((member) => member.agentId)
  const preferredMemberIds = preferred?.memberAgentIds.filter((agentId) =>
    presentMemberIds.includes(agentId)
  ) ?? []
  const memberIds = preferredMemberIds.length > 0 ? preferredMemberIds : presentMemberIds
  const leadId = preferred && memberIds.includes(preferred.defaultLeadAgentId)
    ? preferred.defaultLeadAgentId
    : preflight.presentMembers.find(
      (member) => memberIds.includes(member.agentId) && member.runtimeReadiness === 'ready'
    )?.agentId ?? memberIds[0] ?? ''
  return {
    memberIds,
    leadId,
    excludedMemberIds: preferred?.memberAgentIds.filter((agentId) =>
      !presentMemberIds.includes(agentId)
    ) ?? [],
    usedPresentMembersFallback: preferred !== null && preferredMemberIds.length === 0,
    leadChanged: preferred !== null && preferred.defaultLeadAgentId !== leadId
  }
}

export interface InitialCampSelectionAttention {
  items: string[]
  note: string
}

export function describeInitialCampSelectionAdjustments(
  plan: InitialCampSelectionPlan,
  preferred: NewConversationDefaults | null,
  agents: AgentProfile[]
): InitialCampSelectionAttention | null {
  if (!preferred) return null
  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  const displayName = (agentId: string): string => profileById.get(agentId)?.displayName ?? agentId
  const items = plan.excludedMemberIds.map((agentId) => {
    const agent = profileById.get(agentId)
    if (!agent) return `默认队员“${agentId}”当前不存在，本次未加入`
    if (agent.presence === 'removed' || agent.removedAt !== null) {
      return `${agent.displayName}已永久移除，本次未加入`
    }
    if (agent.presence === 'away') return `${agent.displayName}已暂时离队，本次未加入`
    return `${agent.displayName}当前不在可选队员中，本次未加入`
  })

  if (plan.usedPresentMembersFallback) {
    const selectedNames = plan.memberIds.map(displayName).join('、')
    if (preferred.memberAgentIds.length === 0) {
      items.push(selectedNames
        ? `未保存有效的默认队员，本次暂时选择全部当前在队队员：${selectedNames}`
        : '未保存有效的默认队员，当前也没有可选队员')
    } else {
      items.push(selectedNames
        ? `默认队员均不可用，本次暂时选择全部当前在队队员：${selectedNames}`
        : '默认队员均不可用，当前也没有可选队员')
    }
  }

  if (plan.leadChanged) {
    const originalLead = profileById.get(preferred.defaultLeadAgentId)
    if (!originalLead) {
      items.push(preferred.defaultLeadAgentId
        ? `原默认 Lead“${preferred.defaultLeadAgentId}”当前不存在`
        : '未保存有效的默认 Lead')
    } else if (originalLead.presence === 'removed' || originalLead.removedAt !== null) {
      items.push(`原默认 Lead ${originalLead.displayName}已永久移除`)
    } else if (originalLead.presence === 'away') {
      items.push(`原默认 Lead ${originalLead.displayName}已暂时离队`)
    } else {
      items.push(`原默认 Lead ${originalLead.displayName}当前不可用`)
    }
    items.push(plan.leadId
      ? `本次暂时选择${displayName(plan.leadId)}作为 Lead`
      : '当前没有可用队员可作为 Lead')
  }

  if (items.length === 0) {
    items.push('已保存配置曾失效，本次仍按当前可用的保存值预选，请确认后创建')
  }

  return {
    items,
    note: '以上调整只用于本次创建，不会修改“设置 → 通用”中保存的默认配置。'
  }
}

export function normalizeDraftName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function limitDraftNameInput(value: string): string {
  const normalized = normalizeDraftName(value)
  if (Array.from(normalized).length <= 80) return value
  return Array.from(normalized).slice(0, 80).join('')
}

export function toggleCampMemberSelection({
  memberIds,
  leadId,
  toggledMemberId,
  stableMemberOrder
}: {
  memberIds: string[]
  leadId: string
  toggledMemberId: string
  stableMemberOrder: string[]
}): {
  memberIds: string[]
  leadId: string
  blocked: boolean
} {
  if (!memberIds.includes(toggledMemberId)) {
    return {
      memberIds: stableMemberOrder.filter(
        (id) => id === toggledMemberId || memberIds.includes(id)
      ),
      leadId,
      blocked: false
    }
  }
  if (memberIds.length === 1) return { memberIds, leadId, blocked: true }
  const nextMemberIds = memberIds.filter((id) => id !== toggledMemberId)
  return {
    memberIds: nextMemberIds,
    leadId: leadId === toggledMemberId ? nextMemberIds[0] ?? '' : leadId,
    blocked: false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
