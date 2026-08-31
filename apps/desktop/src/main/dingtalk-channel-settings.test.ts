import { describe, expect, it, vi } from 'vitest'
import type { CoreClient } from './core-client'
import {
  DINGTALK_REQUIRED_SCOPE_VALUES,
  DingTalkChannelSettingsService,
  type DingTalkChannelHostDependencies,
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
import type { DingTalkAppCredential } from './channel-credential-store'
import { DingTalkOpenApiClient } from './dingtalk-open-api'
import { DingTalkStreamRegistry } from './dingtalk-stream-registry'
import { DingTalkProvisioningError } from './dingtalk-member-bot-provisioner'

describe('DingTalk channel account connection', () => {
  it.each([
    'dingtalk_open_platform_unavailable', 'dingtalk_open_platform_timeout', 'channel_storage_unavailable',
    'dingtalk_open_platform_access_denied', 'dingtalk_open_platform_response_invalid', 'dingtalk_web_session_store_invalid'
  ])(
    'does not expire the saved account when startup inspection fails temporarily: %s',
    async (code) => {
      const fixture = completedBotFixture({ credentialPresent: true })
      fixture.developerSession.inspect.mockRejectedValueOnce(new Error(code))

      try {
        await fixture.service.start()
        expect(fixture.commands).not.toContain('channels.dingtalk.account.expire')
        expect((await fixture.service.get()).provider.connection.status).toBe('connected')
        expect(fixture.streamStart).toHaveBeenCalledTimes(1)
        expect(fixture.developerSession.beginLogin).not.toHaveBeenCalled()
      } finally {
        await fixture.service.stop()
      }
    }
  )

  it.each(['missing', 'dingtalk_developer_session_expired'])(
    'expires an account only on a confirmed unusable login: %s',
    async (code) => {
      const fixture = completedBotFixture({ credentialPresent: true })
      if (code === 'missing') fixture.developerSession.inspect.mockResolvedValueOnce(null)
      else fixture.developerSession.inspect.mockRejectedValueOnce(new Error(code))
      try {
        await fixture.service.start()
        await vi.waitFor(() => expect(fixture.commands).toContain('channels.dingtalk.account.expire'))
        expect((await fixture.service.get()).provider.connection.status).toBe('session_expired')
        expect(fixture.streamStart).toHaveBeenCalledTimes(1)
        expect(fixture.developerSession.beginLogin).not.toHaveBeenCalled()
      } finally {
        await fixture.service.stop()
      }
    }
  )

  it('ignores a stale startup inspection after an explicit reconnect attempt', async () => {
    const fixture = completedBotFixture({ credentialPresent: true })
    const inspection = deferred<DingTalkDeveloperIdentity | null>()
    fixture.developerSession.inspect.mockReturnValueOnce(inspection.promise)
    fixture.developerSession.beginLogin.mockRejectedValueOnce(new Error('dingtalk_operation_cancelled'))
    const starting = fixture.service.start()
    try {
      await vi.waitFor(() => expect(fixture.developerSession.inspect).toHaveBeenCalled())
      await expect(fixture.service.connect()).rejects.toThrow('dingtalk_operation_cancelled')
      inspection.resolve(null)
      await starting
      expect(fixture.commands).not.toContain('channels.dingtalk.account.expire')
      expect(fixture.commands).not.toContain('channels.dingtalk.account.upsert')
    } finally {
      inspection.resolve(null)
      await starting
      await fixture.service.stop()
    }
  })

  it('restores published Bot Stream without waiting for the developer web session', async () => {
    const fixture = completedBotFixture({ credentialPresent: true })
    const inspection = deferred<DingTalkDeveloperIdentity | null>()
    fixture.developerSession.inspect.mockReturnValueOnce(inspection.promise)
    try {
      await fixture.service.start()
      expect(fixture.streamStart).toHaveBeenCalledOnce()
      expect(fixture.commands).not.toContain('channels.dingtalk.account.expire')
    } finally {
      await fixture.service.stop()
      inspection.resolve(null)
    }
  })

  it('offers reconnect for a legacy OAuth row without deleting it or stopping existing Bots', async () => {
    const fixture = completedBotFixture({ credentialPresent: true })
    fixture.developerSession.inspect.mockRejectedValueOnce(new Error('dingtalk_legacy_session_requires_reconnect'))
    try {
      await fixture.service.start()
      await vi.waitFor(async () => expect((await fixture.service.get()).provider.connection.status).toBe('session_expired'))
      expect(fixture.commands).not.toContain('channels.dingtalk.account.expire')
      expect(fixture.streamStart).toHaveBeenCalledOnce()
    } finally { await fixture.service.stop() }
  })

  it('does not commit a late browser login after the Owner cancels it', async () => {
    const fixture = completedBotFixture()
    const login = deferred<DingTalkDeveloperIdentity>()
    fixture.developerSession.beginLogin.mockReturnValueOnce(login.promise)
    const connecting = fixture.service.connect()
    const assertion = expect(connecting).rejects.toThrow('dingtalk_operation_cancelled')
    await vi.waitFor(() => expect(fixture.developerSession.beginLogin).toHaveBeenCalled())
    const attempt = (await fixture.service.get()).activeQrAttempt!

    await fixture.service.cancelLogin(attempt.attemptId)
    login.resolve(identity('corp-other', 'owner-other'))
    await assertion
    expect(fixture.commands).not.toContain('channels.dingtalk.account.commitConnection')
    expect((await fixture.service.get()).provider.connection.account?.accountId).toBe('account-corp-a')
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
  })

  it('recovers a completed Bot missing its SQLite credential from the same frozen application', async () => {
    const fixture = completedBotFixture()

    await expect(fixture.service.publish('agent-a')).resolves.toBeUndefined()

    expect(fixture.provision).toHaveBeenCalledWith(expect.objectContaining({
      frozen: {
        unifiedAppId: 'u-app-a', appKey: 'ding-app-a',
        robotCode: 'robot-a', versionId: 'version-a'
      }
    }))
    expect(fixture.commands).toContain('channels.dingtalk.publicationIntent.storeCredential')
    expect(fixture.commands).not.toContain('channels.dingtalk.publicationIntent.create')
    expect(fixture.credential()).toEqual({
      appKey: 'ding-app-a', appSecret: 'fixture-recovered-secret', robotCode: 'robot-a'
    })
    expect(fixture.streamStart).toHaveBeenCalledTimes(1)
    expect(fixture.verifyCard).toHaveBeenCalledTimes(1)
    expect((await fixture.service.get()).activeProvisioning).toMatchObject({
      stage: 'completed', remoteAppId: 'u-app-a', failureCode: null
    })
    expect(fixture.intent()).toMatchObject({ state: 'completed', lastCompletedStep: 'completed' })
    await fixture.service.publish('agent-a')
    expect(fixture.provision).toHaveBeenCalledTimes(1)
  })

  it('uses a usable completed Bot credential without reading secrets from the developer console', async () => {
    const fixture = completedBotFixture({ credentialPresent: true })

    await fixture.service.publish('agent-a')

    expect(fixture.provision).not.toHaveBeenCalled()
    expect(fixture.commands).not.toContain('channels.dingtalk.publicationIntent.storeCredential')
    expect(fixture.streamStart).toHaveBeenCalledTimes(1)
    expect(fixture.verifyCard).toHaveBeenCalledTimes(1)
  })

  it.each(['remote_read', 'storage'] as const)(
    'retries credential recovery on the same completed binding after a %s failure',
    async (failure) => {
      const fixture = completedBotFixture({ rejectCredentialWrites: failure === 'storage' ? 1 : 0 })
      if (failure === 'remote_read') fixture.provision.mockRejectedValueOnce(new Error('dingtalk_fixture_read_failed'))

      await expect(fixture.service.publish('agent-a')).rejects.toThrow()
      expect(fixture.credential()).toBeNull()
      expect(fixture.streamStart).not.toHaveBeenCalled()
      expect(fixture.intent()).toMatchObject({ state: 'completed', version: 14 })

      await fixture.service.publish('agent-a')
      expect(fixture.credential()?.appKey).toBe('ding-app-a')
      expect(fixture.commands).not.toContain('channels.dingtalk.publicationIntent.create')
      expect(fixture.streamStart).toHaveBeenCalledTimes(1)
    }
  )

  it('does not use another developer account to recover an existing Bot credential', async () => {
    const fixture = completedBotFixture({ otherAccount: true })

    await expect(fixture.service.publish('agent-a')).rejects.toThrow('最初发布')
    expect(fixture.provision).not.toHaveBeenCalled()
    expect(fixture.streamStart).not.toHaveBeenCalled()
    expect(fixture.credential()).toBeNull()
  })

  it('does not turn a damaged completed binding with no App ID into a new application', async () => {
    const fixture = completedBotFixture({ emptyFrozenAppId: true })

    await expect(fixture.service.publish('agent-a')).rejects.toThrow('dingtalk_credentials_freeze_invalid')
    expect(fixture.provision).not.toHaveBeenCalled()
    expect(fixture.credential()).toBeNull()
  })

  it.each(['unifiedAppId', 'appKey', 'robotCode', 'versionId'] as const)(
    'rejects a recovered credential with a different frozen %s before writing or reconnecting',
    async (field) => {
      const fixture = completedBotFixture()
      fixture.provision.mockResolvedValueOnce({
        unifiedAppId: 'u-app-a', appKey: 'ding-app-a', appSecret: 'fixture-secret',
        robotCode: 'robot-a', versionId: 'version-a', [field]: 'different-identity'
      })

      await expect(fixture.service.publish('agent-a')).rejects.toThrow('dingtalk_credentials_freeze_invalid')
      expect(fixture.commands).not.toContain('channels.dingtalk.publicationIntent.storeCredential')
      expect(fixture.streamStart).not.toHaveBeenCalled()
      expect(fixture.credential()).toBeNull()
    }
  )

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

  it('discards staged cookies when the Core account commit fails', async () => {
    const previous = identity('corp-old', 'owner-old')
    const replacement = identity('corp-new', 'owner-new')
    const discardPendingLogin = vi.fn(async () => previous)
    const developerSession: DingTalkDeveloperSessionService = {
      inspect: vi.fn(async () => previous),
      beginLogin: vi.fn(async () => replacement),
      pendingConnection: vi.fn(() => ({
        identity: replacement,
        session: { schemaVersion: 2 as const, cookies: [] }
      })),
      activatePendingLogin: vi.fn(async () => undefined),
      discardPendingLogin,
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

  it('blocks an interrupted create at the durable account_verified boundary instead of creating twice', async () => {
    const f = completedBotFixture({ beforeApp: 'account_verified' })
    await expect(f.service.publish('agent-a')).rejects.toThrow('dingtalk_app_create_unknown_remote_state')
    expect(f.provision).not.toHaveBeenCalled()
    expect(f.intent()).toMatchObject({ state: 'failed_unknown_remote_state', remoteUnifiedAppId: null })
  })

  it('persists a proven app ID in the failure transaction when its normal checkpoint failed', async () => {
    const f = completedBotFixture({ beforeApp: 'created' })
    f.provision.mockRejectedValueOnce(new DingTalkProvisioningError('dingtalk_app_identity_checkpoint_failed', {
      facts: { unifiedAppId: 'u-app-a' }
    }))
    await expect(f.service.publish('agent-a')).rejects.toThrow('dingtalk_app_identity_checkpoint_failed')
    expect(f.intent()).toMatchObject({ state: 'failed_recoverable', remoteUnifiedAppId: 'u-app-a',
      lastCompletedStep: 'app_created' })
    expect((await f.service.get()).activeProvisioning?.remoteAppId).toBe('u-app-a')
  })
})

function completedBotFixture(options: {
  credentialPresent?: boolean
  rejectCredentialWrites?: number
  otherAccount?: boolean
  emptyFrozenAppId?: boolean
  beforeApp?: 'created' | 'account_verified'
} = {}) {
  const owner = identity('corp-a', 'owner-a')
  const activeOwner = options.otherAccount ? identity('corp-other', 'owner-other') : owner
  const account = {
    ...activeOwner, status: 'connected', version: 1,
    connectedAt: '2026-08-30T00:00:00Z', lastVerifiedAt: '2026-08-30T00:00:00Z'
  }
  const bot = {
    agentId: 'agent-a', accountId: owner.accountId,
    unifiedAppId: options.emptyFrozenAppId ? '' : 'u-app-a',
    appKey: 'ding-app-a', robotCode: 'robot-a', botDisplayName: '芝士',
    credentialRef: 'dingtalk-credential-a', status: 'published', failureCode: null, version: 1
  }
  let intent: Record<string, unknown> = {
    publicationIntentId: 'intent-a', agentId: 'agent-a', accountId: owner.accountId,
    expectedUserIdDigest: owner.userIdDigest, expectedCorpId: owner.corpId,
    requestedAppName: '芝士', provisioningMode: 'direct_open_platform',
    state: 'completed', remoteUnifiedAppId: bot.unifiedAppId, appKey: bot.appKey,
    robotCode: bot.robotCode, credentialRef: bot.credentialRef, versionId: 'version-a',
    approvalMode: 'NO_APPROVAL', lastCompletedStep: 'completed', failureCode: null,
    version: 14, createdAt: '2026-08-30T00:00:00Z', updatedAt: '2026-08-30T00:00:00Z'
  }
  if (options.beforeApp) intent = { ...intent, state: options.beforeApp, remoteUnifiedAppId: null,
    appKey: null, robotCode: null, credentialRef: null, versionId: null, approvalMode: null,
    lastCompletedStep: options.beforeApp === 'created' ? null : options.beforeApp }
  let credential: DingTalkAppCredential | null = options.credentialPresent ? {
    appKey: bot.appKey, appSecret: 'fixture-recovered-secret', robotCode: bot.robotCode
  } : null
  let rejectedWrites = options.rejectCredentialWrites ?? 0
  const commands: string[] = []
  const core = {
    async request(method: string, params: { command?: Record<string, unknown> }): Promise<unknown> {
      if (method === 'channels.dingtalk.snapshot') return {
        schemaVersion: 1, account, memberBots: options.beforeApp ? [] : [bot], publicationIntents: [intent],
        pendingBindingCount: 0, bindingIssueCount: 0,
        transportConversations: [], pendingAggregates: []
      }
      if (method === 'members.get') return {
        agentId: 'agent-a', displayName: '芝士', avatarRef: null, teamRole: '鉴定士'
      }
      const command = params.command ?? {}
      commands.push(method)
      if (method === 'channels.dingtalk.publicationIntent.storeCredential') {
        if (rejectedWrites-- > 0) return { status: 'rejected', code: 'channel_storage_fixture_failed' }
        expect(command.credentialRef).toBe(bot.credentialRef)
        expect(command.remoteAppId).toBe(bot.appKey)
        expect(command.expectedIntentVersion).toBe(intent.version)
        credential = { appKey: bot.appKey, ...command.credential as Omit<DingTalkAppCredential, 'appKey'> }
        intent = { ...intent, version: Number(intent.version) + 1, failureCode: null }
      } else if (method === 'channels.dingtalk.publicationIntent.advance') {
        expect(command.expectedVersion).toBe(intent.version)
        intent = { ...intent, ...command, version: Number(intent.version) + 1 }
      } else if (method === 'channels.dingtalk.account.expire') {
        expect(command.accountId).toBe(account.accountId)
        expect(command.expectedVersion).toBe(account.version)
        account.status = 'oauth_expired'
        account.version += 1
      }
      return { status: 'applied', code: `${method}.applied`, payload: {} }
    }
  } as unknown as Pick<CoreClient, 'request'>
  const stream = new DingTalkStreamRegistry({
    onMessage: async () => undefined, onCard: async () => undefined
  })
  const streamStart = vi.spyOn(stream, 'start').mockResolvedValue(undefined)
  const api = new DingTalkOpenApiClient({ appKey: bot.appKey, appSecret: 'fixture-recovered-secret' })
  const verifyCard = vi.spyOn(api, 'createCardInstance').mockResolvedValue(undefined)
  const provision = vi.fn<DingTalkChannelHostDependencies['provisioner']['create']>(async (input) => {
    const facts = {
      unifiedAppId: bot.unifiedAppId, appKey: bot.appKey,
      appSecret: 'fixture-recovered-secret', robotCode: bot.robotCode, versionId: 'version-a'
    }
    await input.onStep('account_verified', {})
    await input.onStep('app_created', facts)
    await input.onStep('credentials_read', facts)
    await input.onStep('version_released', facts)
    return facts
  })
  const developerSession = {
    inspect: vi.fn<DingTalkDeveloperSessionService['inspect']>(async () => activeOwner),
    beginLogin: vi.fn<DingTalkDeveloperSessionService['beginLogin']>(async () => activeOwner),
    disconnect: vi.fn(async () => undefined)
  }
  const service = new DingTalkChannelSettingsService({
    core,
    developerSession,
    credentialStore: {
      readDingTalk: vi.fn(async () => credential),
      deleteDingTalk: vi.fn(async () => undefined),
      listPublished: vi.fn(async () => credential ? [{
        agentId: bot.agentId, provider: 'dingtalk' as const,
        credentialRef: bot.credentialRef, remoteAppId: bot.appKey, credential, revision: 1
      }] : [])
    },
    provisioner: { create: provision },
    avatarSource: { resolve: async () => ({ pngBytes: new Uint8Array([1, 2, 3]) }) },
    streamRegistry: stream,
    createApiClient: () => api
  })
  return { service, commands, provision, streamStart, verifyCard, developerSession,
    credential: () => credential, intent: () => intent }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

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
