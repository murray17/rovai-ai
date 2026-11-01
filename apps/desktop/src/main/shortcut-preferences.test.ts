import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ShortcutPreferencesStore } from './shortcut-preferences'
import * as writer from './general-preferences'
import { shortcutDefaults } from '../shared/shortcuts'
const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-shortcuts-')); directories.push(directory)
  const path = join(directory, 'shortcuts.json')
  return { path, store: new ShortcutPreferencesStore(path, 'darwin') }
}
it('preserves corrupt input until an explicit successful save', async () => {
  const { path, store } = await fixture()
  await writeFile(path, '{broken'); await store.load()
  expect(store.get()).toEqual({ revision: 0, preferences: shortcutDefaults(), degraded: true })
  expect(await readFile(path, 'utf8')).toBe('{broken')
  await store.save({ expectedRevision: 0, preferences: shortcutDefaults() })
  expect(store.get().degraded).toBe(false)
})
it('persists keyboard and mouse together, survives reload, and does not expose mutable state', async () => {
  const { path, store } = await fixture()
  const preferences = shortcutDefaults(); preferences.bindings.latest = 'Ctrl+Shift+K'; preferences.mouse.side1 = 'latest'; preferences.sendMode = 'primary-enter'
  const original = JSON.stringify({ ...preferences, bindings: { ...preferences.bindings, 'quick-open': 'Mod+P' }, mouse: { ...preferences.mouse, side2: 'quick-open' } })
  await writeFile(path, original); await store.load()
  expect(store.get()).toEqual({ revision: 0, preferences, degraded: false })
  expect(await readFile(path, 'utf8')).toBe(original)
  await store.save({ expectedRevision: 0, preferences })
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(preferences)
  preferences.bindings.latest = null
  const loaded = new ShortcutPreferencesStore(path, 'darwin'); await loaded.load()
  expect(loaded.get().preferences.bindings.latest).toBe('Ctrl+Shift+K')
  expect(loaded.get().preferences.mouse.side1).toBe('latest')
  expect(loaded.get().preferences.sendMode).toBe('primary-enter')
  const snapshot = loaded.get(); snapshot.preferences.bindings.latest = null
  expect(loaded.get().preferences.bindings.latest).toBe('Ctrl+Shift+K')
})
it('serializes concurrent saves and rejects stale writers without dropping the first update', async () => {
  const { store } = await fixture(); await store.load()
  const first = shortcutDefaults(); first.bindings.latest = 'Alt+L'
  const second = shortcutDefaults(); second.mouse.side1 = 'back'
  const results = await Promise.allSettled([store.save({ expectedRevision: 0, preferences: first }), store.save({ expectedRevision: 0, preferences: second })])
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect(store.get()).toEqual({ revision: 1, preferences: first, degraded: false })
})
it('keeps live state unchanged after a write failure and can retry', async () => {
  const { path, store } = await fixture(); await store.load(); await mkdir(path)
  const next = shortcutDefaults(); next.mouse.side2 = 'preview'
  await expect(store.save({ expectedRevision: 0, preferences: next })).rejects.toThrow()
  expect(store.get()).toEqual({ revision: 0, preferences: shortcutDefaults(), degraded: false })
  await rm(path, { recursive: true }); await store.save({ expectedRevision: 0, preferences: next })
  expect(store.get().revision).toBe(1)
})
it('rejects invalid untrusted IPC input before writing', async () => {
  const { store } = await fixture(); await store.load()
  await expect(store.save(null as never)).rejects.toThrow()
  const preferences = shortcutDefaults(); preferences.bindings.latest = 'K'
  await expect(store.save({ expectedRevision: 0, preferences })).rejects.toThrow()
  expect(store.get().revision).toBe(0)
})

it('migrates all four tabs once, releases their occupied keys and preserves unrelated preferences', async () => {
  const { path, store } = await fixture()
  const old = { ...shortcutDefaults(), schemaVersion: 1 }
  Object.assign(old.bindings, { execution: null, members: 'Alt+M', dm: 'Alt+D', tasks: 'Alt+T', latest: 'Mod+1', preview: 'Mod+4', composer: 'Alt+I' })
  old.mouse.side1 = 'tasks'; old.sendMode = 'primary-enter'
  await writeFile(path, JSON.stringify(old)); await Promise.all([store.load(), store.load()])
  const next = store.get().preferences
  expect([next.bindings.execution, next.bindings.members, next.bindings.dm, next.bindings.tasks]).toEqual(['Mod+1', 'Mod+2', 'Mod+3', 'Mod+4'])
  expect([next.bindings.latest, next.bindings.preview, next.bindings.composer]).toEqual([null, null, 'Alt+I'])
  expect(next.mouse).toEqual(old.mouse); expect(next.sendMode).toBe('primary-enter')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next)
  next.bindings.tasks = 'Alt+T'
  await store.save({ expectedRevision: 0, preferences: next })
  const reopened = new ShortcutPreferencesStore(path, 'darwin'); await reopened.load()
  expect(reopened.get().preferences.bindings.tasks).toBe('Alt+T')
})
it('keeps the v1 file intact if migration cannot persist, uses the new map and retries with explicit save', async () => {
  const { path, store } = await fixture()
  const old = { ...shortcutDefaults(), schemaVersion: 1 }
  Object.assign(old.bindings, { execution: 'Mod+1', tasks: 'Mod+2', members: 'Mod+3', dm: 'Mod+4' })
  const original = JSON.stringify(old); await writeFile(path, original)
  vi.spyOn(writer, 'writePrivateJson').mockRejectedValueOnce(new Error('disk unavailable'))
  await store.load()
  expect(await readFile(path, 'utf8')).toBe(original)
  expect(store.get().migrationPending).toBe(true)
  expect(store.get().preferences.bindings.tasks).toBe('Mod+4')
  await store.save({ expectedRevision: 0, preferences: store.get().preferences })
  expect(store.get().migrationPending).toBeUndefined()
  expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(2)
})
