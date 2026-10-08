import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { AgentProfile, MissionDescriptionContent } from '@contracts'
import { StructuredMentionComposer, type StructuredMentionComposerHandle } from './StructuredMentionComposer'
import { missionContentFromDocument, missionDescriptionDocument, missionMentionIds } from './mission-description'
import { uiAttribute } from './interface-language'

export type MissionDescriptionComposerHandle = { startMention(): void; flush(): Promise<MissionDescriptionContent> }

export const MissionDescriptionComposer = forwardRef<MissionDescriptionComposerHandle, {
  content: MissionDescriptionContent
  agents: AgentProfile[]
  memberAgentIds: string[]
  unavailableAgentIds?: readonly string[]
  disabled: boolean
  identity: string
  onChange(content: MissionDescriptionContent): void
  onPasteFiles(files: File[]): void
}>(function MissionDescriptionComposer({ content, agents, memberAgentIds, unavailableAgentIds, disabled, identity, onChange, onPasteFiles }, ref) {
  const composer = useRef<StructuredMentionComposerHandle>(null)
  const local = useRef(content)
  useEffect(() => {
    if (JSON.stringify(local.current) === JSON.stringify(content)) return
    local.current = content
    composer.current?.replaceDocument(missionDescriptionDocument(content))
  }, [content])
  const members = useMemo(() => agents.map(agent => ({
    agentId: agent.agentId, displayName: agent.displayName, teamRole: agent.teamRole, avatarRef: agent.avatarRef,
    inThread: memberAgentIds.includes(agent.agentId),
    mentionable: !unavailableAgentIds?.includes(agent.agentId) && (agent.presence === 'present' || agent.presence === 'away' && memberAgentIds.includes(agent.agentId))
  })), [agents, memberAgentIds, unavailableAgentIds])
  useImperativeHandle(ref, () => ({
    startMention: () => composer.current?.startMention(),
    flush: async () => composer.current ? missionContentFromDocument((await composer.current.flush()).document) : local.current
  }), [])
  return <StructuredMentionComposer ref={composer} purpose="mission" id="mission-editor-description"
    draftIdentity={identity} document={missionDescriptionDocument(content)} members={members}
    pendingInviteIds={missionMentionIds(content).filter(id => !memberAgentIds.includes(id))}
    className="mission-editor-description" disabled={disabled} ariaLabel={uiAttribute('使命描述')}
    placeholder={uiAttribute('告诉队员，这次要完成什么…')} onSubmit={() => {}} onPasteFiles={onPasteFiles}
    onDocumentChange={document => { const next = missionContentFromDocument(document); local.current = next; onChange(next) }} />
})
