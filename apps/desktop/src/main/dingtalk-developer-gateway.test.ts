import { describe, expect, it, vi } from 'vitest'
import { DingTalkDeveloperApiError, DingTalkDeveloperGateway, type DingTalkDeveloperRequest } from './dingtalk-developer-gateway'
import { DingTalkConsoleError, type DingTalkWebSession } from './dingtalk-web-session'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: { fromPartition: vi.fn() } }))

const owner = { corpId: 'corp-fixture', userId: 'staff-fixture' }

describe('DingTalk Web Session developer gateway', () => {
  it('creates one ordinary internal app through the console, with a frozen Owner identity', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'u-app' })
    expect(await f.gateway.execute({ operation: 'app.create', expectedIdentity: owner,
      values: { appName: '测试队员', description: '测试用应用说明' } })).toEqual({ unifiedAppId: 'u-app' })
    expect(f.session.withConsoleSession).toHaveBeenCalledWith(owner, undefined, expect.any(Function))
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.request).toHaveBeenCalledWith('/openapp/unifiedapp/create', {
      signal: undefined, timeoutMs: undefined, method: 'POST',
      body: { appType: 2, appName: '测试队员', appDesc: '测试用应用说明' }
    })
  })

  it('requires read-back identity to match the frozen app', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'another-app' })
    await expect(f.gateway.execute({ operation: 'app.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } })).rejects.toThrow('dingtalk_app_identity_mismatch')
  })

  it('reads a legacy credential only with the exact agentId resolved from that app', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'u-app', agentId: 12345 })
      .mockResolvedValueOnce({ appKey: 'ding-key', appSecret: 'private-secret' })
    expect(await f.gateway.execute({ operation: 'app.credentials.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } })).toEqual({ appKey: 'ding-key', appSecret: 'private-secret' })
    expect(f.request.mock.calls[1]).toEqual(['/innerApp/getAppAccount', {
      signal: undefined, timeoutMs: undefined, query: { agentId: '12345' }
    }])
  })

  it('never substitutes unifiedAppId for an unproven legacy agentId', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ unifiedAppId: 'u-app' })
    await expect(f.gateway.execute({ operation: 'app.credentials.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } })).rejects.toThrow('dingtalk_console_protocol_unverified')
    expect(f.request).toHaveBeenCalledOnce()
  })

  it.each([true, false])('preserves definite-rejection evidence (%s) and never retries app creation', async (definite) => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new DingTalkConsoleError('dingtalk_open_platform_unavailable', definite))
    const error = await f.gateway.execute({ operation: 'app.create', expectedIdentity: owner,
      values: { appName: '队员', description: '测试说明' } }).catch((error) => error)
    expect(error).toBeInstanceOf(DingTalkDeveloperApiError)
    if (!(error instanceof DingTalkDeveloperApiError)) throw error
    expect(error.definitelyRejected).toBe(definite)
    expect(f.request).toHaveBeenCalledOnce()
  })

  it('sanitizes unknown errors that might contain credential-bearing URLs', async () => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new Error('https://open-dev.dingtalk.com/?access_token=secret-fixture'))
    const error = await f.gateway.execute({ operation: 'app.get', expectedIdentity: owner,
      values: { unifiedAppId: 'u-app' } }).catch((error) => error)
    if (!(error instanceof DingTalkDeveloperApiError)) throw error
    expect(error.message).toBe('dingtalk_open_platform_unavailable')
    expect(error.definitelyRejected).toBe(false)
  })

  it.each([
    { operation: 'shell.exec', values: {} },
    { operation: 'app.get', values: { unifiedAppId: 'u-app', endpoint: 'https://evil.example' } },
    { operation: 'app.get', values: { unifiedAppId: 'a\0b' } },
    { operation: 'app.get', values: { unifiedAppId: 'u-app', appSecret: 'secret' } },
    { operation: 'app.get', values: {} }
  ])('rejects unreviewed operations or arguments before accessing credentials: %j', async (request) => {
    const f = fixture()
    await expect(f.gateway.execute({ expectedIdentity: owner, ...request } as DingTalkDeveloperRequest))
      .rejects.toThrow('dingtalk_developer_argument_rejected')
    expect(f.session.withConsoleSession).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })

  it('requires an explicit frozen Owner before any request', async () => {
    const f = fixture()
    await expect(f.gateway.execute({ operation: 'app.get', values: { unifiedAppId: 'u-app' } } as unknown as DingTalkDeveloperRequest))
      .rejects.toThrow('dingtalk_developer_argument_rejected')
    expect(f.request).not.toHaveBeenCalled()
  })
})

function fixture() {
  const request = vi.fn<DingTalkWebSession['request']>()
  const session = {
    async withConsoleSession<T>(
      _owner: typeof owner, _signal: AbortSignal | undefined,
      operation: (web: Pick<DingTalkWebSession, 'request'>) => Promise<T>
    ): Promise<T> { return operation({ request }) }
  }
  vi.spyOn(session, 'withConsoleSession')
  return { request, session, gateway: new DingTalkDeveloperGateway({ session }) }
}
