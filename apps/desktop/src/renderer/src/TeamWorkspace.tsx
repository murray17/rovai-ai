import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, NewConversationDefaults, SaveTeamCommand, StoredCommandResult, Team } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { useThreadClient } from './camp-client'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { MemberRosterLayout, useMemberRosterLayout } from './MemberRosterLayout'
import { TeamGlyph } from './MissionDefinitionEditor'
import { TeamMemberPicker } from './TeamPicker'
import { MobileBack, useMobileLayout } from './MobileLayout'
import { AppDialogContent, AppDialogHeader, AppDialogFooter, DialogControlIcon } from './AppDialog'
import { readErrorMessage } from './error-message'
import { uiAttribute } from './interface-language'
import './Teams.css'

type Draft = SaveTeamCommand
export type TeamLeaveGuard = () => Promise<boolean>
const blank = (): Draft => ({ teamId: null, expectedVersion: null, name: '', guidance: '', memberAgentIds: [], defaultLeadAgentId: '' })
const draftOf = (team: Team): Draft => ({ teamId: team.id, expectedVersion: team.version, name: team.name, guidance: team.guidance, memberAgentIds: [...team.memberAgentIds], defaultLeadAgentId: team.defaultLeadAgentId })

export function TeamWorkspace({ teams, agents, loading, loadError, defaultTeamId, customDefaults, refresh, onNewConversation, onLeaveGuardChange }: {
  teams: Team[]; agents: AgentProfile[]; loading: boolean; loadError: string | null;
  defaultTeamId: string | null; customDefaults: NewConversationDefaults | null;
  refresh(): Promise<Team[]>; onNewConversation(team: Team): void; onLeaveGuardChange(guard: TeamLeaveGuard | null): void
}): React.JSX.Element {
  const client = useThreadClient()
  const mobile = useMobileLayout()
  const [base, setBase] = useState<Team | null>(teams[0] ?? null)
  const baseRef = useRef(base)
  const [draft, setDraft] = useState<Draft | null>(teams[0] ? draftOf(teams[0]) : null)
  const [detail, setDetail] = useState(false)
  const [guidanceOpen, setGuidanceOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null)
  const decision = useRef<((allowed: boolean) => void) | null>(null)
  const guardPromise = useRef<Promise<boolean> | null>(null)
  const pending = useRef<{ commandId: string; method: 'teams.save' | 'teams.delete'; command: unknown } | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const guidanceInput = useRef<HTMLTextAreaElement>(null)
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base ? draftOf(base) : blank())
  const frozen = busy || pending.current !== null
  const selected = base && teams.find(team => team.id === base.id)
  const changedElsewhere = base && (!selected || selected.version > base.version)
  const select = (team: Team | null): void => {
    // A pending/stale list cannot replace a newer, confirmed save receipt.
    const current = baseRef.current
    if (current && team?.id === current.id && team.version < current.version) team = current
    baseRef.current = team; setBase(team); setDraft(team ? draftOf(team) : null); setDetail(Boolean(team)); setError(null); setSaved(false); setGuidanceOpen(false)
  }
  const create = (roster?: NewConversationDefaults): void => { baseRef.current = null; setBase(null); setDraft({ ...blank(), ...roster }); setDetail(true); setError(null); setSaved(false); setGuidanceOpen(false); requestAnimationFrame(() => nameInput.current?.focus()) }
  const change = (patch: Partial<Draft>): void => { if (!frozen) { setDraft(current => current && ({ ...current, ...patch })); setError(null); setSaved(false) } }

  useEffect(() => { if (!loading && !draft && !base && teams.length) { select(teams[0]); setDetail(false) } }, [loading, teams])
  useEffect(() => { if (guidanceOpen) guidanceInput.current?.focus() }, [guidanceOpen])
  useEffect(() => {
    const guard: TeamLeaveGuard = async () => {
      if (pending.current || busy) return false
      if (!dirty) return true
      if (!guardPromise.current) {
        guardPromise.current = new Promise(resolve => { decision.current = resolve })
        setConfirm('leave')
      }
      return guardPromise.current
    }
    onLeaveGuardChange(guard)
    const unload = (event: BeforeUnloadEvent): void => { if (dirty || pending.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { onLeaveGuardChange(null); window.removeEventListener('beforeunload', unload) }
  }, [dirty, busy, onLeaveGuardChange])
  useEffect(() => () => { decision.current?.(false) }, [])

  const finishDecision = (allowed: boolean): void => {
    setConfirm(null); decision.current?.(allowed); decision.current = null; guardPromise.current = null
  }
  const guardAction = (action: () => void): void => {
    if (frozen) return
    if (!dirty) { action(); return }
    if (!guardPromise.current) { guardPromise.current = new Promise(resolve => { decision.current = resolve }); setConfirm('leave') }
    void guardPromise.current.then(allowed => { if (allowed) action() })
  }
  const guardTeamAction = (action: (team: Team) => void): void => {
    const targetId = base?.id
    guardAction(() => {
      const team = baseRef.current
      if (!team || team.id !== targetId) {
        setError(uiAttribute('团队已更改或不可用，请重新选择。'))
        return
      }
      action(team)
    })
  }
  const mutate = async (method: 'teams.save' | 'teams.delete', command: unknown): Promise<StoredCommandResult | null> => {
    if (busy) return null
    pending.current ??= { method, command, commandId: newCommandId() }
    setBusy(true); setError(null)
    try {
      const operation = pending.current
      const result = await client.request<StoredCommandResult>(operation.method, { commandId: operation.commandId, command: operation.command })
      pending.current = null
      if (result.status === 'rejected') {
        const messages: Record<string, string> = {
          'team.conflict': uiAttribute('团队已在其他地方更改，请重新载入。'),
          'team.invalid': uiAttribute('请检查团队名称、队员、队长和指引长度。'),
          'team.member_unavailable': uiAttribute('所选队员已不可用，请重新选择。')
        }
        setError(messages[result.code] ?? readErrorMessage(result.payload.message ?? result.code))
        void refresh().catch(() => undefined)
        return null
      }
      // The receipt is authoritative even if the following list read fails.
      void refresh().catch(() => undefined)
      return result
    } catch (error) { setError(readErrorMessage(error)); return null }
    finally { setBusy(false) }
  }
  const save = async (): Promise<boolean> => {
    if (!draft) return true
    if (!pending.current && (!draft.name.trim() || Array.from(draft.name.trim()).length > 80 || !draft.memberAgentIds.length || !draft.memberAgentIds.includes(draft.defaultLeadAgentId) || Array.from(draft.guidance.trim()).length > 10000)) {
      setError(uiAttribute('请填写团队名称，选择队员和队长；指引最多 10000 字。')); return false
    }
    const result = await mutate('teams.save', draft)
    if (!result) return false
    const team = result.payload.team as unknown as Team
    select(team); setSaved(true); return true
  }
  const remove = async (): Promise<void> => {
    if (!base) return
    const result = await mutate('teams.delete', { teamId: base.id, expectedVersion: base.version })
    if (result) { select(teams.find(team => team.id !== base.id) ?? null); setConfirm(null) }
  }
  const duplicate = async (source: Team): Promise<void> => {
    const name = uiAttribute('{0} 副本', Array.from(source.name).slice(0, 65).join(''))
    const result = await mutate('teams.save', { ...draftOf(source), teamId: null, expectedVersion: null, name })
    if (result) select(result.payload.team as unknown as Team)
  }
  const discard = (): void => select(teams.find(team => team.id === base?.id) ?? teams[0] ?? null)
  const dialogs = <Dialog.Root open={confirm !== null} onOpenChange={open => { if (!open && !frozen) finishDecision(false) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay"/><AppDialogContent className="team-confirm-dialog" tone={confirm === 'delete' ? 'danger' : 'neutral'}>
    <AppDialogHeader title={confirm === 'delete' ? uiAttribute('删除「{0}」？', base?.name ?? '') : uiAttribute('保存团队更改？')} description={confirm === 'delete' ? (base?.id === defaultTeamId ? uiAttribute('删除后改用自定义配置，并关闭一键创建。已有对话不受影响。') : uiAttribute('已有对话不受影响。')) : uiAttribute('有尚未保存的更改。')}/>
    {error && <p className="compact-inline-error" role="alert">{error}</p>}
    <AppDialogFooter><button type="button" className="quiet-button" disabled={frozen} data-dialog-autofocus onClick={() => finishDecision(false)}>{uiAttribute('取消')}</button>
      {confirm === 'leave' && <button type="button" className="quiet-button" disabled={frozen} onClick={() => { discard(); finishDecision(true) }}>{uiAttribute('放弃更改')}</button>}
      <button type="button" className={confirm === 'delete' ? 'danger-button' : 'primary-button'} disabled={busy} onClick={() => { if (confirm === 'delete') void remove(); else void save().then(ok => { if (ok) finishDecision(true) }) }}>{pending.current ? uiAttribute('重试') : confirm === 'delete' ? uiAttribute('删除团队') : uiAttribute('保存并继续')}</button>
    </AppDialogFooter>
  </AppDialogContent></Dialog.Portal></Dialog.Root>

  if (loading && !teams.length && !draft) return <div className="team-first-workspace" role="status">{uiAttribute('正在载入团队…')}</div>
  if (!teams.length && !draft) return <div className="team-first-workspace"><section className="mcp-first-connection team-first-connection"><TeamGlyph/><h2>{uiAttribute('创建第一个团队')}</h2><p>{uiAttribute('保存常用队员和协作方式，新对话时直接选用。')}</p>
    {error && <p role="alert">{error}</p>}
    {loadError && <p role="alert">{loadError}<button type="button" onClick={() => void refresh().catch(() => undefined)}>{uiAttribute('重试')}</button></p>}
    <div className="mcp-first-connection-actions"><button type="button" onClick={() => create()}><DialogControlIcon name="plus"/><span><strong>{uiAttribute('添加团队')}</strong><small>{uiAttribute('从空白团队开始')}</small></span><DialogControlIcon name="chevron"/></button>
      {customDefaults && <button type="button" onClick={() => create(customDefaults)}><TeamGlyph/><span><strong>{uiAttribute('从默认配置创建')}</strong><small>{uiAttribute('使用已保存的队员与队长')}</small></span><DialogControlIcon name="chevron"/></button>}
    </div></section></div>
  return <div className="members-workspace team-workspace" data-detail={mobile && detail ? 'true' : undefined}>
    <MemberRosterLayout separatorLabel={uiAttribute('团队列表宽度')}><TeamRoster teams={teams} agents={agents} selectedId={base?.id ?? null} draft={draft} dirty={dirty} defaultTeamId={defaultTeamId} disabled={frozen} onSelect={team => guardAction(() => select(team))} onCreate={() => guardAction(() => create())}/></MemberRosterLayout>
    <section className="members-view member-editor-view team-detail" data-mobile-detail={mobile && detail || undefined}>
      {mobile && detail && <div className="mobile-member-back"><MobileBack label={uiAttribute('返回团队列表')} onClick={() => guardAction(() => setDetail(false))}/><span>{uiAttribute('团队')}</span></div>}
      {draft && <form className="team-editor-form" onSubmit={event => { event.preventDefault(); void save() }}><div className="member-detail-scroll"><div className="member-detail-page">
        <header className="team-detail-header"><div className="team-heading-identity"><TeamPortrait ids={draft.memberAgentIds} agents={agents} large/><div><h1>{base?.name ?? uiAttribute('新团队')}</h1><span>{uiAttribute('{0} 位队员', String(draft.memberAgentIds.length))}{base?.id === defaultTeamId ? ` · ${uiAttribute('默认团队')}` : ''}</span></div></div>
          {base && <div className="team-header-actions"><button type="button" className="team-start-button" disabled={frozen} onClick={() => guardTeamAction(onNewConversation)}><DialogControlIcon name="plus"/>{uiAttribute('新对话')}</button>
            <Menu.Root><Menu.Trigger asChild><button type="button" className="team-overflow" disabled={frozen} aria-label={uiAttribute('团队操作')}><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button></Menu.Trigger><Menu.Portal><Menu.Content className="member-editor-menu team-crud-menu" align="end" sideOffset={6} collisionPadding={12}>
              <Menu.Item className="member-editor-menu-item" onSelect={() => guardTeamAction(team => { void duplicate(team) })}>{uiAttribute('复制团队')}</Menu.Item><Menu.Separator className="member-editor-menu-separator"/><Menu.Item className="member-editor-menu-item member-editor-menu-danger" onSelect={() => setConfirm('delete')}>{uiAttribute('删除团队')}</Menu.Item>
            </Menu.Content></Menu.Portal></Menu.Root>
          </div>}
        </header>
        {changedElsewhere && <p className="team-roster-attention">{uiAttribute('团队已在其他地方更改，请重新载入。')} <button type="button" className="quiet-button" disabled={frozen} onClick={discard}>{uiAttribute('重新载入')}</button></p>}
        <div className="team-editor-content"><label className="member-editor-field"><span className="member-editor-field-label">{uiAttribute('团队名称')}</span><input ref={nameInput} value={draft.name} disabled={frozen} aria-label={uiAttribute('团队名称')} placeholder={uiAttribute('例如：日常开发')} onChange={event => change({ name: Array.from(event.target.value).slice(0, 80).join('') })}/></label>
          <section className="team-guidance-block"><header className="team-section-heading"><h2>{uiAttribute('团队指引')}{!draft.guidance.trim() && <span className="team-guidance-optional">{uiAttribute('可选')}</span>}</h2><button type="button" className="team-guidance-toggle" disabled={frozen} aria-expanded={guidanceOpen} aria-controls="team-guidance-content" onClick={() => setGuidanceOpen(!guidanceOpen)}>{guidanceOpen ? uiAttribute('收起') : draft.guidance.trim() ? uiAttribute('编辑') : uiAttribute('添加')}</button></header>
            <div id="team-guidance-content">{guidanceOpen ? <label className="member-editor-field team-guidance-editor"><textarea ref={guidanceInput} rows={5} aria-label={uiAttribute('团队指引')} disabled={frozen} value={draft.guidance} onChange={event => change({ guidance: event.target.value })} placeholder={uiAttribute('团队共同遵循的协作方式、工作原则…')}/><span className="team-guidance-count" aria-live="polite">{Array.from(draft.guidance.trim()).length} / 10000</span></label> : draft.guidance.trim() && <p className="team-guidance-preview">{draft.guidance}</p>}</div>
          </section>
          <section><header className="team-section-heading"><h2>{uiAttribute('队员')}<span className="team-member-count">{draft.memberAgentIds.length}</span></h2><TeamMemberPicker agents={agents} roster={draft} onChange={change} compact busy={frozen}/></header>
            {draft.memberAgentIds.length ? <ul className="team-member-rows">{draft.memberAgentIds.map(id => {
              const member = agents.find(agent => agent.agentId === id)
              const present = member?.presence === 'present' && member.removedAt === null
              const lead = draft.defaultLeadAgentId === id
              return <li className="team-member-row" key={id}><MemberAvatar agentId={id} avatarRef={member?.avatarRef ?? null} displayName={member?.displayName ?? '?'} size="list" decorative/><div className="team-member-identity"><div className="team-member-name"><strong>{member?.displayName ?? uiAttribute('已移除队员')}</strong>{lead && <span className="team-lead-badge">{uiAttribute('队长')}</span>}{!present && <span className="team-member-attention">{uiAttribute('当前不可用')}</span>}</div><span className="team-member-role">{member?.teamRole ?? id}</span></div>
                <div className="team-row-actions">{!lead && <button type="button" className="team-row-action" disabled={frozen || !present} aria-label={uiAttribute('设 {0} 为队长', member?.displayName ?? id)} onClick={() => change({ defaultLeadAgentId: id })}><NavigationIcon name="crown"/>{uiAttribute('设为队长')}</button>}
                  <button type="button" className="team-row-action team-row-remove" disabled={frozen} aria-label={uiAttribute('将 {0} 移出团队', member?.displayName ?? id)} onClick={() => { const ids = draft.memberAgentIds.filter(member => member !== id); change({ memberAgentIds: ids, defaultLeadAgentId: lead ? ids[0] ?? '' : draft.defaultLeadAgentId }) }}><RemoveTeamMemberIcon/>{uiAttribute('移出团队')}</button></div>
              </li>
            })}</ul> : <div className="team-roster-empty">{uiAttribute('添加队员，组建你的团队。')}</div>}
          </section>
        </div>
      </div></div><footer className="team-save-bar"><div className="team-save-bar-inner">{(error || loadError) && <p className="compact-inline-error" role="alert">{error || loadError}</p>}<div className="member-editor-save-row"><span className="member-editor-save-status" role="status">{dirty ? uiAttribute('有未保存更改') : saved ? uiAttribute('已保存') : ''}{loading && <>{dirty || saved ? ' · ' : ''}{uiAttribute('正在载入团队…')}</>}</span><div><button type="button" className="member-editor-cancel" disabled={frozen} onClick={discard}>{base ? uiAttribute('放弃更改') : uiAttribute('取消')}</button><button type="submit" className="member-editor-primary member-editor-save" disabled={busy || (!dirty && !pending.current)}>{pending.current ? uiAttribute('重试') : uiAttribute('保存')}</button></div></div></div></footer></form>}
    </section>{dialogs}
  </div>
}

function RemoveTeamMemberIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8.5" cy="7.5" r="3.5"/><path d="M2 20v-2a6.5 6.5 0 0 1 13 0v2M17 10h5"/></svg>
}

function TeamPortrait({ ids, agents, large = false }: { ids: string[]; agents: AgentProfile[]; large?: boolean }): React.JSX.Element {
  return <span className={`team-portrait${large ? ' is-large' : ''}`} aria-hidden="true">{ids.length ? <>{ids.slice(0, ids.length > 4 ? 3 : 4).map(id => { const agent = agents.find(agent => agent.agentId === id); return <MemberAvatar key={id} agentId={id} avatarRef={agent?.avatarRef ?? null} displayName={agent?.displayName ?? '?'} size="mention" decorative/> })}{ids.length > 4 && <span className="team-portrait-overflow">+{ids.length - 3}</span>}</> : <TeamGlyph/>}</span>
}

function TeamRoster({ teams, agents, selectedId, draft, dirty, defaultTeamId, disabled, onSelect, onCreate }: {
  teams: Team[]; agents: AgentProfile[]; selectedId: string | null; draft: Draft | null; dirty: boolean; defaultTeamId: string | null; disabled: boolean; onSelect(team: Team): void; onCreate(): void
}): React.JSX.Element {
  const { collapsed, id } = useMemberRosterLayout()
  const [query, setQuery] = useState('')
  const filtered = teams.filter(team => team.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <section className={`member-sidebar team-sidebar${collapsed ? ' is-collapsed' : ''}`} id={id} aria-label={uiAttribute('团队列表')}><header className="member-sidebar-heading"><div className="member-sidebar-title"><strong>{uiAttribute('团队')}</strong><span>{teams.length}</span></div><div className="member-sidebar-actions"><button type="button" className="team-add" aria-label={uiAttribute('添加团队')} disabled={disabled} onClick={onCreate}><DialogControlIcon name="plus"/><span>{uiAttribute('添加')}</span></button></div></header>
    {teams.length > 8 && !collapsed && <div className="member-sidebar-filter"><input aria-label={uiAttribute('搜索团队')} placeholder={uiAttribute('搜索团队')} value={query} onChange={event => setQuery(event.target.value)}/></div>}
    <div className="team-list">{filtered.map(team => <button type="button" key={team.id} className={`team-list-row${team.id === selectedId ? ' is-selected' : ''}`} aria-current={team.id === selectedId ? 'true' : undefined} title={team.name} disabled={disabled} onClick={() => onSelect(team)}><TeamPortrait ids={team.memberAgentIds} agents={agents}/><span className="team-list-copy"><span className="team-list-name">{team.name}{team.id === defaultTeamId && <span className="team-default-badge">{uiAttribute('默认')}</span>}{team.id === selectedId && dirty && <span className="team-dirty-dot"/>}</span><small>{uiAttribute('{0} 位队员 · 队长 {1}', String(team.memberAgentIds.length), agents.find(agent => agent.agentId === team.defaultLeadAgentId)?.displayName ?? uiAttribute('不可用'))}</small></span></button>)}
      {draft && !selectedId && <div className="team-list-row is-selected"><TeamPortrait ids={draft.memberAgentIds} agents={agents}/><span className="team-list-copy"><span className="team-list-name">{draft.name || uiAttribute('新团队')}</span><small>{uiAttribute('未保存')}</small></span></div>}
      {!filtered.length && teams.length > 0 && <div className="team-list-empty">{uiAttribute('没有匹配的团队')}</div>}
    </div>
  </section>
}
