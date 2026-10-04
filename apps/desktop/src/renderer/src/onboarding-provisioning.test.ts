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
import { builtinMemberPresetsForLanguage, type BuiltinMemberPreset } from './member-presets'

type InProgress = Extract<OnboardingSnapshot, { status: 'in_progress' }>

describe('first-run provisioning', () => {
  it('retains the selected built-in member, applies adapter defaults, creates a durable Thread, then completes', async () => {
    const events: string[] = []
    const harness = onboardingHarness(events)

    const result = await provisionFirstRun(
      harness.api,
      harness.snapshot,
      [customCodexInstallation(), codexInstallation()]
    )

    expect(result).toMatchObject({
      memberAgentId: 'agent-luoke',
      quickChatThreadId: 'camp-first',
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
      method: 'threads.create',
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
      'request:threads.create',
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

    await provisionFirstRun(harness.api, harness.snapshot, [], () => undefined, 'en')

    expect(harness.requests.map(({ method }) => method)).toEqual(['threads.create'])
    expect(events).toEqual([
      'begin',
      'request:threads.create',
      'checkpoint:camp',
      'commit:camp-first',
      'complete'
    ])
  })

  it('creates the selected English preset once without changing the Thread workflow', async () => {
    const harness = onboardingHarness([], {}, [])
    await provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en')

    const create = harness.requests.find(({ method }) => method === 'members.create')
    expect(create?.params).toMatchObject({
      command: {
        displayName: 'Dingding',
        teamRole: 'Traveling Scholar',
        personalityTraits: ['Curious', 'Adaptable', 'Diligent'],
        avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
      }
    })
    expect(harness.requests.filter(({ method }) => method === 'members.create')).toHaveLength(1)
    expect(harness.requests.find(({ method }) => method === 'threads.create')?.params).toMatchObject({
      name: '初次集结',
      memberAgentIds: ['agent-first']
    })
  })

  it.each(builtinMemberPresetsForLanguage('en'))('initializes the untouched $displayName seed with its English identity', async (preset) => {
    const seed = builtinMember(preset.role)
    const harness = onboardingHarness([], {}, [seed])
    harness.snapshot.selectedMemberRole = preset.role

    const result = await provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en')

    expect(result.memberAgentId).toBe(seed.agentId)
    expect(harness.requests.find(({ method }) => method === 'members.update')?.params).toEqual({
      commandId: 'member-command',
      command: {
        agentId: seed.agentId,
        expectedVersion: seed.version,
        ...identityFor(preset)
      }
    })
    expect(harness.requests.some(({ method }) => method === 'members.create')).toBe(false)
    expect(harness.requests.find(({ method }) => method === 'members.runtime.set')?.params).toMatchObject({
      command: { agentId: seed.agentId, expectedVersion: seed.version + 1 }
    })
  })

  it.each(builtinMemberPresetsForLanguage('en'))('initializes all four seeds when $displayName is selected', async (selected) => {
    const members = builtinMemberPresetsForLanguage('zh-CN').map((preset) => builtinMember(preset.role))
    const harness = onboardingHarness([], {}, members)
    harness.snapshot.selectedMemberRole = selected.role

    const result = await provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en')

    const updates = harness.requests.filter(({ method }) => method === 'members.update')
    expect(updates).toHaveLength(4)
    for (const preset of builtinMemberPresetsForLanguage('en')) {
      const member = members.find((candidate) => candidate.avatarRef === preset.avatarRef)!
      expect(updates).toContainEqual({
        method: 'members.update',
        params: {
          commandId: preset.role === selected.role ? 'member-command' : `member-command:seed:${member.agentId}`,
          command: { agentId: member.agentId, expectedVersion: member.version, ...identityFor(preset) }
        }
      })
    }
    const selectedMember = members.find((member) => member.avatarRef === selected.avatarRef)!
    expect(result.memberAgentId).toBe(selectedMember.agentId)
    expect(harness.requests.filter(({ method }) => method === 'members.runtime.set')).toEqual([{
      method: 'members.runtime.set',
      params: {
        commandId: 'runtime-command',
        command: {
          agentId: selectedMember.agentId,
          expectedVersion: selectedMember.version + 1,
          adapterKind: 'codex-cli',
          model: { mode: 'runtime_default' },
          permissions: codexPermissions()
        }
      }
    }])
    expect(harness.requests.find(({ method }) => method === 'threads.create')?.params).toMatchObject({
      memberAgentIds: [selectedMember.agentId], defaultLeadAgentId: selectedMember.agentId
    })
  })

  it('preserves edited, configured and removed unselected profiles', async () => {
    const edited = { ...builtinMember('muwa'), displayName: 'My teammate' }
    const configured = { ...builtinMember('mianzhi'), runtimeConfiguration: {
      adapterKind: 'codex-cli' as const, model: { mode: 'runtime_default' as const }, permissions: codexPermissions()
    } }
    const removed = { ...builtinMember('qilu'), presence: 'removed' as const, removedAt: '2026-09-30T00:00:00Z' }
    const harness = onboardingHarness([], {}, [builtinMember(), edited, configured, removed])

    await provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en')

    expect(harness.requests.filter(({ method }) => method === 'members.update')).toHaveLength(1)
    expect(harness.requests.find(({ method }) => method === 'members.update')?.params).toMatchObject({
      command: { agentId: 'agent-luoke' }
    })
  })

  it('recovers a partial four-seed initialization without repeating committed writes', async () => {
    const members = builtinMemberPresetsForLanguage('zh-CN').map((preset) => builtinMember(preset.role))
    const selectedMember = members[3]
    const harness = onboardingHarness([], {}, members)
    harness.snapshot.selectedMemberRole = 'qilu'
    const request = harness.api.request.bind(harness.api)
    let updates = 0
    harness.api.request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      const result = await request<T>(method, params)
      if (method === 'members.update') {
        const { command } = params as { command: { agentId: string } }
        const member = members.find((candidate) => candidate.agentId === command.agentId)!
        const preset = builtinMemberPresetsForLanguage('en').find((candidate) => candidate.avatarRef === member.avatarRef)!
        Object.assign(member, identityFor(preset), { version: member.version + 1 })
        if (++updates === 2) throw new Error('reply lost after second seed commit')
      }
      return result
    }

    await expect(provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en'))
      .rejects.toThrow('reply lost after second seed commit')
    expect((harness.current() as InProgress).provisioning?.memberAgentId).toBeNull()

    await provisionFirstRun(harness.api, harness.current() as InProgress, [], () => undefined, 'en')

    expect(updates).toBe(4)
    expect(members.map((member) => member.displayName)).toEqual(['Dingding', 'Cheese', 'Gugu', 'Bunny'])
    expect(harness.requests.find(({ method }) => method === 'members.runtime.set')?.params).toMatchObject({
      command: { agentId: selectedMember.agentId, expectedVersion: selectedMember.version }
    })
  })

  it.each([
    { displayName: 'My teammate' },
    { teamRole: 'My role' },
    { professionalResponsibilities: 'My responsibilities' },
    { personalityTraits: ['My trait'] },
    { workingPrinciples: 'My principles' },
    { growthTopic: 'My focus' },
    { runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'runtime_default' }, permissions: codexPermissions() } }
  ] satisfies Partial<AgentProfile>[])('preserves an existing profile with changes %j', async (patch) => {
    const seed = { ...builtinMember(), ...patch }
    const harness = onboardingHarness([], {}, [seed])

    const result = await provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en')

    expect(result.memberAgentId).toBe(seed.agentId)
    expect(harness.requests.map(({ method }) => method)).toEqual(['members.list', 'members.runtime.set', 'threads.create'])
  })

  it('recovers an identity commit before its checkpoint without repeating the update', async () => {
    const seed = builtinMember()
    const harness = onboardingHarness([], {}, [seed])
    const request = harness.api.request.bind(harness.api)
    const preset = builtinMemberPresetsForLanguage('en')[0]
    harness.api.request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      const result = await request<T>(method, params)
      if (method === 'members.update') {
        Object.assign(seed, identityFor(preset), { version: seed.version + 1 })
        throw new Error('reply lost after commit')
      }
      return result
    }

    await expect(provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en'))
      .rejects.toThrow('reply lost after commit')
    expect((harness.current() as InProgress).provisioning?.memberAgentId).toBeNull()
    harness.api.request = request

    await provisionFirstRun(harness.api, harness.current() as InProgress, [], () => undefined, 'en')

    expect(harness.requests.filter(({ method }) => method === 'members.update')).toHaveLength(1)
    expect(harness.requests.some(({ method }) => method === 'members.create')).toBe(false)
    expect(harness.requests.find(({ method }) => method === 'members.runtime.set')?.params).toMatchObject({
      command: { agentId: seed.agentId, expectedVersion: seed.version }
    })
  })

  it('stops before Runtime configuration when the seed identity update conflicts', async () => {
    const harness = onboardingHarness([])
    const request = harness.api.request.bind(harness.api)
    harness.api.request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      const result = await request<StoredCommandResult>(method, params)
      return (method === 'members.update'
        ? { ...result, status: 'rejected', code: 'agent_profile.version_conflict' }
        : result) as T
    }

    await expect(provisionFirstRun(harness.api, harness.snapshot, [codexInstallation()], () => undefined, 'en'))
      .rejects.toThrow('agent_profile.version_conflict')
    expect(harness.requests.map(({ method }) => method)).toEqual(['members.list', 'members.update'])
    expect((harness.current() as InProgress).provisioning?.memberAgentId).toBeNull()
  })

  it('does not mark training complete until the fourth-page location is restorable', async () => {
    const events: string[] = []
    const harness = onboardingHarness(events, {
      memberAgentId: 'agent-first',
      memberVersionBeforeRuntime: 1,
      memberVersionAfterRuntime: 2,
      quickChatThreadId: 'camp-first'
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
  checkpoints: Partial<OnboardingProvisioningOperation> = {},
  members: AgentProfile[] = [builtinMember()]
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
    quickChatThreadId: null,
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
    provisioning: checkpoints.memberAgentId || checkpoints.quickChatThreadId ? operation : null
  }
  const snapshot = current as InProgress
  const requests: Array<{ method: CoreMethod; params: unknown }> = []
  const api: OnboardingProvisioningApi = {
    async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
      requests.push({ method, params })
      events.push(`request:${method}`)
      if (method === 'members.list') return members as T
      const command = (params as { command: { agentId: string; expectedVersion: number } })?.command
      const result = method === 'members.create'
        ? commandResult(method, { agentId: 'agent-first', version: 1 }, 'agent_profile', 'agent-first')
        : method === 'members.runtime.set' || method === 'members.update'
          ? commandResult(method, { agentId: command.agentId, version: command.expectedVersion + 1 }, 'agent_profile', command.agentId)
          : commandResult(method, { threadId: 'camp-first' }, 'camp', 'camp-first')
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
      async recordProvisionedThread(threadId): Promise<OnboardingSnapshot> {
        events.push('checkpoint:camp')
        current = updateOperation(current, { quickChatThreadId: threadId })
        return current
      },
      async complete(): Promise<OnboardingSnapshot> {
        events.push('complete')
        if (current.status !== 'in_progress' || !current.provisioning?.memberAgentId || !current.provisioning.quickChatThreadId) {
          throw new Error('incomplete')
        }
        current = {
          schemaVersion: 2,
          status: 'completed',
          origin: 'onboarding',
          completedAt: '2026-08-17T00:00:00.000Z',
          selectedMemberRole: current.selectedMemberRole,
          memberAgentId: current.provisioning.memberAgentId,
          quickChatThreadId: current.provisioning.quickChatThreadId
        }
        return current
      }
    },
    desktopSession: {
      async commitRestorableLocation(location): Promise<void> {
        events.push(`commit:${location.kind === 'camp' ? location.threadId : location.kind}`)
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

function identityFor(preset: BuiltinMemberPreset) {
  return {
    displayName: preset.displayName,
    teamRole: preset.teamRole,
    professionalResponsibilities: preset.professionalResponsibilities,
    personalityTraits: preset.personalityTraits,
    workingPrinciples: preset.workingPrinciples,
    growthTopic: preset.growthTopic
  }
}

function builtinMember(role: BuiltinMemberPreset['role'] = 'luoke'): AgentProfile {
  const preset = builtinMemberPresetsForLanguage('zh-CN').find((candidate) => candidate.role === role)!
  return {
    ...identityFor(preset),
    agentId: `agent-${role}`,
    avatarRef: preset.avatarRef,
    accent: preset.accentSample,
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
