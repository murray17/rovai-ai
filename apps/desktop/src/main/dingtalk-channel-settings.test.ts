import { describe, expect, it, vi } from 'vitest'
import type { CoreClient } from './core-client'
import {
  DINGTALK_REQUIRED_SCOPE_VALUES,
  DingTalkChannelSettingsService,
  type DingTalkExecutionConsoleSource,
  type DingTalkChannelHostDependencies,
  dingtalkCardCallbackValue,
  dingtalkMemberBotWelcomeCardParams,
  dingtalkOutTrackId,
  executionCardParams,
  hasCanonicalSingleDingTalkBotTarget,
  presentDingTalkAppIds,
  projectCardParams,
  selectSingleDingTalkInboundObservation,
  shouldAdvanceDingTalkPublicationStep
} from './dingtalk-channel-settings'
import type {
  DingTalkDeveloperIdentity,
  DingTalkDeveloperSessionService
} from './dingtalk-developer-session'
import type { DingTalkAppCredential } from './channel-credential-store'
import { DingTalkOpenApiClient, encodeDingTalkCardActionId } from './dingtalk-open-api'
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
      await expect(fixture.service.connect()).resolves.toBeUndefined()
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
      await vi.waitFor(() => expect(fixture.commands).toContain('channels.dingtalk.host.tick'))
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
    const assertion = expect(connecting).resolves.toBeUndefined()
    await vi.waitFor(() => expect(fixture.developerSession.beginLogin).toHaveBeenCalled())
    const attempt = (await fixture.service.get()).activeQrAttempt!

    await fixture.service.cancelLogin(attempt.attemptId)
    login.resolve(identity('corp-other', 'owner-other'))
    await assertion
    expect(fixture.commands).not.toContain('channels.dingtalk.account.commitConnection')
    expect((await fixture.service.get()).provider.connection.account?.accountId).toBe('account-corp-a')
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
  })

  it.each(['Error', 'DingTalkConsoleError'])('finishes a cancelled login silently for %s and preserves the account', async (name) => {
    const fixture = completedBotFixture({ credentialPresent: true })
    fixture.developerSession.beginLogin.mockRejectedValueOnce(Object.assign(
      new Error('dingtalk_operation_cancelled'), { name }
    ))

    await expect(fixture.service.connect()).resolves.toBeUndefined()

    expect(fixture.developerSession.discardPendingLogin).toHaveBeenCalledOnce()
    expect(fixture.developerSession.disconnect).not.toHaveBeenCalled()
    expect(fixture.commands).not.toContain('channels.dingtalk.account.commitConnection')
    expect(fixture.commands).not.toContain('channels.dingtalk.account.expire')
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
    expect((await fixture.service.get()).provider.connection).toMatchObject({
      status: 'connected', account: { accountId: 'account-corp-a' }
    })
    expect(fixture.credential()?.appKey).toBe('ding-app-a')
  })

  it('projects QR stages and gates refresh/native viewport by the current attempt', async () => {
    const fixture = completedBotFixture()
    const login = deferred<DingTalkDeveloperIdentity>()
    fixture.developerSession.beginLogin.mockReturnValueOnce(login.promise)
    const connecting = fixture.service.connect()
    await vi.waitFor(() => expect(fixture.developerSession.beginLogin).toHaveBeenCalledOnce())
    const options = fixture.developerSession.beginLogin.mock.calls[0]![0]
    const attemptId = (await fixture.service.get()).activeQrAttempt!.attemptId
    const bounds = { x: 20, y: 100, width: 600, height: 400 }
    const qr = { payload: 'data:image/png;base64,aW1hZ2U=', expiresAt: null } as const

    options.onQrReady?.(qr)
    expect((await fixture.service.get()).activeQrAttempt).toMatchObject({
      attemptId, stage: 'awaiting_scan', qrDataUrl: qr.payload, expiresAt: null
    })
    fixture.service.setLoginViewBounds(attemptId, bounds)
    fixture.service.refreshLoginQr('stale-attempt')
    expect(fixture.developerSession.setLoginViewBounds).not.toHaveBeenCalled()
    expect(fixture.developerSession.refreshLoginQr).not.toHaveBeenCalled()
    fixture.service.refreshLoginQr(attemptId)
    expect(fixture.developerSession.refreshLoginQr).toHaveBeenCalledOnce()

    options.onStage?.('scan_confirmed')
    expect((await fixture.service.get()).activeQrAttempt?.qrDataUrl).toBeNull()
    fixture.service.refreshLoginQr(attemptId)
    expect(fixture.developerSession.refreshLoginQr).toHaveBeenCalledOnce()
    options.onStage?.('awaiting_interaction')
    fixture.service.setLoginViewBounds('stale-attempt', bounds)
    fixture.service.setLoginViewBounds(attemptId, bounds)
    expect(fixture.developerSession.setLoginViewBounds).toHaveBeenCalledExactlyOnceWith(bounds)

    options.onStage?.('expired')
    fixture.service.refreshLoginQr(attemptId)
    expect(fixture.developerSession.refreshLoginQr).toHaveBeenCalledTimes(2)
    await fixture.service.cancelLogin('stale-attempt')
    expect(options.signal.aborted).toBe(false)
    await fixture.service.cancelLogin(attemptId)
    expect(options.signal.aborted).toBe(true)
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
    expect(fixture.developerSession.setLoginViewBounds).toHaveBeenLastCalledWith(null)
    // Late DOM observations and queued geometry must not resurrect a cancelled dialog.
    options.onQrReady?.(qr)
    options.onStage?.('awaiting_interaction')
    fixture.service.refreshLoginQr(attemptId)
    fixture.service.setLoginViewBounds(attemptId, bounds)
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
    expect(fixture.developerSession.refreshLoginQr).toHaveBeenCalledTimes(2)
    expect(fixture.developerSession.setLoginViewBounds).toHaveBeenCalledTimes(2)
    await expect(fixture.service.connect()).rejects.toThrow('已有一个钉钉登录流程')
    login.resolve(identity('corp-other', 'owner-other'))
    await expect(connecting).resolves.toBeUndefined()
    expect(fixture.commands).not.toContain('channels.dingtalk.account.commitConnection')
    expect(fixture.provision).not.toHaveBeenCalled()
  })

  it('clears a failed initial snapshot attempt so the Owner can reconnect again', async () => {
    const fixture = completedBotFixture()
    vi.spyOn(fixture.core, 'request').mockRejectedValueOnce(new Error('channel_storage_unavailable'))
    await expect(fixture.service.connect()).rejects.toThrow('channel_storage_unavailable')
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
    fixture.developerSession.beginLogin.mockRejectedValueOnce(new Error('dingtalk_operation_cancelled'))
    await expect(fixture.service.connect()).resolves.toBeUndefined()
    expect(fixture.developerSession.beginLogin).toHaveBeenCalledOnce()
  })

  it.each(['dingtalk_open_platform_unavailable', 'dingtalk_login_timeout'])('still reports a real login failure: %s', async (code) => {
    const fixture = completedBotFixture()
    fixture.developerSession.beginLogin.mockRejectedValueOnce(Object.assign(new Error(code), { name: 'DingTalkConsoleError' }))

    await expect(fixture.service.connect()).rejects.toThrow(code)

    expect(fixture.developerSession.discardPendingLogin).toHaveBeenCalledOnce()
    expect((await fixture.service.get()).activeQrAttempt).toBeNull()
    expect((await fixture.service.get()).provider.connection.status).toBe('connected')
  })

  it('recovers a completed Bot missing its SQLite credential from the same frozen application', async () => {
    const fixture = completedBotFixture()

    await expect(fixture.service.publish('agent-a')).resolves.toBeUndefined()

    expect(fixture.provision).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Rovai AI Teammate · 鉴定士',
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
    expect(fixture.welcomeCard).not.toHaveBeenCalled()
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

  it('sends one private welcome card after a new Bot publication completes', async () => {
    const fixture = completedBotFixture({ beforeApp: 'created' })

    await fixture.service.publish('agent-a')

    expect(fixture.welcomeCard).toHaveBeenCalledOnce()
    expect(fixture.welcomeCard).toHaveBeenCalledWith({
      outTrackId: dingtalkOutTrackId('welcome', 'intent-a'),
      openSpaceId: 'dtv1.card//IM_ROBOT.owner-a',
      robotCode: 'robot-a',
      space: 'p2p',
      cardParamMap: dingtalkMemberBotWelcomeCardParams('芝士')
    })
    expect(fixture.intent()).toMatchObject({ state: 'completed' })
  })

  it('keeps a new Bot publication completed when the welcome card fails', async () => {
    const fixture = completedBotFixture({ beforeApp: 'created' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fixture.welcomeCard.mockRejectedValueOnce(new Error('dingtalk_open_api_http_503'))

    try {
      await expect(fixture.service.publish('agent-a')).resolves.toBeUndefined()

      expect(fixture.welcomeCard).toHaveBeenCalledOnce()
      expect(fixture.intent()).toMatchObject({ state: 'completed', lastCompletedStep: 'completed' })
      expect(warn).toHaveBeenCalledWith(
        '[rovai] DingTalk member Bot welcome failed: dingtalk_open_api_http_503'
      )
    } finally {
      warn.mockRestore()
    }
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

  it('renders the active execution card as three state actions without elapsed copy', () => {
    const params = executionCardParams(executionSource('running'), {
      executionViewUrl: 'http://192.168.1.23:8765/execution/run-1#t=grant',
      recentOutputVisible: false
    })
    const system = JSON.parse(params.sys_full_json_obj) as {
      msgButtons: Array<{ text: string; request?: boolean; url?: string }>
    }

    expect(params.msgTitle).toBe('爱丽丝 · 执行中')
    expect(params.staticMsgContent).toBe('')
    expect(system.msgButtons.map((button) => button.text)).toEqual([
      '显示最近输出', '打开执行台', '停止执行'
    ])
    expect(system.msgButtons.map((button) => button.request === true ? 'callback' : 'url')).toEqual([
      'callback', 'url', 'callback'
    ])
    expect(JSON.stringify(params)).not.toMatch(/秒|用时/u)
  })

  it('removes stop from terminal cards and keeps recent output as an Owner callback', () => {
    const source = executionSource('cancelled')
    source.publicOutput = '最终公开输出'
    const params = executionCardParams(source, {
      executionViewUrl: 'http://192.168.1.23:8765/execution/run-1#t=grant',
      recentOutputVisible: true
    })
    const system = JSON.parse(params.sys_full_json_obj) as {
      order: string[]
      msgButtons: Array<{ text: string }>
    }

    expect(params.msgTitle).toBe('爱丽丝 · 已取消')
    expect(params.staticMsgContent).toContain('最终公开输出')
    expect(system.order).toEqual(['msgTitle', 'staticMsgContent', 'msgButtons'])
    expect(system.msgButtons.map((button) => button.text)).toEqual([
      '收起最近输出', '打开执行台'
    ])
  })

  it('truncates long command labels and never includes command results in DingTalk', () => {
    const source = executionSource('succeeded')
    source.evidence = [{
      id: 'evidence-1', agentRunId: 'run-1', executionEpoch: 1, sequence: 1,
      eventType: 'activity.completed', kind: 'command', phase: 'completed',
      payload: {
        item: {
          type: 'commandExecution',
          command: `pnpm vitest ${'apps/desktop/really-long-directory/'.repeat(4)}final.test.ts`,
          status: 'completed',
          aggregatedOutput: 'must-not-show-command-result'
        }
      },
      contentBlobId: null, contentByteCount: 0, isTruncated: false,
      occurredAt: '2026-09-01T00:00:01Z', canonical: null
    }]
    const params = executionCardParams(source, {
      executionViewUrl: null,
      recentOutputVisible: true
    })

    expect(params.staticMsgContent).toMatch(/^✓ \$ pnpm vitest /u)
    expect(params.staticMsgContent).toContain('…')
    expect(params.staticMsgContent).toMatch(/final\.test\.ts$/u)
    expect(params.staticMsgContent).not.toContain('must-not-show-command-result')
  })

  it('reads an encoded action from the official nested card callback content', () => {
    const value = {
      action: 'execution_recent_output',
      agentRunId: 'run-1',
      visible: true
    }

    expect(dingtalkCardCallbackValue({
      outTrackId: 'card-1',
      content: JSON.stringify({
        cardPrivateData: {
          actionIds: [encodeDingTalkCardActionId(value)],
          params: {}
        }
      })
    })).toEqual(value)
  })

  it('offers Quick Chat even when the DingTalk project catalog is empty', () => {
    const params = projectCardParams({
      pendingBindingId: 'pending-1', expectedVersion: 1, nonce: 'nonce-1', projectOptions: []
    }, false)
    const system = JSON.parse(params.sys_full_json_obj) as {
      msgButtons: Array<{ text: string; id: string }>
    }

    expect(system.msgButtons.map((button) => button.text)).toEqual([
      '开始快速对话', '刷新项目'
    ])
    expect(dingtalkCardCallbackValue({
      content: JSON.stringify({
        cardPrivateData: { actionIds: [system.msgButtons[0].id], params: {} }
      })
    })).toMatchObject({ action: 'quick_chat' })
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
      chatbotUserId: 'ding-bot-user-a',
      atUsers: [{ staffId: null, dingtalkId: 'ding-bot-user-a' }]
    })).toBe(true)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true,
      chatbotUserId: 'ding-bot-user-a', atUsers: []
    })).toBe(false)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true,
      chatbotUserId: 'ding-bot-user-a',
      atUsers: [{ staffId: null, dingtalkId: 'ding-other-bot-user' }]
    })).toBe(false)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true,
      chatbotUserId: null,
      atUsers: [{ staffId: null, dingtalkId: 'ding-bot-user-a' }]
    })).toBe(false)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'group', explicitlyAtBot: true,
      chatbotUserId: 'ding-bot-user-a',
      atUsers: [
        { staffId: null, dingtalkId: 'ding-bot-user-a' },
        { staffId: 'colleague-user', dingtalkId: null }
      ]
    })).toBe(true)
    expect(hasCanonicalSingleDingTalkBotTarget({
      conversationKind: 'p2p', explicitlyAtBot: true,
      chatbotUserId: null, atUsers: []
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
      if (method === 'channels.dingtalk.host.tick') {
        expect(params).toEqual({ workerId: expect.any(String), limit: 20 })
        return { deliveries: [], rosterRefreshes: [] }
      }
      if (method === 'channels.dingtalk.publicationIntent.storeCredential') {
        if (rejectedWrites-- > 0) return { status: 'rejected', code: 'channel_storage_fixture_failed' }
        if (options.beforeApp) expect(command.credentialRef).toMatch(/^dingtalk-/u)
        else expect(command.credentialRef).toBe(bot.credentialRef)
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
  const welcomeCard = vi.spyOn(api, 'createAndDeliverCard').mockResolvedValue('rv-welcome')
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
    setLoginViewBounds: vi.fn<NonNullable<DingTalkDeveloperSessionService['setLoginViewBounds']>>(),
    refreshLoginQr: vi.fn<NonNullable<DingTalkDeveloperSessionService['refreshLoginQr']>>(),
    discardPendingLogin: vi.fn(async () => activeOwner),
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
  return { service, core, commands, provision, streamStart, verifyCard, welcomeCard, developerSession,
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

function executionSource(
  status: DingTalkExecutionConsoleSource['run']['status']
): DingTalkExecutionConsoleSource {
  return {
    sequence: 1,
    agentRunId: 'run-1',
    campId: 'camp-1',
    campTurnId: 'turn-1',
    channelConversationId: 'channel-conversation-1',
    agentId: 'agent-alice',
    agentDisplayName: '爱丽丝',
    run: { status, waitReason: null, terminalReasonCode: null },
    runCreatedAt: '2026-09-01T00:00:00Z',
    evidence: [],
    publicOutput: null,
    startedAt: '2026-09-01T00:00:01Z',
    terminalAt: status === 'running' ? null : '2026-09-01T00:00:02Z',
    targetAppId: 'ding-app-alice',
    externalMessageId: 'card-run-1',
    state: status === 'running' ? 'active' : 'terminal_sealed'
  }
}
