import { describe, expect, it, vi } from 'vitest'
import type {
  AdapterInstallation,
  AdapterPermissionConfig,
  AgentProfile,
  CoreMethod,
  OnboardingProvisioningOperation,
  OnboardingSnapshot,
  StoredCommandResult
} from '@contracts'
import {
  FIRST_RUN_CAMP_TITLE,
  provisionFirstRun,
  type OnboardingProvisioningApi
} from './onboarding-provisioning'

type InProgress = Extract<OnboardingSnapshot, { status: 'in_progress' }>

describe('first-run provisioning', () => {
  it('retains the selected built-in member, applies adapter defaults, creates a durable Camp, then completes', async () => {
    const events: string[] = []
    const harness = onboardingHarness(events)

    const result = await provisionFirstRun(
      harness.api,
      harness.snapshot,
      [customCodexInstallation(), codexInstallation()]
    )

    expect(result).toMatchObject({
      memberAgentId: 'agent-luoke',
      quickChatCampId: 'camp-first',
      snapshot: {
        status: 'completed',
        origin: 'onboarding',
        selectedMemberRole: 'luoke'
      }
    })
    expect(harness.requests).toHaveLength(3)
    expect(harness.requests[0]).toEqual({ method: 'members.list', params: undefined })
    expect(harness.requests[1]).toEqual({
      method: 'members.runtime.set',
      params: {
        commandId: 'runtime-command',
        command: {
          agentId: 'agent-luoke',
          expectedVersion: 4,
          adapterKind: 'codex-cli',
          model: { mode: 'runtime_default' },
          permissions: {
            adapterKind: 'codex-cli',
            schemaVersion: 7,
            values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' }
          }
        }
      }
    })
    expect(harness.requests[2]).toEqual({
      method: 'camps.create',
      params: {
        commandId: 'camp-command',
        name: FIRST_RUN_CAMP_TITLE,
        workspace: null,
        memberAgentIds: ['agent-luoke'],
        defaultLeadAgentId: 'agent-luoke',
        collaborationMode: 'peer',
        activationState: 'active'
      }
    })
    expect(events).toEqual([
      'begin',
      'request:members.list',
      'checkpoint:member',
      'request:members.runtime.set',
      'checkpoint:runtime',
      'request:camps.create',
      'checkpoint:camp',
      'commit:camp-first',
      'complete'
    ])
  })

  it('resumes from persisted checkpoints without replaying completed stages', async () => {
    const events: string[] = []
    const harness = onboardingHarness(events, {
      memberAgentId: 'agent-first',
      memberVersionBeforeRuntime: 1,
      memberVersionAfterRuntime: 2
    })

    await provisionFirstRun(harness.api, harness.snapshot, [])

    expect(harness.requests.map(({ method }) => method)).toEqual(['camps.create'])
    expect(events).toEqual([
      'begin',
      'request:camps.create',
      'checkpoint:camp',
      'commit:camp-first',
      'complete'
    ])
  })

  it('does not mark training complete until the fourth-page location is restorable', async () => {
    const events: string[] = []
    const harness = onboardingHarness(events, {
      memberAgentId: 'agent-first',
      memberVersionBeforeRuntime: 1,
      memberVersionAfterRuntime: 2,
      quickChatCampId: 'camp-first'
    })
    harness.api.desktopSession.commitRestorableLocation = vi.fn(async () => {
      events.push('commit:failed')
      throw new Error('disk unavailable')
    })

    await expect(
      provisionFirstRun(harness.api, harness.snapshot, [])
    ).rejects.toThrow('disk unavailable')
    expect(events).toEqual(['begin', 'commit:failed'])
    expect(harness.current().status).toBe('in_progress')
  })
})

function onboardingHarness(
  events: string[],
  checkpoints: Partial<OnboardingProvisioningOperation> = {}
): {
  api: OnboardingProvisioningApi
  snapshot: InProgress
  requests: Array<{ method: CoreMethod; params: unknown }>
  current(): OnboardingSnapshot
} {
  const operation: OnboardingProvisioningOperation = {
    memberCommandId: 'member-command',
    runtimeCommandId: 'runtime-command',
    campCommandId: 'camp-command',
    runtimePermissions: codexPermissions(),
    memberAgentId: null,
    memberVersionBeforeRuntime: null,
    memberVersionAfterRuntime: null,
    quickChatCampId: null,
    ...checkpoints
  }
  let current: OnboardingSnapshot = {
    schemaVersion: 2,
    status: 'in_progress',
    step: 'runtime',
    selectedMemberRole: 'luoke',
    runtimeSelection: {
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' }
    },
    provisioning: checkpoints.memberAgentId || checkpoints.quickChatCampId ? operation : null
  }
  const snapshot = current as InProgress
  const requests: Array<{ method: CoreMethod; params: unknown }> = []
  const api: OnboardingProvisioningApi = {
    async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
      requests.push({ method, params })
      events.push(`request:${method}`)
      if (method === 'members.list') return [builtinLuoke()] as T
      const result = method === 'members.create'
        ? commandResult(method, { agentId: 'agent-first', version: 1 }, 'agent_profile', 'agent-first')
        : method === 'members.runtime.set'
          ? commandResult(method, { agentId: 'agent-luoke', version: 5 }, 'agent_profile', 'agent-luoke')
          : commandResult(method, { campId: 'camp-first' }, 'camp', 'camp-first')
      return result as T
    },
    onboarding: {
      async beginProvisioning(_selection, runtimePermissions): Promise<OnboardingSnapshot> {
        events.push('begin')
        if (current.status !== 'in_progress') throw new Error('not in progress')
        if (current.provisioning) {
          expect(runtimePermissions).toEqual(current.provisioning.runtimePermissions)
        }
        current = {
          ...current,
          provisioning: current.provisioning ?? { ...operation, runtimePermissions }
        }
        return current
      },
      async recordProvisionedMember(agentId, version): Promise<OnboardingSnapshot> {
        events.push('checkpoint:member')
        current = updateOperation(current, {
          memberAgentId: agentId,
          memberVersionBeforeRuntime: version
        })
        return current
      },
      async recordProvisionedRuntime(version): Promise<OnboardingSnapshot> {
        events.push('checkpoint:runtime')
        current = updateOperation(current, { memberVersionAfterRuntime: version })
        return current
      },
      async recordProvisionedCamp(campId): Promise<OnboardingSnapshot> {
        events.push('checkpoint:camp')
        current = updateOperation(current, { quickChatCampId: campId })
        return current
      },
      async complete(): Promise<OnboardingSnapshot> {
        events.push('complete')
        if (current.status !== 'in_progress' || !current.provisioning?.memberAgentId || !current.provisioning.quickChatCampId) {
          throw new Error('incomplete')
        }
        current = {
          schemaVersion: 2,
          status: 'completed',
          origin: 'onboarding',
          completedAt: '2026-08-17T00:00:00.000Z',
          selectedMemberRole: 'luoke',
          memberAgentId: current.provisioning.memberAgentId,
          quickChatCampId: current.provisioning.quickChatCampId
        }
        return current
      }
    },
    desktopSession: {
      async commitRestorableLocation(location): Promise<void> {
        events.push(`commit:${location.kind === 'camp' ? location.campId : location.kind}`)
      }
    }
  }
  return { api, snapshot, requests, current: () => current }
}

function updateOperation(
  snapshot: OnboardingSnapshot,
  patch: Partial<OnboardingProvisioningOperation>
): OnboardingSnapshot {
  if (snapshot.status !== 'in_progress' || !snapshot.provisioning) throw new Error('missing operation')
  return {
    ...snapshot,
    provisioning: { ...snapshot.provisioning, ...patch }
  }
}

function commandResult(
  commandType: string,
  payload: Record<string, unknown>,
  entityType: string,
  entityId: string
): StoredCommandResult {
  return {
    commandId: `${commandType}-id`,
    commandType,
    requestDigest: 'digest',
    requestDigestVersion: 1,
    status: 'applied',
    code: `${commandType}.applied`,
    payload,
    resultEntity: { entityType, entityId },
    recordedAt: '2026-08-17T00:00:00.000Z'
  }
}

function codexInstallation(): AdapterInstallation {
  return {
    id: 'managed-codex',
    adapterKind: 'codex-cli',
    executablePath: '/usr/local/bin/codex',
    commandName: 'codex',
    installationClass: 'managed_default',
    source: 'inherited_path',
    authScope: 'default',
    enabled: true,
    generation: 1,
    pathState: 'valid',
    version: 1,
    referencedProfileCount: 0,
    snapshot: null,
    modelCatalog: {
      status: 'unavailable', observedAt: null, revalidateAfter: null, expiresAt: null
    },
    memberRuntimeDefaults: {
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' },
      permissions: codexPermissions()
    },
    lastProbeAttempt: null,
    relocationHistory: [],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z'
  }
}

function codexPermissions(): AdapterPermissionConfig {
  return {
    adapterKind: 'codex-cli',
    schemaVersion: 7,
    values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' }
  }
}

function customCodexInstallation(): AdapterInstallation {
  const managed = codexInstallation()
  return {
    ...managed,
    id: 'custom-codex',
    installationClass: 'custom',
    source: 'custom',
    authScope: 'project',
    memberRuntimeDefaults: {
      ...managed.memberRuntimeDefaults!,
      permissions: {
        adapterKind: 'codex-cli',
        schemaVersion: 99,
        values: { sandbox_mode: 'read-only', approval_policy: 'always' }
      }
    }
  }
}

function builtinLuoke(): AgentProfile {
  return {
    agentId: 'agent-luoke',
    displayName: '叮叮',
    avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
    accent: '#4F7F9F',
    teamRole: '游学者',
    professionalResponsibilities: '负责理解需求。',
    personalityTraits: ['好奇'],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: 0,
    version: 4,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    removedAt: null
  }
}
