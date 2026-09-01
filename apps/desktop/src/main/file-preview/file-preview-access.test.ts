import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openPreviewFile, pathIsWithin } from './file-preview-access'

const opened: Array<Awaited<ReturnType<typeof openPreviewFile>>> = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((entry) => entry.file.close().catch(() => undefined)))
})

describe('file preview access', () => {
  it('opens a regular file and produces a root-relative display path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovai-preview-'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'guide.md'), '# Guide')
    const result = await openPreviewFile(root, join(root, 'docs', 'guide.md'))
    opened.push(result)
    expect(result.displayPath).toBe('docs/guide.md')
    expect(result.version.size).toBe(7)
  })

  it('rejects symlinks that escape the authorized root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovai-preview-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'rovai-preview-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    await expect(openPreviewFile(root, join(root, 'link.txt'))).rejects.toMatchObject({
      code: 'outside_authorized_root'
    })
  })

  it('opens one exact external file without turning the source root into a directory grant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovai-preview-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'rovai-preview-outside-'))
    await writeFile(join(outside, 'notes.txt'), 'outside note')
    await symlink(join(outside, 'notes.txt'), join(root, 'link.txt'))

    const result = await openPreviewFile(root, join(root, 'link.txt'), { allowExternalFile: true })
    opened.push(result)

    expect(result.canonicalRoot).toBe(await realpath(outside))
    expect(result.canonicalPath).toBe(await realpath(join(outside, 'notes.txt')))
    expect(result.displayPath).toBe('notes.txt')
  })

  it('uses segment-aware containment', () => {
    expect(pathIsWithin('/repo', '/repo/src/app.ts')).toBe(true)
    expect(pathIsWithin('/repo', '/repo-other/app.ts')).toBe(false)
  })
})
