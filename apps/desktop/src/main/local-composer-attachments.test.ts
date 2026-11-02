import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { basename, dirname, join, toNamespacedPath } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createPastedTextAttachment, LocalComposerAttachmentRegistry } from './local-composer-attachments'
import { openDesktopAttachmentTarget, parseDesktopAttachmentTarget, revealDesktopAttachmentTarget } from './attachment-desktop'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; registryPath: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-local-composer-')))
  temporaryRoots.push(root)
  return { root, registryPath: join(root, 'registry.json') }
}

describe('Local Composer attachment authority', () => {
  it.skipIf(process.platform !== 'win32').each([false, true])(
    'creates, restores and removes pasted text in a Windows namespaced root (long path: %s)',
    async (longPath) => {
      const { root, registryPath } = await fixture()
      const directories = longPath ? Array.from({ length: 4 }, (_, i) => `附件-${i}-${'x'.repeat(65)}`) : []
      const outputRoot = toNamespacedPath(join(root, ...directories))
      await mkdir(outputRoot, { recursive: true })
      const registry = new LocalComposerAttachmentRegistry(registryPath)
      const text = ' \t\r\n' + '😀中'.repeat(10_001) + '\n  '
      const attachment = await createPastedTextAttachment(
        registry, 'thread-a', outputRoot, '粘贴内容-1.txt', Buffer.from(text, 'utf8')
      )
      expect(dirname(attachment.sourcePath!)).toBe(outputRoot)
      expect(basename(attachment.sourcePath!)).toMatch(/^[0-9a-f-]{36}\.txt$/u)
      expect(await readFile(attachment.sourcePath!, 'utf8')).toBe(text)
      const restarted = new LocalComposerAttachmentRegistry(registryPath)
      expect((await restarted.restore('thread-a', [attachment]))[0].availability).toBe('available')
      expect(await restarted.removePastedText('thread-a', attachment.id, async () => outputRoot)).toBe('deleted')
      await expect(readFile(attachment.sourcePath!)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('rejects a linked parent before writing pasted text', async () => {
    const { root, registryPath } = await fixture()
    const target = join(root, 'target')
    await mkdir(join(target, 'output'), { recursive: true })
    const link = join(root, 'linked')
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    const outputRoot = toNamespacedPath(join(link, 'output'))
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    await expect(createPastedTextAttachment(
      registry, 'thread-a', outputRoot, 'paste.txt', Buffer.from('text')
    )).rejects.toThrow('附件目录已变化。')
    expect(await readdir(join(target, 'output'))).toEqual([])
  })

  it('creates complete UTF-8 text in the supplied Thread root and restores its provenance after restart', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const text = ' \t\r\n' + '😀中'.repeat(10_001) + '\n  '
    const attachment = await createPastedTextAttachment(
      registry, 'thread-a', root, '粘贴内容-1.txt', Buffer.from(text, 'utf8')
    )
    expect(basename(attachment.sourcePath!)).toMatch(/^[0-9a-f-]{36}\.txt$/u)
    expect(await readFile(attachment.sourcePath!, 'utf8')).toBe(text)
    const restarted = new LocalComposerAttachmentRegistry(registryPath)
    expect((await restarted.restore('thread-a', [attachment]))[0]).toMatchObject({
      id: attachment.id, generatedBy: 'long_text_paste', availability: 'available',
      pastedTextPreview: '😀中'.repeat(80)
    })
    // A different Thread or an ordinary external .txt never gains deletion permission.
    expect(await restarted.removePastedText('thread-b', attachment.id, async () => root)).toBe('retained')
    const external = await restarted.prepare({
      threadId: 'thread-a', sourcePath: attachment.sourcePath!, displayName: 'external.txt', mediaType: 'text/plain'
    })
    expect(external.pastedTextPreview).toBeUndefined()
    expect(await restarted.removePastedText('thread-a', external.id, async () => root)).toBe('retained')
    await restarted.discard('thread-a', [external.id])
    expect(await readFile(attachment.sourcePath!, 'utf8')).toBe(text)
    expect(await restarted.removePastedText('thread-a', attachment.id, async () => root)).toBe('deleted')
    await expect(readFile(attachment.sourcePath!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await restarted.restore('thread-a', [attachment]))[0].availability).toBe('missing')
  })

  it('keeps one-way send protection across restart and releases only the draft registration', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('text'))
    await registry.protectForSend('thread-a', [{ id: attachment.id, sourcePath: attachment.sourcePath! }])
    // A rejection, lost receipt or retry does not reverse the flag.
    const restarted = new LocalComposerAttachmentRegistry(registryPath)
    await restarted.protectForSend('thread-a', [{ id: attachment.id, sourcePath: attachment.sourcePath! }])
    expect(await restarted.removePastedText('thread-a', attachment.id, async () => {
      throw new Error('Protected files do not need a cleanup path')
    })).toBe('retained')
    expect(await readFile(attachment.sourcePath!, 'utf8')).toBe('text')
    expect((await restarted.restore('thread-a', [attachment]))[0].availability).toBe('missing')
  })

  it('protects only final send sources and preserves earlier protection when a later send has no attachments', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const earlier = await createPastedTextAttachment(registry, 'thread-a', root, 'earlier.txt', Buffer.from('earlier'))
    await registry.protectForSend('thread-a', [{ id: earlier.id, sourcePath: earlier.sourcePath! }])
    const removed = await createPastedTextAttachment(registry, 'thread-a', root, 'removed.txt', Buffer.from('removed'))
    const remaining = await createPastedTextAttachment(registry, 'thread-a', root, 'remaining.txt', Buffer.from('remaining'))

    // A removed draft reference can still have a registration after cleanup failed.
    await rm(removed.sourcePath!)
    await mkdir(removed.sourcePath!)
    await expect(registry.removePastedText('thread-a', removed.id, async () => root)).rejects.toThrow()
    await registry.protectForSend('thread-a', [{ id: remaining.id, sourcePath: remaining.sourcePath! }])
    await registry.protectForSend('thread-a', [])

    const restarted = new LocalComposerAttachmentRegistry(registryPath)
    await rm(removed.sourcePath!, { recursive: true })
    await writeFile(removed.sourcePath!, 'removed')
    expect(await restarted.removePastedText('thread-a', removed.id, async () => root)).toBe('deleted')
    await expect(readFile(removed.sourcePath!)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const attachment of [earlier, remaining]) {
      expect(await restarted.removePastedText('thread-a', attachment.id, async () => root)).toBe('retained')
      expect(await readFile(attachment.sourcePath!, 'utf8')).toBe(attachment === earlier ? 'earlier' : 'remaining')
    }
  })

  it('serializes deletion with protection and refuses to forward protection when its save fails', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('text'))
    let releaseRoot!: (root: string) => void
    let enteredCleanup!: () => void
    const entered = new Promise<void>(resolve => { enteredCleanup = resolve })
    const removal = registry.removePastedText('thread-a', attachment.id, () => {
      enteredCleanup()
      return new Promise(resolve => { releaseRoot = resolve })
    })
    await entered
    let protectionFinished = false
    const protection = registry.protectForSend('thread-a', [{ id: attachment.id, sourcePath: attachment.sourcePath! }])
      .then(() => { protectionFinished = true })
    await Promise.resolve()
    expect(protectionFinished).toBe(false)
    releaseRoot(root)
    expect(await removal).toBe('deleted')
    await protection
    await expect(readFile(attachment.sourcePath!)).rejects.toMatchObject({ code: 'ENOENT' })

    const next = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('next'))
    await rm(registryPath)
    await mkdir(registryPath)
    await expect(registry.protectForSend('thread-a', [{ id: next.id, sourcePath: next.sourcePath! }])).rejects.toThrow()
    expect(await readFile(next.sourcePath!, 'utf8')).toBe('next')
  })

  it('does not make an attachment-free send wait for another Thread cleanup', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('text'))
    let releaseRoot!: (root: string) => void
    let enteredCleanup!: () => void
    const entered = new Promise<void>(resolve => { enteredCleanup = resolve })
    const removal = registry.removePastedText('thread-a', attachment.id, () => {
      enteredCleanup()
      return new Promise(resolve => { releaseRoot = resolve })
    })
    await entered
    try {
      const protectedEmpty = registry.protectForSend('thread-b', []).then(() => true)
      expect(await Promise.race([
        protectedEmpty,
        new Promise<boolean>(resolve => setImmediate(() => resolve(false)))
      ])).toBe(true)
    } finally {
      releaseRoot(root)
      await removal
    }
  })

  it('protects a generated source sent from another Thread, while IDs remain Thread-scoped', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const generated = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('shared text'))
    const unrelated = await createPastedTextAttachment(registry, 'thread-a', root, 'other.txt', Buffer.from('other'))
    const external = await registry.prepare({
      threadId: 'thread-b', sourcePath: generated.sourcePath!, displayName: 'selected.txt', mediaType: 'text/plain'
    })
    await registry.protectForSend('thread-b', [
      { id: external.id, sourcePath: external.sourcePath! },
      // An ID borrowed from another Thread cannot protect an unrelated path.
      { id: unrelated.id, sourcePath: join(root, 'different.txt') }
    ])
    const restarted = new LocalComposerAttachmentRegistry(registryPath)
    expect(await restarted.removePastedText('thread-a', generated.id, async () => root)).toBe('retained')
    expect(await readFile(generated.sourcePath!, 'utf8')).toBe('shared text')
    expect(await restarted.removePastedText('thread-a', unrelated.id, async () => root)).toBe('deleted')
    await expect(readFile(unrelated.sourcePath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains cleanup authority on unlink failure and treats an already missing file as cleaned', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('text'))
    // Deterministic unlink failure, with no permission or timing assumptions.
    await rm(attachment.sourcePath!)
    await mkdir(attachment.sourcePath!)
    await writeFile(join(attachment.sourcePath!, 'do-not-traverse.txt'), 'keep')
    await expect(registry.removePastedText('thread-a', attachment.id, async () => root)).rejects.toThrow()
    expect(await readFile(join(attachment.sourcePath!, 'do-not-traverse.txt'), 'utf8')).toBe('keep')
    const restarted = new LocalComposerAttachmentRegistry(registryPath)
    expect((await restarted.restore('thread-a', [attachment]))[0].generatedBy).toBe('long_text_paste')
    await rm(attachment.sourcePath!, { recursive: true })
    expect(await restarted.removePastedText('thread-a', attachment.id, async () => root)).toBe('deleted')
  })

  it('exempts generated recovery entries from ordinary age and count pruning, but releases them explicitly', async () => {
    const { root, registryPath } = await fixture()
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await createPastedTextAttachment(registry, 'thread-a', root, 'paste.txt', Buffer.from('text'))
    const record = JSON.parse(await readFile(registryPath, 'utf8'))
    const generated = { ...record.entries[0], updatedAt: '2000-01-01T00:00:00Z' }
    const ordinary = Array.from({ length: 201 }, () => ({
      ...generated, attachmentId: randomUUID(), generatedBy: undefined, enteredSendFlow: undefined,
      updatedAt: new Date().toISOString()
    }))
    await writeFile(registryPath, JSON.stringify({ ...record, entries: [...ordinary, generated] }))
    const restarted = new LocalComposerAttachmentRegistry(registryPath)
    expect((await restarted.restore('thread-a', [attachment]))[0].availability).toBe('available')
    await restarted.protectForSend('thread-a', [{ id: attachment.id, sourcePath: attachment.sourcePath! }])
    const saved = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(saved.entries.length).toBe(201)
    expect(saved.entries.find((entry: { attachmentId: string }) => entry.attachmentId === attachment.id)).toMatchObject({
      generatedBy: 'long_text_paste', enteredSendFlow: true
    })
    await restarted.discard('thread-a', [attachment.id])
    expect((await new LocalComposerAttachmentRegistry(registryPath).restore('thread-a', [attachment]))[0].availability).toBe('missing')
    expect(await readFile(attachment.sourcePath!, 'utf8')).toBe('text')
  })

  it('restores an exact Main-owned image source and serves bounded preview bytes', async () => {
    const { root, registryPath } = await fixture()
    for (const [fileName, displayName] of [
      ['screenshot.png', 'screenshot_14:17:26.png'],
      [`${'a'.repeat(121)}.png`, `${'a'.repeat(121)}.png`]
    ]) {
      const imagePath = join(root, fileName)
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      await writeFile(imagePath, bytes)
      const first = new LocalComposerAttachmentRegistry(registryPath)
      const attachment = await first.prepare({
        threadId: 'camp-a', sourcePath: imagePath, displayName, mediaType: 'image/png'
      })
      expect(attachment).toMatchObject({
        displayName, previewKind: 'image', availability: 'available', sourcePath: imagePath
      })
      expect((await first.restore('camp-a', [attachment]))[0]).toMatchObject(attachment)

      const restoredOwner = new LocalComposerAttachmentRegistry(registryPath)
      const [restored] = await restoredOwner.restore('camp-a', [attachment])
      expect(restored).toMatchObject({
        id: attachment.id, displayName, previewKind: 'image', availability: 'available', sourcePath: imagePath
      })
      const locator = { owner: 'composer' as const, threadId: 'camp-a', attachmentRefId: attachment.id }
      const preview = await restoredOwner.preview(locator)
      expect(preview?.availability).toBe('available')
      expect(preview?.preview?.bytes).toEqual(new Uint8Array(bytes))
      const resolved = await restoredOwner.resolveTarget(locator)
      const target = parseDesktopAttachmentTarget(resolved?.target, attachment.id)
      expect(target).toMatchObject({ path: imagePath, displayName, canShowPath: true })
      const accessed: string[] = []
      expect(await openDesktopAttachmentTarget(target!, {
        confirm: async () => true,
        openPath: async (path) => { accessed.push(path); return '' }
      })).toEqual({ opened: true, error: null })
      expect(await revealDesktopAttachmentTarget(target!, {
        canReveal: async () => true,
        revealPath: (path) => { accessed.push(path) }
      })).toEqual({ revealed: true, error: null })
      expect(accessed).toEqual([imagePath, imagePath])
      expect(await readFile(imagePath)).toEqual(bytes)
      expect(await readdir(root)).toContain(fileName)
    }
  })

  it('keeps a source file above 25 MiB available from selection through restore and open', async () => {
    const { root, registryPath } = await fixture()
    const sourcePath = join(root, 'large.png')
    const byteSize = 25 * 1024 * 1024 + 1
    await writeFile(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await truncate(sourcePath, byteSize)

    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await registry.prepare({
      threadId: 'camp-a', sourcePath, displayName: 'large.png', mediaType: 'image/png'
    })
    expect(attachment).toMatchObject({ availability: 'available', byteSize, previewKind: 'image' })

    const restoredOwner = new LocalComposerAttachmentRegistry(registryPath)
    const [restored] = await restoredOwner.restore('camp-a', [attachment])
    expect(restored).toMatchObject({ availability: 'available', byteSize })
    expect(await restoredOwner.preview({
      owner: 'composer', threadId: 'camp-a', attachmentRefId: attachment.id
    })).toEqual({ preview: null, availability: 'available' })
    expect((await restoredOwner.resolveTarget({
      owner: 'composer', threadId: 'camp-a', attachmentRefId: attachment.id
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
      threadId: 'camp-a', sourcePath: selectedPath, displayName: 'selected.txt', mediaType: 'text/plain'
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
      threadId: 'camp-a', sourcePath, displayName: 'notes.md', mediaType: 'text/markdown'
    })
    await registry.discard('camp-a', [attachment.id])
    expect(await registry.resolveTarget({
      owner: 'composer', threadId: 'camp-a', attachmentRefId: attachment.id
    })).toEqual({ target: null, availability: 'missing' })
  })

  it('rolls an authority mutation back when its durable registry cannot be replaced', async () => {
    const { root, registryPath } = await fixture()
    const sourcePath = join(root, 'notes.md')
    await writeFile(sourcePath, '# notes')
    const registry = new LocalComposerAttachmentRegistry(registryPath)
    const attachment = await registry.prepare({
      threadId: 'camp-a', sourcePath, displayName: 'notes.md', mediaType: 'text/markdown'
    })
    await rm(registryPath)
    await mkdir(registryPath)

    await expect(registry.discard('camp-a', [attachment.id])).rejects.toThrow()
    expect((await registry.resolveTarget({
      owner: 'composer', threadId: 'camp-a', attachmentRefId: attachment.id
    }))?.target?.path).toBe(sourcePath)
  })
})
