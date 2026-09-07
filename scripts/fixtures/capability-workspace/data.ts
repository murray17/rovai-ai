import type { AgentProfile, McpServerView, SkillView } from '@contracts'
export function skillFixture(enabled: boolean): SkillView {
  return {
    id: 'skill-1',
    name: 'skill-one',
    origin: 'official',
    managementPolicy: 'user_managed',
    enabled,
    lifecycleStatus: 'active',
    currentRevision: {
      id: 'revision-1',
      skillId: 'skill-1',
      revision: 1,
      name: 'skill-one',
      description: 'Skill fixture',
      sourceType: 'bundled',
      contentDigest: 'sha256:fixture',
      sourceMetadata: {},
      riskSummary: {
        executableFileCount: 0,
        scriptFileCount: 0,
        binaryCandidateCount: 0,
        declaredTools: []
      },
      fileCount: 1,
      totalBytes: 128,
      installedAt: '2026-08-11T00:00:00Z'
    },
    groupAssignments: [],
    version: 7,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    deletionRequestedAt: null
  }
}

export function agent(index = 0): AgentProfile {
  return {
    agentId: `agent_${index}`,
    displayName: index === 0 ? '沐瓦' : `队员 ${index + 1}`,
    avatarRef: null,
    accent: null,
    teamRole: index === 0 ? '开发者' : '协作者',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration:
      index === 0
        ? {
            adapterKind: 'antigravity-app',
            model: { mode: 'runtime_default' },
            permissions: { adapterKind: 'antigravity-app', schemaVersion: 1, values: {} }
          }
        : null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: index,
    version: 1,
    createdAt: '2026-07-24T00:00:00Z',
    updatedAt: '2026-07-24T00:00:00Z',
    removedAt: null
  }
}

export function server(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    serverId: '0241f33e-6ea5-4468-9f55-b048ffbbfdbf',
    transport: 'stdio',
    name: 'docs',
    endpoint: 'node server.mjs',
    enabled: true,
    assignedAgentIds: ['agent_0'],
    source: 'user',
    riskLevel: 'standard',
    riskAcknowledged: false,
    definitionJson: '{"mcpServers":{"docs":{"command":"node"}}}',
    ...overrides
  }
}
