import { afterEach, expect, it, vi } from 'vitest'
import { browserPreferences } from './preferences'
import { ConsoleClient } from './client'
import type { NavigationPreferencesSnapshot } from '@contracts'

// The actual Web preference adapter must read the Host's saved team instead
// of letting an empty or stale browser-local copy shadow the Desktop choice.
afterEach(() => vi.unstubAllGlobals())
it('uses the Host team and one-click flag across browser sessions', async () => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const saved = { newConversationDefaults: { memberAgentIds: ['agent-a', 'agent-b'], defaultLeadAgentId: 'agent-b' }, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: true }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    const input = JSON.parse(String(options?.body))
    if (input.operation === 'preferences.newConversation.setOneClick') saved.oneClickNewConversationEnabled = input.params.enabled
    else if (input.operation === 'preferences.newConversation.setDefaults') {
      saved.newConversationDefaults = input.params.defaults
      saved.oneClickNewConversationEnabled ||= input.params.enableOneClick
    }
    return Response.json({ result: saved })
  })
  const transport = new ConsoleClient('http://127.0.0.1:4317', fetcher)
  await transport.login('b'.repeat(64))
  const api = browserPreferences(transport.presentationScope!, transport).preferences.generalPreferences
  expect(await api.get()).toMatchObject(saved)
  expect(await browserPreferences(transport.presentationScope!, transport).preferences.generalPreferences.get()).toMatchObject(saved)
  await api.setOneClickNewConversationEnabled(false)
  expect(await api.get()).toMatchObject({ oneClickNewConversationEnabled: false, newConversationDefaults: saved.newConversationDefaults })
  await api.setNewConversationDefaults({ memberAgentIds: ['agent-b'], defaultLeadAgentId: 'agent-b' }, true)
  expect(await api.setWorldMapEnabled(true)).toMatchObject({ ...saved, worldMapEnabled: true })
  expect(JSON.parse([...entries.values()][0]).newConversationDefaults).toBeNull()
  expect(await browserPreferences(transport.presentationScope!, transport).preferences.generalPreferences.get()).toMatchObject(saved)
  const staleTeam = { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' }
  await api.invalidateNewConversationDefaults(staleTeam)
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).params.expectedDefaults).toEqual(staleTeam)
  fetcher.mockImplementation(async () => Response.json({ result: {} }))
  await expect(api.get()).rejects.toThrow('不完整')
  transport.clear()
})

it('persists local unread intent, preserves it across other tab writes, and publishes only successful saves', async () => {
  const entries = new Map<string, string>()
  let failWrite = false
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => {
    if (failWrite) throw new Error('Storage unavailable')
    entries.set(key, value)
  } }
  const events = new EventTarget()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', events)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const transport = { request: vi.fn() } as unknown as ConsoleClient
  const first = browserPreferences('host-a', transport).preferences.navigationPreferences
  const other = browserPreferences('host-a', transport).preferences.navigationPreferences
  const id = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
  const seen: NavigationPreferencesSnapshot[] = []
  const unsubscribe = first.onChanged(snapshot => seen.push(snapshot))
  await first.setThreadReadState(id, { manualUnread: true, readThroughGlobalSequence: 12 })
  await other.replacePins([])
  expect((await first.get()).threadReadStates[id]).toEqual({ manualUnread: true, readThroughGlobalSequence: 12 })
  expect((await browserPreferences('host-a', transport).preferences.navigationPreferences.get()).threadReadStates[id].manualUnread).toBe(true)
  expect((await browserPreferences('host-b', transport).preferences.navigationPreferences.get()).threadReadStates).toEqual({})
  await other.setThreadReadState(id, { manualUnread: false, readThroughGlobalSequence: 8 })
  const event = new Event('storage')
  Object.assign(event, { storageArea: storage, key: 'rovai.presentation:host-a:navigation' })
  events.dispatchEvent(event)
  expect(seen.at(-1)?.threadReadStates[id]).toEqual({ manualUnread: false, readThroughGlobalSequence: 12 })
  const count = seen.length
  failWrite = true
  await expect(first.setThreadReadState(id, { manualUnread: true, readThroughGlobalSequence: 12 })).rejects.toThrow('Storage unavailable')
  expect(seen).toHaveLength(count)
  expect((await first.get()).threadReadStates[id].manualUnread).toBe(false)
  expect(transport.request).not.toHaveBeenCalled()
  unsubscribe()
})
