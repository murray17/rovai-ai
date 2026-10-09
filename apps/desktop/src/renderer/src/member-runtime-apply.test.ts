import { describe, expect, it, vi } from 'vitest'
import type { AgentProfile, MemberRuntimeConfiguration, RovaiApi, RuntimePlatformAdmission } from '@contracts'
import { applyRuntimeToMember, reconcileUnknownRuntimeApply, runtimeApplyEligibility, runtimeConfigurationsEqual } from './member-runtime-apply'

const configuration: MemberRuntimeConfiguration = {
  adapterKind: 'codex-cli', model: { mode: 'explicit', modelId: 'model-a', options: { reasoning_effort: 'high' } },
  permissions: { adapterKind: 'codex-cli', schemaVersion: 7, values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' } }
}
const member: AgentProfile = {
  agentId: 'agent_2', displayName: 'Target', teamRole: 'Reviewer', avatarRef: null, accent: null,
  professionalResponsibilities: 'Review', personalityTraits: [], workingPrinciples: '', growthTopic: '', defaultCapabilities: [],
  presence: 'present', runtimeConfiguration: null, runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
  memberOrder: 1, version: 9, createdAt: '', updatedAt: '', removedAt: null
}
const environment = { hostPlatform: null, admissions: [] }
const requestAs = (request: ReturnType<typeof vi.fn>): RovaiApi['request'] => request as RovaiApi['request']

describe('applying a saved member Runtime configuration', () => {
  it('copies only Runtime fields and freezes all values before waiting for the receipt', async () => {
    let complete!: (result: unknown) => void
    const request = vi.fn(() => new Promise(resolve => { complete = resolve }))
    const source = structuredClone(configuration)
    const saving = applyRuntimeToMember(member, source, requestAs(request))
    source.permissions.values.approval_policy = 'never'
    expect(request.mock.calls[0]).toEqual(['members.runtime.set', {
      commandId: expect.any(String), command: { agentId: 'agent_2', expectedVersion: 9, ...configuration }
    }])
    complete({ status: 'applied', payload: { agentId: 'agent_2', version: 10 } })
    await expect(saving).resolves.toMatchObject({ status: 'applied', version: 10 })
    expect(member.runtimeConfiguration).toBeNull()
  })

  it('retains Core CAS rejection and never retries a conflict', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'rejected', code: 'agent_profile.version_conflict', payload: { version: 10 } })
    await expect(applyRuntimeToMember(member, configuration, requestAs(request))).resolves.toMatchObject({ status: 'conflict' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not confuse a lost response or incomplete receipt with failure or success', async () => {
    for (const response of [undefined, { status: 'accepted', payload: { version: 10 } }, { status: 'applied', payload: {} }]) {
      const request = response ? vi.fn().mockResolvedValue(response) : vi.fn().mockRejectedValue(new Error('response lost'))
      await expect(applyRuntimeToMember(member, configuration, requestAs(request))).resolves.toMatchObject({ status: 'unknown' })
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps Runtime default and empty native permissions exact', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'applied', payload: { version: 10 } })
    const source: MemberRuntimeConfiguration = { adapterKind: 'pi', model: { mode: 'runtime_default' }, permissions: { adapterKind: 'pi', schemaVersion: 1, values: {} } }
    await applyRuntimeToMember(member, source, requestAs(request))
    expect(request.mock.calls[0][1].command).toEqual({ agentId: member.agentId, expectedVersion: member.version, ...source })
  })

  it('protects pending Runtime drafts, ongoing edits and platform-frozen configurations', () => {
    expect(runtimeApplyEligibility(member, configuration, { runtimeDirty: true, busy: false }, environment)).toBe('draft')
    expect(runtimeApplyEligibility(member, configuration, { runtimeDirty: false, busy: true }, environment)).toBe('busy')
    for (const adapterKind of ['cursor-agent', 'cline-cli', 'command-code-cli'] as const) {
      expect(runtimeApplyEligibility({ ...member, runtimeConfiguration: { ...configuration, adapterKind } }, configuration, undefined, environment)).toBe('locked')
    }
    const target = { ...member, runtimeConfiguration: configuration }
    const admissions = [{ platform: 'windows-x64', runtimeKind: 'codex-cli', status: 'not_qualified' }] as RuntimePlatformAdmission[]
    expect(runtimeApplyEligibility(target, { ...configuration, model: { mode: 'runtime_default' } }, undefined, { hostPlatform: 'windows-x64', admissions })).toBe('locked')
    expect(runtimeApplyEligibility({ ...member, presence: 'away' }, configuration, undefined, environment)).toBe('available')
    expect(runtimeApplyEligibility({ ...member, removedAt: '2026-10-02' }, configuration, undefined, environment)).toBe('removed')
  })

  it('treats reordered native fields as matching without writing or narrowing permissions', () => {
    const reordered = { ...configuration, permissions: { ...configuration.permissions, values: { approval_policy: 'on-request', sandbox_mode: 'workspace-write' } } }
    expect(runtimeConfigurationsEqual(configuration, reordered)).toBe(true)
    expect(runtimeApplyEligibility({ ...member, runtimeConfiguration: reordered }, configuration, undefined, environment)).toBe('same')
  })

  it('requires read-back for an unknown write and preserves the reviewed CAS version on retry', () => {
    const result = { member, status: 'unknown' as const }
    expect(reconcileUnknownRuntimeApply(result, { ...member, version: 10, runtimeConfiguration: configuration }, configuration)).toMatchObject({ status: 'matched', version: 10 })
    expect(reconcileUnknownRuntimeApply(result, member, configuration)).toMatchObject({ status: 'failed', member: { version: 9 } })
    expect(reconcileUnknownRuntimeApply(result, { ...member, version: 10 }, configuration).status).toBe('conflict')
    expect(reconcileUnknownRuntimeApply(result, undefined, configuration).status).toBe('conflict')
    expect(reconcileUnknownRuntimeApply(result, { ...member, presence: 'removed', runtimeConfiguration: configuration }, configuration).status).toBe('conflict')
  })
})
