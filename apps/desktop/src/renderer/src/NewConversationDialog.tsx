import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  CampCreationPreflight,
  CreateCampRequest,
  ProjectNavigationGroup,
  SelectedProjectBinding
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'

type CreateCampDraft = Omit<CreateCampRequest, 'commandId'>

export function NewConversationDialog({
  open,
  initialProject,
  projects,
  preflight,
  agents,
  busy,
  returnFocusElement,
  onOpenChange,
  onChooseLocalProject,
  onCreate
}: {
  open: boolean
  initialProject: SelectedProjectBinding | null
  projects: ProjectNavigationGroup[]
  preflight: CampCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  returnFocusElement: HTMLElement | null
  onOpenChange(open: boolean): void
  onChooseLocalProject(): Promise<SelectedProjectBinding | null>
  onCreate(draft: CreateCampDraft): Promise<void>
}): React.JSX.Element {
  const [project, setProject] = useState<SelectedProjectBinding | null>(initialProject)
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
    setProject(initialProject)
    setProjectMenuOpen(false)
    setMemberMenuOpen(false)
    setSelectedMemberIds(memberIds)
    setLeadId(recommendedLead)
    setOptionalOpen(false)
    setName('')
    setMemberError(null)
    setSubmitError(null)
    requestAnimationFrame(() => projectTriggerRef.current?.focus())
  }, [initialProject, open, preflight.presentMembers])

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
        setMemberError('至少选择 1 位成员')
      } else {
        setLeadId(next.leadId)
      }
      return next.memberIds
    })
  }

  const chooseLocalProject = async (): Promise<void> => {
    setSubmitError(null)
    try {
      const selected = await onChooseLocalProject()
      if (selected) {
        setProject(selected)
        setProjectMenuOpen(false)
      }
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || selectedMemberIds.length === 0 || !leadId || nameError) return
    setSubmitError(null)
    try {
      await onCreate({
        name: normalizedName || null,
        project,
        memberAgentProfileIds: selectedMemberIds,
        defaultLeadAgentProfileId: leadId,
        collaborationMode: 'peer'
      })
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const projectLabel = project?.name ?? '不关联项目'
  const projectDetail = project?.projectPath ?? '大厅'

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
                <SectionHeading step="01" title="项目" optional detail="用于确定共享工作目录与归档位置；不选择则创建在大厅。" />
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
                    <div className="new-camp-picker-menu" role="listbox" aria-label="选择项目">
                      <ProjectOption
                        label="不关联项目"
                        detail="大厅"
                        selected={project === null}
                        onSelect={() => {
                          setProject(null)
                          setProjectMenuOpen(false)
                        }}
                      />
                      {projects.map((candidate) => {
                        const binding = projectBinding(candidate)
                        return (
                          <ProjectOption
                            key={`${candidate.repositoryScopeId}:${candidate.projectPath}`}
                            label={candidate.name}
                            detail={candidate.projectPath}
                            selected={sameProject(project, binding)}
                            onSelect={() => {
                              setProject(binding)
                              setProjectMenuOpen(false)
                            }}
                          />
                        )
                      })}
                      <button className="new-camp-project-option choose-local" type="button" role="option" aria-selected="false" onClick={() => void chooseLocalProject()}>
                        <span aria-hidden="true">＋</span><span><strong>选择本地 Git 项目…</strong><small>选择一个 Git worktree</small></span>
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section className="new-camp-section">
                <SectionHeading
                  step="02"
                  title="队员与 Lead"
                  suffix={`已选 ${selectedMembers.length} / ${preflight.presentMembers.length}`}
                  detail="默认选择全部在队成员；执行引擎状态不影响结构选择。"
                />
                {preflight.presentMembers.length === 0
                  ? (
                      <div className="new-camp-empty-members" role="alert">
                        当前没有在队成员，请先前往成员页调整成员状态。
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
                                      <strong>{member.displayName}<small>{profile?.roleTitle ?? profile?.personaLabel ?? '成员'}</small></strong>
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
                <SectionHeading step="03" title="协作方式" detail="决定默认消息交给谁处理，以及成员如何参与。" />
                <div className="new-camp-mode-grid" role="radiogroup" aria-label="协作方式">
                  <label className="new-camp-mode-card selected">
                    <input type="radio" name="collaboration-mode" checked readOnly />
                    <span className="new-camp-mode-top"><i aria-hidden="true">↔</i><b aria-hidden="true" /></span>
                    <strong>并肩协作</strong>
                    <span>选中的成员围绕同一目标共同参与、交流和执行。</span>
                    <small>未显式寻址时发送给 Lead</small>
                  </label>
                  <div className="new-camp-mode-card disabled" aria-disabled="true">
                    <span className="new-camp-mode-top"><i aria-hidden="true">⌘</i><em>暂未开放</em></span>
                    <strong>领队统筹</strong>
                    <span>只有 Lead 与用户直接对话，并负责统筹其他成员。</span>
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
                <span>{project?.name ?? '大厅'} · <strong>{selectedMembers.length} 位队员</strong> · 并肩协作</span>
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
  return status === 'ready' ? '已就绪' : status === 'runtime_not_configured' ? '未配置' : '需要检查'
}

function runtimeDetail(profile: AgentProfile | undefined): string {
  if (!profile?.runtimeSelection) return '尚未选择执行引擎'
  return `${profile.runtimeSelection.adapterKind} · ${readinessLabel(profile.runtimeReadiness.status)}`
}

function projectBinding(project: ProjectNavigationGroup): SelectedProjectBinding {
  return {
    name: project.name,
    projectPath: project.projectPath,
    repository: {
      gitCommonDir: project.gitCommonDir,
      objectFormat: project.objectFormat
    }
  }
}

function sameProject(left: SelectedProjectBinding | null, right: SelectedProjectBinding): boolean {
  return left?.projectPath === right.projectPath
    && left.repository.gitCommonDir === right.repository.gitCommonDir
    && left.repository.objectFormat === right.repository.objectFormat
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
