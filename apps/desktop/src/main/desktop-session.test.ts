import { describe, expect, it } from 'vitest'
import { DesktopSessionRegistry, type DesktopSessionSources } from './desktop-session'
import { DEFAULT_GENERAL_PREFERENCES } from './general-preferences'

const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'

function deferredSources(): {
  promise: Promise<DesktopSessionSources>
  resolve(value: DesktopSessionSources): void
} {
  let resolve!: (value: DesktopSessionSources) => void
  const promise = new Promise<DesktopSessionSources>((accept) => { resolve = accept })
  return { promise, resolve }
}

describe('Main Window Session registry', () => {
  it('waits for local preferences before freezing the first window route, independently of Core', async () => {
    const registry = new DesktopSessionRegistry(() => 'local-session')
    const sources = deferredSources()
    registry.createWhenReady(11, sources.promise)
    const reading = registry.getWhenReady(11)
    expect(registry.get(11)).toBeNull()

    sources.resolve({
      preferences: DEFAULT_GENERAL_PREFERENCES,
      restorable: { status: 'valid', location: { kind: 'camp', campId: CAMP_ID } }
    })
    await expect(reading).resolves.toMatchObject({
      sessionId: 'local-session',
      restorableLocation: { kind: 'camp', campId: CAMP_ID }
    })
  })

  it('does not recreate a closed window when its local preference read finishes late', async () => {
    const registry = new DesktopSessionRegistry()
    const sources = deferredSources()
    registry.createWhenReady(11, sources.promise)
    const reading = registry.getWhenReady(11)
    registry.delete(11)
    sources.resolve({
      preferences: DEFAULT_GENERAL_PREFERENCES,
      restorable: { status: 'valid', location: { kind: 'memory' } }
    })
    await expect(reading).resolves.toBeNull()
    expect(registry.get(11)).toBeNull()
  })

  it('freezes one startup route per window lifetime and rereads preferences only for a new window', () => {
    let sequence = 0
    const registry = new DesktopSessionRegistry(() => `session-${++sequence}`)
    const first = registry.create(11, {
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'runtime',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: true
    }, {
      status: 'valid',
      location: { kind: 'camp', campId: CAMP_ID }
    })

    const second = registry.create(22, {
      schemaVersion: 4,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: false
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
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: true
    }, { status: 'missing', location: null })
    const second = registry.create(22, {
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'skills',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: true
    }, { status: 'valid', location: { kind: 'quick_chat' } })

    registry.delete(11)
    expect(registry.get(11)).toBeNull()
    expect(registry.get(22)).toEqual(second)
  })
})
