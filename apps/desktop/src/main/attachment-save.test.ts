import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAttachmentTarget } from './attachment-desktop'
import { saveDesktopAttachment } from './attachment-save'

vi.mock('node:crypto', () => ({ randomUUID: () => 'fixture-copy' }))

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rovai-attachment-save-'))
  directories.push(root)
  const source = join(root, 'original.bin')
  const destination = join(root, 'saved.bin')
  const bytes = Buffer.from([0, 255, 10, 128, 1])
  await writeFile(source, bytes)
  const target: DesktopAttachmentTarget = { attachmentId: 'fixture', displayName: 'report:2026.bin', kind: 'file',
    mediaType: 'application/octet-stream', path: source, openRisk: 'normal', canShowPath: true }
  return { root, source, destination, bytes, target }
}

describe('native attachment saving', () => {
  it('reauthorizes after the dialog and saves the current binary bytes without changing the source', async () => {
    const f = await fixture()
    const updated = Buffer.concat([f.bytes, Buffer.from([42])])
    await writeFile(f.destination, 'old destination')
    const resolve = vi.fn(async () => ({ target: f.target, availability: 'available' as const }))
    const result = await saveDesktopAttachment(resolve, async name => {
      expect(name).toBe('report_2026.bin')
      await writeFile(f.source, updated)
      return f.destination
    })
    expect(result).toEqual({ saved: true, error: null, availability: 'available' })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(await readFile(f.destination)).toEqual(updated)
    expect(await readFile(f.source)).toEqual(updated)
    expect(await readdir(f.root)).toEqual(expect.arrayContaining(['original.bin', 'saved.bin']))
    expect((await readdir(f.root)).filter(name => name.startsWith('.rovai-download-'))).toEqual([])
    const prior = await stat(f.source)
    expect(await saveDesktopAttachment(resolve, async () => f.source)).toMatchObject({ saved: true })
    expect((await stat(f.source)).ino).toBe(prior.ino)
    expect(await readFile(f.source)).toEqual(updated)
  })

  it('treats cancellation as no write and stops when owner authorization is lost during the dialog', async () => {
    const f = await fixture()
    const resolve = vi.fn(async () => ({ target: f.target, availability: 'available' as const }))
    expect(await saveDesktopAttachment(resolve, async () => null)).toEqual({ saved: false, error: null, availability: 'available' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(await readdir(f.root)).toEqual(['original.bin'])
    await writeFile(f.destination, 'keep destination')
    const revoked = vi.fn().mockResolvedValueOnce({ target: f.target, availability: 'available' })
      .mockResolvedValueOnce({ target: null, availability: 'missing' })
    expect(await saveDesktopAttachment(revoked, async () => f.destination))
      .toEqual({ saved: false, error: 'target_unavailable', availability: 'missing' })
    expect(await readFile(f.destination, 'utf8')).toBe('keep destination')
    const choose = vi.fn()
    expect(await saveDesktopAttachment(async () => ({ target: { ...f.target, kind: 'directory' }, availability: 'available' }), choose))
      .toMatchObject({ saved: false, error: 'target_unavailable' })
    expect(choose).not.toHaveBeenCalled()
  })

  it('follows owner-approved symlink references but preserves the destination if the target becomes a directory', async () => {
    const f = await fixture()
    const alias = join(f.root, 'alias.bin')
    await symlink(f.source, alias)
    const resolve = async () => ({ target: { ...f.target, path: alias }, availability: 'available' as const })
    expect(await saveDesktopAttachment(resolve, async () => f.destination)).toMatchObject({ saved: true })
    expect(await readFile(f.destination)).toEqual(f.bytes)
    await writeFile(f.destination, 'keep destination')
    const result = await saveDesktopAttachment(resolve, async () => {
      await rm(alias)
      await symlink(f.root, alias, 'dir')
      return f.destination
    })
    expect(result).toEqual({ saved: false, error: 'save_failed', availability: 'available' })
    expect(await readFile(f.destination, 'utf8')).toBe('keep destination')
    expect(JSON.stringify(result)).not.toContain(f.root)
    expect((await readdir(f.root)).filter(name => name.startsWith('.rovai-download-'))).toEqual([])
  })

  it('preserves the original file and removes temporary output after a destination failure', async () => {
    const f = await fixture()
    const result = await saveDesktopAttachment(async () => ({ target: f.target, availability: 'available' }), async () => f.root)
    expect(result).toEqual({ saved: false, error: 'save_failed', availability: 'available' })
    expect(await readFile(f.source)).toEqual(f.bytes)
    expect(await readdir(f.root)).toEqual(['original.bin'])
  })

  it('does not remove an existing file when exclusive temporary creation fails', async () => {
    const f = await fixture()
    const foreign = join(f.root, '.rovai-download-fixture-copy')
    await writeFile(foreign, 'unowned file')
    await writeFile(f.destination, 'keep destination')
    const result = await saveDesktopAttachment(async () => ({ target: f.target, availability: 'available' }), async () => f.destination)
    expect(result).toMatchObject({ saved: false, error: 'save_failed' })
    expect(await readFile(foreign, 'utf8')).toBe('unowned file')
    expect(await readFile(f.destination, 'utf8')).toBe('keep destination')
    expect(await readFile(f.source)).toEqual(f.bytes)
  })
})
