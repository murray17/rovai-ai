import { describe, expect, it } from 'vitest'
import { ChannelSettingsService } from './channel-settings'

describe('channel settings service', () => {
  it('projects only public Feishu setup facts while the host is unavailable', () => {
    const snapshot = new ChannelSettingsService().get()

    expect(snapshot).toEqual({
      schemaVersion: 1,
      channels: [{
        kind: 'feishu',
        displayName: '飞书',
        hostStatus: 'unavailable',
        connection: {
          status: 'not_connected',
          account: null
        },
        memberBots: []
      }]
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/cookie|csrf|secret|token/i)
  })

  it('returns an isolated snapshot for each Renderer read', () => {
    const service = new ChannelSettingsService()
    const first = service.get()
    first.channels.length = 0

    expect(service.get().channels).toHaveLength(1)
  })
})
