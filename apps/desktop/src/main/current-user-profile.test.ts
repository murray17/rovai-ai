import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CURRENT_USER_PROFILE } from '@contracts'
import { CurrentUserProfileStore, parseCurrentUserProfile } from './current-user-profile'

const roots: string[] = []
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rovai-current-user-profile-'))
  roots.push(root)
  return join(root, 'profile.json')
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('Desktop current user presentation storage', () => {
  it('starts without creating a file, atomically persists both fields and restores defaults across restarts', async () => {
    const path = await fixture()
    const store = await CurrentUserProfileStore.load(path)
    expect(store.get()).toEqual(DEFAULT_CURRENT_USER_PROFILE)
    expect(await readdir(join(path, '..'))).toEqual([])
    const png = await readFile(new URL('../renderer/src/assets/characters/muwa/icon-192.png', import.meta.url))
    const draft = { displayName: '  新名字 🐻  ', avatarDataUrl: `data:image/png;base64,${png.toString('base64')}` }
    const saved = await store.save(draft)
    expect(saved.displayName).toBe('新名字 🐻')
    expect((await CurrentUserProfileStore.load(path)).get()).toEqual(saved)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    await store.save({ displayName: ' ', avatarDataUrl: null })
    expect((await CurrentUserProfileStore.load(path)).get()).toEqual(DEFAULT_CURRENT_USER_PROFILE)
  })

  it('keeps the last accepted pair on write failure and permits a later retry', async () => {
    const path = await fixture()
    const store = await CurrentUserProfileStore.load(path)
    const saved = await store.save({ displayName: '旧名称', avatarDataUrl: null })
    await rm(path)
    await mkdir(path)
    await expect(store.save({ displayName: '新名称', avatarDataUrl: null })).rejects.toThrow()
    expect(store.get()).toEqual(saved)
    expect(await readdir(join(path, '..'))).toEqual(['profile.json'])
    await rm(path, { recursive: true })
    await Promise.all([
      store.save({ displayName: '第一次', avatarDataUrl: null }),
      store.save({ displayName: '第二次', avatarDataUrl: null })
    ])
    expect((await CurrentUserProfileStore.load(path)).get().displayName).toBe('第二次')
  })

  it('rejects unbounded or non-image input and never silently repairs an unreadable saved file', async () => {
    const path = await fixture()
    await writeFile(path, '{broken profile')
    const store = await CurrentUserProfileStore.load(path)
    expect(store.loadDegradation?.code).toBe('current_user_profile_unreadable')
    expect(await readFile(path, 'utf8')).toBe('{broken profile')
    for (const input of [
      { displayName: '名'.repeat(33), avatarDataUrl: null },
      { displayName: '两\n行', avatarDataUrl: null },
      { displayName: '你', avatarDataUrl: 'https://example.com/avatar.png' },
      { displayName: '你', avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
      { displayName: '你', avatarDataUrl: 'data:image/png;base64,YmFk' },
      { displayName: '你', avatarDataUrl: null, userId: 'another-user' }
    ]) expect(() => parseCurrentUserProfile(input)).toThrow()
    expect(parseCurrentUserProfile({ displayName: '🐻'.repeat(32), avatarDataUrl: null }).displayName).toHaveLength(64)
  })
})
