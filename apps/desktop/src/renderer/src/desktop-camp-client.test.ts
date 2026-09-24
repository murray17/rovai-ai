import { afterEach, expect, it, vi } from 'vitest'
import { desktopCampClient } from './desktop-camp-client'

// Owns the Renderer → preload channel seam: the provider kind chosen on a tab
// must reach preload unchanged, never defaulted or rewritten to another provider.
afterEach(() => vi.unstubAllGlobals())

it.each(['feishu', 'lark', 'dingtalk'] as const)('forwards %s publish and retry to exactly that provider', async (kind) => {
  const snapshot = { schemaVersion: 4 }
  const channels = {
    publishMemberBot: vi.fn().mockResolvedValue(snapshot),
    retryMemberBot: vi.fn().mockResolvedValue(snapshot),
    selectPublicationApprover: vi.fn().mockResolvedValue(snapshot)
  }
  vi.stubGlobal('window', { rovai: { channels } })

  await expect(desktopCampClient.channels!.publishMemberBot('agent-a', kind)).resolves.toBe(snapshot)
  await expect(desktopCampClient.channels!.retryMemberBot('agent-a', kind)).resolves.toBe(snapshot)

  expect(channels.publishMemberBot).toHaveBeenCalledExactlyOnceWith('agent-a', kind)
  expect(channels.retryMemberBot).toHaveBeenCalledExactlyOnceWith('agent-a', kind)
  expect(channels.selectPublicationApprover).not.toHaveBeenCalled()
})
