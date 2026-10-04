import { describe, expect, it, vi } from 'vitest'
import { ChannelSettingsCoordinator, hasPublishedChannelBot } from './channel-settings-coordinator'
import type { ChannelSettingsService } from './channel-settings'
import type { DingTalkChannelSettingsService } from './dingtalk-channel-settings'
import type { MemberBotProvisioningView } from '@contracts'

describe('ChannelSettingsCoordinator', () => {
  it('retains each provider publication identity when both have progress', async () => {
    const feishuProgress: MemberBotProvisioningView = { publicationIntentId: 'feishu-original', agentId: 'member', stage: 'creating_app', detail: 'creating', remoteAppId: 'feishu-app', failureCode: null }
    const dingtalkProgress: MemberBotProvisioningView = { ...feishuProgress, publicationIntentId: 'dingtalk-original', remoteAppId: 'dingtalk-app', stage: 'completed' }
    const feishu = { onChanged: () => () => undefined, get: async () => ({ channels: [{ kind: 'feishu' }], activeProvisioning: feishuProgress, activeQrAttempt: null, pendingBindingCount: 0, bindingIssueCount: 0 }) }
    const dingtalk = { onChanged: () => () => undefined, get: async () => ({ provider: { kind: 'dingtalk' }, activeProvisioning: dingtalkProgress, activeQrAttempt: null, pendingBindingCount: 0, bindingIssueCount: 0 }) }
    const coordinator = new ChannelSettingsCoordinator({ feishu: feishu as unknown as ChannelSettingsService, lark: idleLark(), dingtalk: dingtalk as unknown as DingTalkChannelSettingsService })
    const snapshot = await coordinator.get()
    expect(snapshot.channels.map(provider => provider.provisioning)).toEqual([
      { ...feishuProgress, kind: 'feishu' }, { ...dingtalkProgress, kind: 'dingtalk' }
    ])
    coordinator.dispose()
  })

  it('admits one publication per provider before any asynchronous service read and releases after failure', async () => {
    let release!: () => void
    const publish = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); throw new Error('network timeout') })
    const feishu = { onChanged: () => () => undefined, publishMemberBot: publish, retryMemberBot: publish }
    const dingtalk = { onChanged: () => () => undefined }
    const coordinator = new ChannelSettingsCoordinator({ feishu: feishu as unknown as ChannelSettingsService, lark: idleLark(), dingtalk: dingtalk as unknown as DingTalkChannelSettingsService })
    const first = coordinator.publishMemberBot('member', 'feishu')
    const failure = expect(first).rejects.toThrow('network timeout')
    await expect(coordinator.retryMemberBot('member', 'feishu')).rejects.toThrow('channel_publication_busy')
    expect(publish).toHaveBeenCalledOnce()
    release(); await failure
    const retry = coordinator.retryMemberBot('member', 'feishu')
    const retryFailure = expect(retry).rejects.toThrow('network timeout')
    expect(publish).toHaveBeenCalledTimes(2)
    release(); await retryFailure
    coordinator.dispose()
  })

  it('opens the execution gate only for a currently published channel Bot', () => {
    expect(hasPublishedChannelBot({
      channels: [{ memberBots: [{ publicationStatus: 'disabled' }] }]
    })).toBe(false)
    expect(hasPublishedChannelBot({
      channels: [
        { memberBots: [] },
        { memberBots: [{ publicationStatus: 'published' }] }
      ]
    })).toBe(true)
  })

  it.each(['feishu', 'lark', 'dingtalk'] as const)('keeps the other Hosts running when %s cannot start', async (failing) => {
    const hosts = {
      feishu: host(failing === 'feishu' ? new Error('feishu_unavailable') : undefined),
      lark: host(failing === 'lark' ? new Error('lark_unavailable') : undefined),
      dingtalk: host(failing === 'dingtalk' ? new Error('dingtalk_unavailable') : undefined)
    }
    const coordinator = coordinatorOf(hosts)

    await expect(coordinator.start()).resolves.toBeUndefined()
    for (const [kind, service] of Object.entries(hosts)) {
      expect(service.start).toHaveBeenCalledOnce()
      if (kind !== failing) expect(service.stop).not.toHaveBeenCalled()
    }
    coordinator.dispose()
  })

  it('reports startup failure only when every provider Host is unavailable', async () => {
    const coordinator = coordinatorOf({
      feishu: host(new Error('feishu_unavailable')),
      lark: host(new Error('lark_unavailable')),
      dingtalk: host(new Error('dingtalk_unavailable'))
    })

    await expect(coordinator.start()).rejects.toThrow('All Channel Hosts failed to start')
    coordinator.dispose()
  })

  it('forwards Core activity to every provider Host', () => {
    const hosts = { feishu: host(), lark: host(), dingtalk: host() }
    const coordinator = coordinatorOf(hosts)
    const event = { method: 'agent_run.terminal', params: { agentRunId: 'run-1' } }

    coordinator.handleCoreEvent(event)

    for (const service of Object.values(hosts)) expect(service.handleCoreEvent).toHaveBeenCalledExactlyOnceWith(event)
    coordinator.dispose()
  })

  it('orders providers Feishu, Lark, DingTalk and routes Lark operations only to Lark', async () => {
    const openPlatform = (kind: 'feishu' | 'lark') => ({
      onChanged: () => () => undefined,
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      publishMemberBot: vi.fn(async () => undefined),
      retryMemberBot: vi.fn(async () => undefined),
      cancelQrAttempt: vi.fn(async () => undefined),
      get: async () => ({ channels: [{ kind }], activeProvisioning: null, activeQrAttempt: null, pendingBindingCount: 1, bindingIssueCount: 1 })
    })
    const feishu = openPlatform('feishu')
    const lark = openPlatform('lark')
    const dingtalk = { onChanged: () => () => undefined, get: async () => ({ provider: { kind: 'dingtalk' }, activeProvisioning: null, activeQrAttempt: null, pendingBindingCount: 1, bindingIssueCount: 0 }) }
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu as unknown as ChannelSettingsService,
      lark: lark as unknown as ChannelSettingsService,
      dingtalk: dingtalk as unknown as DingTalkChannelSettingsService
    })

    const snapshot = await coordinator.get()
    expect(snapshot.channels.map(provider => provider.kind)).toEqual(['feishu', 'lark', 'dingtalk'])
    expect(snapshot).toMatchObject({ pendingBindingCount: 3, bindingIssueCount: 2 })
    await coordinator.connect('lark')
    await coordinator.publishMemberBot('member', 'lark')
    await coordinator.retryMemberBot('member', 'lark')
    await coordinator.disconnect('lark')
    for (const method of ['connect', 'publishMemberBot', 'retryMemberBot', 'disconnect'] as const) {
      expect(lark[method]).toHaveBeenCalledOnce()
      expect(feishu[method]).not.toHaveBeenCalled()
    }
    await expect(coordinator.selectPublicationApprover('member', 'user', 'lark'))
      .rejects.toThrow('lark_publication_approver_not_supported')
    coordinator.dispose()
  })
})

function coordinatorOf(hosts: Record<'feishu' | 'lark' | 'dingtalk', ReturnType<typeof host>>): ChannelSettingsCoordinator {
  return new ChannelSettingsCoordinator({
    feishu: hosts.feishu.service as ChannelSettingsService,
    lark: hosts.lark.service as ChannelSettingsService,
    dingtalk: hosts.dingtalk.service as DingTalkChannelSettingsService
  })
}

function idleLark(): ChannelSettingsService {
  return {
    ...host().service as object,
    get: async () => ({ channels: [], activeProvisioning: null, activeQrAttempt: null, pendingBindingCount: 0, bindingIssueCount: 0 })
  } as unknown as ChannelSettingsService
}

function host(startError?: Error): {
  service: unknown
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  handleCoreEvent: ReturnType<typeof vi.fn>
} {
  const start = vi.fn(async () => {
    if (startError) throw startError
  })
  const stop = vi.fn(async () => undefined)
  const handleCoreEvent = vi.fn()
  return {
    start,
    stop,
    handleCoreEvent,
    service: {
      start,
      stop,
      handleCoreEvent,
      onChanged: vi.fn(() => () => undefined)
    }
  }
}
