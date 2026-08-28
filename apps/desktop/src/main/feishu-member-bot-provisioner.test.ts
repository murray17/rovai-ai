import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FeishuDeveloperPortalSession,
  FeishuOpenPlatformSession
} from './feishu-developer-session'
import {
  FeishuWebSessionMemberBotProvisioner,
  isUnknownRemoteProvisioningError
} from './feishu-member-bot-provisioner'
import {
  FeishuOpenPlatformApiError,
  type FeishuPublishedVersionSummary
} from './feishu-open-platform-api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function provisioner(
  portal: FeishuDeveloperPortalSession,
  options: ConstructorParameters<typeof FeishuWebSessionMemberBotProvisioner>[1]
): FeishuWebSessionMemberBotProvisioner {
  return new FeishuWebSessionMemberBotProvisioner(portal, {
    resolveOwnerOpenId: async () => 'ou_owner_for_app',
    ...options
  })
}

describe('Feishu Web Session member Bot provisioner', () => {
  it('publishes through the console and resolves Owner from the App creator', async () => {
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
    const applicationGet = vi.fn(async () => {
      operations.push('resolve_owner')
      return {
        code: 0,
        data: {
          app: {
            app_id: 'cli_dingding',
            creator_id: 'ou_owner_for_app'
          }
        }
      }
    })
    const createOwnerIdentityClient = vi.fn(() => ({
      application: {
        v6: {
          application: { get: applicationGet }
        }
      }
    }))
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const result = await new FeishuWebSessionMemberBotProvisioner(portal, {
      createClient: () => client,
      readDefaultAvatar,
      createOwnerIdentityClient
    }).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      avatarSource: { pngBytes: memberAvatar, width: 192, height: 192 },
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onRemoteAppCreated: async ({ appId, creationMode }) => {
        operations.push('freeze_app')
        expect({ appId, creationMode }).toEqual({
          appId: 'cli_dingding',
          creationMode: 'template'
        })
      },
      onProgress: (step) => progress.push(step)
    })

    expect(result).toEqual({
      appId: 'cli_dingding',
      appSecret: 'secret-dingding',
      ownerOpenId: 'ou_owner_for_app',
      botDisplayName: '叮叮',
      publishedVersionId: 'version_2'
    })
    expect(operations).toEqual([
      'upload_avatar',
      'create_app',
      'freeze_app',
      'read_secret',
      'enable_bot',
      'request_event',
      'create_version',
      'publish_version',
      'configure_scopes',
      'configure_events',
      'configure_callbacks',
      'create_version',
      'publish_version',
      'verify',
      'resolve_owner'
    ])
    expect(progress).toEqual([
      'session_verified',
      'app_created',
      'activation_started',
      'activation_published',
      'configuration_started',
      'configuration_waiting',
      'configuration_verified',
      'version_published',
      'online_verified'
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
    expect(client.createVersion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      appVersion: '1.0.0',
      remark: '启用飞书队员 Bot',
      changeLog: '启用 Bot 并请求长连接事件模式。',
      reuseExisting: true
    }))
    expect(client.configureScopes).toHaveBeenCalledWith(
      'cli_dingding',
      expect.objectContaining({
        tenantScopes: expect.arrayContaining(['application:application:self_manage'])
      }),
      undefined
    )
    expect(client.configureScopes).toHaveBeenCalledWith(
      'cli_dingding',
      expect.objectContaining({
        tenantScopes: expect.not.arrayContaining(['contact:contact.base:readonly'])
      }),
      undefined
    )
    expect(createOwnerIdentityClient).toHaveBeenCalledWith({
      brand: 'feishu',
      appId: 'cli_dingding',
      appSecret: 'secret-dingding'
    })
    expect(applicationGet).toHaveBeenCalledWith({
      path: { app_id: 'cli_dingding' },
      params: { lang: 'zh_cn', user_id_type: 'open_id' }
    })
    expect(readDefaultAvatar).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(portal.persist).toHaveBeenCalledTimes(1)
  })

  it('does not read the secret until the durable App-ID barrier resolves', async () => {
    const operations: string[] = []
    const client = fakeOpenPlatformClient(operations)
    let releaseBarrier: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve })

    const provisioning = provisioner(fakePortal(), {
      createClient: () => client,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-barrier',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onRemoteAppCreated: async () => barrier
    })

    await vi.waitFor(() => expect(client.createApp).toHaveBeenCalledTimes(1))
    expect(client.readAppSecret).not.toHaveBeenCalled()
    releaseBarrier?.()
    await provisioning
    expect(operations.indexOf('read_secret')).toBeGreaterThan(operations.indexOf('create_app'))
  })

  it('stops every later remote mutation when the durable App-ID barrier rejects', async () => {
    const client = fakeOpenPlatformClient([])

    await expect(provisioner(fakePortal(), {
      createClient: () => client,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-barrier-rejected',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onRemoteAppCreated: async () => { throw new Error('core_freeze_failed') }
    })).rejects.toMatchObject({
      code: 'core_freeze_failed',
      remoteState: 'create_outcome_unknown'
    })

    expect(client.readAppSecret).not.toHaveBeenCalled()
    expect(client.enableBot).not.toHaveBeenCalled()
    expect(client.configureScopes).not.toHaveBeenCalled()
    expect(client.createVersion).not.toHaveBeenCalled()
  })

  it('skips the final patch version when post-activation configuration is already current', async () => {
    const progress: string[] = []
    const operations: string[] = []
    const client = fakeOpenPlatformClient(operations)
    client.configureScopes.mockImplementation(async () => {
      operations.push('configure_scopes')
      return { changed: false }
    })
    client.configureEvents.mockImplementation(async () => {
      operations.push('configure_events')
      return { changed: false }
    })
    client.configureCallbacksAndWebSocket.mockImplementation(async () => {
      operations.push('configure_callbacks')
      return { changed: false }
    })

    const result = await provisioner(fakePortal(), {
      createClient: () => client,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-current',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onRemoteAppCreated: async () => undefined,
      onProgress: (step) => progress.push(step)
    })

    expect(result.publishedVersionId).toBe('version_1')
    expect(client.createVersion).toHaveBeenCalledTimes(1)
    expect(client.publishVersion).toHaveBeenCalledTimes(1)
    expect(progress).not.toContain('configuration_verified')
    expect(progress).toEqual([
      'session_verified',
      'app_created',
      'activation_started',
      'activation_published',
      'configuration_started',
      'configuration_waiting',
      'version_published',
      'online_verified'
    ])
  })

  it('keeps an Event convergence failure recoverable after durable freeze', async () => {
    const client = fakeOpenPlatformClient([])
    client.configureEvents.mockRejectedValue(new FeishuOpenPlatformApiError(
      'feishu_console_event_verification_failed',
      true
    ))

    const error = await provisioner(fakePortal(), {
      createClient: () => client,
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-event-timeout',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onRemoteAppCreated: async () => undefined
    }).catch((reason: unknown): unknown => reason)

    expect(error).toMatchObject({
      code: 'feishu_console_event_verification_failed',
      remoteState: 'known_frozen'
    })
    expect(client.createApp).toHaveBeenCalledTimes(1)
    expect(client.verifyMemberBot).not.toHaveBeenCalled()
  })

  it('keeps the frozen app recoverable when its App-scoped Owner identity cannot resolve', async () => {
    const client = fakeOpenPlatformClient([])
    const progress: string[] = []

    const error = await provisioner(fakePortal(), {
      createClient: () => client,
      resolveOwnerOpenId: async () => {
        throw new Error('feishu_connection_error')
      },
      readDefaultAvatar: async () => ({
        pngBytes: new Uint8Array([1]),
        width: 1,
        height: 1
      })
    }).create({
      publicationIntentId: 'intent-owner-resolution',
      agentId: 'agent-a',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onRemoteAppCreated: async () => undefined,
      onProgress: (step) => progress.push(step)
    }).catch((reason: unknown): unknown => reason)

    expect(error).toMatchObject({
      code: 'feishu_connection_error',
      remoteState: 'known_frozen'
    })
    expect(client.verifyMemberBot).toHaveBeenCalledTimes(1)
    expect(progress).not.toContain('online_verified')
  })

  it('repairs the member avatar on the frozen published app without creating another app', async () => {
    const progress: string[] = []
    const operations: string[] = []
    const portal = fakePortal()
    const client = fakeOpenPlatformClient(operations)

    const result = await provisioner(portal, {
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
      ownerOpenId: 'ou_owner_for_app',
      botDisplayName: '叮叮',
      publishedVersionId: 'version_2'
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
      'activation_started',
      'activation_published',
      'configuration_started',
      'configuration_waiting',
      'configuration_verified',
      'version_published',
      'online_verified'
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

    const result = await provisioner(portal, {
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
    expect(operations).toEqual([
      'read_secret',
      'find_published_version',
      'verify',
      'find_version',
      'verify'
    ])
    expect(client.uploadAppIcon).not.toHaveBeenCalled()
    expect(client.createVersion).not.toHaveBeenCalled()
    expect(client.publishVersion).not.toHaveBeenCalled()
  })

  it('reuses and publishes a pending configuration patch left by an interrupted attempt', async () => {
    const operations: string[] = []
    const client = fakeOpenPlatformClient(operations)
    client.findPublishedVersion.mockImplementation(async () => {
      operations.push('find_published_version')
      return { versionId: 'version_2', status: 2, appVersion: '1.0.1' }
    })
    client.findVersion.mockImplementation(async () => {
      operations.push('find_version')
      return { versionId: 'version_pending', status: 5, appVersion: '1.0.2' }
    })

    const result = await provisioner(fakePortal(), {
      createClient: () => client
    }).reconcile({
      publicationIntentId: 'intent-interrupted',
      agentId: 'agent-a',
      remoteAppId: 'cli_dingding',
      appName: '叮叮',
      appDescription: 'Rovai AI 队员 · 游学者',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    })

    expect(result.publishedVersionId).toBe('version_pending')
    expect(client.createVersion).not.toHaveBeenCalled()
    expect(client.publishVersion).toHaveBeenCalledWith(
      'cli_dingding',
      'version_pending',
      undefined
    )
    expect(operations).toEqual([
      'read_secret',
      'find_published_version',
      'verify',
      'find_version',
      'publish_version',
      'verify'
    ])
  })

  it('repairs missing online message readiness on the frozen app with the next version', async () => {
    const operations: string[] = []
    const portal = fakePortal()
    const client = fakeOpenPlatformClient(operations)
    client.findPublishedVersion.mockImplementation(async () => {
      operations.push('find_published_version')
      return { versionId: 'version_2', status: 2, appVersion: '1.0.1' }
    })
    client.verifyMemberBot
      .mockImplementationOnce(async () => {
        operations.push('verify')
        throw new FeishuOpenPlatformApiError(
          'feishu_console_scope_verification_failed',
          true
        )
      })
      .mockImplementationOnce(async () => { operations.push('verify') })

    const result = await provisioner(portal, {
      createClient: () => client
    }).reconcile({
      publicationIntentId: 'intent-existing',
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

    expect(result.appId).toBe('cli_dingding')
    expect(operations).toEqual([
      'read_secret',
      'find_published_version',
      'verify',
      'upload_avatar',
      'enable_bot',
      'configure_scopes',
      'configure_events',
      'configure_callbacks',
      'create_version',
      'publish_version',
      'verify'
    ])
    expect(client.createApp).not.toHaveBeenCalled()
    expect(client.createVersion).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'cli_dingding',
      appVersion: '1.0.2',
      reuseExisting: true
    }))
  })

  it('fails before opening the console when the expected identity cannot be proven', async () => {
    const portal = fakePortal()
    vi.mocked(portal.requireExpectedIdentity)
      .mockRejectedValue(new Error('feishu_developer_identity_changed'))
    const createClient = vi.fn()

    await expect(provisioner(portal, {
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
    const error = await provisioner(portal, {
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
      remoteState: 'create_outcome_unknown'
    })
    expect(isUnknownRemoteProvisioningError(error)).toBe(true)
  })

  it('marks a failure after durable app freeze as recoverable on the same app', async () => {
    const portal = fakePortal()
    const client = fakeOpenPlatformClient([])
    client.readAppSecret.mockRejectedValue(new FeishuOpenPlatformApiError(
      'feishu_console_read_secret_rejected_10042',
      false
    ))
    let remoteAppId: string | undefined
    const error = await provisioner(portal, {
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
      onRemoteAppCreated: async ({ appId }) => { remoteAppId = appId },
      onProgress: (_step, appId) => { remoteAppId = appId ?? remoteAppId }
    }).catch((reason: unknown): unknown => reason)

    expect(remoteAppId).toBe('cli_dingding')
    expect(error).toMatchObject({ remoteState: 'known_frozen' })
    expect(isUnknownRemoteProvisioningError(error)).toBe(false)
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
        avatarUrl: 'https://sf3-cn.feishucdn.com/obj/avatar.png',
        creationMode: 'template' as const
      }
    }),
    readAppSecret: vi.fn(async () => {
      operations.push('read_secret')
      return 'secret-dingding'
    }),
    enableBot: vi.fn(async () => { operations.push('enable_bot') }),
    requestEventLongConnection: vi.fn(async () => {
      operations.push('request_event')
      return { changed: true }
    }),
    configureScopes: vi.fn(async () => {
      operations.push('configure_scopes')
      return { changed: true }
    }),
    configureEvents: vi.fn(async () => {
      operations.push('configure_events')
      return { changed: true }
    }),
    configureCallbacksAndWebSocket: vi.fn(async () => {
      operations.push('configure_callbacks')
      return { changed: true }
    }),
    createVersion: vi.fn(async (input: { appVersion?: string }) => {
      operations.push('create_version')
      const patch = Number(input.appVersion?.split('.')[2] ?? 0)
      return `version_${patch + 1}`
    }),
    publishVersion: vi.fn(async (_appId: string, versionId: string) => {
      operations.push('publish_version')
      return { versionId, status: 2 }
    }),
    findPublishedVersion: vi.fn(async () => {
      operations.push('find_published_version')
      return { versionId: 'version_1', status: 2, appVersion: '1.0.0' }
    }),
    findVersion: vi.fn(async (): Promise<FeishuPublishedVersionSummary | null> => {
      operations.push('find_version')
      return null
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
