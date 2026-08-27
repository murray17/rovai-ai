import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeishuDeveloperPortalSession } from './feishu-developer-session'
import {
  FeishuWebSessionMemberBotProvisioner,
  isUnknownRemoteProvisioningError
} from './feishu-member-bot-provisioner'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Feishu Web Session member Bot provisioner', () => {
  it('reuses the expected signed-in session and completes the official registration protocol without a QR callback', async () => {
    vi.useFakeTimers()
    const confirmationUrls: string[] = []
    const progress: string[] = []
    const portal = fakePortal({
      async showRegistrationConfirmation({ url }) {
        confirmationUrls.push(url)
        return { close: vi.fn(), closed: new Promise(() => undefined) }
      }
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        device_code: 'device-1',
        verification_uri_complete: 'https://accounts.feishu.cn/accounts/page/login?device_code=device-1',
        interval: 0,
        expires_in: 30
      }))
      .mockResolvedValueOnce(jsonResponse({
        client_id: 'cli_agent_a',
        client_secret: 'secret-agent-a'
      }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = new FeishuWebSessionMemberBotProvisioner(portal).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '审阅员',
      appDescription: 'Rovai AI 队员 · 代码审阅',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' },
      onProgress: (step) => progress.push(step)
    })

    await vi.advanceTimersByTimeAsync(1_000)
    const result = await promise

    expect(result).toMatchObject({
      appId: 'cli_agent_a',
      appSecret: 'secret-agent-a',
      botDisplayName: '审阅员'
    })
    expect(confirmationUrls).toHaveLength(1)
    const confirmation = new URL(confirmationUrls[0])
    expect(confirmation.searchParams.get('createOnly')).toBe('true')
    expect(confirmation.searchParams.get('name')).toBe('审阅员')
    expect(confirmation.searchParams.get('desc')).toBe('Rovai AI 队员 · 代码审阅')
    expect(confirmation.searchParams.get('addons')).toBeTruthy()
    expect(progress).toEqual([
      'session_verified',
      'app_created',
      'credentials_read',
      'bot_configured',
      'version_published'
    ])
    expect(portal.requireExpectedIdentity).toHaveBeenCalledWith({
      userId: 'owner-user',
      tenantId: 'tenant-1'
    })
    expect(portal.persist).toHaveBeenCalledTimes(1)
  })

  it('fails before registration when the expected developer identity cannot be proven', async () => {
    const portal = fakePortal()
    vi.mocked(portal.requireExpectedIdentity)
      .mockRejectedValue(new Error('feishu_developer_identity_changed'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(new FeishuWebSessionMemberBotProvisioner(portal).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '审阅员',
      appDescription: 'Rovai AI 队员 · 代码审阅',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    })).rejects.toThrow('feishu_developer_identity_changed')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(portal.showRegistrationConfirmation).not.toHaveBeenCalled()
  })

  it('treats a redirect to login as an expired session, not an unknown app result', async () => {
    const portal = fakePortal({
      async showRegistrationConfirmation() {
        return { close: vi.fn(), closed: Promise.resolve('session_expired' as const) }
      }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      device_code: 'device-1',
      verification_uri_complete: 'https://accounts.feishu.cn/accounts/page/login?device_code=device-1',
      interval: 5,
      expires_in: 30
    })))

    await expect(new FeishuWebSessionMemberBotProvisioner(portal).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '审阅员',
      appDescription: 'Rovai AI 队员 · 代码审阅',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    })).rejects.toThrow('feishu_developer_session_expired')
  })

  it('marks a lost poll response as unknown remote state', async () => {
    vi.useFakeTimers()
    const portal = fakePortal()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        device_code: 'device-1',
        verification_uri_complete: 'https://accounts.feishu.cn/accounts/page/login?device_code=device-1',
        interval: 0,
        expires_in: 30
      }))
      .mockRejectedValueOnce(new Error('network_lost')))
    const promise = new FeishuWebSessionMemberBotProvisioner(portal).create({
      publicationIntentId: 'intent-1',
      agentId: 'agent-a',
      appName: '审阅员',
      appDescription: 'Rovai AI 队员 · 代码审阅',
      expectedDeveloperIdentity: { userId: 'owner-user', tenantId: 'tenant-1' }
    })

    const settled: Promise<unknown> = promise
      .then((value): unknown => value)
      .catch((error: unknown): unknown => error)
    await vi.advanceTimersByTimeAsync(1_000)
    const error = await settled

    expect(error).toBeInstanceOf(Error)
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
    showRegistrationConfirmation: vi.fn(
      overrides.showRegistrationConfirmation ?? (async () => ({
        close: vi.fn(),
        closed: new Promise<'closed' | 'session_expired'>(() => undefined)
      }))
    ),
    persist: vi.fn(overrides.persist ?? (async () => undefined))
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

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => value)
  } as unknown as Response
}
