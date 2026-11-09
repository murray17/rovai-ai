// Unit coverage of mutations; the real IndexedDB cross-tab lock is exercised by
// the isolated Electron navigation fixture.
vi.mock('./auth-storage', () => {
  let tail = Promise.resolve()
  return { withBrowserPreferenceWrite: (_scope: string, update: () => unknown) => {
    const next = tail.then(update); tail = next.then(() => undefined, () => undefined); return next
  } }
})
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
  const saved = { newConversationTeamId: null as string | null, newConversationDefaults: { memberAgentIds: ['agent-a', 'agent-b'], defaultLeadAgentId: 'agent-b' }, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: true }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    const input = JSON.parse(String(options?.body))
    if (input.operation === 'preferences.newConversation.setTeam') saved.newConversationTeamId = input.params.teamId
    else if (input.operation === 'preferences.newConversation.setOneClick') saved.oneClickNewConversationEnabled = input.params.enabled
    else if (input.operation === 'preferences.newConversation.setDefaults') {
      saved.newConversationDefaults = input.params.defaults
      saved.newConversationTeamId = null
      saved.oneClickNewConversationEnabled ||= input.params.enableOneClick
    }
    return Response.json({ result: saved })
  })
  const transport = new ConsoleClient('http://127.0.0.1:4317', fetcher)
  await transport.login('b'.repeat(64))
  const api = browserPreferences(transport.presentationScope!, transport).preferences.generalPreferences
  expect(await api.get()).toMatchObject(saved)
  expect(await browserPreferences(transport.presentationScope!, transport).preferences.generalPreferences.get()).toMatchObject(saved)
  const custom = structuredClone(saved.newConversationDefaults)
  await api.setNewConversationTeam('team-1')
  expect(await api.get()).toMatchObject({ newConversationTeamId: 'team-1', newConversationDefaults: custom })
  await api.setNewConversationTeam(null)
  await api.setOneClickNewConversationEnabled(false)
  expect(await api.get()).toMatchObject({ oneClickNewConversationEnabled: false, newConversationDefaults: saved.newConversationDefaults })
  await api.setNewConversationDefaults({ memberAgentIds: ['agent-b'], defaultLeadAgentId: 'agent-b' }, true)
  expect(await api.setWorldMapEnabled(true)).toMatchObject({ ...saved, worldMapEnabled: true })
  expect(JSON.parse([...entries.values()][0]).newConversationDefaults).toBeNull()
  expect(await browserPreferences(transport.presentationScope!, transport).preferences.generalPreferences.get()).toMatchObject(saved)
  const stale = { expectedTeamId: 'team-A', expectedDefaults: { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' } }
  await api.setNewConversationTeam('team-B')
  await api.invalidateNewConversationDefaults(stale)
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).params).toEqual(stale)
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

it('merges concurrent directory writes and protects removal, completed migration and aliases', async () => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const transport = { request: vi.fn() } as unknown as ConsoleClient
  const a = browserPreferences('projects', transport).preferences.navigationPreferences
  const b = browserPreferences('projects', transport).preferences.navigationPreferences
  await Promise.all([a.registerProjects(['/a']), b.setProjectName('directory:/a', '名字'), b.registerProjects(['/b']), a.removeProject('directory:/gone', []), b.registerProjects(['/gone', '/legacy'], true)])
  expect(await a.get()).toMatchObject({ registeredProjects: ['/a', '/b', '/legacy'], legacyProjectsSynced: true, projectNames: { 'directory:/a': '名字' } })
  await a.registerProjects(['/late'], true)
  expect((await a.get()).registeredProjects).not.toContain('/late')
  for (const path of (await a.get()).registeredProjects) await a.removeProject(`directory:${path}`, [])
  expect(await b.get()).toMatchObject({ registeredProjects: [], legacyProjectsSynced: true })
  await b.restoreProject('directory:/gone')
  expect((await a.get()).registeredProjects).toEqual(['/gone'])
  const key = 'rovai.presentation:projects:navigation'
  entries.set(key, '{broken')
  expect((await a.get()).readError).toBeTruthy()
  await expect(a.registerProjects(['/lost'], true)).rejects.toThrow()
  expect(entries.get(key)).toBe('{broken')
})


it('persists fixed palettes independently of OS changes and restores system following', async () => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) })
  const media = { matches: true, addEventListener() {}, removeEventListener() {} }
  vi.stubGlobal('matchMedia', () => media)
  const transport = { request: vi.fn() } as unknown as ConsoleClient
  const api = browserPreferences('theme-owner', transport).preferences.appearance
  await api.updatePreferences({ chatFontSize: 18 })
  for (const [preference, resolvedTheme] of [['horizon', 'day'], ['classic-red', 'day'], ['ember', 'night']] as const) {
    expect(await api.setPreference(preference)).toMatchObject({ preference, resolvedTheme, chatFontSize: 18 })
    media.matches = !media.matches
    expect(await browserPreferences('theme-owner', transport).preferences.appearance.get()).toMatchObject({ preference, resolvedTheme, chatFontSize: 18 })
  }
  await api.setPreference('system')
  media.matches = false
  expect(await api.get()).toMatchObject({ preference: 'system', resolvedTheme: 'day' })
  media.matches = true
  expect(await api.get()).toMatchObject({ preference: 'system', resolvedTheme: 'night' })
})
