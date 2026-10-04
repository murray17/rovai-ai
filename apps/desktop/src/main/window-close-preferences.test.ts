import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WindowClosePreferences } from './window-close-preferences'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function path() { const root = await mkdtemp(join(tmpdir(), 'rovai-close-preference-')); roots.push(root); return join(root, 'window-close.json') }

it('defaults to asking and persists all three choices across independent store loads', async () => {
  const file = await path()
  const store = new WindowClosePreferences(file)
  expect(store.get()).toBe('ask'); expect(store.loadFailed).toBe(false)
  for (const choice of ['tray', 'exit', 'ask'] as const) {
    await store.set(choice)
    expect(new WindowClosePreferences(file).get()).toBe(choice)
  }
})

it.each(['{', '{}', '{"schemaVersion":2,"behavior":"tray"}', '{"schemaVersion":1,"behavior":"other"}'])('preserves unreadable/invalid input %s and asks safely', async content => {
  const file = await path(); await writeFile(file, content)
  const store = new WindowClosePreferences(file)
  expect(store.get()).toBe('ask'); expect(store.loadFailed).toBe(true)
  expect(await readFile(file, 'utf8')).toBe(content)
})

it('failed writes do not change the effective policy', async () => {
  const file = await path(); await writeFile(file, 'blocked parent')
  const store = new WindowClosePreferences(join(file, 'child'))
  await expect(store.set('tray')).rejects.toThrow()
  expect(store.get()).toBe('ask')
})
