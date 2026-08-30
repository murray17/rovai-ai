import { describe, expect, it, vi } from 'vitest'
import type { CoreClient } from './core-client'
import {
  DINGTALK_REQUIRED_SCOPE_VALUES,
  DingTalkChannelSettingsService,
  dingtalkOutTrackId,
  hasCanonicalSingleDingTalkBotTarget,
  presentDingTalkAppIds,
  selectSingleDingTalkInboundObservation,
  shouldAdvanceDingTalkPublicationStep
} from './dingtalk-channel-settings'
import type {
  DingTalkDeveloperIdentity,
  DingTalkDeveloperSessionService
} from './dingtalk-developer-session'

describe('DingTalk channel account connection', () => {
  it('publishes the minimum message, roster, and AI Card scopes', () => {
    expect(DINGTALK_REQUIRED_SCOPE_VALUES).toEqual([
      'Card.Instance.Write',
      'Card.Streaming.Write',
      'qyapi_chat_manage',
      'qyapi_robot_sendmsg'
    ])
  })

  it('maps the authoritative remote robotCode roster back to frozen app keys', () => {
    expect(presentDingTalkAppIds([
      { appKey: 'ding-app-b', robotCode: 'robot-b', status: 'published' },
      { appKey: 'ding-app-a', robotCode: 'robot-a', status: 'published' },
      { appKey: 'ding-app-disabled', robotCode: 'robot-disabled', status: 'disabled' }
    ], new Set(['robot-b', 'robot-disabled']))).toEqual(['ding-app-b'])
  })

  it('keeps card outTrackId stable across outbox retries', () => {
    expect(dingtalkOutTrackId('run', 'delivery-1')).toBe(
      dingtalkOutTrackId('run', 'delivery-1')
    )
    expect(dingtalkOutTrackId('run', 'delivery-1')).not.toBe(
      dingtalkOutTrackId('run', 'delivery-2')
    )
  })

  it('fails closed when one DingTalk message reaches multiple managed Bots', () => {
    const first = { message: { appId: 'ding-app-a' }, agentId: 'agent-a' }
    const retry = { message: { appId: 'ding-app-a' }, agentId: 'agent-a' }
    const second = { message: { appId: 'ding-app-b' }, agentId: 'agent-b' }

    expect(selectSingleDingTalkInboundObservation([first, retry])).toBe(first)
    expect(selectSingleDingTalkInboundObservation([first, second])).toBeNull()
    expect(selectSingleDingTalkInboundObservation([])).toBeNull()
  })

  it('requires canonical atUsers proof for a direct group target', () => {
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true,
      atUsers: [{ staffId: null, dingtalkId: 'ding-app-a' }]
    })).toBe(true)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true, atUsers: []
    })).toBe(false)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true,
      atUsers: [
        { staffId: null, dingtalkId: 'ding-app-a' },
        { staffId: null, dingtalkId: 'ding-app-b' }
      ]
    })).toBe(false)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'p2p', explicitlyAtBot: true, atUsers: []
    })).toBe(true)
  })

  it('discards the staged OAuth profile when the Core account commit fails', async () => {
    const previous = identity('corp-old', 'owner-old')
    const replacement = identity('corp-new', 'owner-new')
    const discardPendingLogin = vi.fn(async () => previous)
    const developerSession: DingTalkDeveloperSessionService = {
      inspect: vi.fn(async () => previous),
      beginLogin: vi.fn(async () => replacement),
      pendingConnection: vi.fn(() => ({
        identity: replacement,
        session: { schemaVersion: 1 as const, currentProfileKey: 'pending', profiles: [] }
      })),
      activatePendingLogin: vi.fn(async () => undefined),
      discardPendingLogin,
      accessToken: vi.fn(async () => 'access-token'),
      disconnect: vi.fn(async () => undefined)
    }
    const core = {
      async request(method: string): Promise<unknown> {
        if (method === 'channels.dingtalk.snapshot') return {
          schemaVersion: 1, account: null, memberBots: [], publicationIntents: [],
          pendingBindingCount: 0, bindingIssueCount: 0,
          transportConversations: [], pendingAggregates: []
        }
        throw new Error('core_commit_failed')
      }
    } as unknown as Pick<CoreClient, 'request'>
    const service = new DingTalkChannelSettingsService({
      core,
      developerSession,
      credentialStore: {
        readDingTalk: vi.fn(async () => null),
        deleteDingTalk: vi.fn(async () => undefined),
        listPublished: vi.fn(async () => [])
      },
      provisioner: { async create() { throw new Error('unused') } },
      avatarSource: { async resolve() { return undefined } }
    })

    await expect(service.connect()).rejects.toThrow('core_commit_failed')
    expect(discardPendingLogin).toHaveBeenCalledTimes(1)
  })

  it('accepts only an approver from the active frozen candidate list', async () => {
    const service = new DingTalkChannelSettingsService({
      core: {} as Pick<CoreClient, 'request'>,
      developerSession: {} as DingTalkDeveloperSessionService,
      credentialStore: {
        readDingTalk: vi.fn(async () => null),
        deleteDingTalk: vi.fn(async () => undefined),
        listPublished: vi.fn(async () => [])
      },
      provisioner: { async create() { throw new Error('unused') } },
      avatarSource: { async resolve() { return undefined } }
    })

    await expect(service.selectApprover('agent-a', 'owner-a'))
      .rejects.toThrow('dingtalk_approver_selection_invalid')
  })

  it('projects a durable recoverable publication failure ahead of a live Stream', async () => {
    const core = {
      async request(method: string): Promise<unknown> {
        if (method !== 'channels.dingtalk.snapshot') throw new Error(`unexpected:${method}`)
        return {
          schemaVersion: 1,
          account: null,
          memberBots: [{
            agentId: 'agent-a', accountId: 'account-a', unifiedAppId: 'u-app-a',
            appKey: 'ding-app-a', robotCode: 'robot-a', botDisplayName: '芝士',
            credentialRef: 'dingtalk-credential-a', status: 'published', failureCode: null,
            version: 1
          }],
          publicationIntents: [{
            publicationIntentId: 'intent-a', agentId: 'agent-a', accountId: 'account-a',
            expectedUserIdDigest: `sha256:${'a'.repeat(64)}`, expectedCorpId: 'corp-a',
            requestedAppName: '芝士', provisioningMode: 'direct_open_platform',
            state: 'failed_recoverable', remoteUnifiedAppId: 'u-app-a', appKey: 'ding-app-a',
            robotCode: 'robot-a', credentialRef: 'dingtalk-credential-a', versionId: 'version-a',
            approvalMode: 'NO_APPROVAL', lastCompletedStep: 'stream_verified',
            failureCode: 'dingtalk_card_verification_failed', version: 9,
            createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z'
          }],
          pendingBindingCount: 0,
          bindingIssueCount: 0,
          transportConversations: [],
          pendingAggregates: []
        }
      }
    } as unknown as Pick<CoreClient, 'request'>
    const service = new DingTalkChannelSettingsService({
      core,
      developerSession: {} as DingTalkDeveloperSessionService,
      credentialStore: {
        readDingTalk: vi.fn(async () => null),
        deleteDingTalk: vi.fn(async () => undefined),
        listPublished: vi.fn(async () => [])
      },
      provisioner: { async create() { throw new Error('unused') } },
      avatarSource: { async resolve() { return undefined } }
    })

    const result = await service.get()
    expect(result.provider.memberBots[0]).toMatchObject({
      publicationStatus: 'failed',
      failureCode: 'dingtalk_card_verification_failed'
    })
  })

  it('re-enters the durable publication step exactly once after a recoverable failure', () => {
    expect(shouldAdvanceDingTalkPublicationStep({
      state: 'failed_recoverable',
      lastCompletedStep: 'version_released'
    }, 'account_verified')).toBe(false)
    expect(shouldAdvanceDingTalkPublicationStep({
      state: 'failed_recoverable',
      lastCompletedStep: 'version_released'
    }, 'version_released')).toBe(true)
    expect(shouldAdvanceDingTalkPublicationStep({
      state: 'version_released',
      lastCompletedStep: 'version_released'
    }, 'version_released')).toBe(false)
    expect(shouldAdvanceDingTalkPublicationStep({
      state: 'failed_recoverable',
      lastCompletedStep: null
    }, 'account_verified')).toBe(true)
  })
})

function identity(corpId: string, userId: string): DingTalkDeveloperIdentity {
  return {
    accountId: `account-${corpId}`,
    userIdDigest: `sha256:${userId.padEnd(64, '0').slice(0, 64)}`,
    corpId,
    userId,
    userName: userId,
    corpName: corpId,
    oauthProfileRef: `profile-${corpId}`,
    expiresAt: null
  }
}
