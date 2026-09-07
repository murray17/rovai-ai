import type { AgentProfile, StoredCommandResult } from '@contracts'
import {
  identityCommand,
  identityDraftFor,
  type IdentityDraft
} from './member-identity-draft'
import { readErrorMessage } from './error-message'

type IdentityMethod = 'members.create' | 'members.update' | 'members.avatar.set'

// Each receipt advances only the fields actually committed. A failed second command
// leaves the image draft pending and can never replay member creation or overwrite Runtime.
export async function saveMemberIdentity({
  agent,
  draft,
  avatarRef,
  request,
  onCommitted
}: {
  agent: AgentProfile | null
  draft: IdentityDraft
  avatarRef: string | null
  request(
    method: IdentityMethod,
    command: unknown
  ): Promise<StoredCommandResult>
  onCommitted(profile: AgentProfile): void
}): Promise<AgentProfile> {
  const identity = identityCommand(draft, null)
  let current = agent
  let textCommitted = false
  const receipt = async (
    method: IdentityMethod,
    command: unknown
  ): Promise<{ id: string; version: number }> => {
    const result = await request(method, command)
    if (result.status === 'rejected') {
      const message =
        result.code === 'agent_profile.version_conflict'
          ? '队员已被其他操作更新，请重新载入后重试。'
          : result.code === 'agent_profile.display_name_conflict'
            ? '该名称已被其他队员使用，请换一个名称。'
            : typeof result.payload.message === 'string'
              ? result.payload.message
              : `保存未完成：${result.code}`
      throw new Error(message)
    }
    const id = result.resultEntity?.entityId ?? result.payload.agentId
    const version = result.payload.version
    if (typeof id !== 'string' || typeof version !== 'number')
      throw new Error('已收到保存回执，但无法确认最新版本，请重新载入。')
    return { id, version }
  }
  if (!current) {
    const result = await receipt('members.create', { ...identity, avatarRef })
    const now = new Date().toISOString()
    current = {
      ...identity,
      avatarRef,
      accent: null,
      agentId: result.id,
      version: result.version,
      defaultCapabilities: [],
      presence: 'present',
      runtimeConfiguration: null,
      runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
      memberOrder: 0,
      createdAt: now,
      updatedAt: now,
      removedAt: null
    }
    onCommitted(current)
    return current
  }
  if (JSON.stringify(identityDraftFor(current)) !== JSON.stringify(identity)) {
    const result = await receipt('members.update', {
      ...identity,
      agentId: current.agentId,
      expectedVersion: current.version
    })
    current = { ...current, ...identity, version: result.version }
    textCommitted = true
    onCommitted(current)
  }
  if (current.avatarRef !== avatarRef) {
    try {
      const result = await receipt('members.avatar.set', {
        agentId: current.agentId,
        expectedVersion: current.version,
        avatarRef
      })
      current = { ...current, avatarRef, version: result.version }
      onCommitted(current)
    } catch (error) {
      if (textCommitted)
        throw new Error(
          `队员文字信息已保存，角色图片未保存：${readErrorMessage(error)}`
        )
      throw error
    }
  }
  return current
}
