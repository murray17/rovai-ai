import { describe, expect, it, vi } from 'vitest'
import type { FeishuOpenPlatformSession } from './feishu-developer-session'
import {
  FeishuOpenPlatformApiError,
  OpenPlatformApiClient,
  type FeishuMemberBotConsoleConfiguration
} from './feishu-open-platform-api'

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
    const session = fakeSession(async (rawUrl, init) => {
      const url = new URL(rawUrl)
      calls.push({ url, init })
      if (url.pathname === '/developers/v1/app/upload/image') {
        return apiResponse({ url: configuration.avatarUrl })
      }
      if (url.pathname === '/developers/v1/app/create') {
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
            status: scopesConfigured ? (detailReads >= 2 ? 5 : 1) : 0,
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
        return apiResponse({ callbackMode: 0, callbacks: [] })
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
        return apiResponse({ status: detailReads === 1 ? 5 : 2 })
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
      avatarUrl
    })
    const secret = await client.readAppSecret(app.appId)
    await client.enableBot(app.appId)
    await client.configureScopes(app.appId, configuration)
    await client.configureEvents(app.appId, configuration)
    await client.configureCallbacksAndWebSocket(app.appId, configuration)
    const versionId = await client.createVersion({
      appId: app.appId,
      ownerUserId: 'owner-user'
    })
    const published = await client.publishVersion(app.appId, versionId)
    await client.verifyMemberBot({ appId: app.appId, versionId, configuration })

    expect(secret).toBe('app-secret')
    expect(published).toEqual({ versionId: 'version_1', status: 2 })
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      '/developers/v1/app/upload/image',
      '/developers/v1/app/create',
      '/developers/v1/secret/cli_dingding',
      '/developers/v1/robot/switch/cli_dingding',
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/scope/update/cli_dingding',
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/event/switch/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/event/update/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/callback/cli_dingding',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/app_version/create/cli_dingding',
      '/developers/v1/publish/commit/cli_dingding/version_1',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/publish/release/cli_dingding/version_1',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/robot/cli_dingding',
      '/developers/v1/scope/all/cli_dingding',
      '/developers/v1/event/cli_dingding',
      '/developers/v1/callback/cli_dingding',
      '/developers/v1/app_version/detail/cli_dingding/version_1'
    ])
    const firstHeaders = new Headers(calls[0].init?.headers)
    expect(firstHeaders.get('x-csrf-token')).toBe('csrf-fixture')
    expect(calls.every(({ init }) => init?.credentials === 'include')).toBe(true)
    const uploadBody = calls[0].init?.body
    expect(uploadBody).toBeInstanceOf(FormData)
    expect((uploadBody as FormData).get('scale')).toBe('{"width":192,"height":192}')

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
      callbacks: { items: [] }
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

  it('fails closed when the event mode switch does not become effective', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname === '/developers/v1/event/cli_dingding') {
        return apiResponse({ eventMode: 0, appEvents: [] })
      }
      if (url.pathname === '/developers/v1/event/switch/cli_dingding') {
        return apiResponse({})
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).configureEvents(
      'cli_dingding',
      configuration
    )).rejects.toMatchObject({ code: 'feishu_console_event_verification_failed' })
    expect(paths).toEqual([
      '/developers/v1/event/cli_dingding',
      '/developers/v1/event/switch/cli_dingding',
      '/developers/v1/event/cli_dingding'
    ])
  })

  it('fails before mutation when a critical P2P scope is absent from the catalog', async () => {
    const paths: string[] = []
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      paths.push(url.pathname)
      if (url.pathname === '/developers/v1/scope/all/cli_dingding') {
        return apiResponse({
          scopes: configuration.tenantScopes
            .filter((name) => name !== 'im:message.p2p_msg:readonly')
            .map((name, index) => ({ id: `scope_${index}`, name, status: 0 }))
        })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).configureScopes(
      'cli_dingding',
      configuration
    )).rejects.toMatchObject({ code: 'feishu_console_scope_catalog_missing' })
    expect(paths).toEqual(['/developers/v1/scope/all/cli_dingding'])
  })

  it('switches an enabled callback subscription to long connection and reads it back', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    let callbackMode = 1
    let manifest = '{}'
    const session = fakeSession(async (rawUrl, init) => {
      const url = new URL(rawUrl)
      calls.push({ url, init })
      if (url.pathname === '/developers/v1/callback/cli_dingding') {
        return apiResponse({ callbackMode, callbacks: ['card.action.trigger'] })
      }
      if (url.pathname === '/developers/v1/callback/switch/cli_dingding') {
        callbackMode = Number(jsonBody(init).callbackMode)
        return apiResponse({})
      }
      if (url.pathname === '/developers/v1/manifest/get/cli_dingding') {
        return apiResponse({ appManifest: manifest })
      }
      if (url.pathname === '/developers/v1/manifest/upsert') {
        manifest = String(jsonBody(init).appManifest)
        return apiResponse({})
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    })

    await expect(new OpenPlatformApiClient(session).configureCallbacksAndWebSocket(
      'cli_dingding',
      configuration
    )).resolves.toBeUndefined()
    expect(jsonBody(calls.find(({ url }) => (
      url.pathname === '/developers/v1/callback/switch/cli_dingding'
    ))?.init)).toEqual({ clientId: 'cli_dingding', callbackMode: 4 })
  })

  it('reconciles a release HTTP 400 when the version was published remotely', async () => {
    let detailReads = 0
    let releaseRequests = 0
    const session = fakeSession(async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname.includes('/app_version/detail/')) {
        detailReads += 1
        return apiResponse({ status: detailReads === 1 ? 5 : 2 })
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
    expect(detailReads).toBe(2)
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

  it('marks a lost create response as an unknown remote outcome', async () => {
    const session = fakeSession(async () => {
      throw new Error('network response lost')
    })

    const error = await new OpenPlatformApiClient(session).createApp({
      appName: configuration.appName,
      appDescription: configuration.appDescription,
      avatarUrl: configuration.avatarUrl
    }).catch((reason: unknown): unknown => reason)

    expect(error).toMatchObject({
      code: 'feishu_console_create_app_transport_failed',
      outcomeUnknown: true
    })
  })
})

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
