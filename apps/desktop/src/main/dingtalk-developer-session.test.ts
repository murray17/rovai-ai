import { describe, expect, it } from 'vitest'
import type { DingTalkGatewayBackend, DingTalkGatewayRequest } from './dingtalk-developer-gateway'
import { DwsDingTalkDeveloperSessionService } from './dingtalk-developer-session'

describe('DWS DingTalk developer session', () => {
  it('projects only a valid OAuth profile into a stable local identity', async () => {
    const gateway = new QueueGateway([{
      success: true,
      authenticated: true,
      token_valid: true,
      corp_id: 'corp-1',
      user_id: 'owner-1',
      user_name: 'Murray',
      corp_name: '星海科技',
      expires_at: '2026-08-30T00:00:00Z'
    }])
    const service = new DwsDingTalkDeveloperSessionService({ gateway, configDir: '/tmp/dws-test' })

    const identity = await service.inspect()
    expect(identity).toMatchObject({
      corpId: 'corp-1',
      userId: 'owner-1',
      userName: 'Murray',
      corpName: '星海科技'
    })
    expect(identity?.accountId).toMatch(/^rvdta_[a-f0-9]{32}$/u)
    expect(identity?.userIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(JSON.stringify(identity)).not.toContain('access_token')
  })

  it('runs browser/device login and then re-reads the authoritative profile', async () => {
    const gateway = new QueueGateway([
      { completed: true },
      {
        success: true,
        authenticated: true,
        token_valid: true,
        corp_id: 'corp-1',
        user_id: 'owner-1',
        user_name: 'Murray',
        corp_name: '星海科技'
      }
    ])
    const service = new DwsDingTalkDeveloperSessionService({ gateway, configDir: '/tmp/dws-test' })
    const stages: string[] = []
    await service.beginLogin({
      signal: new AbortController().signal,
      deviceFlow: true,
      onStage: (stage) => { stages.push(stage) }
    })

    expect(gateway.requests.map((request) => request.operation)).toEqual([
      'auth.login', 'auth.status'
    ])
    expect(gateway.requests[0]?.values).toEqual({ device: true })
    expect(stages).toEqual([
      'preparing', 'awaiting_browser', 'inspecting_identity', 'connected'
    ])
  })

  it('disconnects only the exact corp/user profile', async () => {
    const gateway = new QueueGateway([{ completed: true }])
    const service = new DwsDingTalkDeveloperSessionService({ gateway, configDir: '/tmp/dws-test' })
    await service.disconnect({ corpId: 'corp-1', userId: 'owner-1' })
    expect(gateway.requests[0]).toMatchObject({
      operation: 'auth.logout',
      values: { profile: 'corp-1:owner-1' }
    })
  })

  it('restores an exact previously active profile without deleting either login', async () => {
    const gateway = new QueueGateway([{ completed: true }])
    const service = new DwsDingTalkDeveloperSessionService({ gateway, configDir: '/tmp/dws-test' })
    await service.activate({ corpId: 'corp-old', userId: 'owner-old' })
    expect(gateway.requests[0]).toMatchObject({
      operation: 'profile.switch',
      values: { profileSelector: 'corp-old:owner-old' }
    })
  })
})

class QueueGateway implements DingTalkGatewayBackend {
  readonly requests: DingTalkGatewayRequest[] = []
  readonly #responses: unknown[]

  constructor(responses: unknown[]) {
    this.#responses = [...responses]
  }

  async execute(request: DingTalkGatewayRequest): Promise<unknown> {
    this.requests.push(request)
    return this.#responses.shift()
  }
}
