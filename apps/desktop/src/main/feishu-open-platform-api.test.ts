import { describe, expect, it, vi } from 'vitest'
import type { FeishuOpenPlatformSession } from './feishu-developer-session'
import {
  FeishuOpenPlatformApiError,
  OpenPlatformApiClient,
  type FeishuMemberBotConsoleConfiguration
} from './feishu-open-platform-api'
import { ProvisioningTimingRecorder } from './feishu-provisioning-timing'

const configuration: FeishuMemberBotConsoleConfiguration = {
  appName: '叮叮',
  appDescription: 'Rovai AI 队员 · 游学者',
  avatarUrl: 'https://sf3-cn.feishucdn.com/obj/avatar.png',
  tenantScopes: [
    'im:message',
    'im:message.p2p_msg:readonly',
    'im:message.group_at_msg:readonly',
    'im:message:send_as_bot'
  ],
  tenantEvents: ['im.message.receive_v1']
}

describe('OpenPlatformApiClient', () => {
  it('uses the signed-in Session console APIs to create, configure, publish and verify a Bot', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    let manifest = '{}'
    let detailReads = 0
    let botEnabled = false
    let scopesConfigured = false
    let eventMode = 0
    let appEvents: string[] = []
    let callbackMode = 0
    const session = fakeSession(async (rawUrl, init) => {
      const url = new URL(rawUrl)
      calls.push({ url, init })
      if (url.pathname === '/developers/v1/app/upload/image') {
        return apiResponse({ url: configuration.avatarUrl })
      }
      if (url.pathname === '/developers/v1/manifest/upsert_by_template') {
        return apiResponse({ ClientID: 'cli_dingding', Avatar: configuration.avatarUrl })
      }
      if (url.pathname === '/developers/v1/secret/cli_dingding') {
        return apiResponse({ secret: 'app-secret' })
      }
      if (url.pathname === '/developers/v1/robot/switch/cli_dingding') {
        botEnabled = true
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/robot/cli_dingding') {
        return apiResponse({ enable: botEnabled })
      }
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({
          scopes: configuration.tenantScopes.map((name, index) => ({
            id: `scope_${index}`,
            name,
            status: scopesConfigured ? 5 : 0,
            supportScopeIdentityTypes: [2]
          }))
        })
      }
      if (url.pathname === '/developers/v1/scope/update/cli_dingding') {
        scopesConfigured = true
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({ eventMode, events: [], appEvents, userEvents: [] })
      }
      if (url.pathname === '/developers/v1/event/switch/cli_dingding') {
        eventMode = Number(jsonBody(init).eventMode)
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/event/update/cli_dingding') {
        appEvents = [...appEvents, ...stringBodyArray(jsonBody(init).appEvents)]
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        const callbacks = (
          JSON.parse(manifest) as { callbacks?: { items?: string[] } }
        ).callbacks?.items ?? []
        return apiResponse({ callbackMode, callbacks })
      }
      if (url.pathname === '/developers/v1/callback/switch/cli_dingding') {
        callbackMode = Number(jsonBody(init).callbackMode)
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: manifest })
      }
      if (url.pathname === '/developers/v1/manifest/upsert') {
        const body = jsonBody(init)
        manifest = String(body.appManifest)
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/app_version/create/cli_dingding') {
        return apiResponse({ versionId: 'version_1' })
      }
      if (url.pathname.includes('/app_version/detail/')) {
        detailReads += 1
        return apiResponse({ status: detailReads <= 2 ? 5 : 2 })
      }
      return apiResponse({})
    })
    const client = new OpenPlatformApiClient(session, {
      delay: async () => undefined,
      publishPollIntervalMs: 1,
      publishTimeoutMs: 5_000
    })

    const avatarUrl = await client.uploadAppIcon({
      pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      width: 192,
      height: 192
    })
    const app = await client.createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl,
      correlationId: 'rvfpi_intent1'
    })
    const secret = await client.readAppSecret(app.appId)
    await client.enableBot(app.appId)
    const configured = await client.configureMemberBot(app.appId, configuration)
    const versionId = await client.createVersion({
      appId: app.appId,
      ownerUserId: 'owner-user'
    })
    const published = await client.publishVersion(app.appId, versionId)
    await client.verifyMemberBot({
      appId: app.appId,
      versionId,
      configuration,
      verifiedConfiguration: configured.verified
    })

    expect(secret).toBe('app-secret')
    expect(published).toEqual({ versionId: 'version_1', status: 2 })
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      '/developers/v1/app/upload/image',
      '/developers/v1/manifest/upsert_by_template',
      '/developers/v1/secret/cli_dingding',
      '/developers/v1/robot/switch/cli_dingding',
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/callback/cli_dingding',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/scope/update/cli_dingding',
      '/developers/v1/event/switch/cli_dingding',
      '/developers/v1/event/update/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/callback/switch/cli_dingding',
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/callback/cli_dingding',
      '/developers/v1/app_version/create/cli_dingding',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/publish/commit/cli_dingding/version_1',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/publish/release/cli_dingding/version_1',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/robot/cli_dingding',
      '/developers/v1/app_version/detail/cli_dingding/version_1'
    ])
    const firstHeaders = new Headers(calls[0].init?.headers)
    expect(firstHeaders.get('x-csrf-token')).toBe('csrf-fixture')
    expect(calls.every(({ init }) => init?.credentials === 'include')).toBe(true)
    const uploadBody = calls[0].init?.body
    expect(uploadBody).toBeInstanceOf(FormData)
    expect((uploadBody as FormData).get('scale')).toBe('{"width":192,"height":192}')
    expect(jsonBody(calls.find(({ url }) => (
      url.pathname === '/developers/v1/manifest/upsert_by_template'
    ))?.init)).toEqual({
      appManifestTemplateID: 'developer_console',
      createAppUserCustomField: {
        i18n: {
          zh_cn: {
            name: configuration.appName,
            description: configuration.appDescription
          }
        },
        avatar: configuration.avatarUrl,
        primaryLang: 'zh_cn'
      },
      cid: 'rvfpi_intent1',
      HTTPHead: {}
    })
    expect(app.creationMode).toBe('template')

    const configuredManifest = JSON.parse(manifest) as Record<string, unknown>
    expect(configuredManifest).toMatchObject({
      manifest_schema_version: '0.0.1',
      avatar_url: configuration.avatarUrl,
      bot: { enable: true, menu_enable: false },
      scopes: { tenant: configuration.tenantScopes },
      events: {
        subscription_type: 'websocket',
        items: { tenant: configuration.tenantEvents }
      },
      callbacks: {
        subscription_type: 'websocket',
        items: ['card.action.trigger']
      }
    })
    expect(jsonBody(calls.find(({ url }) => (
      url.pathname === '/developers/v1/scope/update/cli_dingding'
    ))?.init)).toMatchObject({
      appScopeIDs: ['scope_0', 'scope_1', 'scope_2', 'scope_3'],
      userScopeIDs: [],
      scopeIds: [],
      operation: 'add'
    })
    expect(jsonBody(calls.find(({ url }) => (
      url.pathname === '/developers/v1/event/update/cli_dingding'
    ))?.init)).toMatchObject({
      operation: 'add',
      appEvents: ['im.message.receive_v1'],
      eventMode: 4
    })
  })

  it('keeps rejected response text and secrets out of the thrown error', async () => {
    const session = fakeSession(async () => new Response(JSON.stringify({
      code: 10042,
      msg: 'rejected because app-secret-was-here',
      data: { secret: 'do-not-leak' }
    }), { status: 200 }))

    const error = await new OpenPlatformApiClient(session)
      .readAppSecret('cli_dingding')
      .catch((reason: unknown): unknown => reason)

    expect(error).toBeInstanceOf(FeishuOpenPlatformApiError)
    expect(String(error)).toContain('feishu_console_read_secret_rejected_10042')
    expect(String(error)).not.toMatch(/app-secret-was-here|do-not-leak/)
  })

  it('does not misclassify a deleted App redirect as an expired Developer Session', async () => {
    const session = fakeSession(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://open.feishu.cn/app' }
    }))

    await expect(new OpenPlatformApiClient(session).readAppSecret(
      'cli_dingding'
    )).rejects.toMatchObject({
      code: 'feishu_console_remote_app_unavailable',
      outcomeUnknown: false
    })
  })

  it('reports an undocumented console denial as a connection error', async () => {
    const session = fakeSession(async () => new Response(JSON.stringify({
      code: 10003,
      msg: 'forbidden'
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' }
    }))

    await expect(new OpenPlatformApiClient(session).readAppSecret(
      'cli_dingding'
    )).rejects.toMatchObject({
      code: 'feishu_connection_error',
      outcomeUnknown: false
    })
  })

  it('does not infer a cause from another undocumented HTTP 403 code', async () => {
    const session = fakeSession(async () => new Response(JSON.stringify({
      code: 10042,
      msg: 'forbidden'
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' }
    }))

    await expect(new OpenPlatformApiClient(session).readAppSecret(
      'cli_dingding'
    )).rejects.toMatchObject({
      code: 'feishu_connection_error',
      outcomeUnknown: false
    })
  })

  it('still classifies HTTP 401 as an expired Developer Session', async () => {
    const session = fakeSession(async () => new Response(null, { status: 401 }))

    await expect(new OpenPlatformApiClient(session).readAppSecret(
      'cli_dingding'
    )).rejects.toMatchObject({
      code: 'feishu_developer_session_expired',
      outcomeUnknown: false
    })
  })

  it('still classifies an account-login redirect as an expired Developer Session', async () => {
    const session = fakeSession(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.feishu.cn/accounts/page/login' }
    }))

    await expect(new OpenPlatformApiClient(session).readAppSecret(
      'cli_dingding'
    )).rejects.toMatchObject({
      code: 'feishu_developer_session_expired',
      outcomeUnknown: false
    })
  })

  it('rejects a manifest-only message subscription when the online event state is not ready', async () => {
    const paths: string[] = []
    const manifest = JSON.stringify({
      avatar_url: configuration.avatarUrl,
      bot: { enable: true },
      scopes: { tenant: configuration.tenantScopes },
      events: {
        subscription_type: 'websocket',
        items: { tenant: configuration.tenantEvents }
      },
      callbacks: { subscription_type: 'websocket', items: [] }
    })
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: manifest })
      }
      if (url.pathname === '/developers/v1/app_version/detail/cli_dingding/version_1') {
        return apiResponse({ status: 2 })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({ eventMode: 0, events: [], appEvents: [], userEvents: [] })
      }
      if (url.pathname === '/developers/v1/robot/cli_dingding') {
        return apiResponse({ enable: true })
      }
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({
          scopes: configuration.tenantScopes.map((name, index) => ({
            id: `scope_${index}`,
            name,
            status: 5
          }))
        })
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        return apiResponse({ callbackMode: 0, callbacks: [] })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).verifyMemberBot({
      appId: 'cli_dingding',
      versionId: 'version_1',
      configuration
    })).rejects.toMatchObject({
      code: 'feishu_console_event_verification_failed'
    })
    expect(paths).toContain('/developers/v1/event/cli_dingding')
  })

  it('submits every configuration mutation before one shared readback and reconciles Manifest once', async () => {
    const paths: string[] = []
    let submittedAtPathCount = -1
    let manifest = JSON.stringify({ preserved: { value: true } })
    let mutationsComplete = false
    const session = fakeSession(async (rawUrl, init) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({ scopes: scopeCatalog(mutationsComplete ? 5 : 0) })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({
          eventMode: mutationsComplete ? 4 : 0,
          appEvents: mutationsComplete ? configuration.tenantEvents : []
        })
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        return apiResponse({
          callbackMode: mutationsComplete ? 4 : 0,
          callbacks: mutationsComplete ? ['card.action.trigger'] : []
        })
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: manifest })
      }
      if (url.pathname === '/developers/v1/manifest/upsert') {
        manifest = String(jsonBody(init).appManifest)
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/callback/switch/cli_dingding') {
        mutationsComplete = true
        return apiResponse({})
      }
      if ([
        '/developers/v1/scope/update/cli_dingding',
        '/developers/v1/event/switch/cli_dingding',
        '/developers/v1/event/update/cli_dingding'
      ].includes(url.pathname)) return apiResponse({})
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    const result = await new OpenPlatformApiClient(session).configureMemberBot(
      'cli_dingding',
      configuration,
      undefined,
      () => { submittedAtPathCount = paths.length }
    )

    expect(result.changed).toBe(true)
    expect(result.mutations).toEqual({
      scopesChanged: true,
      eventModeChanged: true,
      eventsChanged: true,
      callbackModeChanged: true,
      manifestChanged: true
    })
    expect(paths.filter((path) => path.includes('/manifest/get/'))).toHaveLength(1)
    expect(paths.filter((path) => path === '/developers/v1/manifest/upsert')).toHaveLength(1)
    const mutationPaths = paths.filter((path) => (
      path.includes('/scope/update/')
      || path.includes('/event/switch/')
      || path.includes('/event/update/')
      || path === '/developers/v1/manifest/upsert'
      || path.includes('/callback/switch/')
    ))
    expect(mutationPaths).toEqual([
      '/developers/v1/scope/update/cli_dingding',
      '/developers/v1/event/switch/cli_dingding',
      '/developers/v1/event/update/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/callback/switch/cli_dingding'
    ])
    expect(paths[submittedAtPathCount - 1]).toBe(
      '/developers/v1/callback/switch/cli_dingding'
    )
    const lastMutationIndex = paths.lastIndexOf('/developers/v1/callback/switch/cli_dingding')
    expect(paths.indexOf('/developers/v1/scope/all/cli_dingding', lastMutationIndex + 1))
      .toBeGreaterThan(lastMutationIndex)
    expect(JSON.parse(manifest)).toMatchObject({
      preserved: { value: true },
      scopes: { tenant: configuration.tenantScopes },
      events: { items: { tenant: configuration.tenantEvents }, subscription_type: 'websocket' },
      callbacks: { items: ['card.action.trigger'], subscription_type: 'websocket' }
    })
  })

  it('starts Scope, Event and Callback readbacks in parallel', async () => {
    const readbackRequests: string[] = []
    const scopeGate = deferred<Response>()
    const eventGate = deferred<Response>()
    const callbackGate = deferred<Response>()
    let scopeUpdated = false
    const manifest = configuredManifest(configuration)
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        if (!scopeUpdated) return apiResponse({ scopes: scopeCatalog(0) })
        readbackRequests.push('scope')
        return scopeGate.promise
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        if (!scopeUpdated) return apiResponse(readyEventState())
        readbackRequests.push('event')
        return eventGate.promise
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        if (!scopeUpdated) return apiResponse(readyCallbackState())
        readbackRequests.push('callback')
        return callbackGate.promise
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: manifest })
      }
      if (url.pathname === '/developers/v1/scope/update/cli_dingding') {
        scopeUpdated = true
        return apiResponse({})
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    const configuring = new OpenPlatformApiClient(session).configureMemberBot(
      'cli_dingding',
      configuration
    )
    await vi.waitFor(() => expect(readbackRequests).toEqual(['scope', 'event', 'callback']))
    scopeGate.resolve(apiResponse({ scopes: scopeCatalog(5) }))
    eventGate.resolve(apiResponse(readyEventState()))
    callbackGate.resolve(apiResponse(readyCallbackState()))
    await expect(configuring).resolves.toMatchObject({ changed: true })
  })

  it('keeps successful dimensions across a transient readback failure without replaying mutations', async () => {
    const readCounts = { scope: 0, event: 0, callback: 0 }
    let scopeUpdated = false
    let scopeMutations = 0
    const delay = vi.fn(async () => undefined)
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        if (!scopeUpdated) return apiResponse({ scopes: scopeCatalog(0) })
        readCounts.scope += 1
        return apiResponse({ scopes: scopeCatalog(5) })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        if (!scopeUpdated) return apiResponse(readyEventState())
        readCounts.event += 1
        if (readCounts.event === 1) throw new Error('transient network failure')
        return apiResponse(readyEventState())
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        if (!scopeUpdated) return apiResponse(readyCallbackState())
        readCounts.callback += 1
        return apiResponse(readyCallbackState())
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: configuredManifest(configuration) })
      }
      if (url.pathname === '/developers/v1/scope/update/cli_dingding') {
        scopeMutations += 1
        scopeUpdated = true
        return apiResponse({})
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session, { delay }).configureMemberBot(
      'cli_dingding',
      configuration
    )).resolves.toMatchObject({ changed: true })
    expect(scopeMutations).toBe(1)
    expect(readCounts).toEqual({ scope: 2, event: 2, callback: 2 })
    expect(delay).toHaveBeenCalledTimes(1)
  })

  it('uses one shared configuration deadline whose wall time is the slowest dimension', async () => {
    let monotonicMs = 0
    let mutationsComplete = false
    const delay = vi.fn(async (milliseconds: number) => { monotonicMs += milliseconds })
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({ scopes: scopeCatalog(mutationsComplete && monotonicMs >= 200 ? 5 : 0) })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({
          eventMode: mutationsComplete && monotonicMs >= 300 ? 4 : 0,
          appEvents: mutationsComplete && monotonicMs >= 300 ? configuration.tenantEvents : []
        })
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        return apiResponse({
          callbackMode: mutationsComplete && monotonicMs >= 400 ? 4 : 0,
          callbacks: mutationsComplete && monotonicMs >= 400 ? ['card.action.trigger'] : []
        })
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: '{}' })
      }
      if (url.pathname === '/developers/v1/callback/switch/cli_dingding') {
        mutationsComplete = true
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/manifest/upsert' || url.pathname.includes('/update/') || url.pathname.includes('/event/switch/')) {
        return apiResponse({})
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session, {
      configurationPollIntervalMs: 100,
      configurationTimeoutMs: 500,
      delay,
      now: () => monotonicMs
    }).configureMemberBot('cli_dingding', configuration)).resolves.toMatchObject({
      changed: true
    })
    expect(monotonicMs).toBe(400)
    expect(delay).toHaveBeenCalledTimes(4)
  })

  it('fails once at the shared deadline and never replays a configuration mutation', async () => {
    let monotonicMs = 0
    const mutations: string[] = []
    const timingLines: string[] = []
    const timing = new ProvisioningTimingRecorder({
      publicationIntentId: 'rvfpi_timeout',
      agentId: 'agent-a',
      appId: 'cli_dingding',
      recovering: false
    }, {
      now: () => monotonicMs,
      write: (line) => timingLines.push(line)
    })
    const delay = vi.fn(async (milliseconds: number) => { monotonicMs += milliseconds })
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({ scopes: scopeCatalog(0) })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({ eventMode: 0, appEvents: [] })
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        return apiResponse({ callbackMode: 0, callbacks: [] })
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: '{}' })
      }
      if (url.pathname.includes('/update/') || url.pathname.includes('/switch/') || url.pathname === '/developers/v1/manifest/upsert') {
        mutations.push(url.pathname)
        return apiResponse({})
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session, {
      configurationPollIntervalMs: 50,
      configurationTimeoutMs: 120,
      delay,
      now: () => monotonicMs,
      timing
    }).configureMemberBot('cli_dingding', configuration)).rejects.toMatchObject({
      code: 'feishu_console_scope_verification_failed'
    })
    expect(monotonicMs).toBe(120)
    expect(mutations).toHaveLength(5)
    expect(new Set(mutations).size).toBe(5)
    const configurationTiming = timingLines
      .map(parseProvisioningTimingLine)
      .find((sample) => sample.phase === 'configuration_convergence_ms')
    expect(configurationTiming).toMatchObject({
      durationMs: 120,
      outcome: 'failed',
      failureCode: 'feishu_console_scope_verification_failed',
      missingDimensions: ['scope', 'event', 'callback']
    })
  })

  it('fails before mutation when a critical P2P scope is absent from the initial parallel state', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({
          scopes: scopeCatalog(0).filter(({ name }) => name !== 'im:message.p2p_msg:readonly')
        })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') return apiResponse(readyEventState())
      if (url.pathname === '/developers/v1/callback/cli_dingding') return apiResponse(readyCallbackState())
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: configuredManifest(configuration) })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).configureMemberBot(
      'cli_dingding',
      configuration
    )).rejects.toMatchObject({ code: 'feishu_console_scope_catalog_missing' })
    expect(paths).toEqual([
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/callback/cli_dingding',
      '/developers/v1/manifest/get/cli_dingding'
    ])
  })

  it('does not upsert Manifest when all online and declared configuration is already current', async () => {
    const paths: string[] = []
    const timingLines: string[] = []
    const session = readyConfigurationSession(paths)

    const result = await new OpenPlatformApiClient(session, {
      timing: new ProvisioningTimingRecorder({
        publicationIntentId: 'rvfpi_current',
        agentId: 'agent-a',
        appId: 'cli_dingding',
        recovering: false
      }, { write: (line) => timingLines.push(line) })
    }).configureMemberBot(
      'cli_dingding',
      configuration
    )

    expect(result.changed).toBe(false)
    expect(paths).toEqual([
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/callback/cli_dingding',
      '/developers/v1/manifest/get/cli_dingding'
    ])
    expect(timingLines.map(parseProvisioningTimingLine).map((sample) => sample.phase)).toEqual([
      'scope_config_ms',
      'manifest_reconcile_ms',
      'event_convergence_ms',
      'callback_convergence_ms',
      'configuration_convergence_ms'
    ])
  })

  it('reuses exact convergence evidence but falls back to online reads when App or requirements differ', async () => {
    const paths: string[] = []
    const session = readyConfigurationSession(paths, true)
    const client = new OpenPlatformApiClient(session)
    const configured = await client.configureMemberBot('cli_dingding', configuration)
    paths.splice(0)

    await client.verifyMemberBot({
      appId: 'cli_dingding',
      versionId: 'version_1',
      configuration,
      verifiedConfiguration: configured.verified
    })
    expect(paths).toEqual([
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/robot/cli_dingding',
      '/developers/v1/app_version/detail/cli_dingding/version_1'
    ])

    paths.splice(0)
    await client.verifyMemberBot({
      appId: 'cli_dingding',
      versionId: 'version_1',
      configuration,
      verifiedConfiguration: { ...configured.verified, appId: 'cli_other' }
    })
    expect(paths).toContain('/developers/v1/scope/all/cli_dingding')
    expect(paths).toContain('/developers/v1/event/cli_dingding')
    expect(paths).toContain('/developers/v1/callback/cli_dingding')

    paths.splice(0)
    await expect(client.verifyMemberBot({
      appId: 'cli_dingding',
      versionId: 'version_1',
      configuration: {
        ...configuration,
        tenantEvents: [...configuration.tenantEvents, 'im.message.reaction.created_v1']
      },
      verifiedConfiguration: configured.verified
    })).rejects.toMatchObject({ code: 'feishu_console_event_verification_failed' })
    expect(paths).toContain('/developers/v1/scope/all/cli_dingding')
    expect(paths).toContain('/developers/v1/event/cli_dingding')
    expect(paths).toContain('/developers/v1/callback/cli_dingding')
  })

  it('requires both callback mode 4 and card.action.trigger during final verification', async () => {
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/developers/v1/robot/cli_dingding') {
        return apiResponse({ enable: true })
      }
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({
          scopes: configuration.tenantScopes.map((name, index) => ({
            id: `scope_${index}`,
            name,
            status: 5,
            supportScopeIdentityTypes: [2]
          }))
        })
      }
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({
          eventMode: 4,
          events: [],
          appEvents: configuration.tenantEvents,
          userEvents: []
        })
      }
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        return apiResponse({ callbackMode: 4, callbacks: [] })
      }
      if (url.pathname === '/developers/v1/app_version/detail/cli_dingding/version_1') {
        return apiResponse({ status: 2 })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).verifyMemberBot({
      appId: 'cli_dingding',
      versionId: 'version_1',
      configuration: {
        tenantScopes: configuration.tenantScopes,
        tenantEvents: configuration.tenantEvents
      }
    })).rejects.toMatchObject({ code: 'feishu_console_callback_verification_failed' })
  })

  it('reconciles a release HTTP 400 when the version was published remotely', async () => {
    let detailReads = 0
    let releaseRequests = 0
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname.includes('/app_version/detail/')) {
        detailReads += 1
        return apiResponse({ status: detailReads <= 2 ? 5 : 2 })
      }
      if (url.pathname.includes('/publish/release/')) {
        releaseRequests += 1
        return new Response(JSON.stringify({ code: 10001, msg: 'already released' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      return apiResponse({})
    })
    const client = new OpenPlatformApiClient(session, {
      delay: async () => undefined,
      publishPollIntervalMs: 1,
      publishTimeoutMs: 5_000
    })

    await expect(client.publishVersion('cli_dingding', 'version_1')).resolves.toEqual({
      versionId: 'version_1',
      status: 2
    })
    expect(detailReads).toBe(3)
    expect(releaseRequests).toBe(1)
  })

  it('finds the newest existing published version without creating or publishing a new one', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname.includes('/app_version/list/')) {
        return apiResponse({
          versions: [
            { versionId: 'version_1', appVersion: '1.0.0' },
            { versionId: 'version_2', appVersion: '1.0.1' }
          ]
        })
      }
      if (url.pathname.includes('/app_version/detail/')) {
        return apiResponse({ status: 2 })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).findPublishedVersion(
      'cli_dingding'
    )).resolves.toEqual({ versionId: 'version_2', status: 2, appVersion: '1.0.1' })
    expect(paths).toEqual([
      '/developers/v1/app_version/list/cli_dingding',
      '/developers/v1/app_version/detail/cli_dingding/version_2'
    ])
  })

  it('reuses an existing avatar repair version instead of creating a duplicate', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname.includes('/app_version/list/')) {
        return apiResponse({
          versions: [{ versionId: 'version_avatar', appVersion: '1.0.1' }]
        })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).createVersion({
      appId: 'cli_dingding',
      ownerUserId: 'owner-user',
      appVersion: '1.0.1',
      reuseExisting: true
    })).resolves.toBe('version_avatar')
    expect(paths).toEqual(['/developers/v1/app_version/list/cli_dingding'])
  })

  it('accepts the appID field returned by the current Feishu console', async () => {
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/developers/v1/manifest/upsert_by_template') {
        return apiResponse({
          appID: 'cli_gugu',
          avatar: configuration.avatarUrl
        })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl: configuration.avatarUrl,
      correlationId: 'rvfpi_intent1'
    })).resolves.toEqual({
      appId: 'cli_gugu',
      avatarUrl: configuration.avatarUrl,
      creationMode: 'template'
    })
  })

  it('falls back to self-build exactly once after a definite template rejection', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname === '/developers/v1/manifest/upsert_by_template') {
        return new Response(JSON.stringify({ code: 10001 }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.pathname === '/developers/v1/app/create') {
        return apiResponse({ ClientID: 'cli_fallback', Avatar: configuration.avatarUrl })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl: configuration.avatarUrl,
      correlationId: 'rvfpi_intent1'
    })).resolves.toMatchObject({
      appId: 'cli_fallback',
      creationMode: 'self_build_fallback'
    })
    expect(paths).toEqual([
      '/developers/v1/manifest/upsert_by_template',
      '/developers/v1/app/create'
    ])
  })

  it.each([
    ['HTTP 409', () => new Response(null, { status: 409 })],
    ['HTTP 500', () => new Response(null, { status: 500 })],
    ['a success envelope without ClientID', () => apiResponse({ Avatar: configuration.avatarUrl })],
    ['a redirect after the create mutation', () => new Response(null, {
      status: 302,
      headers: { location: 'https://open.feishu.cn/app' }
    })],
    ['an envelope without a result code', () => new Response(JSON.stringify({
      data: { ClientID: 'cli_untrusted' }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })]
  ])('does not self-build after ambiguous template outcome: %s', async (_label, response) => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      return response()
    })

    await expect(new OpenPlatformApiClient(session).createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl: configuration.avatarUrl,
      correlationId: 'rvfpi_intent1'
    })).rejects.toMatchObject({ outcomeUnknown: true })
    expect(paths).toEqual(['/developers/v1/manifest/upsert_by_template'])
  })

  it('does not self-build when the Developer Session expires during template creation', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      paths.push(new URL(rawUrl).pathname)
      return new Response(null, { status: 401 })
    })

    await expect(new OpenPlatformApiClient(session).createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl: configuration.avatarUrl,
      correlationId: 'rvfpi_intent1'
    })).rejects.toMatchObject({ code: 'feishu_developer_session_expired' })
    expect(paths).toEqual(['/developers/v1/manifest/upsert_by_template'])
  })

  it('marks a lost create response as an unknown remote outcome', async () => {
    const session = fakeSession(async () => {
      throw new Error('network response lost')
    })

    const error = await new OpenPlatformApiClient(session).createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl: configuration.avatarUrl,
      correlationId: 'rvfpi_intent1'
    }).catch((reason: unknown): unknown => reason)

    expect(error).toMatchObject({
      code: 'feishu_console_create_app_from_template_transport_failed',
      outcomeUnknown: true
    })
  })
})

function scopeCatalog(status: number) {
  return configuration.tenantScopes.map((name, index) => ({
    id: `scope_${index}`,
    name,
    status,
    supportScopeIdentityTypes: [2]
  }))
}

function readyEventState() {
  return {
    eventMode: 4,
    events: [],
    appEvents: configuration.tenantEvents,
    userEvents: []
  }
}

function readyCallbackState() {
  return { callbackMode: 4, callbacks: ['card.action.trigger'] }
}

function configuredManifest(value: FeishuMemberBotConsoleConfiguration): string {
  return JSON.stringify({
    manifest_schema_version: '0.0.1',
    avatar_url: value.avatarUrl,
    primary_language: 'zh_cn',
    i18ns: {
      zh_cn: {
        name: value.appName,
        description: value.appDescription
      }
    },
    bot: { enable: true, menu_enable: false },
    scopes: { tenant: value.tenantScopes, user: [] },
    events: {
      items: { tenant: value.tenantEvents, user: [] },
      subscription_type: 'websocket'
    },
    callbacks: {
      items: ['card.action.trigger'],
      subscription_type: 'websocket'
    }
  })
}

function readyConfigurationSession(
  paths: string[],
  includeFinalVerification = false
): FeishuOpenPlatformSession {
  return fakeSession(async (rawUrl) => {
    const url = new URL(rawUrl)
    paths.push(url.pathname)
    if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
      return apiResponse({ scopes: scopeCatalog(5) })
    }
    if (url.pathname === '/developers/v1/event/cli_dingding') {
      return apiResponse(readyEventState())
    }
    if (url.pathname === '/developers/v1/callback/cli_dingding') {
      return apiResponse(readyCallbackState())
    }
    if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
      return apiResponse({ appManifest: configuredManifest(configuration) })
    }
    if (includeFinalVerification && url.pathname === '/developers/v1/robot/cli_dingding') {
      return apiResponse({ enable: true })
    }
    if (
      includeFinalVerification
      && url.pathname === '/developers/v1/app_version/detail/cli_dingding/version_1'
    ) return apiResponse({ status: 2 })
    throw new Error(`unexpected request: ${url.pathname}`)
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function parseProvisioningTimingLine(line: string): Record<string, unknown> {
  const prefix = '[feishu.provision.timing] '
  if (!line.startsWith(prefix)) throw new Error('expected provisioning timing line')
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>
}

function fakeSession(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): FeishuOpenPlatformSession {
  return {
    brand: 'feishu',
    apiOrigin: 'https://open.feishu.cn',
    csrfToken: 'csrf-fixture',
    fetch: vi.fn(handler)
  }
}

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function jsonBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('expected JSON body')
  return JSON.parse(init.body) as Record<string, unknown>
}

function stringBodyArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('expected string array')
  }
  return value
}
