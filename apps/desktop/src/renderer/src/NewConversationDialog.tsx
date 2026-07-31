import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  CampCreationPreflight,
  CreateCampRequest,
  ProjectNavigationGroup,
  WorkspaceInspection
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'

type CreateCampDraft = Omit<CreateCampRequest, 'commandId'>

export function NewConversationDialog({
  open,
  initialWorkspace,
  projects,
  preflight,
  agents,
  busy,
  returnFocusElement,
  onOpenChange,
  onChooseWorkspaceDirectory,
  onCreate
}: {
  open: boolean
  initialWorkspace: WorkspaceInspection | null
  projects: ProjectNavigationGroup[]
  preflight: CampCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  returnFocusElement: HTMLElement | null
  onOpenChange(open: boolean): void
  onChooseWorkspaceDirectory(): Promise<WorkspaceInspection | null>
  onCreate(draft: CreateCampDraft): Promise<void>
}): React.JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceInspection | null>(initialWorkspace)
  const [inspectingWorkspace, setInspectingWorkspace] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [memberMenuOpen, setMemberMenuOpen] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [leadId, setLeadId] = useState('')
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [name, setName] = useState('')
  const [memberError, setMemberError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  )
  const selectedMembers = preflight.presentMembers.filter((member) =>
    selectedMemberIds.includes(member.agentProfileId)
  )
  const normalizedName = normalizeDraftName(name)
  const nameLength = Array.from(normalizedName).length
  const nameError = nameLength > 80 ? '对话名称最多 80 个字符。' : null
  const lead = selectedMembers.find((member) => member.agentProfileId === leadId) ?? null

  useEffect(() => {
    if (!open) return
    const { memberIds, leadId: recommendedLead } = initialCampSelection(preflight)
    setWorkspace(initialWorkspace)
    setInspectingWorkspace(false)
    setProjectMenuOpen(false)
    setMemberMenuOpen(false)
    setSelectedMemberIds(memberIds)
    setLeadId(recommendedLead)
    setOptionalOpen(false)
    setName('')
    setMemberError(null)
    setSubmitError(null)
    requestAnimationFrame(() => projectTriggerRef.current?.focus())
  }, [initialWorkspace, open, preflight.presentMembers])

  const toggleMember = (agentProfileId: string): void => {
    if (busy) return
    setMemberError(null)
    setSelectedMemberIds((current) => {
      const next = toggleCampMemberSelection({
        memberIds: current,
        leadId,
        toggledMemberId: agentProfileId,
        stableMemberOrder: preflight.presentMembers.map((member) => member.agentProfileId)
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
        setWorkspace(selected)
        setProjectMenuOpen(false)
      }
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const selectKnownWorkspace = async (project: ProjectNavigationGroup): Promise<void> => {
    setSubmitError(null)
    setInspectingWorkspace(true)
    try {
      const inspection = await window.rovai.request<WorkspaceInspection>('workspaces.inspect', {
        path: project.projectPath
      })
      setWorkspace(inspection)
      setProjectMenuOpen(false)
    } catch (error) {
      setSubmitError(errorMessage(error))
    } finally {
      setInspectingWorkspace(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || inspectingWorkspace || selectedMemberIds.length === 0 || !leadId || nameError) return
    setSubmitError(null)
    try {
      await onCreate({
        name: normalizedName || null,
        workspace: workspace ? { projectPath: workspace.projectPath } : null,
        memberAgentProfileIds: selectedMemberIds,
        defaultLeadAgentProfileId: leadId,
        collaborationMode: 'peer'
      })
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const projectLabel = workspace?.name ?? '使用快速对话'
  const projectDetail = workspace?.projectPath ?? 'Rovai-ai 管理的快速对话目录'
  const capability = workspaceCapability(workspace)

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
                  确定这段对话的工作环境、队员与协作方式。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="dialog-close" type="button" aria-label="关闭创建新对话" disabled={busy}>×</button>
              </Dialog.Close>
            </header>

            <div className="new-camp-dialog-body">
              <section className="new-camp-section">
                <SectionHeading step="01" title="工作目录" optional detail="选择任意安全、可读目录；不选择则创建在快速对话。" />
                <div className="new-camp-picker">
                  <button
                    ref={projectTriggerRef}
                    className="new-camp-picker-trigger"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={projectMenuOpen}
                    disabled={busy || inspectingWorkspace}
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
                            onSelect={() => void selectKnownWorkspace(candidate)}
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
                                const profile = profileById.get(member.agentProfileId)
                                return profile
                                  ? <MemberAvatar key={profile.id} agentProfileId={profile.id} avatarRef={profile.avatarRef} displayName={profile.displayName} size="mention" decorative />
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
                                    setSelectedMemberIds(preflight.presentMembers.map((member) => member.agentProfileId))
                                    setMemberError(null)
                                  }}
                                >全选</button>
                              </div>
                              {preflight.presentMembers.map((member) => {
                                const profile = profileById.get(member.agentProfileId)
                                const selected = selectedMemberIds.includes(member.agentProfileId)
                                return (
                                  <label className={`new-camp-member-option ${selected ? '' : 'unselected'}`} key={member.agentProfileId}>
                                    <input type="checkbox" checked={selected} disabled={busy} onChange={() => toggleMember(member.agentProfileId)} />
                                    {profile && <MemberAvatar agentProfileId={profile.id} avatarRef={profile.avatarRef} displayName={profile.displayName} size="list" decorative />}
                                    <span className="new-camp-member-copy">
                                      <strong>{member.displayName}<small>{profile?.roleTitle ?? profile?.personaLabel ?? '队员'}</small></strong>
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
                              <option key={member.agentProfileId} value={member.agentProfileId}>
                                {member.displayName} · {readinessLabel(member.runtimeReadiness)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
              </section>

              <section className="new-camp-section">
                <SectionHeading step="03" title="协作方式" detail="决定默认消息交给谁处理，以及队员如何参与。" />
                <div className="new-camp-mode-grid" role="radiogroup" aria-label="协作方式">
                  <label className="new-camp-mode-card selected">
                    <input type="radio" name="collaboration-mode" checked readOnly />
                    <span className="new-camp-mode-top"><i aria-hidden="true">↔</i><b aria-hidden="true" /></span>
                    <strong>并肩协作</strong>
                    <span>选中的队员围绕同一目标共同参与、交流和执行。</span>
                    <small>未显式寻址时发送给 Lead</small>
                  </label>
                  <div className="new-camp-mode-card disabled" aria-disabled="true">
                    <span className="new-camp-mode-top"><i aria-hidden="true">⌘</i><em>暂未开放</em></span>
                    <strong>领队统筹</strong>
                    <span>只有 Lead 与用户直接对话，并负责统筹其他队员。</span>
                    <small>当前版本不可选择</small>
                  </div>
                </div>
              </section>

              <section className="new-camp-section optional-section">
                <button
                  className="new-camp-optional-trigger"
                  type="button"
                  aria-expanded={optionalOpen}
                  aria-controls="new-camp-optional-panel"
                  disabled={busy}
                  onClick={() => setOptionalOpen((current) => !current)}
                >
                  <span aria-hidden="true">☷</span>
                  <span><strong>可选配置</strong><small>补充对话名称，不影响上面的结构配置。</small></span>
                  <em>{normalizedName || '未设置'}</em>
                  <span className="new-camp-chevron" aria-hidden="true">⌄</span>
                </button>
                {optionalOpen && (
                  <div className="new-camp-optional-panel" id="new-camp-optional-panel">
                    <label htmlFor="new-camp-name">对话名称 <span>· 非必填</span></label>
                    <input
                      id="new-camp-name"
                      value={name}
                      disabled={busy}
                      aria-invalid={Boolean(nameError)}
                      aria-describedby={nameError ? 'new-camp-name-error' : 'new-camp-name-hint'}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="例如：重构 MCP 设置页"
                      autoComplete="off"
                    />
                    {nameError
                      ? <small className="new-camp-field-error" id="new-camp-name-error" role="alert">{nameError}</small>
                      : <small id="new-camp-name-hint">留空将创建为「未命名对话」。</small>}
                  </div>
                )}
              </section>
            </div>

            <footer className="new-camp-dialog-footer">
              <div>
                <span>{workspace?.name ?? '快速对话'} · <strong>{selectedMembers.length} 位队员</strong> · 并肩协作</span>
                {lead && <span> · Lead：{lead.displayName}</span>}
                {submitError && <p role="alert">{submitError}</p>}
              </div>
              <div>
                <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close>
                <button className="primary-button" type="submit" disabled={busy || inspectingWorkspace || selectedMembers.length === 0 || !leadId || Boolean(nameError)}>
                  {busy ? '正在创建…' : inspectingWorkspace ? '正在检查…' : '创建'}
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
      : status === 'selected_unresolved'
        ? '暂时无法确认'
        : '不可用'
}

function runtimeDetail(profile: AgentProfile | undefined): string {
  if (!profile?.runtimeSelection) return '尚未选择 Agent 运行时'
  return `${profile.runtimeSelection.adapterKind} · ${readinessLabel(profile.runtimeReadiness.status)}`
}

export function workspaceCapability(workspace: WorkspaceInspection | null): {
  label: string
  detail: string
  tone: 'neutral' | 'clean' | 'attention'
} {
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

export function initialCampSelection(preflight: CampCreationPreflight): {
  memberIds: string[]
  leadId: string
} {
  const memberIds = preflight.presentMembers.map((member) => member.agentProfileId)
  const leadId = preflight.presentMembers.find(
    (member) => member.runtimeReadiness === 'ready'
  )?.agentProfileId ?? memberIds[0] ?? ''
  return { memberIds, leadId }
}

export function normalizeDraftName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
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
