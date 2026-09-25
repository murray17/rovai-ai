import type {
  SkillDeliveryGroupView,
  ComposerSkillCandidates,
  SkillOrigin,
  SkillView
} from '@contracts'

export interface ComposerSkillOption {
  id: string
  name: string
  description: string
  origin: SkillOrigin
  source?: 'toolbox' | 'native'
  sourceScope?: 'user' | 'project'
  entryPath?: string
  memberIds?: string[]
}

export function composerSkillsFromCandidates(candidates: ComposerSkillCandidates): ComposerSkillOption[] {
  return candidates.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    origin: 'official',
    source: skill.source,
    sourceScope: skill.sourceScope,
    entryPath: skill.entryPath,
    memberIds: skill.memberIds
  }))
}

/**
 * The picker reflects configured delivery for the current Lead. It does not
 * claim that a Runtime has already loaded or read the selected Skill.
 */
export function availableComposerSkillsForLead(
  skills: readonly SkillView[],
  groups: readonly SkillDeliveryGroupView[],
  leadAgentId: string | null
): ComposerSkillOption[] {
  if (!leadAgentId) return []

  const leadGroupKeys = new Set(groups
    .filter((group) => group.members.some((member) => member.agentId === leadAgentId))
    .map((group) => group.key))

  return skills.flatMap((skill) => {
    const deliveredToLead = skill.groupAssignments.some((assignment) =>
      assignment.revisionId === skill.currentRevision.id
      && leadGroupKeys.has(assignment.groupKey)
    )
    if (!skill.enabled || skill.lifecycleStatus !== 'active' || !deliveredToLead) return []
    return [{
      id: skill.id,
      name: skill.name,
      description: skill.currentRevision.description,
      origin: skill.origin
    }]
  })
}
