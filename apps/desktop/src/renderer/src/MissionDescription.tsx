import * as Popover from '@radix-ui/react-popover'
import type { AgentProfile, MissionRecord } from '@contracts'
import { MemberPortrait } from './MemberPortrait'
import { useMissionPeople } from './MissionControls'
import { missionDescriptionContent } from './mission-description'
import { uiAttribute } from './interface-language'

function MissionMemberReference({ agentId, member, active }: { agentId: string; member?: AgentProfile; active: boolean }) {
  const available = active && member && member.presence !== 'removed'
  const label = `@${member?.displayName ?? uiAttribute('不可用队员')}`
  if (!available) return <span className="message-mention-token is-unavailable" data-agent-id={agentId} title={uiAttribute('该队员已不可用')}>{label}</span>
  return <Popover.Root><Popover.Trigger asChild><span role="button" tabIndex={0} className="message-mention-token is-interactive" data-agent-id={agentId}
    aria-label={uiAttribute('查看{0}的基础信息', member.displayName)} onClick={event => { if (window.getSelection()?.toString()) event.preventDefault() }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click() } }}>{label}</span></Popover.Trigger>
    <Popover.Portal><Popover.Content className="compact-menu mission-member-profile" sideOffset={8} collisionPadding={12} aria-label={member.displayName}>
      <div className="mention-profile-side-shell"><div className="mention-profile-media"><MemberPortrait agentId={agentId} avatarRef={member.avatarRef} displayName={member.displayName} decorative className="mention-profile-portrait"/></div>
        <div className="mention-profile-copy"><header className="mention-profile-header"><h2>{member.displayName}</h2><p>{member.teamRole}</p></header><div className="mention-profile-fields"><p>{member.professionalResponsibilities}</p></div></div></div>
    </Popover.Content></Popover.Portal></Popover.Root>
}

export function MissionDescription({ mission }: { mission: MissionRecord }) {
  const agents = useMissionPeople()
  return <>{missionDescriptionContent(mission.description, mission.descriptionContent).map((segment, index) => segment.kind === 'text'
    ? segment.text
    : <MissionMemberReference key={index} agentId={segment.agentId} member={agents.find(agent => agent.agentId === segment.agentId)} active={mission.memberAgentIds.includes(segment.agentId)}/>)}</>
}
