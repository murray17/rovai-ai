import type { ChannelSettingsSnapshot } from '@contracts'

export class ChannelSettingsService {
  get(): ChannelSettingsSnapshot {
    return {
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
    }
  }
}
