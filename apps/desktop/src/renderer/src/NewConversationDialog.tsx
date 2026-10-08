import { rejectedMissionMemberIds } from './useMissions'
import { missionDescriptionContent, missionDescriptionText, missionMentionIds, unavailableMissionMentionIds } from './mission-description'
import { useThreadClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import type {
  AgentProfile,
  ThreadCreationPreflight,
  CreateThreadRequest,
  NewConversationDefaults,
  MissionCreate,
  MissionDescriptionContent,
  ProjectNavigationGroup,
  WorkspaceInspection,
  WorkspaceSelection
} from '@contracts'
import { isNewConversationMemberAvailable, newConversationMemberStatus } from './new-conversation-availability'
import { useMobileLayout } from './MobileLayout'
import { NewConversationPicker } from './NewConversationPicker'
import { NewConversationQuickHelp } from './NewConversationQuickHelp'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { DialogControlIcon } from './AppDialog'
import {
  MissionAttachmentButton,
  MissionMentionButton,
  MissionPropertyChip,
  MissionTagPicker,
  MissionWritingPlane,
  ProjectGlyph,
  TeamGlyph,
  missionAttachmentDrafts,
  type MissionDraftAttachment,
  type MissionWritingPlaneHandle
} from './MissionDefinitionEditor'
import { displayProjectPath } from '../../shared/project-display-name'
import { UiText, uiAttribute } from './interface-language'

type CreateThreadDraft = Omit<CreateThreadRequest, 'commandId' | 'activationState'>
type WorkspaceChoice = WorkspaceSelection | WorkspaceInspection
type GitInspectionStatus = 'idle' | 'loading' | 'ready' | 'failed'

export function NewConversationDialog({
  open,
  purpose = 'camp',
  recovery = null,
  recoveryAttachments = [],
  initialWorkspace,
  initialSelection,
  attentionMessage,
  projects,
  missionTagCatalog = [],
  preflight,
  agents,
  busy: creationBusy,
  projectAccessReady,
  onOpenChange,
  onChooseWorkspaceDirectory,
  onWorkspaceSelected,
  onCreate
}: {
  open: boolean
  purpose?: 'camp' | 'mission'
  recovery?: MissionCreate | null
  recoveryAttachments?: ReturnType<typeof missionAttachmentDrafts>
  initialWorkspace: WorkspaceSelection | null
  initialSelection?: NewConversationDefaults | null
  attentionMessage?: string | null
  projects: ProjectNavigationGroup[]
  missionTagCatalog?: string[]
  preflight: ThreadCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  projectAccessReady: boolean
  onOpenChange(open: boolean): void
  onChooseWorkspaceDirectory(): Promise<WorkspaceSelection | null>
  onWorkspaceSelected(workspace: WorkspaceSelection): Promise<void>
  onCreate(draft: CreateThreadDraft, enableOneClick: boolean, mission?: {description:string; descriptionContent:MissionDescriptionContent; start:boolean; tags:string[]; attachments:ReturnType<typeof missionAttachmentDrafts>}): Promise<void>
}): React.JSX.Element {
  const client = useThreadClient()
  const mobile = useMobileLayout()
  const [submitting, setSubmitting] = useState(false)
  const busy = creationBusy || submitting
  const [workspace, setWorkspace] = useState<WorkspaceChoice | null>(initialWorkspace)
  const [gitInspectionStatus, setGitInspectionStatus] = useState<GitInspectionStatus>('idle')
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [memberMenuOpen, setMemberMenuOpen] = useState(false)
  const [leadMenuOpen, setLeadMenuOpen] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [leadId, setLeadId] = useState('')
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [name, setName] = useState('')
  const [descriptionContent, setDescriptionContent] = useState<MissionDescriptionContent>([])
  const [rejectedIds, setRejectedIds] = useState<string[]>([])
  const unavailableIds = useMemo(() => unavailableMissionMentionIds(descriptionContent, agents, selectedMemberIds, rejectedIds), [descriptionContent, agents, selectedMemberIds, rejectedIds])
  const description = missionDescriptionText(descriptionContent, agents)
  const setDescription = (text: string) => setDescriptionContent(missionDescriptionContent(text))
  const pendingMentionIds = missionMentionIds(descriptionContent).filter(id => !selectedMemberIds.includes(id))
  const [tags, setTags] = useState<string[]>([])
  const [attachments, setAttachments] = useState<MissionDraftAttachment[]>([])
  const [expanded, setExpanded] = useState(false)
  const [missionDialogContent, setMissionDialogContent] = useState<HTMLDivElement | null>(null)
  const isMission = purpose === 'mission'
  const startSubmitRef = useRef<HTMLButtonElement>(null)
  const [quickHelpOpen, setQuickHelpOpen] = useState(false)
  const [enableOneClick, setEnableOneClick] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const memberTriggerRef = useRef<HTMLButtonElement>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const missionEditorRef = useRef<MissionWritingPlaneHandle>(null)
  const draftInitializedRef = useRef(false)
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent])),
    [agents]
  )
  const preferredInitialSelection = initialSelection ?? null
  const initialSelectionPlan = useMemo(
    () => planInitialThreadSelection(preflight, preferredInitialSelection),
    [preferredInitialSelection, preflight.presentMembers]
  )
  const availableMembers = preflight.presentMembers.filter(isNewConversationMemberAvailable)
  const selectedMembers = preflight.presentMembers.filter((member) =>
    selectedMemberIds.includes(member.agentId)
  )
  const selectedAvailableMembers = selectedMembers.filter(isNewConversationMemberAvailable)
  const hasUnavailableSelection = selectedMemberIds.some((id) =>
    !availableMembers.some((member) => member.agentId === id)
  )
  const normalizedName = isMission ? name.trim() : normalizeDraftName(name)
  const nameLength = Array.from(normalizedName).length
  const nameError = nameLength > (isMission ? 200 : 80)
    ? isMission ? uiAttribute('使命标题最多 200 个字符。') : uiAttribute('对话名称最多 80 个字符。')
    : isMission && Array.from(description).length > 12000 ? uiAttribute('使命描述最多 12,000 个字符。') : null
  const lead = selectedAvailableMembers.find((member) => member.agentId === leadId) ?? null
  const leadProfile = lead ? profileById.get(lead.agentId) : undefined
  const projectActionsDisabled = projectWorkspaceActionsDisabled(busy, projectAccessReady)
  const projectSubmissionBlocked = workspaceSubmissionBlocked(workspace, projectAccessReady)
  const submissionBlocked = busy || projectSubmissionBlocked || availableMembers.length === 0
    || isMission && unavailableIds.length > 0 || hasUnavailableSelection || (selectedMemberIds.length > 0 && !lead) || Boolean(nameError)

  useEffect(() => {
    if (!open) {
      if (recovery) return
      // A mission draft lives for the lifetime of this mounted dialog and is
      // cleared only after a confirmed create. Closing a regular camp dialog
      // keeps its existing reset-on-dismiss behavior.
      if (!isMission) draftInitializedRef.current = false
      return
    }
    if (draftInitializedRef.current) return
    draftInitializedRef.current = true
    const { memberIds, leadId: recommendedLead } = initialSelectionPlan
    setWorkspace(initialWorkspace)
    setGitInspectionStatus(hasGitObservation(initialWorkspace) ? 'ready' : 'idle')
    setProjectMenuOpen(false)
    setMemberMenuOpen(false)
    setLeadMenuOpen(false)
    setSelectedMemberIds(memberIds)
    setLeadId(recommendedLead)
    setOptionalOpen(false)
    setName('')
    setDescription('')
    setRejectedIds([])
    setTags([])
    setAttachments([])
    setExpanded(false)
    setEnableOneClick(false)
    setQuickHelpOpen(false)
    setMemberError(null)
    setSubmitError(null)
  }, [initialSelectionPlan, initialWorkspace, isMission, open, recovery])

  const pendingGitInspectionPath = workspace && !hasGitObservation(workspace)
    ? workspace.projectPath
    : null

  useEffect(() => {
    if (!workspaceInspectionShouldStart(open, projectAccessReady, pendingGitInspectionPath)) return
    let cancelled = false
    setGitInspectionStatus('loading')
    void client.request<WorkspaceInspection>('workspaces.inspect', {
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
  }, [client, open, pendingGitInspectionPath, projectAccessReady])

  useEffect(() => {
    if (open && optionalOpen) nameInputRef.current?.focus()
  }, [open, optionalOpen])

  const toggleMember = (agentId: string): void => {
    if (busy || !availableMembers.some((member) => member.agentId === agentId)) return
    setMemberError(null)
    const next = toggleThreadMemberSelection({
      memberIds: selectedMemberIds,
      leadId,
      toggledMemberId: agentId,
      stableMemberOrder: preflight.presentMembers.map((member) => member.agentId)
    })
    setSelectedMemberIds(next.memberIds)
    setLeadId(next.leadId)
  }

  const allMembersSelected = availableMembers.length > 0 && !hasUnavailableSelection
    && selectedMemberIds.length === availableMembers.length
  const toggleAllMembers = (): void => {
    if (busy || availableMembers.length === 0) return
    setSelectedMemberIds(allMembersSelected ? [] : availableMembers.map(member => member.agentId))
    setLeadId(allMembersSelected ? '' : lead?.agentId ?? availableMembers[0].agentId)
    setMemberError(null)
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
      submissionBlocked || submittingRef.current
    ) return
    if (isMission && !normalizedName) { setSubmitError(uiAttribute('请填写使命标题。')); nameInputRef.current?.focus(); return }
    if (selectedMemberIds.length === 0) {
      setMemberError(uiAttribute('请至少选择一位队员。'))
      memberTriggerRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate({
        name: normalizedName || null,
        workspace: workspace ? { projectPath: workspace.projectPath } : null,
        memberAgentIds: selectedMemberIds,
        defaultLeadAgentId: leadId,
        collaborationMode: 'peer'
      }, enableOneClick, isMission ? {description: '', descriptionContent: await missionEditorRef.current!.flushDescription(), tags, attachments: missionAttachmentDrafts(attachments), start:(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'start'} : undefined)
      if (isMission) {
        draftInitializedRef.current = false
        setName('')
        setDescription('')
        setTags([])
        setAttachments([])
        setExpanded(false)
        setSubmitError(null)
      }
    } catch (error) {
      setRejectedIds(rejectedMissionMemberIds(error))
      setSubmitError(errorMessage(error))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const projectLabel = projectAccessReady
    ? projects.find((project) => project.projectPath === workspace?.projectPath)?.name
      ?? workspace?.name ?? uiAttribute('使用快速对话')
    : uiAttribute('正在载入项目…')
  const projectDetail = projectAccessReady
    ? workspace ? displayProjectPath(workspace.projectPath) : uiAttribute('Rovai AI 管理的快速对话目录')
    : uiAttribute('正在确认本机项目访问状态')
  const gitPresentation = workspaceGitPresentation(workspace, gitInspectionStatus)

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!busy) onOpenChange(nextOpen) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay new-camp-dialog-overlay" />
        <Dialog.Content
          ref={isMission ? setMissionDialogContent : undefined}
          className={`new-camp-dialog compact-dialog ${isMission ? `mission-definition-dialog mission-create-dialog${expanded ? ' is-expanded' : ''}` : ''}`}
          aria-describedby="new-camp-dialog-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (isMission) return
            const target = projectAccessReady ? projectTriggerRef.current : closeButtonRef.current
            target?.focus()
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { if (busy || quickHelpOpen) event.preventDefault() }}
          onPointerDownOutside={(event) => {
            if (event.target instanceof Element && event.target.closest('.new-camp-quick-tooltip')) event.preventDefault()
          }}
        >
          <header className={`compact-header${isMission ? ' mission-editor-header' : ''}`}>
            <Dialog.Title>{isMission ? uiAttribute("新使命") : uiAttribute("新对话")}</Dialog.Title>
            {isMission
              ? <div className="mission-editor-header-actions"><button className="mission-editor-icon-button" type="button" aria-label={expanded ? uiAttribute("恢复编辑区域大小") : uiAttribute("展开编辑区域")} title={expanded ? uiAttribute("恢复编辑区域大小") : uiAttribute("展开编辑区域")} onClick={() => setExpanded(value => !value)} disabled={busy}><svg viewBox="0 0 24 24" aria-hidden="true">{expanded ? <><path d="M9 3v6H3M15 21v-6h6M3 9l6-6M21 15l-6 6"/></> : <><path d="M9 3H3v6M15 21h6v-6M3 9l6-6M21 15l-6 6"/></>}</svg></button><Dialog.Close asChild><button ref={closeButtonRef} className="compact-close" type="button" aria-label={uiAttribute("关闭新使命")} disabled={busy}><DialogControlIcon name="close" /></button></Dialog.Close></div>
              : <Dialog.Close asChild><button ref={closeButtonRef} className="compact-close" type="button" aria-label={uiAttribute("关闭新对话")} disabled={busy}><DialogControlIcon name="close" /></button></Dialog.Close>}
          </header>
          <Dialog.Description id="new-camp-dialog-description" className="sr-only">{isMission ? uiAttribute("填写使命目标，选择工作目录与队伍。") : uiAttribute("选择工作目录、队员与队长。对话名称可选。")}</Dialog.Description>
          <form className="compact-form" onSubmit={(event) => void submit(event)}>
            <div className={`compact-body camp-fields${isMission ? ' mission-editor-body' : ''}`}>
              {attentionMessage && <p className="compact-inline-note" role="status">{attentionMessage}</p>}
              {recovery && !busy && <p className="compact-inline-note" role="status"><UiText zh={"上次创建结果尚未确认。"} /><button type="button" className="mission-source-link" onClick={() => { setName(recovery.title); setDescriptionContent(missionDescriptionContent(recovery.description, recovery.descriptionContent)); setTags(recovery.tags); setAttachments(recoveryAttachments.map(({id, file, kindHint}) => ({kind:'local', id, file, kindHint}))); setWorkspace(recovery.projectBindingKind === 'directory' ? {name:projects.find(p=>p.projectPath===recovery.projectPath)?.name ?? recovery.projectPath,projectPath:recovery.projectPath} : null); setSelectedMemberIds(recovery.memberAgentIds); setLeadId(recovery.defaultLeadAgentId); setSubmitError(null) }}><UiText zh={"恢复上次内容以重试"} /></button></p>}
              {isMission && <MissionWritingPlane ref={missionEditorRef} titleInputRef={nameInputRef} title={name} descriptionContent={descriptionContent} agents={agents} memberAgentIds={selectedMemberIds} unavailableAgentIds={unavailableIds} attachments={attachments} disabled={busy} attachmentsDisabled={!client.missionAttachments} titleError={!normalizedName ? undefined : nameLength > 200 ? uiAttribute("使命名称最多 200 个字符。") : undefined} descriptionError={unavailableIds.length ? uiAttribute('提及的队员已不可用，请移除提及或选择其他队员。') : Array.from(description).length > 12000 ? uiAttribute("使命描述最多 12,000 个字符。") : undefined} onTitleChange={setName} onDescriptionChange={setDescriptionContent} onAttachmentsChange={setAttachments} onNotify={setSubmitError}/>}
              {!isMission && <><div className="compact-row">
                <span id="new-camp-workspace-label"><UiText zh={"工作目录"} /></span>
                <NewConversationPicker mobile={mobile} open={projectMenuOpen} onOpenChange={setProjectMenuOpen} busy={busy} title={uiAttribute("选择工作目录")}
                  trigger={<button ref={projectTriggerRef} className="compact-picker new-camp-picker-trigger" type="button" aria-labelledby="new-camp-workspace-label new-camp-workspace-value" aria-busy={!projectAccessReady} disabled={projectActionsDisabled}>
                      <WorkspaceIcon kind={workspace ? 'project' : 'quick-chat'} /><span id="new-camp-workspace-value">{projectLabel}</span><DialogControlIcon name="chevron" />
                    </button>}
                  menu={<DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="compact-menu workspace-menu" align="end" sideOffset={6} collisionPadding={12} aria-label={uiAttribute("选择工作目录")} loop>
                      <DropdownMenu.RadioGroup value={workspace?.projectPath ?? ''}>
                        <DropdownMenu.RadioItem className="compact-option" value="" disabled={projectActionsDisabled} onSelect={() => { setWorkspace(null); setProjectMenuOpen(false) }}>
                          <WorkspaceIcon kind="quick-chat" /><span><UiText zh={"使用快速对话"} /><small><UiText zh={"由 Rovai AI 管理工作目录"} /></small></span><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                        <DropdownMenu.Separator className="compact-separator" />
                        {projects.map((project) => <DropdownMenu.RadioItem key={project.projectKey} className="compact-option" value={project.projectPath} disabled={projectActionsDisabled} onSelect={() => selectKnownWorkspace(project)}>
                          <WorkspaceIcon kind="project" /><span>{project.name}<small>{displayProjectPath(project.projectPath)}</small></span><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>)}
                      </DropdownMenu.RadioGroup>
                      <DropdownMenu.Separator className="compact-separator" />
                      <DropdownMenu.Item className="compact-option" disabled={projectActionsDisabled} onSelect={() => void chooseWorkspaceDirectory()}><DialogControlIcon name="plus" /><span><UiText zh={"选择工作目录…"} /></span></DropdownMenu.Item>
                    </DropdownMenu.Content>}>
                  <button type="button" className="compact-option" aria-pressed={!workspace} disabled={projectActionsDisabled} onClick={() => { setWorkspace(null); setProjectMenuOpen(false) }}>
                    <WorkspaceIcon kind="quick-chat" /><span><UiText zh={"使用快速对话"} /><small><UiText zh={"由 Rovai AI 管理工作目录"} /></small></span>{!workspace && <DialogControlIcon name="check" />}
                  </button>
                  {projects.map(project => <button type="button" className="compact-option" key={project.projectKey} aria-pressed={workspace?.projectPath === project.projectPath} disabled={projectActionsDisabled} onClick={() => selectKnownWorkspace(project)}>
                    <WorkspaceIcon kind="project" /><span>{project.name}<small>{displayProjectPath(project.projectPath)}</small></span>{workspace?.projectPath === project.projectPath && <DialogControlIcon name="check" />}
                  </button>)}
                  <button type="button" className="compact-option" disabled={projectActionsDisabled} onClick={() => { setProjectMenuOpen(false); void chooseWorkspaceDirectory() }}><DialogControlIcon name="plus" /><span><UiText zh={"选择工作目录…"} /></span></button>
                </NewConversationPicker>
              </div></>}
              {isMission && <div className="mission-editor-properties" aria-label={uiAttribute("使命属性")}>
                <MissionProjectPicker open={projectMenuOpen} onOpenChange={setProjectMenuOpen} projects={projects} workspace={workspace} projectLabel={projectLabel} disabled={projectActionsDisabled} portalContainer={missionDialogContent}
                  onQuickChat={() => { setWorkspace(null); setProjectMenuOpen(false) }} onProject={selectKnownWorkspace} onChooseDirectory={() => { setProjectMenuOpen(false); void chooseWorkspaceDirectory() }}/>
                <MissionTeamPicker busy={busy} members={preflight.presentMembers} availableMembers={availableMembers} selectedMemberIds={selectedMemberIds} selectedMembers={selectedMembers} leadId={leadId} profileById={profileById} enableOneClick={enableOneClick} triggerRef={memberTriggerRef} portalContainer={missionDialogContent} onEnableOneClick={setEnableOneClick} onToggle={toggleMember} onToggleAll={toggleAllMembers} onLead={setLeadId}/>
                <MissionTagPicker tags={tags} catalog={missionTagCatalog} disabled={busy} portalContainer={missionDialogContent} onChange={setTags}/>
              </div>}
              {!isMission && <>{workspace && <div className="compact-row-detail"><span title={projectDetail}>{projectDetail}</span>{gitPresentation.kind === 'metadata' && <span className="compact-git">{gitPresentation.label}</span>}{gitPresentation.kind === 'loading' && <span role="status">{gitPresentation.label}</span>}</div>}
              {gitPresentation.kind === 'warning' && <div className="new-camp-workspace-warning" role="alert"><div><strong>{gitPresentation.label}</strong><span>{gitPresentation.detail}</span></div></div>}
              <div className="compact-row">
                <span id="new-camp-members-label"><UiText zh={"队员"} /></span>
                <NewConversationPicker mobile={mobile} open={memberMenuOpen} onOpenChange={setMemberMenuOpen} busy={busy} title={uiAttribute("选择队员")} multiple
                  trigger={<button ref={memberTriggerRef} className="compact-picker member-trigger" aria-invalid={Boolean(memberError)} aria-describedby={memberError ? 'new-camp-members-error' : undefined} type="button" aria-labelledby="new-camp-members-label new-camp-members-value" disabled={busy || !preflight.presentMembers.length}>
                      <span className="compact-avatar-stack">{selectedMembers.slice(0, 3).map((member) => <MemberAvatar key={member.agentId} agentId={member.agentId} avatarRef={profileById.get(member.agentId)?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />)}</span>
                      <span id="new-camp-members-value">{selectedMembers.length ? uiAttribute("{0} 位队员", String(selectedMembers.length)) : availableMembers.length ? uiAttribute("选择队员") : uiAttribute("暂无可用队员")}</span><DialogControlIcon name="chevron" />
                    </button>}
                  menu={<DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="compact-menu roster-menu new-camp-member-grid" align="end" sideOffset={6} collisionPadding={12} aria-label={uiAttribute("选择队员")} onKeyDownCapture={navigateMemberGrid} loop>
                      <div className="compact-menu-heading"><span><UiText zh={"参与本次对话"} /></span><DropdownMenu.Item asChild disabled={busy || availableMembers.length === 0} onSelect={event => { event.preventDefault(); toggleAllMembers() }}><button type="button" disabled={busy || availableMembers.length === 0}>{allMembersSelected ? uiAttribute("取消全选") : uiAttribute("全选")}</button></DropdownMenu.Item></div>
                      {preflight.presentMembers.map((member) => {
                        const profile = profileById.get(member.agentId)
                        return <DropdownMenu.CheckboxItem className="compact-option" key={member.agentId} checked={selectedMemberIds.includes(member.agentId)} disabled={busy || !isNewConversationMemberAvailable(member)} onCheckedChange={() => toggleMember(member.agentId)} onSelect={(event) => event.preventDefault()}>
                          <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                          <span className="new-camp-candidate-copy">{member.displayName}<small><span>{profile?.teamRole || uiAttribute('队员')}</span><span aria-hidden="true">·</span><span className={isNewConversationMemberAvailable(member) ? 'compact-ready' : 'new-camp-candidate-unavailable'}>{newConversationMemberStatus(member)}</span></small></span>
                          <span className="compact-checkbox"><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator></span>
                        </DropdownMenu.CheckboxItem>
                      })}
                    </DropdownMenu.Content>}>
                  <div className="compact-menu-heading"><span role="status"><UiText zh={"已选 "} />{selectedMembers.length}<UiText zh={" 位"} /></span><button type="button" disabled={busy || availableMembers.length === 0} onClick={toggleAllMembers}>{allMembersSelected ? uiAttribute("取消全选") : uiAttribute("全选")}</button></div>
                  {preflight.presentMembers.map(member => {
                    const profile = profileById.get(member.agentId)
                    const disabled = busy || !isNewConversationMemberAvailable(member)
                    return <label className="compact-option new-camp-mobile-member" key={member.agentId} data-disabled={disabled ? '' : undefined}>
                      <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                      <span className="new-camp-candidate-copy">{member.displayName}<small>{profile?.teamRole || uiAttribute('队员')} · <span className={isNewConversationMemberAvailable(member) ? 'compact-ready' : 'new-camp-candidate-unavailable'}>{newConversationMemberStatus(member)}</span></small></span>
                      <input type="checkbox" aria-label={member.displayName} checked={selectedMemberIds.includes(member.agentId)} disabled={disabled} onChange={() => toggleMember(member.agentId)} />
                    </label>
                  })}
                </NewConversationPicker>
              </div>
              </>}
              {isMission && <>
                {gitPresentation.kind === 'warning' && <p className="compact-inline-error" role="alert">{gitPresentation.label}：{gitPresentation.detail}</p>}
                {memberError && <p id="new-camp-members-error" role="alert" className="compact-inline-error new-camp-members-error">{memberError}</p>}
                {availableMembers.length === 0 && <p className="new-camp-empty-note"><UiText zh={"暂无可用队员，请先在「队员」中配置智能体。"} /></p>}
                {hasUnavailableSelection && <p className="compact-inline-error" role="alert"><UiText zh={"所选队员已不可用，请重新选择。"} /></p>}
              </>}
              {!isMission && <>
                {memberError && <p id="new-camp-members-error" role="alert" className="compact-inline-error new-camp-members-error">{memberError}</p>}
                {availableMembers.length === 0 && <p className="new-camp-empty-note"><UiText zh={"暂无可用队员，请先在「队员」中配置智能体。"} /></p>}
                {hasUnavailableSelection && <p className="compact-inline-error" role="alert"><UiText zh={"所选队员已不可用，请重新选择。"} /></p>}
                <div className="compact-row">
                <span id="new-camp-lead-label"><UiText zh={"队长"} /></span>
                <NewConversationPicker mobile={mobile} open={leadMenuOpen} onOpenChange={setLeadMenuOpen} busy={busy} title={uiAttribute("选择队长")}
                  trigger={<button className="compact-picker" type="button" aria-labelledby="new-camp-lead-label new-camp-lead-value" disabled={busy || selectedAvailableMembers.length === 0}>
                      {lead && <MemberAvatar agentId={lead.agentId} avatarRef={leadProfile?.avatarRef ?? null} displayName={lead.displayName} size="mention" decorative />}
                      <span id="new-camp-lead-value">{lead?.displayName ?? (selectedAvailableMembers.length ? uiAttribute("选择队长") : uiAttribute("暂无可选队长"))}</span><DialogControlIcon name="chevron" />
                    </button>}
                  menu={<DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="compact-menu roster-menu" align="end" sideOffset={6} collisionPadding={12} aria-label={uiAttribute("选择队长")} loop>
                      <DropdownMenu.Label className="compact-menu-heading"><UiText zh={"从已选队员中选择"} /></DropdownMenu.Label>
                      <DropdownMenu.RadioGroup value={leadId} onValueChange={setLeadId}>
                        {selectedAvailableMembers.map((member) => {
                          const profile = profileById.get(member.agentId)
                          return <DropdownMenu.RadioItem className="compact-option" value={member.agentId} key={member.agentId} disabled={busy}>
                            <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                            <span>{member.displayName}<small>{profile?.teamRole || uiAttribute('队员')}</small></span><small className="compact-ready"><UiText zh={"可用"} /></small><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        })}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>}>
                  {selectedAvailableMembers.map(member => <button type="button" className="compact-option" key={member.agentId} aria-pressed={leadId === member.agentId} disabled={busy} onClick={() => { setLeadId(member.agentId); setLeadMenuOpen(false) }}>
                    <MemberAvatar agentId={member.agentId} avatarRef={profileById.get(member.agentId)?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                    <span>{member.displayName}<small>{profileById.get(member.agentId)?.teamRole || uiAttribute('队员')}</small></span>{leadId === member.agentId && <DialogControlIcon name="check" />}
                  </button>)}
                </NewConversationPicker>
              </div>
              </>}
              {!isMission && <div className="compact-name-disclosure">
                <button className="compact-text-button" type="button" aria-expanded={optionalOpen} aria-controls="new-camp-optional-panel" disabled={busy} onClick={() => setOptionalOpen((current) => !current)}><DialogControlIcon name={optionalOpen ? 'chevron' : 'plus'} />{optionalOpen ? uiAttribute("对话名称") : normalizedName ? uiAttribute("对话名称：{0}", String(normalizedName)) : uiAttribute("添加对话名称")}<span><UiText zh={"可选"} /></span></button>
                {optionalOpen && <div className="compact-name-field" id="new-camp-optional-panel">
                  <label className="sr-only" htmlFor="new-camp-name"><UiText zh={"对话名称"} /></label>
                  <input ref={nameInputRef} id="new-camp-name" value={name} disabled={busy} aria-invalid={Boolean(nameError)} aria-describedby="new-camp-name-hint" onChange={(event) => setName(limitDraftNameInput(event.target.value))} placeholder={uiAttribute("输入名称...")} autoComplete="off" />
                  <div className="compact-field-meta"><span id="new-camp-name-hint"><UiText zh={"留空为「未命名对话」"} /></span><span>{nameLength} / 80</span></div>
                  {nameError && <small className="compact-field-error" role="alert">{nameError}</small>}
                </div>}
              </div>
              }
              {!isMission && <div className="new-camp-quick-setting">
                <div className="new-camp-quick-row">
                  <label className="new-camp-quick-label">
                    <input type="checkbox" checked={enableOneClick} disabled={busy} onChange={(event) => setEnableOneClick(event.target.checked)} />
                    <span><UiText zh={"以后使用此队伍一键新建"} /></span>
                  </label>
                  <NewConversationQuickHelp onOpenChange={setQuickHelpOpen}/>
                </div>
              </div>}
              {submitError && <p className="compact-inline-error" role="alert">{submitError}</p>}
            </div>
            {isMission
              ? <footer className="compact-footer mission-editor-footer">
                  <div className="mission-editor-tools"><MissionAttachmentButton onClick={() => missionEditorRef.current?.chooseFiles()} disabled={busy || !client.missionAttachments}/><MissionMentionButton onClick={() => missionEditorRef.current?.startMention()} disabled={busy}/></div>
                  <div className="mission-editor-footer-actions"><Dialog.Close asChild><button className="compact-cancel" type="button" disabled={busy}><UiText zh={"取消"} /></button></Dialog.Close>
                    <div className="mission-create-split">
                      <button className="compact-primary" type="submit" value="save" disabled={submissionBlocked}>{busy ? uiAttribute("正在新建…") : pendingMentionIds.length ? uiAttribute("邀请并新建") : uiAttribute("新建")}</button>
                      <button ref={startSubmitRef} type="submit" value="start" hidden disabled={submissionBlocked}/>
                      <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="compact-primary mission-create-options" type="button" aria-label={uiAttribute("新建使命选项")} disabled={submissionBlocked}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button></DropdownMenu.Trigger>
                        <DropdownMenu.Portal><DropdownMenu.Content className="compact-menu" align="end" sideOffset={6}>
                          <DropdownMenu.Item className="compact-option" onSelect={() => startSubmitRef.current?.form?.requestSubmit(startSubmitRef.current)}><UiText zh={"开始使命"} /></DropdownMenu.Item>
                        </DropdownMenu.Content></DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                  </div>
                </footer>
              : <footer className="compact-footer">
                  <Dialog.Close asChild><button className="compact-cancel" type="button" disabled={busy}><UiText zh={"取消"} /></button></Dialog.Close>
                  <button className="compact-primary" type="submit" value="save" disabled={submissionBlocked}>{busy ? uiAttribute("正在新建…") : uiAttribute("新建")}</button>
                </footer>}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type MissionMember = ThreadCreationPreflight['presentMembers'][number]

function MissionProjectPicker({
  open,
  projects,
  workspace,
  projectLabel,
  disabled,
  portalContainer,
  onOpenChange,
  onQuickChat,
  onProject,
  onChooseDirectory
}: {
  open: boolean
  projects: ProjectNavigationGroup[]
  workspace: WorkspaceChoice | null
  projectLabel: string
  disabled: boolean
  portalContainer: HTMLElement | null
  onOpenChange(open: boolean): void
  onQuickChat(): void
  onProject(project: ProjectNavigationGroup): void
  onChooseDirectory(): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const matchingProjects = projects.filter(project => `${project.name}\n${project.projectPath}`.toLocaleLowerCase().includes(normalized))
  const quickChatMatches = !normalized || uiAttribute('使用快速对话 Rovai AI 管理的快速对话目录').toLocaleLowerCase().includes(normalized)
  return <Popover.Root open={open} onOpenChange={next => { if (!disabled) onOpenChange(next); if (!next) setQuery('') }}>
    <Popover.Trigger asChild><MissionPropertyChip className="mission-editor-project-property" icon={<ProjectGlyph/>} disabled={disabled} aria-label={uiAttribute("项目：{0}", String(projectLabel))}>{projectLabel}</MissionPropertyChip></Popover.Trigger>
    <Popover.Portal container={portalContainer}><Popover.Content className="compact-menu mission-editor-project-popover" align="start" sideOffset={6} collisionPadding={12}
      onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }}>
      <label className="mission-picker-search"><NavigationIcon name="search"/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} aria-label={uiAttribute("搜索项目")} placeholder={uiAttribute("搜索项目…")}
        onKeyDown={event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.closest('.mission-editor-project-popover')?.querySelector<HTMLButtonElement>('.mission-editor-project-list button:not(:disabled)')?.focus() } }}/></label>
      <div className="mission-editor-project-list" role="group" aria-label={uiAttribute("可选项目")}>
        {quickChatMatches && <button type="button" className="compact-option" aria-pressed={!workspace} disabled={disabled} onClick={onQuickChat}><WorkspaceIcon kind="quick-chat"/><span><UiText zh={"使用快速对话"} /><small><UiText zh={"由 Rovai AI 管理工作目录"} /></small></span>{!workspace && <DialogControlIcon name="check"/>}</button>}
        {matchingProjects.map(project => <button type="button" className="compact-option" key={project.projectKey} aria-pressed={workspace?.projectPath === project.projectPath} disabled={disabled} title={displayProjectPath(project.projectPath)} onClick={() => onProject(project)}><WorkspaceIcon kind="project"/><span>{project.name}<small>{displayProjectPath(project.projectPath)}</small></span>{workspace?.projectPath === project.projectPath && <DialogControlIcon name="check"/>}</button>)}
        {!quickChatMatches && !matchingProjects.length && <p className="mission-picker-empty" role="status"><UiText zh={"没有匹配的项目"} /></p>}
      </div>
      <div className="mission-editor-project-footer"><button type="button" className="compact-option" disabled={disabled} onClick={onChooseDirectory}><DialogControlIcon name="plus"/><span><UiText zh={"选择工作目录…"} /></span></button></div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

function MissionTeamPicker({
  busy,
  members,
  availableMembers,
  selectedMemberIds,
  selectedMembers,
  leadId,
  profileById,
  enableOneClick,
  triggerRef,
  portalContainer,
  onEnableOneClick,
  onToggle,
  onToggleAll,
  onLead
}: {
  busy: boolean
  members: MissionMember[]
  availableMembers: MissionMember[]
  selectedMemberIds: string[]
  selectedMembers: MissionMember[]
  leadId: string
  profileById: Map<string, AgentProfile>
  enableOneClick: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  portalContainer: HTMLElement | null
  onEnableOneClick(value: boolean): void
  onToggle(agentId: string): void
  onToggleAll(): void
  onLead(agentId: string): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const lead = selectedMembers.find(member => member.agentId === leadId) ?? null
  const allSelected = availableMembers.length > 0
    && selectedMemberIds.length === availableMembers.length
    && selectedMemberIds.every(id => availableMembers.some(member => member.agentId === id))
  const normalized = query.trim().toLocaleLowerCase()
  const matchingMembers = members.filter(member => {
    const profile = profileById.get(member.agentId)
    return `${member.displayName}\n${profile?.teamRole ?? ''}\n${newConversationMemberStatus(member)}`.toLocaleLowerCase().includes(normalized)
  })

  return <Popover.Root open={open} onOpenChange={next => { if (!busy) setOpen(next); if (!next) setQuery('') }}>
    <Popover.Trigger asChild>
      <MissionPropertyChip ref={triggerRef} className="mission-editor-team-property" icon={<TeamGlyph/>} disabled={busy || !members.length} aria-invalid={!selectedMemberIds.length} aria-label={selectedMembers.length ? uiAttribute("队员与队长：{0} 位队员，{1}", String(selectedMembers.length), String(lead ? uiAttribute("队长 {0}", String(lead.displayName)) : uiAttribute("未选择队长"))) : availableMembers.length ? uiAttribute("选择队员与队长") : uiAttribute("暂无可用队员")}>
        <span className="mission-editor-team-summary">
          {selectedMembers.length ? <><span className="compact-avatar-stack">{selectedMembers.slice(0, 2).map(member => <MemberAvatar key={member.agentId} agentId={member.agentId} avatarRef={profileById.get(member.agentId)?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative/>)}{selectedMembers.length > 2 && <span className="mission-editor-team-overflow" aria-hidden="true">+{selectedMembers.length - 2}</span>}</span>
            <span className="mission-editor-team-divider" aria-hidden="true"/>
            <span>{lead ? uiAttribute("队长 {0}", String(lead.displayName)) : uiAttribute("选择队长")}</span></>
            : <span>{availableMembers.length ? uiAttribute("选择队员") : uiAttribute("暂无可用队员")}</span>}
        </span>
      </MissionPropertyChip>
    </Popover.Trigger>
    <Popover.Portal container={portalContainer}><Popover.Content className="compact-menu mission-editor-team-popover" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }}>
      <div className="compact-menu-heading"><span><UiText zh={"队员与队长 "} /><small className="mission-editor-team-count"><UiText zh={"已选 "} />{selectedMemberIds.length} / {members.length}</small></span><button type="button" disabled={busy || !availableMembers.length} onClick={onToggleAll}>{allSelected ? uiAttribute("取消全选") : uiAttribute("全选")}</button></div>
      <label className="mission-picker-search"><NavigationIcon name="search"/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} aria-label={uiAttribute("搜索队员")} placeholder={uiAttribute("搜索队员…")}
        onKeyDown={event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.closest('.mission-editor-team-popover')?.querySelector<HTMLButtonElement>('.mission-editor-team-member:not(:disabled)')?.focus() } }}/></label>
      <div className="mission-editor-team-list">
        {matchingMembers.map(member => {
          const profile = profileById.get(member.agentId)
          const available = isNewConversationMemberAvailable(member)
          const selected = selectedMemberIds.includes(member.agentId)
          const isLead = leadId === member.agentId
          return <div className="mission-editor-team-row" key={member.agentId} data-disabled={!available ? '' : undefined}>
            <button type="button" className="mission-editor-team-member" disabled={busy || !available} onClick={() => onToggle(member.agentId)}>
              <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative/>
              <span>{member.displayName}<small>{profile?.teamRole || uiAttribute('队员')} · {newConversationMemberStatus(member)}</small></span>
              <span className={`mission-editor-team-check${selected ? ' is-checked' : ''}`}>{selected && <DialogControlIcon name="check"/>}</span>
            </button>
            <button type="button" className={`mission-editor-lead-choice${isLead ? ' is-selected' : ''}`} disabled={busy || !available || !selected} onClick={() => onLead(member.agentId)}>{isLead ? uiAttribute("队长") : uiAttribute("设为队长")}</button>
          </div>
        })}
        {!matchingMembers.length && <p className="mission-picker-empty" role="status"><UiText zh={"没有匹配的队员"} /></p>}
      </div>
      <div className="mission-editor-team-footer">
        <label><input type="checkbox" checked={enableOneClick} disabled={busy} onChange={event => onEnableOneClick(event.target.checked)}/><span><UiText zh={"以后使用此队伍一键新建"} /></span></label>
        <button type="button" className="compact-primary" onClick={() => { setOpen(false); setQuery('') }} disabled={busy}><UiText zh={"完成"} /></button>
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

function navigateMemberGrid(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'))
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index < 0) return
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  const candidates = horizontal ? items : items.filter((_, itemIndex) => itemIndex % 2 === index % 2)
  const start = candidates.indexOf(items[index])
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
  let next = items[index]
  for (let offset = 1; offset <= candidates.length; offset++) {
    const candidate = candidates[(start + step * offset + candidates.length) % candidates.length]
    if (!candidate.hasAttribute('data-disabled')) {
      next = candidate
      break
    }
  }
  // Capture before Radix schedules its single-column roving focus.
  event.preventDefault()
  event.stopPropagation()
  next.focus()
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

function WorkspaceIcon({ kind }: { kind: 'quick-chat' | 'project' }): React.JSX.Element {
  if (kind === 'quick-chat') return <NavigationIcon name="square-pen" />
  return (
    <svg className="new-camp-project-folder-icon" viewBox="0 0 24 24">
      <path className="folder-fill" d="M3.75 7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2Z" />
      <path d="M3.9 9.1h16.2" />
    </svg>
  )
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
          label:uiAttribute("Git 检测失败"),
          detail:uiAttribute("未能完成 Git 检测。目录仍可使用；执行前会重新检查 Git 状态。")
        }
      : {
          kind: 'loading',
          label:uiAttribute("检测 Git…")
        }
  }
  if (workspace.gitObservation.state === 'not_git') return { kind: 'none' }
  if (workspace.gitObservation.state === 'git_invalid') {
    return {
      kind: 'warning',
      label:uiAttribute("Git 状态异常"),
      detail:uiAttribute("无法读取当前 Git 状态。目录仍可使用；执行前会重新检查 Git 状态。")
    }
  }
  if (!workspace.gitObservation.headCommit) {
    return { kind: 'metadata', label:uiAttribute("Git · 尚无提交") }
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

export function initialThreadSelection(
  preflight: ThreadCreationPreflight,
  preferred: NewConversationDefaults | null = null
): {
  memberIds: string[]
  leadId: string
} {
  const { memberIds, leadId } = planInitialThreadSelection(preflight, preferred)
  return { memberIds, leadId }
}

export interface InitialThreadSelectionPlan {
  memberIds: string[]
  leadId: string
}

export function planInitialThreadSelection(
  preflight: ThreadCreationPreflight,
  preferred: NewConversationDefaults | null = null
): InitialThreadSelectionPlan {
  const presentMemberIds = preflight.presentMembers.filter(isNewConversationMemberAvailable).map((member) => member.agentId)
  const preferredMemberIds = preferred?.memberAgentIds.filter((agentId) =>
    presentMemberIds.includes(agentId)
  ) ?? []
  const memberIds = preferredMemberIds.length > 0 ? preferredMemberIds : presentMemberIds
  const leadId = preferred && memberIds.includes(preferred.defaultLeadAgentId)
    ? preferred.defaultLeadAgentId
    : memberIds[0] ?? ''
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

export function toggleThreadMemberSelection({
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
} {
  if (!memberIds.includes(toggledMemberId)) {
    return {
      memberIds: stableMemberOrder.filter(
        (id) => id === toggledMemberId || memberIds.includes(id)
      ),
      leadId: leadId || toggledMemberId,
    }
  }
  const nextMemberIds = memberIds.filter((id) => id !== toggledMemberId)
  return {
    memberIds: nextMemberIds,
    leadId: leadId === toggledMemberId ? nextMemberIds[0] ?? '' : leadId,
  }
}

function errorMessage(error: unknown): string {
  return readErrorMessage(error)
}
