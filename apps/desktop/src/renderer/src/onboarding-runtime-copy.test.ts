import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentProfile, CoreMethod, OnboardingSnapshot, StoredCommandResult } from '@contracts'
import { OnboardingStore, parseOnboardingSnapshot } from '../../main/onboarding-preferences'
import { builtinMemberPresetsForLanguage } from './member-presets'
import { provisionFirstRun, type OnboardingProvisioningApi } from './onboarding-provisioning'

type InProgress = Extract<OnboardingSnapshot, { status: 'in_progress' }>
const directories: string[] = []
const threadId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const selection = {
  adapterKind: 'codex-cli' as const,
  model: { mode: 'explicit' as const, modelId: 'test-model', options: { reasoning_effort: 'high' } }
}
const permissions = {
  adapterKind: 'codex-cli' as const, schemaVersion: 7,
  values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('first-run Runtime copies with durable Desktop checkpoints', () => {
  it.each(['zh-CN', 'en'] as const)('configures all four %s seeds with one frozen selection and a single-member Thread', async (language) => {
    const h = await harness()
    const versions = h.members.map((member) => member.version)
    await provisionFirstRun(h.api, h.snapshot(), [], () => undefined, language)

    expect(h.writes).toHaveLength(4)
    expect(h.members.map((member) => member.runtimeConfiguration))
      .toEqual(h.members.map(() => ({ ...selection, permissions })))
    expect(h.members.map((member) => member.version))
      .toEqual(versions.map((version) => version + (language === 'en' ? 2 : 1)))
    expect(h.members.map((member) => member.displayName))
      .toEqual(builtinMemberPresetsForLanguage(language).map((preset) => preset.displayName))
    expect(h.requests.find((request) => request.method === 'threads.create')?.params)
      .toMatchObject({ memberAgentIds: ['agent-luoke'], defaultLeadAgentId: 'agent-luoke' })
    expect((await h.restart()).status).toBe('completed')
  })

  it('copies only present unconfigured built-ins and preserves their customized identities', async () => {
    const h = await harness()
    h.members[1].displayName = 'My teammate'
    h.members[2].runtimeConfiguration = { ...selection, model: { mode: 'runtime_default' }, permissions }
    h.members[3].presence = 'removed'
    h.members[3].removedAt = '2026-10-05T00:00:00Z'
    h.members.push({ ...h.members[0], agentId: 'custom', avatarRef: null })
    const original = structuredClone(h.members)

    await provisionFirstRun(h.api, h.snapshot(), [])

    expect(h.writes).toEqual(['agent-luoke', 'agent-muwa'])
    expect(h.members[1].displayName).toBe('My teammate')
    expect(h.members.slice(2)).toEqual(original.slice(2))
  })

  it.each(['command', 'checkpoint'] as const)('recovers a lost %s reply without overwriting later edits or repeating committed writes', async (boundary) => {
    const h = await harness()
    const request = h.api.request
    const checkpoint = h.api.onboarding.recordRuntimeCopy
    let interrupted = false
    h.api.request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      const result = await request<T>(method, params)
      if (boundary === 'command' && method === 'members.runtime.set'
        && (params as { command: { agentId: string } }).command.agentId === 'agent-mianzhi' && !interrupted) {
        interrupted = true
        throw new Error('reply lost')
      }
      return result
    }
    h.api.onboarding.recordRuntimeCopy = async (agentId, commandId, outcome) => {
      const result = await checkpoint(agentId, commandId, outcome)
      if (boundary === 'checkpoint' && agentId === 'agent-mianzhi' && !interrupted) {
        interrupted = true
        throw new Error('reply lost')
      }
      return result
    }
    await expect(provisionFirstRun(h.api, h.snapshot(), [])).rejects.toThrow('reply lost')
    const frozen = h.snapshot().provisioning!.runtimeCopies!
    expect(h.snapshot().status).toBe('in_progress')
    // The user changes even the member whose successful reply was lost.
    for (const member of h.members.slice(1, 3)) {
      member.runtimeConfiguration = { ...selection, model: { mode: 'runtime_default' }, permissions }
      member.version++
    }
    const edited = structuredClone(h.members.slice(1, 3))
    await h.restart()
    expect(h.snapshot().provisioning!.runtimeCopies).toEqual(frozen)
    await provisionFirstRun(h.api, h.snapshot(), [])

    expect(h.writes).toEqual(['agent-luoke', 'agent-muwa', 'agent-mianzhi', 'agent-qilu'])
    expect(h.members.slice(1, 3)).toEqual(edited)
    expect(h.requests.filter((request) => request.method === 'threads.create')).toHaveLength(1)
  })

  it('keeps the durable target plan after its reply is lost and skips later version conflicts', async () => {
    const h = await harness()
    const prepare = h.api.onboarding.prepareRuntimeCopies
    h.api.onboarding.prepareRuntimeCopies = async (targets) => {
      await prepare(targets)
      throw new Error('plan reply lost')
    }
    await expect(provisionFirstRun(h.api, h.snapshot(), [])).rejects.toThrow('plan reply lost')
    const targets = h.snapshot().provisioning!.runtimeCopies!
    h.members[1].version++
    h.members[1].runtimeConfiguration = { ...selection, model: { mode: 'runtime_default' }, permissions }
    h.members[2].presence = 'removed'
    h.members[2].version++
    const edited = structuredClone(h.members.slice(1, 3))
    await h.restart()
    const checkpoints: OnboardingSnapshot[] = []
    await provisionFirstRun(h.api, h.snapshot(), [], (snapshot) => checkpoints.push(snapshot))

    expect(h.writes).toEqual(['agent-luoke', 'agent-qilu'])
    expect(h.members.slice(1, 3)).toEqual(edited)
    const completedCopies = checkpoints.filter((snapshot) => snapshot.status === 'in_progress').at(-1)!
    expect(completedCopies.provisioning!.runtimeCopies).toEqual(targets.map((target, index) => ({
      ...target, status: index < 2 ? 'skipped' : 'applied'
    })))
  })

  it('retries a known rejection with a new durable command but keeps the original target version', async () => {
    const h = await harness()
    h.rejectNext('agent-muwa')
    await expect(provisionFirstRun(h.api, h.snapshot(), [])).rejects.toThrow('runtime_configuration_unavailable')
    const failed = h.requests.filter((request) => request.method === 'members.runtime.set').at(-1)!
    const retry = h.snapshot().provisioning!.runtimeCopies![0]
    expect(retry.commandId).not.toBe(failed.params.commandId)
    expect(retry.expectedVersion).toBe(failed.params.command.expectedVersion)
    await h.restart()
    await provisionFirstRun(h.api, h.snapshot(), [])
    expect(h.writes).toEqual(['agent-luoke', 'agent-muwa', 'agent-mianzhi', 'agent-qilu'])
  })

  it('retains an unknown command when the transport fails before Core receives it', async () => {
    const h = await harness()
    const request = h.api.request
    let failedCommand: unknown
    h.api.request = async <T>(method: CoreMethod, params?: unknown): Promise<T> => {
      if (method === 'members.runtime.set'
        && (params as { command: { agentId: string } }).command.agentId === 'agent-muwa') {
        failedCommand = params
        throw new Error('disconnected')
      }
      return request<T>(method, params)
    }
    await expect(provisionFirstRun(h.api, h.snapshot(), [])).rejects.toThrow('disconnected')
    await h.restart()
    h.api.request = request
    await provisionFirstRun(h.api, h.snapshot(), [])
    expect(h.requests.find((entry) => entry.method === 'members.runtime.set'
      && entry.params.command.agentId === 'agent-muwa')?.params).toEqual(failedCommand)
    expect(h.writes).toHaveLength(4)
  })

  it.each([1, 2])('resumes unfinished schema %s without resetting existing command IDs', async (schemaVersion) => {
    const h = await harness()
    const old = JSON.parse(await readFile(h.file, 'utf8'))
    delete old.provisioning.runtimeCopies
    old.schemaVersion = schemaVersion
    await writeFile(h.file, JSON.stringify(old))
    await h.restart()
    expect(h.snapshot().schemaVersion).toBe(3)
    expect(h.snapshot().provisioning!.runtimeCommandId).toBe(old.provisioning.runtimeCommandId)
    expect(h.snapshot().provisioning!.runtimeCopies).toBeNull()
    await provisionFirstRun(h.api, h.snapshot(), [])
    expect(h.writes).toHaveLength(4)
  })

  it.each(['onboarding', 'runtime_deferred', 'existing_installation'])('never reopens completed %s installations for backfill', async (origin) => {
    const h = await harness()
    const completed = {
      schemaVersion: 2, status: 'completed', origin, completedAt: '2026-10-02T08:00:00Z',
      selectedMemberRole: origin === 'onboarding' ? 'luoke' : null,
      memberAgentId: origin === 'onboarding' ? 'agent-luoke' : null,
      quickChatThreadId: origin === 'onboarding' ? threadId : null
    }
    await writeFile(h.file, JSON.stringify(completed))
    const restored = await h.restart()
    expect(restored).toEqual({ ...completed, schemaVersion: 3 })
    const store = await OnboardingStore.load(h.file)
    expect(await store.initialize(false)).toEqual(restored)
    await expect(store.prepareRuntimeCopies([])).rejects.toThrow('不可修改')
    expect(h.writes).toEqual([])
  })

  it('validates plans, fences stale replies and refuses completion with pending copies', async () => {
    const h = await harness()
    const store = await OnboardingStore.load(h.file)
    await expect(store.prepareRuntimeCopies([])).rejects.toThrow('尚未保存')
    await store.recordProvisionedMember('agent-luoke', 1)
    await store.recordProvisionedRuntime(2)
    await expect(store.recordProvisionedThread(threadId)).rejects.toThrow('尚未完成')
    for (const targets of [
      [{ agentId: 'agent-luoke', expectedVersion: 1 }],
      [{ agentId: 'a', expectedVersion: 0 }],
      [{ agentId: 'a', expectedVersion: 1 }, { agentId: 'a', expectedVersion: 1 }],
      ['a', 'b', 'c', 'd'].map((agentId) => ({ agentId, expectedVersion: 1 }))
    ]) await expect(store.prepareRuntimeCopies(targets)).rejects.toThrow('Invalid')
    const prepared = await store.prepareRuntimeCopies([{ agentId: 'agent-muwa', expectedVersion: 1 }]) as InProgress
    expect(await store.prepareRuntimeCopies([])).toEqual(prepared)
    const target = prepared.provisioning!.runtimeCopies![0]
    await expect(store.recordProvisionedThread(threadId)).rejects.toThrow('尚未完成')
    await expect(store.complete()).rejects.toThrow('尚未完成')
    const retried = await store.recordRuntimeCopy(target.agentId, target.commandId, 'retry') as InProgress
    expect(await store.recordRuntimeCopy(target.agentId, target.commandId, 'applied')).toEqual(retried)
    expect(await store.recordRuntimeCopy(target.agentId, target.commandId, 'retry')).toEqual(retried)
    await store.recordRuntimeCopy(target.agentId, retried.provisioning!.runtimeCopies![0].commandId, 'applied')
    await store.recordProvisionedThread(threadId)
    expect((await store.complete()).status).toBe('completed')

    for (const copies of [
      [{ ...target, status: 'unknown' }], [target, target],
      [{ ...target, expectedVersion: -1 }], [{ ...target, commandId: 'invalid' }],
      [{ ...target, agentId: 'agent-luoke' }]
    ]) expect(parseOnboardingSnapshot({
      ...prepared, provisioning: { ...prepared.provisioning, runtimeCopies: copies }
    })).toBeNull()
    const missing = structuredClone(prepared) as unknown as { provisioning: Record<string, unknown> }
    delete missing.provisioning.runtimeCopies
    expect(parseOnboardingSnapshot(missing)).toBeNull()
  })
})

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-onboarding-copies-'))
  directories.push(directory)
  const file = join(directory, 'onboarding.json')
  let store = await OnboardingStore.load(file)
  await store.initialize(false)
  await store.completeWelcome()
  await store.completeMemberSelection()
  await store.beginProvisioning(selection, permissions)
  const members: AgentProfile[] = builtinMemberPresetsForLanguage('zh-CN').map((preset) => ({
    agentId: `agent-${preset.role}`, displayName: preset.displayName, teamRole: preset.teamRole,
    professionalResponsibilities: preset.professionalResponsibilities, personalityTraits: preset.personalityTraits,
    workingPrinciples: preset.workingPrinciples, growthTopic: preset.growthTopic, avatarRef: preset.avatarRef,
    accent: preset.accentSample, defaultCapabilities: [], memberOrder: 0,
    presence: 'present', removedAt: null, runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] }, version: 1,
    createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z'
  }))
  const writes: string[] = []
  type Params = { commandId: string; command: { agentId: string; expectedVersion: number } & Record<string, unknown> }
  const requests: Array<{ method: CoreMethod; params: Params }> = []
  const ledger = new Map<string, { params: unknown; result: StoredCommandResult }>()
  let rejectAgent: string | null = null
  const api: OnboardingProvisioningApi = {
    async request<T>(method: CoreMethod, input?: unknown): Promise<T> {
      const params = input as Params
      requests.push({ method, params: structuredClone(params) })
      if (method === 'members.list') return structuredClone(members) as T
      const recorded = ledger.get(params.commandId)
      if (recorded) {
        expect(params).toEqual(recorded.params)
        return structuredClone(recorded.result) as T
      }
      const result: StoredCommandResult = {
        commandId: params.commandId, commandType: method, requestDigest: 'test', requestDigestVersion: 1,
        status: 'applied', code: 'applied', payload: {}, resultEntity: null, recordedAt: '2026-10-05T00:00:00Z'
      }
      if (method === 'threads.create') {
        result.payload = { threadId }
      } else {
        const member = members.find((candidate) => candidate.agentId === params.command.agentId)!
        const code = member.presence === 'removed' ? 'agent_profile.removed'
          : member.version !== params.command.expectedVersion ? 'agent_profile.version_conflict'
            : rejectAgent === member.agentId ? 'runtime_configuration_unavailable' : null
        if (code) {
          result.status = 'rejected'
          result.code = code
          rejectAgent = null
        } else {
          const { agentId, expectedVersion, ...values } = params.command
          if (method === 'members.runtime.set') {
            member.runtimeConfiguration = structuredClone(values) as unknown as AgentProfile['runtimeConfiguration']
            writes.push(agentId)
          } else if (method === 'members.update') Object.assign(member, values)
          else throw new Error(`Unexpected method ${method}`)
          result.payload = { agentId, version: ++member.version }
        }
      }
      ledger.set(params.commandId, { params: structuredClone(params), result: structuredClone(result) })
      return result as T
    },
    onboarding: {
      beginProvisioning: (...args) => store.beginProvisioning(...args),
      recordProvisionedMember: (...args) => store.recordProvisionedMember(...args),
      recordProvisionedRuntime: (...args) => store.recordProvisionedRuntime(...args),
      prepareRuntimeCopies: (...args) => store.prepareRuntimeCopies(...args),
      recordRuntimeCopy: (...args) => store.recordRuntimeCopy(...args),
      recordProvisionedThread: (...args) => store.recordProvisionedThread(...args),
      complete: () => store.complete()
    },
    desktopSession: { async commitRestorableLocation() {} }
  }
  return {
    api, file, members, writes, requests,
    snapshot: () => store.get() as InProgress,
    rejectNext: (agentId: string) => { rejectAgent = agentId },
    restart: async () => { store = await OnboardingStore.load(file); return store.get() }
  }
}
