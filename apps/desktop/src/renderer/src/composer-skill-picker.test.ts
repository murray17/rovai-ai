import { describe, expect, it } from 'vitest'
import type { SkillDeliveryGroupView, SkillView } from '@contracts'
import { availableComposerSkillsForLead } from './composer-skill-picker'

function skill(
  name: string,
  overrides: Partial<SkillView> = {}
): SkillView {
  const id = `skill-${name}`
  const revisionId = `revision-${name}`
  return {
    id,
    name,
    origin: 'official',
    managementPolicy: 'user_managed',
    enabled: true,
    lifecycleStatus: 'active',
    currentRevision: {
      id: revisionId,
      skillId: id,
      revision: 1,
      name,
      description: `${name} description`,
      sourceType: 'bundled',
      contentDigest: `sha256:${name}`,
      sourceMetadata: {},
      riskSummary: {
        executableFileCount: 0,
        scriptFileCount: 0,
        binaryCandidateCount: 0,
        declaredTools: []
      },
      fileCount: 1,
      totalBytes: 100,
      installedAt: '2026-08-11T00:00:00Z'
    },
    groupAssignments: [{
      groupKey: 'codex',
      revisionId,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z'
    }],
    version: 1,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    deletionRequestedAt: null,
    ...overrides
  }
}

const groups: SkillDeliveryGroupView[] = [{
  key: 'codex',
  label: 'Codex',
  relativePath: '.codex/skills',
  adapterKinds: ['codex-cli'],
  verification: 'verified',
  members: [{
    agentId: 'lead-agent',
    displayName: 'Lead',
    avatarRef: null,
    accent: null
  }]
}, {
  key: 'opencode',
  label: 'OpenCode',
  relativePath: '.config/opencode/skills',
  adapterKinds: ['opencode-cli'],
  verification: 'verified',
  members: []
}]

describe('Composer Skill picker catalog', () => {
  it('only exposes active current-revision Skills delivered to the current Lead group', () => {
    const available = skill('available')
    const disabled = skill('disabled', { enabled: false })
    const deleting = skill('deleting', { lifecycleStatus: 'deleting' })
    const otherGroup = skill('other-group')
    otherGroup.groupAssignments = [{
      ...otherGroup.groupAssignments[0],
      groupKey: 'opencode'
    }]
    const staleRevision = skill('stale-revision')
    staleRevision.groupAssignments = [{
      ...staleRevision.groupAssignments[0],
      revisionId: 'revision-before-current'
    }]

    expect(availableComposerSkillsForLead(
      [available, disabled, deleting, otherGroup, staleRevision],
      groups,
      'lead-agent'
    )).toEqual([{
      id: available.id,
      name: 'available',
      description: 'available description',
      origin: 'official'
    }])
  })

  it('returns no candidates without an exact current Lead identity', () => {
    expect(availableComposerSkillsForLead([skill('available')], groups, null)).toEqual([])
    expect(availableComposerSkillsForLead([skill('available')], groups, 'other-agent')).toEqual([])
  })
})
