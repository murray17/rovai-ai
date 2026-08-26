import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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
import { NavigationIcon } from './NavigationIcon'

type CreateCampDraft = Omit<CreateCampRequest, 'commandId' | 'activationState'>
type WorkspaceChoice = WorkspaceSelection | WorkspaceInspection
type GitInspectionStatus = 'idle' | 'loading' | 'ready' | 'failed'

export function NewConversationDialog({
  open,
  initialWorkspace,
  initialSelection,
  attentionMessage,
  projects,
  preflight,
  agents,
  busy,
  projectAccessReady,
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
  projects: ProjectNavigationGroup[]
  preflight: CampCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  projectAccessReady: boolean
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
  const closeButtonRef = useRef<HTMLButtonElement>(null)
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
  const selectedMembers = preflight.presentMembers.filter((member) =>
    selectedMemberIds.includes(member.agentId)
  )
  const normalizedName = normalizeDraftName(name)
  const nameLength = Array.from(normalizedName).length
  const nameError = nameLength > 80 ? '对话名称最多 80 个字符。' : null
  const lead = selectedMembers.find((member) => member.agentId === leadId) ?? null
  const leadProfile = lead ? profileById.get(lead.agentId) : undefined
  const projectActionsDisabled = projectWorkspaceActionsDisabled(busy, projectAccessReady)
  const projectSubmissionBlocked = workspaceSubmissionBlocked(workspace, projectAccessReady)

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
  }, [initialSelectionPlan, initialWorkspace, open])

  const pendingGitInspectionPath = workspace && !hasGitObservation(workspace)
    ? workspace.projectPath
    : null

  useEffect(() => {
    if (!workspaceInspectionShouldStart(open, projectAccessReady, pendingGitInspectionPath)) return
    let cancelled = false
    setGitInspectionStatus('loading')
    void window.rovai.request<WorkspaceInspection>('workspaces.inspect', {
      path: pendingGitInspectionPath
    }).then((inspection) => {
      if (cancelled || inspection.projectPath !== pendingGitInspectionPath) return
      setWorkspace(inspection)
      setGitInspectionStatus('ready')
    }).catch(() => {
      if (cancelled) return
      setGitInspectionStatus('failed')
    })
    return () => { cancelled = true }
  }, [open, pendingGitInspectionPath, projectAccessReady])

  useEffect(() => {
    if (open && optionalOpen) nameInputRef.current?.focus()
  }, [open, optionalOpen])

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
    if (projectActionsDisabled) return
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
    if (projectActionsDisabled) return
    setSubmitError(null)
    setWorkspace({ name: project.name, projectPath: project.projectPath })
    setGitInspectionStatus('idle')
    setProjectMenuOpen(false)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (
      busy
      || projectSubmissionBlocked
      || selectedMemberIds.length === 0
      || !leadId
      || nameError
    ) return
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

  const projectLabel = projectAccessReady
    ? workspace?.name ?? '使用快速对话'
    : '正在载入项目…'
  const projectDetail = projectAccessReady
    ? workspace?.projectPath ?? 'Rovai AI 管理的快速对话目录'
    : '正在确认本机项目访问状态'
  const gitPresentation = workspaceGitPresentation(workspace, gitInspectionStatus)

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
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const focusTarget = projectAccessReady
              ? projectTriggerRef.current
              : closeButtonRef.current
            focusTarget?.focus()
          }}
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
              <span className="new-camp-dialog-header-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M10 3v14M3 10h14" />
                </svg>
              </span>
              <div className="new-camp-dialog-header-copy">
                <span className="new-camp-eyebrow"><i />NEW CAMP</span>
                <Dialog.Title>创建新对话</Dialog.Title>
                <Dialog.Description id="new-camp-dialog-description">
                  确定这段对话的工作环境与队员。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button ref={closeButtonRef} className="dialog-close" type="button" aria-label="关闭创建新对话" disabled={busy}>×</button>
              </Dialog.Close>
            </header>

            <div className="new-camp-dialog-body">
              {attentionMessage && <p className="new-camp-attention" role="status">{attentionMessage}</p>}
              <section className="new-camp-section">
                <SectionHeading step="01" title="工作目录" optional detail="选择任意安全、可读目录；不选择则创建在快速对话。" />
                <div className="new-camp-picker">
                  <button
                    ref={projectTriggerRef}
                    className="new-camp-picker-trigger"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={projectMenuOpen}
                    aria-busy={!projectAccessReady}
                    disabled={projectActionsDisabled}
                    onClick={() => setProjectMenuOpen((current) => !current)}
                  >
                    <span className="new-camp-picker-icon" aria-hidden="true">
                      <WorkspaceIcon kind={workspace ? 'project' : 'quick-chat'} />
                    </span>
                    <span><strong>{projectLabel}</strong><small>{projectDetail}</small></span>
                    {gitPresentation.kind === 'metadata' && (
                      <span className="new-camp-git-metadata" title={gitPresentation.label}>
                        {gitPresentation.label}
                      </span>
                    )}
                    {gitPresentation.kind === 'loading' && (
                      <span className="new-camp-git-loading">
                        <i aria-hidden="true" />{gitPresentation.label}
                      </span>
                    )}
                    <DropdownChevron />
                  </button>
                  {projectMenuOpen && (
                    <div className="new-camp-picker-menu" role="listbox" aria-label="选择工作目录">
                      <ProjectOption
                        label="使用快速对话"
                        detail="Rovai AI 管理的快速对话目录"
                        kind="quick-chat"
                        selected={workspace === null}
                        disabled={projectActionsDisabled}
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
                            kind="project"
                            selected={workspace?.projectPath === candidate.projectPath}
                            disabled={projectActionsDisabled}
                            onSelect={() => selectKnownWorkspace(candidate)}
                          />
                        )
                      })}
                      <button className="new-camp-project-option choose-local" type="button" role="option" aria-selected="false" disabled={projectActionsDisabled} onClick={() => void chooseWorkspaceDirectory()}>
                        <span aria-hidden="true">＋</span><span><strong>选择工作目录…</strong><small>普通目录与 Git worktree 均可</small></span>
                      </button>
                    </div>
                  )}
                </div>
                {gitPresentation.kind === 'warning' && (
                  <div className="new-camp-workspace-warning" role="alert">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M10 2.8 18 17H2L10 2.8Z" />
                      <path d="M10 7.2v4.7M10 14.5h.01" />
                    </svg>
                    <div>
                      <strong>{gitPresentation.label}</strong>
                      <span>{gitPresentation.detail}</span>
                    </div>
                  </div>
                )}
              </section>

              <section className="new-camp-section">
                <SectionHeading
                  step="02"
                  title="队员与负责人"
                  suffix={`已选 ${selectedMembers.length} / ${preflight.presentMembers.length}`}
                  detail="默认选择全部在队的队员；结构选择不会改变队员的长期配置。"
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
                            <DropdownChevron />
                          </button>
                          {memberMenuOpen && (
                            <div className="new-camp-picker-menu member-menu" role="listbox" aria-label="选择队员" aria-multiselectable="true">
                              <div className="new-camp-member-toolbar">
                                <span>本次会话队员</span>
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
                        <div className="new-camp-lead-field">
                          <span>负责人</span>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button
                                className="new-camp-lead-trigger"
                                type="button"
                                disabled={busy || !lead}
                                aria-label={lead
                                  ? `当前负责人：${lead.displayName}，${readinessLabel(lead.runtimeReadiness)}；选择负责人`
                                  : '选择负责人'}
                              >
                                {lead && (
                                  <MemberAvatar
                                    agentId={lead.agentId}
                                    avatarRef={leadProfile?.avatarRef ?? null}
                                    displayName={lead.displayName}
                                    size="list"
                                    decorative
                                  />
                                )}
                                <span className="new-camp-lead-copy">
                                  <strong>{lead?.displayName ?? '未设置'}</strong>
                                  <small>{leadProfile?.teamRole || '队员'}</small>
                                </span>
                                {lead && <RuntimeReadiness status={lead.runtimeReadiness} />}
                                <DropdownChevron />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                className="new-camp-lead-menu"
                                align="start"
                                sideOffset={6}
                                collisionPadding={12}
                                aria-label="选择负责人"
                                loop
                              >
                                <DropdownMenu.Label className="new-camp-lead-menu-label">
                                  从已选队员中选择
                                </DropdownMenu.Label>
                                <DropdownMenu.RadioGroup value={leadId} onValueChange={setLeadId}>
                                  {selectedMembers.map((member) => {
                                    const profile = profileById.get(member.agentId)
                                    return (
                                      <DropdownMenu.RadioItem
                                        className="new-camp-lead-option"
                                        value={member.agentId}
                                        key={member.agentId}
                                        disabled={busy}
                                        aria-label={`${member.displayName}，${readinessLabel(member.runtimeReadiness)}`}
                                      >
                                        <MemberAvatar
                                          agentId={member.agentId}
                                          avatarRef={profile?.avatarRef ?? null}
                                          displayName={member.displayName}
                                          size="list"
                                          decorative
                                        />
                                        <span className="new-camp-lead-copy">
                                          <strong>{member.displayName}</strong>
                                          <small>{profile?.teamRole || '队员'}</small>
                                        </span>
                                        <RuntimeReadiness status={member.runtimeReadiness} />
                                        <span className="new-camp-lead-check" aria-hidden="true">
                                          <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
                                        </span>
                                      </DropdownMenu.RadioItem>
                                    )
                                  })}
                                </DropdownMenu.RadioGroup>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
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
                      setOptionalOpen((current) => !current)
                    }}
                  >
                    <span className="new-camp-optional-icon" aria-hidden="true">
                      <svg viewBox="0 0 18 18">
                        <path d="M4 4.5h2M8 4.5h6M4 9h2M8 9h6M4 13.5h2M8 13.5h6" />
                      </svg>
                    </span>
                    <span><strong>可选配置</strong><small>补充对话名称，不影响上面的结构配置。</small></span>
                    <em>{normalizedName || '未设置'}</em>
                    <DropdownChevron />
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
                          placeholder="输入名称..."
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
                {lead && <span> · 负责人：{lead.displayName}</span>}
                {submitError && <p role="alert">{submitError}</p>}
              </div>
              <div>
                <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close>
                <button className="primary-button" type="submit" disabled={busy || projectSubmissionBlocked || selectedMembers.length === 0 || !leadId || Boolean(nameError)}>
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

export function projectWorkspaceActionsDisabled(
  busy: boolean,
  projectAccessReady: boolean
): boolean {
  return busy || !projectAccessReady
}

export function workspaceInspectionShouldStart(
  open: boolean,
  projectAccessReady: boolean,
  pendingPath: string | null
): pendingPath is string {
  return open && projectAccessReady && pendingPath !== null
}

export function workspaceSubmissionBlocked(
  workspace: WorkspaceChoice | null,
  projectAccessReady: boolean
): boolean {
  return workspace !== null && !projectAccessReady
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

function DropdownChevron(): React.JSX.Element {
  return (
    <svg className="new-camp-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.25 6.25 3.75 3.5 3.75-3.5" />
    </svg>
  )
}

function ProjectOption({ label, detail, kind, selected, disabled, onSelect }: {
  label: string
  detail: string
  kind: 'quick-chat' | 'project'
  selected: boolean
  disabled: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <button className={`new-camp-project-option ${selected ? 'selected' : ''}`} type="button" role="option" aria-selected={selected} disabled={disabled} onClick={onSelect}>
      <span className="new-camp-project-option-icon" aria-hidden="true"><WorkspaceIcon kind={kind} /></span>
      <span><strong>{label}</strong><small>{detail}</small></span><b aria-hidden="true">✓</b>
    </button>
  )
}

function WorkspaceIcon({ kind }: { kind: 'quick-chat' | 'project' }): React.JSX.Element {
  if (kind === 'quick-chat') return <NavigationIcon name="square-pen" />
  return (
    <svg className="new-camp-project-folder-icon" viewBox="0 0 24 24">
      <path className="folder-fill" d="M3.75 7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2Z" />
      <path d="M3.9 9.1h16.2" />
    </svg>
  )
}

function RuntimeReadiness({ status }: {
  status: CampCreationPreflight['presentMembers'][number]['runtimeReadiness']
}): React.JSX.Element {
  const tone = status === 'ready' || status === 'light_ready'
    ? 'ready'
    : 'attention'
  return <span className={`new-camp-runtime-status ${tone}`}><i />{readinessLabel(status)}</span>
}

function readinessLabel(status: CampCreationPreflight['presentMembers'][number]['runtimeReadiness']): string {
  return status === 'ready' || status === 'light_ready'
    ? '可用'
    : status === 'installed_unverified'
      ? '不可用，待检查'
      : status === 'runtime_not_configured'
        ? '未配置'
        : '不可用'
}

function runtimeDetail(profile: AgentProfile | undefined): string {
  if (!profile?.runtimeConfiguration) return '尚未完成运行配置'
  return `${profile.runtimeConfiguration.adapterKind} · ${readinessLabel(profile.runtimeReadiness.status)}`
}

export type WorkspaceGitPresentation =
  | { kind: 'none' }
  | { kind: 'loading', label: string }
  | { kind: 'metadata', label: string }
  | { kind: 'warning', label: string, detail: string }

export function workspaceGitPresentation(
  workspace: WorkspaceChoice | null,
  inspectionStatus: GitInspectionStatus = 'ready'
): WorkspaceGitPresentation {
  if (!workspace) return { kind: 'none' }
  if (workspace && !hasGitObservation(workspace)) {
    return inspectionStatus === 'failed'
      ? {
          kind: 'warning',
          label: 'Git 检测失败',
          detail: '未能完成 Git 检测。目录仍可使用；执行前会重新检查 Git 状态。'
        }
      : {
          kind: 'loading',
          label: '检测 Git…'
        }
  }
  if (workspace.gitObservation.state === 'not_git') return { kind: 'none' }
  if (workspace.gitObservation.state === 'git_invalid') {
    return {
      kind: 'warning',
      label: 'Git 状态异常',
      detail: '无法读取当前 Git 状态。目录仍可使用；执行前会重新检查 Git 状态。'
    }
  }
  if (!workspace.gitObservation.headCommit) {
    return { kind: 'metadata', label: 'Git · 尚无提交' }
  }
  return {
    kind: 'metadata',
    label: `Git · ${workspace.gitObservation.branch ?? 'detached'}`
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
    )?.agentId ?? preflight.presentMembers.find(
      (member) => memberIds.includes(member.agentId)
        && member.runtimeReadiness === 'light_ready'
    )?.agentId ?? memberIds[0] ?? ''
  return {
    memberIds,
    leadId
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
