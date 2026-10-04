import { describe, expect, it, vi } from 'vitest'
import type { ChannelSettingsSnapshot } from '@contracts'
import { createHostChannelHandler, parseHostChannelRequest } from './host-channels'

const snapshot: ChannelSettingsSnapshot = {
  schemaVersion: 4,
  channels: [],
  pendingBindingCount: 0,
  bindingIssueCount: 0,
  activeQrAttempt: null,
  activeProvisioning: null
}

describe('Host channel requests', () => {
  it.each(['feishu', 'lark', 'dingtalk'] as const)('admits publish and retry for %s', (kind) => {
    for (const operation of ['publish', 'retry'] as const) {
      expect(parseHostChannelRequest({ operation, kind, agentId: 'member' })).toEqual({ operation, kind, agentId: 'member' })
    }
  })

  it.each(['feishu', 'lark'] as const)('keeps approver selection DingTalk-only: %s', (kind) => {
    expect(parseHostChannelRequest({ operation: 'selectApprover', kind, agentId: 'member', userId: 'user' })).toBeNull()
  })

  it('routes a Lark publication to the Lark kind', async () => {
    const publishMemberBot = vi.fn(async () => snapshot)
    const handler = createHostChannelHandler({
      get: vi.fn(), retryMemberBot: vi.fn(), selectPublicationApprover: vi.fn(), publishMemberBot
    })
    await expect(handler({ operation: 'publish', kind: 'lark', agentId: 'member' }))
      .resolves.toMatchObject({ error: null })
    expect(publishMemberBot).toHaveBeenCalledExactlyOnceWith('member', 'lark')
  })

  it.each([
    ['lark_session_expired', 'channel_session_expired'],
    ['lark_developer_session_expired', 'channel_session_expired'],
    ['lark_developer_identity_changed', 'channel_session_expired'],
    ['Lark 登录已过期，请先重新连接账号。', 'channel_session_expired'],
    ['请先连接最初发布该队员应用的 Lark 账号。', 'channel_session_expired'],
    ['lark_login_interaction_required', 'channel_native_interaction'],
    ['feishu_developer_session_expired', 'channel_session_expired'],
    ['feishu_login_interaction_required', 'channel_native_interaction'],
    ['dingtalk_developer_session_expired', 'channel_session_expired'],
    ['lark_connection_error', 'channel_operation_failed'],
    ['lark_brand_moved_to_lark', 'channel_operation_failed']
  ])('maps %s to %s', async (failure, error) => {
    const handler = createHostChannelHandler({
      get: vi.fn(async () => { throw new Error(failure) }),
      publishMemberBot: vi.fn(), retryMemberBot: vi.fn(), selectPublicationApprover: vi.fn()
    })
    await expect(handler({ operation: 'get' })).resolves.toEqual({ error })
  })
})
