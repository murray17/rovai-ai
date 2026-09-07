import { describe, expect, it, vi } from 'vitest'
import type { AgentProfile, StoredCommandResult } from '@contracts'
import { identityDraftFor } from './member-identity-draft'
import { saveMemberIdentity } from './member-identity-save'

const profile: AgentProfile = {
  agentId: 'agent_1',
  displayName: '队员',
  avatarRef: null,
  accent: null,
  teamRole: '研究员',
  professionalResponsibilities: '',
  personalityTraits: [],
  workingPrinciples: '',
  growthTopic: '',
  defaultCapabilities: [],
  presence: 'present',
  memberOrder: 0,
  version: 4,
  runtimeConfiguration: {
    adapterKind: 'codex-cli',
    model: { mode: 'runtime_default' },
    permissions: {
      adapterKind: 'codex-cli',
      schemaVersion: 1,
      values: { sandbox_mode: 'read-only', approval_policy: 'on-request' }
    }
  },
  runtimeReadiness: { status: 'ready', blockers: [] },
  createdAt: '',
  updatedAt: '',
  removedAt: null
}
const receipt = (version: number): StoredCommandResult => ({
  commandId: 'test',
  commandType: 'members.update',
  requestDigest: 'test',
  requestDigestVersion: 1,
  recordedAt: '',
  status: 'applied',
  code: 'agent_profile.updated',
  payload: { agentId: 'agent_1', version },
  resultEntity: { entityType: 'agent_profile', entityId: 'agent_1' }
})

describe('inline member identity save', () => {
  it('advances versions from receipts while preserving Runtime and reports a partial image failure honestly', async () => {
    const draft = { ...identityDraftFor(profile), displayName: '新名称' }
    const committed: AgentProfile[] = []
    const request = vi
      .fn()
      .mockResolvedValueOnce(receipt(5))
      .mockRejectedValueOnce(new Error('image conflict'))
    await expect(
      saveMemberIdentity({
        agent: profile,
        draft,
        avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
        request,
        onCommitted: (value) => committed.push(value)
      })
    ).rejects.toThrow('文字信息已保存，角色图片未保存')
    expect(
      request.mock.calls.map(([method, command]) => [
        method,
        command.expectedVersion
      ])
    ).toEqual([
      ['members.update', 4],
      ['members.avatar.set', 5]
    ])
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({
      displayName: '新名称',
      avatarRef: null,
      version: 5,
      runtimeConfiguration: profile.runtimeConfiguration
    })
    expect(request.mock.calls[0][1]).not.toHaveProperty('runtimeConfiguration')
    const retry = vi.fn().mockResolvedValue(receipt(6))
    const result = await saveMemberIdentity({
      agent: committed[0],
      draft,
      avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
      request: retry,
      onCommitted: vi.fn()
    })
    expect(retry.mock.calls).toEqual([
      [
        'members.avatar.set',
        {
          agentId: 'agent_1',
          expectedVersion: 5,
          avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
        }
      ]
    ])
    expect(result.runtimeConfiguration).toEqual(profile.runtimeConfiguration)
  })

  it('creates identity and selected image once without setting any Runtime preference', async () => {
    const request = vi.fn().mockResolvedValue(receipt(1))
    const result = await saveMemberIdentity({
      agent: null,
      draft: { ...identityDraftFor(null), displayName: '  新队员  ' },
      avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
      request,
      onCommitted: vi.fn()
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('members.create')
    expect(request.mock.calls[0][1]).toMatchObject({
      displayName: '新队员',
      avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
    })
    expect(request.mock.calls[0][1]).not.toHaveProperty('expectedVersion')
    expect(result.runtimeConfiguration).toBeNull()
  })

  it('never attempts the image mutation when identity was rejected or its outcome is unknown', async () => {
    for (const failure of [
      new Error('transport interrupted'),
      {
        ...receipt(5),
        status: 'rejected',
        code: 'agent_profile.version_conflict'
      }
    ]) {
      const request = vi.fn()
      if (failure instanceof Error) request.mockRejectedValue(failure)
      else request.mockResolvedValue(failure)
      const accepted = vi.fn()
      await expect(
        saveMemberIdentity({
          agent: profile,
          draft: { ...identityDraftFor(profile), teamRole: '开发者' },
          avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
          request,
          onCommitted: accepted
        })
      ).rejects.toThrow()
      expect(request).toHaveBeenCalledTimes(1)
      expect(accepted).not.toHaveBeenCalled()
    }
  })
})
