import type { AgentProfile, ComposerDocument, MissionDescriptionContent } from '@contracts'
import { composerDocumentToPlainText, composerDocumentFromLegacyContent } from './composer-document'

export function missionDescriptionContent(text: string, content?: MissionDescriptionContent): MissionDescriptionContent {
  return content ?? (text ? [{ kind: 'text', text }] : [])
}

export function missionDescriptionDocument(content: MissionDescriptionContent): ComposerDocument {
  return composerDocumentFromLegacyContent(content)
}

export function missionContentFromDocument(document: ComposerDocument): MissionDescriptionContent {
  return document.segments.map(segment => {
    if (segment.kind === 'text') return segment
    if (segment.atom.type === 'member') return { kind: 'member_mention', agentId: segment.atom.agentId }
    // Unsupported clipboard atoms remain readable text, never mission identities.
    return { kind: 'text', text: composerDocumentToPlainText({ version: 2, segments: [segment] }) }
  })
}

export function missionDescriptionText(content: MissionDescriptionContent, agents: readonly Pick<AgentProfile, 'agentId' | 'displayName'>[]): string {
  return composerDocumentToPlainText(missionDescriptionDocument(content), agents)
}

export function missionMentionIds(content: MissionDescriptionContent): string[] {
  return [...new Set(content.flatMap(segment => segment.kind === 'member_mention' ? [segment.agentId] : []))]
}

export function unavailableMissionMentionIds(content: MissionDescriptionContent, agents: readonly AgentProfile[], memberAgentIds: readonly string[], rejected: readonly string[] = []): string[] {
  return missionMentionIds(content).filter(id => {
    const member = agents.find(agent => agent.agentId === id)
    return rejected.includes(id) || !member || member.presence === 'removed' || member.presence === 'away' && !memberAgentIds.includes(id)
  })
}
