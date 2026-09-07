import type {
  AgentProfile,
  CreateAgentProfileCommand,
  UpdateAgentProfileCommand
} from '@contracts'

export type IdentityDraft = {
  displayName: string
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  workingPrinciples: string
  growthTopic: string
}

export const EMPTY_IDENTITY: IdentityDraft = {
  displayName: '',
  teamRole: '',
  professionalResponsibilities: '',
  personalityTraits: [],
  workingPrinciples: '',
  growthTopic: ''
}

export function identityCommand(
  draft: IdentityDraft,
  agent: AgentProfile | null
): CreateAgentProfileCommand | UpdateAgentProfileCommand {
  const identity: CreateAgentProfileCommand = {
    displayName: draft.displayName.trim(),
    teamRole: normalizeIdentityTag(draft.teamRole),
    professionalResponsibilities: draft.professionalResponsibilities.trim(),
    personalityTraits: draft.personalityTraits.map(normalizeIdentityTag),
    workingPrinciples: draft.workingPrinciples.trim(),
    growthTopic: draft.growthTopic.trim()
  }
  return agent
    ? { ...identity, agentId: agent.agentId, expectedVersion: agent.version }
    : identity
}

export type IdentityDraftField = keyof IdentityDraft | 'advanced'

export function identityDraftIssue(
  draft: IdentityDraft,
  currentAgentId: string | null,
  agents: Pick<AgentProfile, 'agentId' | 'displayName'>[]
): { field: IdentityDraftField; message: string } | null {
  const displayNameLength = unicodeScalarLength(draft.displayName.trim())
  if (displayNameLength < 1 || displayNameLength > 80) {
    return { field: 'displayName', message: '名称必须为 1–80 个字符。' }
  }
  if (
    hasDuplicateMemberDisplayName(draft.displayName, currentAgentId, agents)
  ) {
    return {
      field: 'displayName',
      message: '该名称已被其他队员使用，请换一个名称。'
    }
  }
  const teamRole = normalizeIdentityTag(draft.teamRole)
  if (
    unicodeScalarLength(teamRole) > 120 ||
    hasControlOrNewline(draft.teamRole)
  ) {
    return {
      field: 'teamRole',
      message: '团队角色最多 120 个字符，且不能包含换行或控制字符。'
    }
  }
  if (unicodeScalarLength(draft.professionalResponsibilities.trim()) > 300) {
    return {
      field: 'professionalResponsibilities',
      message: '专业职责最多 300 个字符。'
    }
  }
  if (
    draft.personalityTraits.length > 6 ||
    draft.personalityTraits.some((trait) => {
      const length = unicodeScalarLength(normalizeIdentityTag(trait))
      return length < 1 || length > 16 || hasControlOrNewline(trait)
    })
  ) {
    return {
      field: 'personalityTraits',
      message: '性格底色最多 6 项，每项必须为 1–16 个字符。'
    }
  }
  if (unicodeScalarLength(draft.workingPrinciples.trim()) > 300) {
    return { field: 'workingPrinciples', message: '工作准则最多 300 个字符。' }
  }
  if (unicodeScalarLength(draft.growthTopic.trim()) > 300) {
    return { field: 'growthTopic', message: '成长课题最多 300 个字符。' }
  }
  return null
}

export function unicodeScalarLength(value: string): number {
  return Array.from(value).length
}

export function hasControlOrNewline(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value)
}

export function normalizeIdentityTag(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function hasDuplicateMemberDisplayName(
  displayName: string,
  currentAgentId: string | null,
  agents: Pick<AgentProfile, 'agentId' | 'displayName'>[]
): boolean {
  const normalized = normalizeMemberDisplayName(displayName)
  return (
    normalized !== '' &&
    agents.some(
      (candidate) =>
        candidate.agentId !== currentAgentId &&
        normalizeMemberDisplayName(candidate.displayName) === normalized
    )
  )
}

function normalizeMemberDisplayName(displayName: string): string {
  return displayName.trim().normalize('NFKC').toLowerCase()
}

export function identityDraftFor(agent: AgentProfile | null): IdentityDraft {
  if (!agent) return { ...EMPTY_IDENTITY, personalityTraits: [] }
  return {
    displayName: agent.displayName,
    teamRole: agent.teamRole,
    professionalResponsibilities: agent.professionalResponsibilities,
    personalityTraits: [...agent.personalityTraits],
    workingPrinciples: agent.workingPrinciples,
    growthTopic: agent.growthTopic
  }
}
