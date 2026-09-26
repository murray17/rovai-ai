import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type Ref } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, CampOpenProjection, MissionDelivery, MissionRecord, MissionStatus, MissionUpdate, MissionWorkspace, ProjectNavigationGroup } from '@contracts'
import { useCampClient, type CampClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { DialogControlIcon } from './AppDialog'
import { NavigationIcon } from './NavigationIcon'
import { MobilePageHeader, useMobileLayout } from './MobileLayout'
import { MissionIcon } from './MissionIcon'
import { Avatar, CompactDialog, Icon, LabelsEditor, MissionAvatars, MissionContextMenu, MissionFilter, MissionPeopleProvider, MissionPopover, MissionRoster, MissionTags, StatusIcon, FilterStateIcon, TagColorDot, statuses, type ContextPosition } from './MissionControls'
import { RunningText } from './RunningText'
import { MissionCommandRejected, missionCommand, missionError } from './useMissions'
import { MemberAvatar } from './MemberAvatar'
import { AttachmentCard, ComposerAttachmentStrip } from './AttachmentCard'
import {
  MissionAttachmentButton,
  MissionPropertyChip,
  MissionTagPicker,
  MissionWritingPlane,
  ProjectGlyph,
  TeamGlyph,
  keptMissionAttachmentIds,
  missionAttachmentDrafts,
  storedMissionAttachments,
  type MissionDraftAttachment,
  type MissionWritingPlaneHandle
} from './MissionDefinitionEditor'
import { displayProjectPath } from '../../shared/project-display-name'

type MissionActions = {
  edit(mission: MissionRecord): void
  menu(mission: MissionRecord, event: MouseEvent<HTMLElement>): void
  roster(mission: MissionRecord, event: MouseEvent<HTMLElement>): void
  tags(mission: MissionRecord, event: MouseEvent<HTMLElement>): void
  status(mission: MissionRecord, status: MissionStatus): void
  start(mission: MissionRecord): void
  cleanup(mission: MissionRecord): Promise<void>
  cleanupFeedback(mission: MissionRecord): 'cleaning' | 'success' | 'failed' | null
  dismissCleanupSuccesses(): void
  notifyError(message: string, action?: { label: string; onSelect(): void }): void
  startAccepted(missionId: string): boolean
  busyId: string | null
}
const Actions = createContext<MissionActions | null>(null)
export function useMissionActions(): MissionActions {
  const actions = useContext(Actions)
  if (!actions) throw new Error('Mission interaction owner is unavailable')
  return actions
}
export function missionProject(m: MissionRecord, projects: ProjectNavigationGroup[]): string {
  return m.projectBindingKind === 'quick_chat' ? '快速对话' : projects.find(p => p.projectPath === m.projectPath)?.name ?? m.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? m.projectPath
}
export function missionDate(value: string): string {
  const date = new Date(value), today = new Date(), yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } as const : {}) })
}

function openMissionCamp(client: Pick<CampClient, 'request'>, campId: string): Promise<CampOpenProjection> {
  return client.request<CampOpenProjection>('camps.open', { traceId: newCommandId(), campId })
}

/** Shared overlays keep card actions identical in the board, drawer and full conversation. */
export function MissionInteractionProvider({ missions, projects, agents, onChanged, onWorkspaceCleaned, onDeleted, onOpen, onError, children }: {
  missions: MissionRecord[]; projects: ProjectNavigationGroup[]; agents: AgentProfile[]; onChanged(campId: string): Promise<void>; onWorkspaceCleaned(campId: string): Promise<void>; onDeleted(campId: string): Promise<void>; onOpen(mission: MissionRecord): void; onError(message: string, action?: { label: string; onSelect(): void }): void; children: ReactNode
}) {
  const client = useCampClient()
  const [position, setPosition] = useState<(ContextPosition & { kind: 'menu' | 'tags' | 'members' }) | null>(null)
  const [editing, setEditing] = useState<MissionRecord | null>(null)
  const [cleaning, setCleaning] = useState<MissionRecord | null>(null)
  const [deleting, setDeleting] = useState<MissionRecord | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [acceptedStarts, setAcceptedStarts] = useState<Set<string>>(() => new Set())
  const [cleanupFeedbacks, setCleanupFeedbacks] = useState<Record<string, 'cleaning' | 'success'>>({})
  const starts = useRef(new Map<string, string>())
  const cleanupRequests = useRef(new Set<string>())
  const cleanupTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const observedCleanupStates = useRef(new Map<string, NonNullable<MissionRecord['workspaceCleanup']>['state'] | undefined>())
  const catalog = [...new Set(missions.flatMap(m => m.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const selected = missions.find(m => m.missionId === position?.id)
  const selectedForMenu = selected && (cleanupFeedbacks[selected.missionId] === 'cleaning' || selected.workspaceCleanup?.state === 'cleaning')
    ? { ...selected, cleanupAvailable: false }
    : selected
  const anchor = (kind: 'menu' | 'tags' | 'members', m: MissionRecord, event: MouseEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setPosition({ id: m.missionId, kind, x: kind === 'menu' && event.type === 'contextmenu' ? event.clientX : rect.left, y: kind === 'menu' && event.type === 'contextmenu' ? event.clientY : rect.bottom, origin: event.currentTarget })
  }
  async function change(m: MissionRecord, kind: 'status' | 'update', fields: object) {
    try {
      await missionCommand(client, kind === 'status' ? 'missions.status' : 'missions.update', { missionId: m.missionId, ...fields })
      await onChanged(m.campId)
    } catch (error) {
      if (error instanceof MissionCommandRejected && error.result.code === 'mission.details_version_conflict') {
        try { await onChanged(m.campId) } catch { /* The conflict payload still carries the authoritative fields. */ }
      }
      throw error
    }
  }
  const report = (promise: Promise<unknown>) => { void promise.catch(error => onError(missionError(error))) }
  async function start(m: MissionRecord) {
    if (busyId) return
    const commandId = starts.current.get(m.missionId) ?? newCommandId()
    starts.current.set(m.missionId, commandId); setBusyId(m.missionId)
    try {
      await missionCommand(client, 'missions.start', { missionId: m.missionId }, commandId)
      setAcceptedStarts(current => new Set(current).add(m.missionId))
      starts.current.delete(m.missionId)
      await onChanged(m.campId)
    }
    catch (error) { if (error instanceof MissionCommandRejected) starts.current.delete(m.missionId); throw error }
    finally { setBusyId(null) }
  }
  async function cleanup(m: MissionRecord) {
    if (cleanupRequests.current.has(m.missionId) || cleanupFeedbacks[m.missionId] === 'cleaning' || m.workspaceCleanup?.state === 'cleaning') return
    cleanupRequests.current.add(m.missionId)
    try {
      await missionCommand(client, 'missions.workspace.cleanup', { missionId: m.missionId })
      setCleanupFeedbacks(current => ({ ...current, [m.missionId]: 'cleaning' }))
      void onWorkspaceCleaned(m.campId).catch(error => onError(`使命 Worktree 清理已开始，但信息刷新失败：${missionError(error)}`))
    } finally {
      cleanupRequests.current.delete(m.missionId)
    }
  }
  const dismissCleanupSuccesses = () => {
    cleanupTimers.current.forEach(timer => clearTimeout(timer)); cleanupTimers.current.clear()
    setCleanupFeedbacks(current => Object.values(current).includes('success')
      ? Object.fromEntries(Object.entries(current).filter(([, state]) => state !== 'success'))
      : current)
  }
  useEffect(() => {
    // A completed list refresh is authoritative again; the local latch only bridges
    // the accepted command response to that first projection.
    setAcceptedStarts(current => current.size ? new Set() : current)
  }, [missions])
  useEffect(() => {
    const present = new Set(missions.map(mission => mission.missionId))
    for (const missionId of observedCleanupStates.current.keys()) {
      if (!present.has(missionId)) observedCleanupStates.current.delete(missionId)
    }
    for (const mission of missions) {
      const missionId = mission.missionId
      const cleanup = mission.workspaceCleanup
      const state = cleanup?.state
      const observed = observedCleanupStates.current.has(missionId)
      const previous = observedCleanupStates.current.get(missionId)
      observedCleanupStates.current.set(missionId, state)
      if (!observed) continue
      const locallyCleaning = cleanupFeedbacks[missionId] === 'cleaning'
      const transitioned = state !== previous
      if (cleanup?.state === 'failed' && (locallyCleaning || transitioned)) {
        setCleanupFeedbacks(current => {
          if (!(missionId in current)) return current
          const next = { ...current }; delete next[missionId]; return next
        })
        const label = cleanup.worktreeRemoved && !cleanup.branchRemoved ? '分支清理失败' : 'Worktree 清理失败'
        onError(`${`M-${String(mission.number).padStart(3, '0')}`} ${label}`, { label: '查看', onSelect: () => onOpen(mission) })
      } else if (state === 'cleaned' && (locallyCleaning || transitioned)) {
        setCleanupFeedbacks(current => current[missionId] === 'success' ? current : { ...current, [missionId]: 'success' })
        if (!cleanupTimers.current.has(missionId)) {
          cleanupTimers.current.set(missionId, setTimeout(() => {
            cleanupTimers.current.delete(missionId)
            setCleanupFeedbacks(current => {
              if (current[missionId] !== 'success') return current
              const next = { ...current }; delete next[missionId]; return next
            })
          }, 4_000))
        }
      }
    }
  }, [cleanupFeedbacks, missions, onError, onOpen])
  useEffect(() => () => { cleanupTimers.current.forEach(timer => clearTimeout(timer)) }, [])
  const actions: MissionActions = {
    edit: setEditing, menu: (m, e) => anchor('menu', m, e), roster: (m, e) => anchor('members', m, e), tags: (m, e) => anchor('tags', m, e),
    status: (m, status) => report(change(m, 'status', { status })), start: m => report(start(m)), cleanup,
    cleanupFeedback: m => cleanupFeedbacks[m.missionId] ?? (m.workspaceCleanup?.state === 'cleaning' || m.workspaceCleanup?.state === 'failed' ? m.workspaceCleanup.state : null),
    dismissCleanupSuccesses, notifyError: onError, startAccepted: missionId => acceptedStarts.has(missionId), busyId
  }
  return <MissionPeopleProvider agents={agents}><Actions.Provider value={actions}>{children}
    <MissionContextMenu key={`${position?.id}:${position?.x}:${position?.y}`} m={selectedForMenu} position={position?.kind === 'menu' ? position : null} catalog={catalog} onClose={() => setPosition(null)}
      onEdit={() => { if (selected) setEditing(selected); setPosition(null) }}
      onStatus={status => { if (selected) actions.status(selected, status) }}
      onLead={id => { if (selected) report((async () => {
        const snapshot = await openMissionCamp(client, selected.campId)
        await missionCommand(client, 'camps.changeDefaultLead', { campId: selected.campId, successorAgentId: id, expectedVersion: snapshot.camp.version })
        await onChanged(selected.campId)
      })()) }}
      onSaveTags={tags => selected ? change(selected, 'update', { tags }) : Promise.resolve()}
      onCleanup={() => { if (selected) setCleaning(selected); setPosition(null) }}
      onDelete={() => { if (selected) setDeleting(selected); setPosition(null) }} />
    {position && position.kind !== 'menu' && selected && <MissionPopover position={position} title={position.kind === 'tags' ? '编辑标签' : '使命队员'} onClose={() => setPosition(null)} className={position.kind === 'tags' ? 'mission-label-popover' : 'mission-members-popover'}>
      {position.kind === 'tags' ? <LabelsEditor key={selected.missionId} m={selected} catalog={catalog} onSave={tags => change(selected, 'update', { tags })}/> : <MissionRoster m={selected}/>}
    </MissionPopover>}
    {editing && <MissionEdit key={editing.missionId} mission={editing} projects={projects} agents={agents} catalog={catalog} onClose={() => setEditing(null)} onSaved={() => onChanged(editing.campId)} onSave={patch => change(editing, 'update', patch)}/>}
    {cleaning && (
      <MissionWorkspaceCleanup key={cleaning.missionId} mission={cleaning} onClose={() => setCleaning(null)} onRequested={async () => { await cleanup(cleaning); setCleaning(null) }}/>
    )}
    {deleting && <MissionDelete key={deleting.missionId} mission={deleting} onClose={() => setDeleting(null)} onDelete={async workspaceDisposition => {
      const snapshot = await openMissionCamp(client, deleting.campId)
      await missionCommand(client, 'camps.delete', { campId: deleting.campId, expectedVersion: snapshot.camp.version, force: true, workspaceDisposition })
      await onDeleted(deleting.campId); setDeleting(null)
    }}/>}
  </Actions.Provider></MissionPeopleProvider>
}

function MissionEdit({ mission, projects, agents, catalog, onSave, onSaved, onClose }: {
  mission: MissionRecord
  projects: ProjectNavigationGroup[]
  agents: AgentProfile[]
  catalog: string[]
  onSave(patch: Omit<MissionUpdate, 'missionId'>): Promise<void>
  onSaved(): Promise<void>
  onClose(): void
}) {
  const client = useCampClient()
  const [baseline, setBaseline] = useState({ title: mission.title, description: mission.description, tags: mission.tags, attachments: mission.attachments ?? [], version: mission.detailsVersion })
  const [title, setTitle] = useState(mission.title)
  const [description, setDescription] = useState(mission.description)
  const [tags, setTags] = useState(mission.tags)
  const [attachments, setAttachments] = useState<MissionDraftAttachment[]>(() => storedMissionAttachments(mission.attachments))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<MissionWritingPlaneHandle>(null)
  const agentById = useMemo(() => new Map(agents.map(agent => [agent.agentId, agent])), [agents])
  const members = mission.memberAgentIds.map(id => agentById.get(id)).filter((agent): agent is AgentProfile => !!agent)
  const lead = mission.defaultLeadAgentId ? agentById.get(mission.defaultLeadAgentId) ?? null : null
  const normalizedTitle = title.trim()
  const keepAttachmentIds = keptMissionAttachmentIds(attachments)
  const newAttachments = missionAttachmentDrafts(attachments)
  const attachmentsChanged = newAttachments.length > 0
    || keepAttachmentIds.join('\n') !== baseline.attachments.map(attachment => attachment.id).join('\n')
  const changed = normalizedTitle !== baseline.title || description !== baseline.description
    || tags.join('\n') !== baseline.tags.join('\n') || attachmentsChanged
  const titleError = !normalizedTitle ? '请填写使命标题。' : [...normalizedTitle].length > 200 ? '使命标题最多 200 个字符。' : ''
  const descriptionError = [...description].length > 12000 ? '使命描述最多 12,000 个字符。' : ''
  const invalid = !!titleError || !!descriptionError
  async function save() {
    if (!changed || invalid) return
    const patch: MissionUpdate = {
      missionId: mission.missionId,
      ...(normalizedTitle !== baseline.title ? { title: normalizedTitle } : {}),
      ...(description !== baseline.description ? { description } : {}),
      ...(tags.join('\n') !== baseline.tags.join('\n') ? { tags } : {}),
      expectedDetailsVersion: baseline.version
    }
    setBusy(true); setError('')
    try {
      if (attachmentsChanged) {
        if (!client.missionAttachments) throw new Error('当前环境不支持编辑使命附件。')
        const result = await client.missionAttachments.update(newCommandId(), patch, keepAttachmentIds, newAttachments)
        if (result.status === 'rejected') throw new MissionCommandRejected(result)
        await onSaved()
      } else {
        const { missionId: _missionId, ...contentPatch } = patch
        await onSave(contentPatch)
      }
      onClose()
    } catch (error) {
      if (error instanceof MissionCommandRejected && error.result.code === 'mission.details_version_conflict') {
        try {
          const latest = (await client.request<MissionRecord[]>('missions.list')).find(candidate => candidate.missionId === mission.missionId)
          if (!latest) throw new Error('Mission no longer exists')
          setBaseline({ title: latest.title, description: latest.description, tags: latest.tags, attachments: latest.attachments ?? [], version: latest.detailsVersion })
          setTitle(latest.title); setDescription(latest.description); setTags(latest.tags); setAttachments(storedMissionAttachments(latest.attachments))
          setError('使命刚刚被修改，已载入最新内容。请重新编辑后保存。')
        } catch { setError('使命刚刚被修改，但最新内容加载失败。请关闭后重试。') }
      } else setError(missionError(error))
    } finally { setBusy(false) }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay new-camp-dialog-overlay"/>
      <Dialog.Content ref={setDialogContent} className={`compact-dialog mission-definition-dialog mission-edit-dialog${expanded ? ' is-expanded' : ''}`} aria-describedby="mission-edit-description"
        onOpenAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault() }}>
        <header className="compact-header mission-editor-header">
          <div className="mission-editor-heading"><Dialog.Title>编辑使命</Dialog.Title><span>{`M-${String(mission.number).padStart(3, '0')}`}</span></div>
          <div className="mission-editor-header-actions"><button className="mission-editor-icon-button" type="button" aria-label={expanded ? '恢复编辑区域大小' : '展开编辑区域'} title={expanded ? '恢复编辑区域大小' : '展开编辑区域'} onClick={() => setExpanded(value => !value)} disabled={busy}><svg viewBox="0 0 24 24" aria-hidden="true">{expanded ? <><path d="M9 3v6H3M15 21v-6h6M3 9l6-6M21 15l-6 6"/></> : <><path d="M9 3H3v6M15 21h6v-6M3 9l6-6M21 15l-6 6"/></>}</svg></button><Dialog.Close asChild><button className="compact-close" type="button" aria-label="关闭编辑使命" disabled={busy}><DialogControlIcon name="close"/></button></Dialog.Close></div>
        </header>
        <Dialog.Description id="mission-edit-description" className="sr-only">编辑使命名称、描述、标签和附件。项目、队员与队长在创建后不可更改。</Dialog.Description>
        <form className="compact-form" onSubmit={event => { event.preventDefault(); void save() }}>
          <div className="compact-body mission-editor-body">
            <MissionWritingPlane ref={editorRef} titleInputRef={titleInputRef} title={title} description={description} attachments={attachments} disabled={busy} attachmentsDisabled={!client.missionAttachments} titleError={titleError || undefined} descriptionError={descriptionError || undefined} mission={{campId: mission.campId, missionId: mission.missionId}} onTitleChange={setTitle} onDescriptionChange={setDescription} onAttachmentsChange={setAttachments} onNotify={setError}/>
            <div className="mission-editor-properties" aria-label="使命属性">
              <MissionPropertyChip icon={<ProjectGlyph/>} locked className="mission-editor-project-property" title="编辑使命时不能更改项目" aria-label={`项目：${missionProject(mission, projects)}，编辑使命时不能更改`}>{missionProject(mission, projects)}</MissionPropertyChip>
              <MissionPropertyChip icon={<TeamGlyph/>} locked className="mission-editor-team-property mission-editor-team-locked" title="编辑使命时不能更改队员或队长" aria-label={`队员与队长：${members.length} 位队员，${lead ? `队长 ${lead.displayName}` : '未设置队长'}，编辑使命时不能更改`}>
                <span className="mission-editor-team-summary"><span className="compact-avatar-stack">{members.slice(0, 2).map(member => <MemberAvatar key={member.agentId} agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="mention" decorative/>)}{members.length > 2 && <span className="mission-editor-team-overflow" aria-hidden="true">+{members.length - 2}</span>}</span><span className="mission-editor-team-divider" aria-hidden="true"/><span>{lead ? `队长 ${lead.displayName}` : '未设置队长'}</span></span>
              </MissionPropertyChip>
              <MissionTagPicker tags={tags} catalog={catalog} disabled={busy} portalContainer={dialogContent} onChange={setTags}/>
            </div>
            {error && <p role="alert" className="compact-inline-error mission-editor-error">{error}</p>}
          </div>
          <footer className="compact-footer mission-editor-footer"><MissionAttachmentButton onClick={() => editorRef.current?.chooseFiles()} disabled={busy || !client.missionAttachments}/><div className="mission-editor-footer-actions"><button className="compact-cancel" type="button" disabled={busy} onClick={onClose}>取消</button><button className="compact-primary" type="submit" disabled={busy || invalid || !changed}>{busy ? '正在保存…' : '保存'}</button></div></footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
function MissionWorkspaceCleanup({ mission, onRequested, onClose }: { mission: MissionRecord; onRequested(): Promise<void>; onClose(): void }) {
  const client = useCampClient(), [delivery, setDelivery] = useState<MissionDelivery | null>(null), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { let current = true; setError(''); void client.request<MissionDelivery>('missions.delivery', { missionId: mission.missionId }).then(data => { if (current) setDelivery(data) }).catch(error => { if (current) setError(missionError(error)) }); return () => { current = false } }, [client, mission.missionId, retry])
  async function cleanup() {
    setBusy(true); setError('')
    try {
      await onRequested()
    } catch (error) { setError(missionError(error)) } finally { setBusy(false) }
  }
  return <CompactDialog title="清理使命 Worktree" className="mission-worktree-cleanup-dialog" onClose={() => { if (!busy) onClose() }} footer={<><button className="compact-cancel" onClick={onClose} disabled={busy}>取消</button><button className="compact-primary" onClick={() => void cleanup()} disabled={busy || !delivery?.workspace}>{busy ? '正在安排清理…' : '清理'}</button></>}>
    <p>将删除此使命的 Worktree 和本地分支。</p>
    {delivery?.workspace && <div className="mission-delete-workspaces"><div><code>{delivery.workspace.worktreePath}</code><small>{delivery.workspace.managedBranch}</small></div></div>}
    {!delivery && !error && <p role="status">正在读取关联工作区…</p>}
    {error && <p className="compact-inline-error" role="alert">{error}{!delivery && <button className="mission-source-link" onClick={() => setRetry(value => value + 1)}>重试</button>}</p>}
  </CompactDialog>
}

function MissionDelete({ mission, onDelete, onClose }: { mission: MissionRecord; onDelete(workspaceDisposition: 'retain' | 'cleanup'): Promise<void>; onClose(): void }) {
  const client = useCampClient(), [delivery, setDelivery] = useState<MissionDelivery | null>(null), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [cleanupWorkspace, setCleanupWorkspace] = useState(false)
  useEffect(() => { let current = true; setError(''); void client.request<MissionDelivery>('missions.delivery', { missionId: mission.missionId }).then(data => { if (current) setDelivery(data) }).catch(error => { if (current) setError(missionError(error)) }); return () => { current = false } }, [client, mission.missionId, retry])
  async function remove() { setBusy(true); setError(''); try { await onDelete(cleanupWorkspace ? 'cleanup' : 'retain') } catch (error) { setError(missionError(error)) } finally { setBusy(false) } }
  return <CompactDialog title="删除使命" className="mission-delete-dialog" onClose={() => { if (!busy) onClose() }} footer={<><button className="compact-cancel" onClick={onClose} disabled={busy}>取消</button><button className="compact-primary mission-delete-confirm" onClick={() => void remove()} disabled={busy || !delivery}>{busy ? '正在删除…' : '删除使命'}</button></>}>
    <p className="mission-delete-summary">删除后，使命、会话和交付文件将被一并删除，正在执行的队员会停止。此操作无法撤销。</p>
    {mission.workspaceEverCreated && <label className="mission-delete-workspace-option"><input type="checkbox" checked={cleanupWorkspace} disabled={busy || !mission.workspaceResourcesPresent} onChange={event => setCleanupWorkspace(event.target.checked)}/><span>{mission.workspaceResourcesPresent ? '同时清理 Worktree 及本地分支' : '同时清理 Worktree 及本地分支（已清理）'}</span><span className="mission-inline-help" tabIndex={0} aria-label="未勾选时，Worktree 和本地分支保留在原位置。" data-tooltip="未勾选时，Worktree 和本地分支保留在原位置。">?</span></label>}
    {!delivery && !error && <p role="status">正在读取关联工作区…</p>}{error && <p className="compact-inline-error" role="alert">{error}{!delivery && <button className="mission-source-link" onClick={() => setRetry(v => v + 1)}>重试</button>}</p>}
  </CompactDialog>
}

export function MissionBoard({ missions, projects, loading, error, selectedId, hidden, onRefresh, onNew, onOpen, onOpenMenu = () => undefined, menuOpen = false, menuTriggerRef }: {
  missions: MissionRecord[]; projects: ProjectNavigationGroup[]; loading: boolean; error: string | null; selectedId?: string; hidden?: boolean; onRefresh(): Promise<void>; onNew(): void; onOpen(m: MissionRecord): void; onOpenMenu?(trigger: HTMLButtonElement): void; menuOpen?: boolean; menuTriggerRef?: Ref<HTMLButtonElement>
}) {
  const actions = useMissionActions()
  const mobile = useMobileLayout()
  const [searchOpen, setSearchOpen] = useState(false)
  const mobileOffsets = useRef<Partial<Record<MissionStatus, number>>>({})
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const held = useRef(false)
  const cancelPress = (): void => { if (press.current) clearTimeout(press.current.timer); press.current = null }
  useEffect(() => { if (hidden) cancelPress(); return cancelPress }, [hidden])
  const [query, setQuery] = useState(''), [stateFilter, setStateFilter] = useState<string[]>([]), [tags, setTags] = useState<string[]>([]), [projectFilter, setProjectFilter] = useState<string[]>([]), [view, setView] = useState<'board' | 'list'>('board')
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<MissionStatus | null>(null)
  const [pageHidden, setPageHidden] = useState(false)
  const [activeLane, setActiveLane] = useState<MissionStatus>('needs_you')
  const [scrolledLanes, setScrolledLanes] = useState<Partial<Record<MissionStatus, boolean>>>({})
  const boardScroll = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (mobile && boardScroll.current) boardScroll.current.scrollTop = mobileOffsets.current[activeLane] ?? 0
  }, [activeLane, mobile])
  const laneScrolls = useRef(new Map<MissionStatus, HTMLDivElement>())
  const laneScrollMemory = useRef(new Map<MissionStatus, number>())
  const boardHorizontalMemory = useRef(0)
  const dragPointer = useRef<{ x: number; y: number; status: MissionStatus } | null>(null)
  const dragFrame = useRef<number | null>(null)
  const dragFrameTime = useRef(0)
  useEffect(() => { if (hidden) actions.dismissCleanupSuccesses() }, [hidden])
  useEffect(() => {
    const update = (): void => setPageHidden(document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current)
  }, [])
  const catalog = [...new Set(missions.flatMap(m => m.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const paths = [...new Set(missions.map(m => m.projectPath))]
  const filtered = missions.filter(m => (mobile || !stateFilter.length || stateFilter.includes(m.status)) && (!tags.length || tags.some(t => m.tags.includes(t))) && (!projectFilter.length || projectFilter.includes(m.projectPath)) && `${m.title}\n${m.description}\n${m.tags.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const visibleStatuses = statuses.filter(status => !stateFilter.length || stateFilter.includes(status.id))
  const updateActiveLane = (): void => {
    const host = boardScroll.current
    if (!host || view !== 'board') return
    const edge = host.getBoundingClientRect().left + 2
    let nearest: { status: MissionStatus; distance: number } | null = null
    for (const status of visibleStatuses) {
      const column = laneScrolls.current.get(status.id)?.closest<HTMLElement>('.mission-column')
      if (!column) continue
      const distance = Math.abs(column.getBoundingClientRect().left - edge)
      if (!nearest || distance < nearest.distance) nearest = { status: status.id, distance }
    }
    if (nearest) setActiveLane(current => current === nearest.status ? current : nearest.status)
  }
  const changeView = (next: 'board' | 'list'): void => {
    if (next === view) return
    if (view === 'board') {
      laneScrolls.current.forEach((lane, status) => laneScrollMemory.current.set(status, lane.scrollTop))
      boardHorizontalMemory.current = boardScroll.current?.scrollLeft ?? 0
    }
    setView(next)
  }
  useLayoutEffect(() => {
    if (view !== 'board') return
    laneScrolls.current.forEach((lane, status) => { lane.scrollTop = laneScrollMemory.current.get(status) ?? 0 })
    if (boardScroll.current) boardScroll.current.scrollLeft = boardHorizontalMemory.current
    updateActiveLane()
  }, [view])
  useLayoutEffect(() => {
    laneScrollMemory.current.clear()
    mobileOffsets.current = {}
    if (mobile && boardScroll.current) boardScroll.current.scrollTop = 0
    laneScrolls.current.forEach(lane => { lane.scrollTop = 0 })
    updateActiveLane()
  }, [query, stateFilter.join('\u0000'), tags.join('\u0000'), projectFilter.join('\u0000')])
  const updateLaneScroll = (status: MissionStatus, lane: HTMLDivElement): void => {
    const scrolled = lane.scrollTop > 0 && lane.scrollHeight > lane.clientHeight
    setScrolledLanes(current => !!current[status] === scrolled ? current : { ...current, [status]: scrolled })
  }
  useLayoutEffect(() => {
    if (view !== 'board') return
    const measure = (): void => laneScrolls.current.forEach((lane, status) => updateLaneScroll(status, lane))
    measure()
    const observer = new ResizeObserver(measure)
    laneScrolls.current.forEach(lane => observer.observe(lane))
    return () => observer.disconnect()
  }, [view, hidden, missions, query, stateFilter, tags, projectFilter])
  const edgeSpeed = (point: number, start: number, end: number): number => {
    const margin = Math.min(64, (end - start) / 3)
    if (point < start + margin && point >= start - 12) return -Math.max(1, (start + margin - point) / margin) * 9
    if (point > end - margin && point <= end + 12) return Math.max(1, (point - end + margin) / margin) * 9
    return 0
  }
  const queueDragScroll = (): void => {
    if (dragFrame.current !== null) return
    const scroll = (time: number): void => {
      const pointer = dragPointer.current
      if (!pointer) { dragFrame.current = null; dragFrameTime.current = 0; return }
      const scale = Math.min(2, Math.max(.5, (time - (dragFrameTime.current || time - 16)) / 16))
      dragFrameTime.current = time
      const lane = laneScrolls.current.get(pointer.status)
      if (lane) {
        const bounds = lane.getBoundingClientRect()
        lane.scrollTop += edgeSpeed(pointer.y, bounds.top, bounds.bottom) * scale
      }
      const host = boardScroll.current
      if (host) {
        const bounds = host.getBoundingClientRect()
        if (pointer.y >= bounds.top && pointer.y <= bounds.bottom) host.scrollLeft += edgeSpeed(pointer.x, bounds.left, bounds.right) * scale
      }
      dragFrame.current = requestAnimationFrame(scroll)
    }
    dragFrame.current = requestAnimationFrame(scroll)
  }
  const stopDragging = (): void => {
    dragPointer.current = null
    dragFrameTime.current = 0
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current)
    dragFrame.current = null
    setDraggingId(null)
    setDragOverStatus(null)
  }
  useEffect(() => {
    if (!draggingId) return
    const cancel = (event: KeyboardEvent): void => { if (event.key === 'Escape') stopDragging() }
    document.addEventListener('keydown', cancel)
    return () => document.removeEventListener('keydown', cancel)
  }, [draggingId])
  const focusAdjacentLane = (status: MissionStatus, direction: -1 | 1): void => {
    const index = visibleStatuses.findIndex(candidate => candidate.id === status)
    const next = visibleStatuses[index + direction]
    const lane = next && laneScrolls.current.get(next.id)
    const host = boardScroll.current
    if (!lane || !host) return
    lane.focus({ preventScroll: true })
    const laneBounds = lane.closest<HTMLElement>('.mission-column')?.getBoundingClientRect()
    const hostBounds = host.getBoundingClientRect()
    if (laneBounds && (laneBounds.left < hostBounds.left || laneBounds.right > hostBounds.right)) {
      host.scrollLeft += laneBounds.left - hostBounds.left
    }
  }
  function card(m: MissionRecord) {
    const cleanupFeedback = actions.cleanupFeedback(m)
    const openFromContainer = (event: MouseEvent<HTMLElement>) => {
      if (!(event.target instanceof Element) || event.target.closest('button,a,input') || window.getSelection()?.toString()) return
      event.currentTarget.querySelector<HTMLButtonElement>('.mission-card-open')?.focus({ preventScroll: true }); onOpen(m)
    }
    return <article key={m.missionId} data-mission-id={m.missionId} aria-busy={cleanupFeedback === 'cleaning' || undefined} className={`mission-board-card${selectedId === m.missionId ? ' selected' : ''}${draggingId === m.missionId ? ' is-dragging' : ''}${m.hasUnread ? ' is-unread' : ''}`} onClick={openFromContainer} onContextMenu={e => { cancelPress(); actions.menu(m, e) }} draggable={!mobile}
      onPointerDown={event => {
        held.current = false
        if (!mobile || event.pointerType === 'mouse' || !event.isPrimary) return
        cancelPress()
        const target = event.currentTarget, x = event.clientX, y = event.clientY
        press.current = { x, y, timer: setTimeout(() => {
          press.current = null; held.current = true
          target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
        }, 480) }
      }}
      onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress() }}
      onPointerUp={cancelPress} onPointerCancel={cancelPress}
      onClickCapture={event => { if (held.current) { held.current = false; event.preventDefault(); event.stopPropagation() } }}
      onDragStart={event => { setDraggingId(m.missionId); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', m.missionId) }}
      onDragEnd={stopDragging}
      onKeyDown={e => { held.current = false; if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect(); e.currentTarget.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: bounds.left, clientY: bounds.bottom })) } }}>
      <div className="mission-card-meta"><span>{`M-${String(m.number).padStart(3, '0')}`}</span><div className="mission-card-top-actions"><MissionRunning mission={m} pageHidden={pageHidden}/></div></div>
      {mobile && <button type="button" className="mobile-context-trigger" aria-label={`${m.title}的操作`} onClick={event => actions.menu(m, event)}>操作</button>}
      <button className="mission-card-open" onClick={() => onOpen(m)}><h3>{m.title}</h3></button>
      <div className="mission-project-tags"><span className="mission-card-project" title={displayProjectPath(m.projectPath)}><NavigationIcon name="folder-open"/>{missionProject(m, projects)}</span><MissionTags tags={m.tags}/></div>
      <div className="mission-card-footer"><MissionAvatars m={m} compact onClick={e => actions.roster(m, e)}/>{m.hasUnread && <span className="mission-unread-message" role="img" aria-label="有未读回复" title="有未读回复；与执行状态独立"><span className="mission-unread-dot" aria-hidden="true"/><span aria-hidden="true">未读</span></span>}<time dateTime={m.updatedAt} title={new Date(m.updatedAt).toLocaleString()}>{missionDate(m.updatedAt)}</time></div>
      {cleanupFeedback && (
        <MissionCleanupCardStatus mission={m} state={cleanupFeedback} onOpen={() => onOpen(m)}/>
      )}
    </article>
  }
  if (mobile) return <section className="mission-board-page mobile-mission-board" hidden={hidden} aria-label="使命板">
    <MobilePageHeader title="使命板" onOpenMenu={onOpenMenu} menuOpen={menuOpen} triggerRef={menuTriggerRef}>
      <button className="mission-new mission-new-entry" onClick={onNew}><Icon name="plus" />新使命</button>
    </MobilePageHeader>
    <div className="mobile-mission-toolbar">
      {searchOpen ? <><label className="mobile-mission-search"><NavigationIcon name="search" /><input autoFocus aria-label="搜索使命" placeholder="搜索使命…" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" onClick={() => { setSearchOpen(false); setQuery('') }}>取消</button></> : <>
        <MissionFilter label="项目" icon={<NavigationIcon name="folder-open" />} values={projectFilter} onChange={setProjectFilter} options={paths.map(path => ({ id: path, keywords: path, icon: <NavigationIcon name="folder-open" />, label: missionProject(missions.find(m => m.projectPath === path)!, projects) }))} />
        <MissionFilter label="标签" icon={<Icon name="tag" />} values={tags} onChange={setTags} options={catalog.map(tag => ({ id: tag, label: tag, icon: <TagColorDot tag={tag} /> }))} />
        {!!(tags.length + projectFilter.length) && <button type="button" className="mobile-icon-button" aria-label="清除筛选" onClick={() => { setTags([]); setProjectFilter([]) }}><DialogControlIcon name="close" /></button>}
        <button type="button" className="mobile-icon-button mobile-mission-search-trigger" aria-label="搜索使命" onClick={() => setSearchOpen(true)}><NavigationIcon name="search" /></button>
      </>}
    </div>
    <nav className="mission-status-tabs" aria-label="使命状态">{statuses.map(status => <button type="button" key={status.id} aria-pressed={activeLane === status.id} onClick={() => {
      cancelPress()
      if (boardScroll.current) mobileOffsets.current[activeLane] = boardScroll.current.scrollTop
      setActiveLane(status.id)
    }}><StatusIcon status={status.id} /><span>{status.label}</span><small>{filtered.filter(m => m.status === status.id).length}</small></button>)}</nav>
    <MissionCleanupNotice />
    <div className="mobile-mission-list" ref={boardScroll} onScroll={cancelPress} aria-label={`${statuses.find(s => s.id === activeLane)?.label}的使命`}>
      {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={() => void onRefresh()}>重试</button></div>}
      {loading && !missions.length ? <p className="mission-section-empty" role="status">正在读取使命…</p> : <>
        {filtered.filter(m => m.status === activeLane).map(card)}
        {!filtered.some(m => m.status === activeLane) && !error && <div className="mission-mobile-empty">
          <MissionIcon /><h2>{query || tags.length || projectFilter.length ? '没有匹配的使命' : !missions.length ? '从一个目标开始' : `暂无${statuses.find(s => s.id === activeLane)?.label}的使命`}</h2>
          {query || tags.length || projectFilter.length ? <button type="button" className="quiet-button" onClick={() => { setQuery(''); setTags([]); setProjectFilter([]) }}>清除筛选</button> : <button type="button" className="mission-new" onClick={onNew}><Icon name="plus" />新使命</button>}
        </div>}
      </>}
    </div>
  </section>
  return <section className="mission-board-content mission-board-page" hidden={hidden} aria-label="使命板">
    <header className="mission-page-header"><div><h1>使命板</h1><p>设定目标，与队伍一起推进。</p></div><button className="mission-new mission-new-entry" onClick={onNew}><Icon name="plus"/>新使命</button></header>
    <div className="mission-toolbar"><div className="mission-filter-group">
      <MissionFilter label="状态" icon={<FilterStateIcon/>} searchable={false} values={stateFilter} onChange={setStateFilter} options={statuses.map(s => ({ id: s.id, label: s.label, icon: <StatusIcon status={s.id}/> }))}/>
      <MissionFilter label="标签" icon={<Icon name="tag"/>} values={tags} onChange={setTags} options={catalog.map(t => ({id: t, label: t, icon: <TagColorDot tag={t}/>}))}/>
      <MissionFilter label="项目" icon={<NavigationIcon name="folder-open"/>} values={projectFilter} onChange={setProjectFilter} options={paths.map(path => ({ id: path, keywords: path, icon: <NavigationIcon name="folder-open"/>, label: missionProject(missions.find(m => m.projectPath === path)!, projects) }))}/>
      {!!(stateFilter.length + tags.length + projectFilter.length) && <button className="mission-clear-filters" aria-label="清除筛选" onClick={() => { setStateFilter([]); setTags([]); setProjectFilter([]) }}><DialogControlIcon name="close"/></button>}
    </div><label className="mission-search"><NavigationIcon name="search"/><input aria-label="搜索使命" placeholder="搜索使命…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <Menu.Root><Menu.Trigger asChild><button className="mission-filter mission-view-trigger" aria-label={`切换视图，当前${view === 'board' ? '看板' : '列表'}`}><Icon name={view}/><Icon name="chevron"/></button></Menu.Trigger><Menu.Portal><Menu.Content className="compact-menu" align="end" sideOffset={6}><Menu.RadioGroup value={view} onValueChange={v => changeView(v as 'board' | 'list')}>{(['board', 'list'] as const).map(v => <Menu.RadioItem className="compact-option" value={v} key={v}><Icon name={v}/><span>{v === 'board' ? '看板' : '列表'}</span><Menu.ItemIndicator><Icon name="check"/></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup></Menu.Content></Menu.Portal></Menu.Root>
    </div>
    {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={() => void onRefresh()}>重试</button></div>}
    <MissionCleanupNotice/>
    <p className="sr-only" id="mission-board-lane-help">每个状态列可独立滚动。可拖动卡片，或通过卡片操作菜单修改状态。</p>
    {view === 'board' && <nav className="mission-lane-nav" aria-label="切换状态列">{visibleStatuses.map(status => <button type="button" key={status.id} aria-pressed={activeLane === status.id} onClick={() => {
      const host = boardScroll.current
      const column = laneScrolls.current.get(status.id)?.closest<HTMLElement>('.mission-column')
      if (!host || !column) return
      const hostBounds = host.getBoundingClientRect(), columnBounds = column.getBoundingClientRect()
      host.scrollLeft += columnBounds.left - hostBounds.left
      setActiveLane(status.id)
    }}>{status.label}<small>{filtered.filter(mission => mission.status === status.id).length}</small></button>)}</nav>}
    <div ref={boardScroll} className="mission-board-scroll" data-view={view} onScroll={event => { if (event.target === event.currentTarget) updateActiveLane() }} onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        dragPointer.current = null
        if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current)
        dragFrame.current = null
        dragFrameTime.current = 0
        setDragOverStatus(null)
      }
    }}>
      {loading && !missions.length && <p role="status" className="mission-section-empty">正在加载使命…</p>}
      {view === 'board' ? <div className="mission-board" style={{gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(var(--mission-column-min-width, 200px), 1fr))`}}>
        {visibleStatuses.map(s => <section className={`mission-column${scrolledLanes[s.id] ? ' is-scrolled' : ''}${dragOverStatus === s.id ? ' is-drop-target' : ''}`} key={s.id}
          onDragOver={event => { if (!draggingId) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; dragPointer.current = { x: event.clientX, y: event.clientY, status: s.id }; setDragOverStatus(s.id); queueDragScroll() }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStatus(current => current === s.id ? null : current) }}
          onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain') || draggingId; const mission = missions.find(candidate => candidate.missionId === id); stopDragging(); if (mission && mission.status !== s.id) actions.status(mission, s.id) }}>
          <header><StatusIcon status={s.id}/><h2 id={`mission-lane-${s.id}`}>{s.label}</h2><span>{filtered.filter(m => m.status === s.id).length}</span></header>
          <div ref={node => { if (node) laneScrolls.current.set(s.id, node); else laneScrolls.current.delete(s.id) }} className="mission-column-cards" data-status={s.id} tabIndex={0} role="region" aria-labelledby={`mission-lane-${s.id}`} aria-describedby="mission-board-lane-help" onScroll={event => updateLaneScroll(s.id, event.currentTarget)} onKeyDown={event => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); focusAdjacentLane(s.id, event.key === 'ArrowLeft' ? -1 : 1) }
          }}>{filtered.filter(m => m.status === s.id).map(card)}</div>
        </section>)}
      </div> : <div className="mission-grouped-list">{visibleStatuses.map(s => <section className="mission-list-group" key={s.id}>
        <button className="mission-group-heading" aria-expanded={!collapsedGroups.includes(s.id)} onClick={() => setCollapsedGroups(current => current.includes(s.id) ? current.filter(id => id !== s.id) : [...current, s.id])}>
          <Icon name="chevron"/><StatusIcon status={s.id}/><h2>{s.label}</h2><span>{filtered.filter(m => m.status === s.id).length}</span>
        </button>
        <div className="mission-list-cards" hidden={collapsedGroups.includes(s.id)}>{filtered.filter(m => m.status === s.id).map(card)}</div>
      </section>)}</div>}
    </div>
    {!loading && missions.length > 0 && !filtered.length && <p className="mission-section-empty" role="status">没有符合筛选条件的使命。</p>}
  </section>
}

function MissionCleanupCardStatus({ mission, state, onOpen }: { mission: MissionRecord; state: 'cleaning' | 'success' | 'failed'; onOpen(): void }) {
  const branchOnly = mission.workspaceCleanup?.worktreeRemoved && !mission.workspaceCleanup.branchRemoved
  if (state === 'failed') return <div className="mission-card-cleanup-status is-failed" role="alert">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75 14.25 13H1.75L8 1.75Z"/><path d="M8 5.1v4.2M8 11.7v.1"/></svg>
    <span>{branchOnly ? '分支清理失败' : 'Worktree 清理失败'}</span><span aria-hidden="true">·</span><button type="button" onClick={onOpen}>查看</button>
  </div>
  return <div className={`mission-card-cleanup-status is-${state}`} role="status" aria-live="polite" aria-atomic="true">
    {state === 'cleaning' ? <span className="mission-cleanup-spinner" aria-hidden="true"/> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8.1 3 3 6.5-6.5"/></svg>}
    <span>{state === 'cleaning' ? branchOnly ? '正在清理本地分支…' : '正在清理 Worktree…' : 'Worktree 已清理'}</span>
  </div>
}

function MissionRunning({ mission, pageHidden }: { mission: MissionRecord; pageHidden: boolean }) {
  const visible = mission.runningAgentIds.slice(0, 3)
  if (!visible.length) return null
  return <span className="mission-running" role="img" aria-label={`${mission.runningAgentIds.length} 位队员执行中`}>
    <span className="mission-running-avatars" aria-hidden="true">{visible.map(id => <Avatar key={id} id={id}/>)}</span>
    {mission.runningAgentIds.length > 3 && <small aria-hidden="true"><span className="mission-overflow-label">+{mission.runningAgentIds.length - 3}</span></small>}
    <RunningText text="执行中" active={false}/>
    <svg className="camp-execution-orbits" aria-hidden="true" focusable="false" data-paused={pageHidden}>
      <rect width="100%" height="100%" rx="5" pathLength="100"/>
      <rect className="is-ember" width="100%" height="100%" rx="5" pathLength="100"/>
    </svg>
  </span>
}

/** Deleted-Mission cleanup recovery; retained workspaces never enter this route. */
function MissionCleanupNotice() {
  const client = useCampClient(), { notifyError } = useMissionActions(), [rows, setRows] = useState<MissionWorkspace[]>([]), [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null)
  const previousStates = useRef<Map<string, MissionWorkspace['state']> | null>(null)
  useEffect(() => {
    let current = true, sequence = 0
    const load = () => {
      const request = ++sequence
      void client.request<MissionWorkspace[]>('missions.cleanup.list').then(next => {
        if (!current || request !== sequence) return
        const previous = previousStates.current
        if (previous) next.filter(row => row.state === 'cleanup_failed' && previous.get(row.id) !== 'cleanup_failed').forEach(row => {
          const label = row.cleanupWorktreeRemoved && !row.cleanupBranchRemoved ? '分支清理失败' : 'Worktree 清理失败'
          notifyError(`使命 ${row.managedBranch} ${label}`, { label: '查看', onSelect: () => setOpen(true) })
        })
        previousStates.current = new Map(next.map(row => [row.id, row.state]))
        setRows(next); setError('')
      }).catch(error => { if (current && request === sequence) setError(missionError(error)) })
    }
    load()
    const poll = setInterval(load, 30_000), unsubscribe = client.onEvent?.(event => { if (event.method === 'missions.invalidated') load() }), invalidated = client.onInvalidated?.(load)
    return () => { current = false; clearInterval(poll); unsubscribe?.(); invalidated?.() }
  }, [client, notifyError])
  async function retry(workspace: MissionWorkspace) {
    setBusy(workspace.id); setError('')
    try {
      await client.request('missions.cleanup.retry', { workspaceId: workspace.id })
      const next = await client.request<MissionWorkspace[]>('missions.cleanup.list')
      previousStates.current = new Map(next.map(row => [row.id, row.state]))
      setRows(next)
    } catch (error) { setError(missionError(error)) } finally { setBusy(null) }
  }
  return <>{(rows.length > 0 || error) && <div className="mission-cleanup-notice"><button onClick={() => setOpen(true)}>{error ? '工作区清理状态暂不可用' : `${rows.length} 个工作区待清理`}</button></div>}
    {open && <CompactDialog title="工作区清理" className="mission-cleanup-list" onClose={() => setOpen(false)}>{error && <p role="alert">{error}</p>}{rows.map(row => {
      const branchOnly = row.cleanupWorktreeRemoved && !row.cleanupBranchRemoved
      return <section key={row.id}><div><code>{row.worktreePath}</code><small>受管分支：{row.managedBranch}</small><small>Worktree：{row.cleanupWorktreeRemoved ? '已清理' : '待清理'} · 本地分支：{row.cleanupBranchRemoved ? '已清理' : '待清理'}</small></div>
        {row.state === 'cleanup_pending' && <p role="status">{branchOnly ? '正在清理本地分支…' : '正在清理 Worktree…'}</p>}
        {row.diagnostic && <><p className="mission-cleanup-failure-title" role="alert">{branchOnly ? '分支清理失败' : 'Worktree 清理失败'}</p><p>{row.diagnostic}</p></>}
        {row.state === 'cleanup_failed' && <button className="compact-cancel" onClick={() => void retry(row)} disabled={busy !== null}>{busy === row.id ? '正在安排重试…' : '重试未完成步骤'}</button>}
      </section>
    })}{!rows.length && !error && <p role="status">工作区已清理完成。</p>}</CompactDialog>}
  </>
}

export function MissionIntro({ mission: m, projects }: { mission: MissionRecord; projects: ProjectNavigationGroup[] }) {
  const actions = useMissionActions(), [expanded, setExpanded] = useState(false), [canExpand, setCanExpand] = useState(false), [attachmentError, setAttachmentError] = useState('')
  const description = useRef<HTMLParagraphElement>(null)
  const starting = actions.busyId === m.missionId
  useLayoutEffect(() => {
    const node = description.current
    if (!node) return
    const measure = () => {
      // Compare the natural content height against the three-line reading limit.
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight)
      setCanExpand(node.scrollHeight > lineHeight * 3 + 1)
    }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(node)
    return () => observer.disconnect()
  }, [m.description])
  return <>
    <section className="mission-intro" aria-label="会话使命">
      <div className="mission-intro-top"><span><MissionIcon/>使命</span><span className="mission-status-readonly"><StatusIcon status={m.status}/>{statuses.find(s => s.id === m.status)?.label}</span></div>
      <h2>{m.title}</h2>{m.description && <p ref={description} className={`mission-description${expanded ? ' expanded' : ''}`}>{m.description}</p>}
      {canExpand && <button className="mission-description-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '收起描述' : '展开描述'}<Icon name="chevron"/></button>}
      {!!m.attachments.length && <ComposerAttachmentStrip ariaLabel="使命附件，使用左右方向键浏览">
        {m.attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} locator={{owner:'mission', campId:m.campId, missionId:m.missionId, attachmentRefId:attachment.id}} presentation="composer" onNotify={setAttachmentError}/>) }
      </ComposerAttachmentStrip>}
      {attachmentError && <p className="compact-inline-error mission-intro-attachment-error" role="alert">{attachmentError}</p>}
      <div className="mission-project-tags"><span className="mission-card-project" title={displayProjectPath(m.projectPath)}><NavigationIcon name="folder-open"/>{missionProject(m, projects)}</span><MissionTags tags={m.tags}/></div>
      <div className="mission-intro-meta"><MissionAvatars m={m}/></div>
    </section>
    {m.status === 'not_started' && m.startAvailable && !actions.startAccepted(m.missionId) && <div className="mission-start-row"><button className="mission-new mission-start" disabled={starting} aria-busy={starting} onClick={() => actions.start(m)}><Icon name="play"/>{starting ? '正在开始…' : '开始使命'}</button></div>}
  </>
}
