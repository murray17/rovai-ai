import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalComposerAttachmentRegistry } from './local-composer-attachments'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; registryPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'rovai-local-composer-'))
  temporaryRoots.push(root)
  return { root, registryPath: join(root, 'registry.json') }
}

describe('Local Composer attachment authority', () => {
  it('restores an exact Main-owned image source and serves bounded preview bytes', async () => {
    const { root, registryPath } = await fixture()
    const imagePath = join(root, 'screenshot.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(imagePath, bytes)
    const first = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await first.prepare({
      campId: 'camp-a', sourcePath: imagePath, displayName: 'screenshot.png', mediaType: 'image/png'
    })
    expect(attachment).toMatchObject({ previewKind: 'image', availability: 'available', sourcePath: imagePath })

    const restoredOwner = new LocalComposerAttachmentRegistry(registryPath)
    const [restored] = await restoredOwner.restore('camp-a', [attachment])
    expect(restored).toMatchObject({ id: attachment.id, previewKind: 'image', sourcePath: imagePath })
    const preview = await restoredOwner.preview({
      owner: 'composer', campId: 'camp-a', attachmentRefId: attachment.id
    })
    expect(preview?.availability).toBe('available')
    expect(preview?.preview?.bytes).toEqual(new Uint8Array(bytes))
    expect((await restoredOwner.resolveTarget({
      owner: 'composer', campId: 'camp-a', attachmentRefId: attachment.id
    }))?.target).toMatchObject({ path: imagePath, canShowPath: true })
  })

  it('keeps a source file above 25 MiB available from selection through restore and open', async () => {
    const { root, registryPath } = await fixture()
    const sourcePath = join(root, 'large.png')
    const byteSize = 25 * 1024 * 1024 + 1
    await writeFile(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await truncate(sourcePath, byteSize)

    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await registry.prepare({
      campId: 'camp-a', sourcePath, displayName: 'large.png', mediaType: 'image/png'
    })
    expect(attachment).toMatchObject({ availability: 'available', byteSize, previewKind: 'image' })

    const restoredOwner = new LocalComposerAttachmentRegistry(registryPath)
    const [restored] = await restoredOwner.restore('camp-a', [attachment])
    expect(restored).toMatchObject({ availability: 'available', byteSize })
    expect(await restoredOwner.preview({
      owner: 'composer', campId: 'camp-a', attachmentRefId: attachment.id
    })).toEqual({ preview: null, availability: 'available' })
    expect((await restoredOwner.resolveTarget({
      owner: 'composer', campId: 'camp-a', attachmentRefId: attachment.id
    }))?.target?.path).toBe(sourcePath)
  })

  it('does not trust a Renderer-supplied replacement path during restore', async () => {
    const { root, registryPath } = await fixture()
    const selectedPath = join(root, 'selected.txt')
    const replacementPath = join(root, 'replacement.txt')
    await writeFile(selectedPath, 'selected')
    await writeFile(replacementPath, 'replacement')
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await registry.prepare({
      campId: 'camp-a', sourcePath: selectedPath, displayName: 'selected.txt', mediaType: 'text/plain'
    })
    const [restored] = await registry.restore('camp-a', [{ ...attachment, sourcePath: replacementPath }])
    expect(restored.sourcePath).toBe(selectedPath)
  })

  it('revokes local preview/open authority when the draft releases an attachment', async () => {
    const { root, registryPath } = await fixture()
    const sourcePath = join(root, 'notes.md')
    await writeFile(sourcePath, '# notes')
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await registry.prepare({
      campId: 'camp-a', sourcePath, displayName: 'notes.md', mediaType: 'text/markdown'
    })
    await registry.discard('camp-a', [attachment.id])
    expect(await registry.resolveTarget({
      owner: 'composer', campId: 'camp-a', attachmentRefId: attachment.id
    })).toEqual({ target: null, availability: 'missing' })
  })

  it('rolls an authority mutation back when its durable registry cannot be replaced', async () => {
    const { root, registryPath } = await fixture()
    const sourcePath = join(root, 'notes.md')
    await writeFile(sourcePath, '# notes')
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await registry.prepare({
      campId: 'camp-a', sourcePath, displayName: 'notes.md', mediaType: 'text/markdown'
    })
    await rm(registryPath)
    await mkdir(registryPath)

    await expect(registry.discard('camp-a', [attachment.id])).rejects.toThrow()
    expect((await registry.resolveTarget({
      owner: 'composer', campId: 'camp-a', attachmentRefId: attachment.id
    }))?.target?.path).toBe(sourcePath)
  })
})
