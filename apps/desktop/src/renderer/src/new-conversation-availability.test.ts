import { describe, expect, it } from 'vitest'
import type { ThreadCreationPreflight } from '@contracts'
import { isNewConversationMemberAvailable, newConversationMemberStatus } from './new-conversation-availability'
import { planInitialThreadSelection } from './NewConversationDialog'

describe('new conversation member availability', () => {
  it.each([
    [true, 'ready', true, '可用'],
    [true, 'light_ready', true, '可用'],
    [false, 'ready', false, '未配置智能体'],
    [false, 'light_ready', false, '未配置智能体'],
    [false, 'runtime_not_configured', false, '未配置智能体'],
    [true, 'runtime_not_configured', false, '未配置智能体'],
    [true, 'installed_unverified', false, '智能体不可用'],
    [true, 'needs_attention', false, '智能体不可用']
  ] as const)('configured=%s readiness=%s', (runtimeConfigured, runtimeReadiness, available, label) => {
    const member = { runtimeConfigured, runtimeReadiness }
    expect(isNewConversationMemberAvailable(member)).toBe(available)
    expect(newConversationMemberStatus(member)).toBe(label)
  })

  it('filters saved unavailable members and Lead, and leaves an empty draft when no one is available', () => {
    const preflight: ThreadCreationPreflight = {
      admissible: true, blockers: [], initialLeadAgentId: 'unsaved',
      presentMembers: [
        { agentId: 'unsaved', displayName: '未配置', memberOrder: 0, runtimeConfigured: false, runtimeReadiness: 'ready' },
        { agentId: 'usable', displayName: '可用', memberOrder: 1, runtimeConfigured: true, runtimeReadiness: 'light_ready' }
      ]
    }
    const preferred = { memberAgentIds: ['unsaved', 'usable'], defaultLeadAgentId: 'unsaved' }
    expect(planInitialThreadSelection(preflight, preferred)).toEqual({ memberIds: ['usable'], leadId: 'usable' })
    preflight.presentMembers[1].runtimeReadiness = 'needs_attention'
    expect(planInitialThreadSelection(preflight, preferred)).toEqual({ memberIds: [], leadId: '' })
    expect(preferred.memberAgentIds).toEqual(['unsaved', 'usable'])
  })
})
