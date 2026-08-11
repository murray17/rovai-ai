import type {
  SkillDeliveryGroupView,
  SkillOrigin,
  SkillView
} from '@contracts'

export interface ComposerSkillOption {
  id: string
  name: string
  description: string
  origin: SkillOrigin
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
