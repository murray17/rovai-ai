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
  tenantScopes: ['im:message', 'im:message:send_as_bot'],
  tenantEvents: ['im.message.receive_v1']
}

describe('OpenPlatformApiClient', () => {
  it('uses the signed-in Session console APIs to create, configure, publish and verify a Bot', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    let manifest = '{}'
    let detailReads = 0
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
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/manifest/get/cli_dingding',
      '/developers/v1/manifest/upsert',
      '/developers/v1/app_version/create/cli_dingding',
      '/developers/v1/publish/commit/cli_dingding/version_1',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/publish/release/cli_dingding/version_1',
      '/developers/v1/app_version/detail/cli_dingding/version_1',
      '/developers/v1/manifest/get/cli_dingding',
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
      bot: { enable: true, menu_enable: false },
      scopes: { tenant: configuration.tenantScopes },
      events: {
        subscription_type: 'websocket',
        items: { tenant: configuration.tenantEvents }
      },
      callbacks: { subscription_type: 'websocket', items: [] }
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
