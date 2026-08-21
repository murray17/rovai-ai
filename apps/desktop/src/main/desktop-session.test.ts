import { describe, expect, it } from 'vitest'
import { DesktopSessionRegistry } from './desktop-session'

const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'

describe('Main Window Session registry', () => {
  it('freezes one startup route per window lifetime and rereads preferences only for a new window', () => {
    let sequence = 0
    const registry = new DesktopSessionRegistry(() => `session-${++sequence}`)
    const first = registry.create(11, {
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'runtime',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    }, {
      status: 'valid',
      location: { kind: 'camp', campId: CAMP_ID }
    })

    const second = registry.create(22, {
      schemaVersion: 3,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    }, {
      status: 'valid',
      location: { kind: 'memory' }
    })

    expect(registry.get(11)).toEqual(first)
    expect(registry.get(11)).toEqual(first)
    expect(second).toMatchObject({
      sessionId: 'session-2',
      startupLocationMode: 'quick_chat',
      restorableLocation: { kind: 'memory' }
    })
    expect(second).not.toEqual(first)
  })

  it('forgets a closed window without changing another live session', () => {
    const registry = new DesktopSessionRegistry(() => crypto.randomUUID())
    registry.create(11, {
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    }, { status: 'missing', location: null })
    const second = registry.create(22, {
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'skills',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    }, { status: 'valid', location: { kind: 'quick_chat' } })

    registry.delete(11)
    expect(registry.get(11)).toBeNull()
    expect(registry.get(22)).toEqual(second)
  })
})
