import { describe, expect, it, vi } from 'vitest'
import { ChannelSettingsCoordinator } from './channel-settings-coordinator'
import type { ChannelSettingsService } from './channel-settings'
import type { DingTalkChannelSettingsService } from './dingtalk-channel-settings'

describe('ChannelSettingsCoordinator', () => {
  it('keeps Feishu running when the optional DingTalk Host cannot start', async () => {
    const feishu = host()
    const dingtalk = host(new Error('dingtalk_open_platform_unavailable'))
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu.service as ChannelSettingsService,
      dingtalk: dingtalk.service as DingTalkChannelSettingsService
    })

    await expect(coordinator.start()).resolves.toBeUndefined()
    expect(feishu.start).toHaveBeenCalledOnce()
    expect(feishu.stop).not.toHaveBeenCalled()
    coordinator.dispose()
  })

  it('reports startup failure only when neither provider Host is available', async () => {
    const feishu = host(new Error('feishu_unavailable'))
    const dingtalk = host(new Error('dingtalk_unavailable'))
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu.service as ChannelSettingsService,
      dingtalk: dingtalk.service as DingTalkChannelSettingsService
    })

    await expect(coordinator.start()).rejects.toThrow('All Channel Hosts failed to start')
    coordinator.dispose()
  })

  it('forwards Core activity to both provider Hosts', () => {
    const feishu = host()
    const dingtalk = host()
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu.service as ChannelSettingsService,
      dingtalk: dingtalk.service as DingTalkChannelSettingsService
    })
    const event = { method: 'agent_run.terminal', params: { agentRunId: 'run-1' } }

    coordinator.handleCoreEvent(event)

    expect(feishu.handleCoreEvent).toHaveBeenCalledExactlyOnceWith(event)
    expect(dingtalk.handleCoreEvent).toHaveBeenCalledExactlyOnceWith(event)
    coordinator.dispose()
  })
})

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
