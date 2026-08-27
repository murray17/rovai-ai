import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FeishuDeveloperPortalSession,
  FeishuOpenPlatformSession
} from './feishu-developer-session'
import {
  FeishuWebSessionMemberBotProvisioner,
  isUnknownRemoteProvisioningError
} from './feishu-member-bot-provisioner'
import { FeishuOpenPlatformApiError } from './feishu-open-platform-api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Feishu Web Session member Bot provisioner', () => {
  it('uses only Open Platform console APIs for normal publishing', async () => {
    const progress: string[] = []
    const operations: string[] = []
    const portal = fakePortal()
    const client = fakeOpenPlatformClient(operations)
    const readDefaultAvatar = vi.fn(async () => ({
      pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      width: 192,
      height: 192
    }))
    const memberAvatar = new Uint8Array([1, 2, 3, 4])
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const result = await new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient: () => client,
      readDefaultAvatar
    }).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      avatarSource: { pngBytes: memberAvatar, width: 192, height: 192 },
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onProgress: (step) => progress.push(step)
    })

    expect(result).toEqual({
      appId: 'cli_dingding',
      appSecret: 'secret-dingding',
      botDisplayName: '叮叮',
      publishedVersionId: 'version_1'
    })
    expect(operations).toEqual([
      'upload_avatar',
      'create_app',
      'read_secret',
      'enable_bot',
      'configure_scopes',
      'configure_events',
      'configure_callbacks',
      'create_version',
      'publish_version',
      'verify'
    ])
    expect(progress).toEqual([
      'session_verified',
      'app_created',
      'bot_configured',
      'permissions_events_configured',
      'version_published'
    ])
    expect(portal.requireExpectedIdentity).toHaveBeenCalledWith({
      userId: 'owner-user',
      tenantId: 'tenant-1'
    })
    expect(portal.openPlatformSession).toHaveBeenCalledWith(expect.objectContaining({
      expectedIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    }))
    expect(client.uploadAppIcon).toHaveBeenCalledWith(expect.objectContaining({
      pngBytes: memberAvatar,
      width: 192,
      height: 192
    }))
    expect(readDefaultAvatar).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(portal.persist).toHaveBeenCalledTimes(1)
  })

  it('repairs the member avatar on the frozen published app without creating another app', async () => {
    const progress: string[] = []
    const operations: string[] = []
    const portal = fakePortal()
    const client = fakeOpenPlatformClient(operations)

    const result = await new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient: () => client
    }).reconcile({
      publicationIntentId: 'intent-unknown',
      agentId: 'agent-a',
      remoteAppId: 'cli_dingding',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      avatarSource: {
        pngBytes: new Uint8Array([9, 8, 7]),
        width: 192,
        height: 192
      },
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onProgress: (step) => progress.push(step)
    })

    expect(result).toEqual({
      appId: 'cli_dingding',
      appSecret: 'secret-dingding',
      botDisplayName: '叮叮',
      publishedVersionId: 'version_1'
    })
    expect(operations).toEqual([
      'read_secret',
      'find_published_version',
      'upload_avatar',
      'enable_bot',
      'configure_scopes',
      'configure_events',
      'configure_callbacks',
      'create_version',
      'publish_version',
      'verify'
    ])
    expect(progress).toEqual([
      'session_verified',
      'app_created',
      'bot_configured',
      'permissions_events_configured',
      'version_published'
    ])
    expect(client.createApp).not.toHaveBeenCalled()
    expect(client.createVersion).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'cli_dingding',
      appVersion: '1.0.1',
      reuseExisting: true
    }))
  })

  it('keeps reconciliation idempotent after the avatar repair version is published', async () => {
    const operations: string[] = []
    const portal = fakePortal()
    const client = fakeOpenPlatformClient(operations)
    client.findPublishedVersion.mockImplementation(async () => {
      operations.push('find_published_version')
      return { versionId: 'version_2', status: 2, appVersion: '1.0.1' }
    })

    const result = await new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient: () => client
    }).reconcile({
      publicationIntentId: 'intent-unknown',
      agentId: 'agent-a',
      remoteAppId: 'cli_dingding',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      avatarSource: {
        pngBytes: new Uint8Array([9, 8, 7]),
        width: 192,
        height: 192
      },
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    })

    expect(result.publishedVersionId).toBe('version_2')
    expect(operations).toEqual(['read_secret', 'find_published_version', 'verify'])
    expect(client.uploadAppIcon).not.toHaveBeenCalled()
    expect(client.createVersion).not.toHaveBeenCalled()
    expect(client.publishVersion).not.toHaveBeenCalled()
  })

  it('fails before opening the console when the expected identity cannot be proven', async () => {
    const portal = fakePortal()
    vi.mocked(portal.requireExpectedIdentity)
      .mockRejectedValue(new Error('feishu_developer_identity_changed'))
    const createClient = vi.fn()

    await expect(new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    })).rejects.toThrow('feishu_developer_identity_changed')

    expect(portal.openPlatformSession).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('marks a lost console create response as unknown remote state', async () => {
    const portal = fakePortal()
    const client = fakeOpenPlatformClient([])
    client.createApp.mockRejectedValue(new FeishuOpenPlatformApiError(
      'feishu_console_create_app_transport_failed',
      true
    ))
    const error = await new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient: () => client,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    }).catch((reason: unknown): unknown => reason)

    expect(error).toMatchObject({
      code: 'feishu_console_create_app_transport_failed',
      remoteState: 'unknown'
    })
    expect(isUnknownRemoteProvisioningError(error)).toBe(true)
  })

  it('marks a failure after app creation as unknown and exposes its app id through progress', async () => {
    const portal = fakePortal()
    const client = fakeOpenPlatformClient([])
    client.readAppSecret.mockRejectedValue(new FeishuOpenPlatformApiError(
      'feishu_console_read_secret_rejected_10042',
      false
    ))
    let remoteAppId: string | undefined
    const error = await new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient: () => client,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onProgress: (_step, appId) => { remoteAppId = appId ?? remoteAppId }
    }).catch((reason: unknown): unknown => reason)

    expect(remoteAppId).toBe('cli_dingding')
    expect(isUnknownRemoteProvisioningError(error)).toBe(true)
  })
})

function fakePortal(overrides: Partial<FeishuDeveloperPortalSession> = {}): FeishuDeveloperPortalSession {
  return {
    beginLogin: vi.fn(overrides.beginLogin ?? (async () => developerIdentity())),
    inspect: vi.fn(overrides.inspect ?? (async () => developerIdentity())),
    requireExpectedIdentity: vi.fn(
      overrides.requireExpectedIdentity ?? (async () => developerIdentity())
    ),
    disconnect: vi.fn(overrides.disconnect ?? (async () => undefined)),
    openPlatformSession: vi.fn(
      overrides.openPlatformSession ?? (async () => openPlatformSession())
    ),
    persist: vi.fn(overrides.persist ?? (async () => undefined))
  }
}

function openPlatformSession(): FeishuOpenPlatformSession {
  return {
    brand: 'feishu',
    apiOrigin: 'https://open.feishu.cn',
    csrfToken: 'csrf-fixture',
    fetch: vi.fn()
  }
}

function fakeOpenPlatformClient(operations: string[]) {
  return {
    uploadAppIcon: vi.fn(async () => {
      operations.push('upload_avatar')
      return 'https://sf3-cn.feishucdn.com/obj/avatar.png'
    }),
    createApp: vi.fn(async () => {
      operations.push('create_app')
      return {
        appId: 'cli_dingding',
        avatarUrl: 'https://sf3-cn.feishucdn.com/obj/avatar.png'
      }
    }),
    readAppSecret: vi.fn(async () => {
      operations.push('read_secret')
      return 'secret-dingding'
    }),
    enableBot: vi.fn(async () => { operations.push('enable_bot') }),
    configureScopes: vi.fn(async () => { operations.push('configure_scopes') }),
    configureEvents: vi.fn(async () => { operations.push('configure_events') }),
    configureCallbacksAndWebSocket: vi.fn(async () => {
      operations.push('configure_callbacks')
    }),
    createVersion: vi.fn(async () => {
      operations.push('create_version')
      return 'version_1'
    }),
    publishVersion: vi.fn(async () => {
      operations.push('publish_version')
      return { versionId: 'version_1', status: 2 }
    }),
    findPublishedVersion: vi.fn(async () => {
      operations.push('find_published_version')
      return { versionId: 'version_1', status: 2, appVersion: '1.0.0' }
    }),
    verifyMemberBot: vi.fn(async () => { operations.push('verify') })
  }
}

function developerIdentity() {
  return {
    brand: 'feishu' as const,
    userId: 'owner-user',
    userName: 'Murray',
    email: 'murray@example.com',
    tenantId: 'tenant-1',
    tenantName: '星海科技'
  }
}
