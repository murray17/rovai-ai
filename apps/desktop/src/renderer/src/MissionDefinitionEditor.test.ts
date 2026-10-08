import { describe, expect, it } from 'vitest'
import { missionAttachmentDrafts, missionLocalAttachmentView, type MissionDraftAttachment } from './MissionDefinitionEditor'
import { attachmentFormatLabel } from './attachment-presentation'
import type { AgentProfile, MissionDescriptionContent } from '@contracts'
import { missionContentFromDocument, missionDescriptionContent, missionDescriptionDocument, missionDescriptionText, missionMentionIds, unavailableMissionMentionIds } from './mission-description'

describe('Mission description identity and repair', () => {
  it('round-trips ordered identities and literal @ text while resolving current names', () => {
    const content: MissionDescriptionContent = [
      { kind: 'text', text: '请 @手写名字 与 ' },
      { kind: 'member_mention', agentId: 'alice' },
      { kind: 'text', text: '\n复核：' },
      { kind: 'member_mention', agentId: 'alice' }
    ]
    expect(missionContentFromDocument(missionDescriptionDocument(content))).toEqual(content)
    expect(missionMentionIds(content)).toEqual(['alice'])
    expect(missionDescriptionText(content, [{ agentId: 'alice', displayName: '新名字' }])).toBe('请 @手写名字 与 @新名字\n复核：@新名字')
    expect(missionMentionIds(missionDescriptionContent('@新名字'))).toEqual([])
  })

  it('allows active away references and requires unavailable references to be removed', () => {
    const content: MissionDescriptionContent = ['present', 'away', 'removed', 'missing']
      .map(agentId => ({ kind: 'member_mention', agentId }))
    const agents = ['present', 'away', 'removed'].map(presence => ({ agentId: presence, presence })) as AgentProfile[]
    expect(unavailableMissionMentionIds(content, agents, ['away'])).toEqual(['removed', 'missing'])
    expect(unavailableMissionMentionIds(content, agents, [])).toEqual(['away', 'removed', 'missing'])
    expect(unavailableMissionMentionIds(content, agents, ['away'], ['present'])).toEqual(['present', 'removed', 'missing'])
    expect(unavailableMissionMentionIds([], agents, [], ['present'])).toEqual([])
  })
})

describe('Mission attachment presentation', () => {
  it('preserves a dragged directory hint for retry and presents it as DIR', () => {
    const file = new File([], '需求资料')
    const attachment: MissionDraftAttachment = {
      kind: 'local',
      id: 'mission-directory',
      file,
      kindHint: 'directory'
    }

    expect(missionAttachmentDrafts([attachment])).toEqual([{
      id: 'mission-directory',
      file,
      kindHint: 'directory'
    }])
    const view = missionLocalAttachmentView(attachment)
    expect(view).toEqual({
      id: 'mission-directory',
      displayName: '需求资料',
      kind: 'directory',
      fileCount: null,
      mediaType: 'inode/directory',
      byteSize: null,
      previewKind: 'none',
      availability: 'unknown'
    })
    expect(attachmentFormatLabel(view.displayName, view.kind)).toBe('DIR')
  })
})
