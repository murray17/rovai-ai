import { randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { lstat, open, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { AttachmentSaveResult, LocalAttachmentAvailability } from '@contracts'
import type { DesktopAttachmentTarget } from './attachment-desktop'

/** Only Main supplies the owner-authorized source and the native dialog's destination. */
export async function saveDesktopAttachment(
  resolve: () => Promise<{ target: DesktopAttachmentTarget | null; availability: LocalAttachmentAvailability }>,
  chooseDestination: (name: string) => Promise<string | null>
): Promise<AttachmentSaveResult> {
  let availability: LocalAttachmentAvailability = 'unknown'
  try {
    const initial = await resolve()
    availability = initial.availability
    if (!initial.target || initial.target.kind !== 'file') {
      return { saved: false, error: 'target_unavailable', availability }
    }
    const name = initial.target.displayName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/u, '') || 'file'
    const destination = await chooseDestination(name)
    if (!destination) return { saved: false, error: null, availability }
    // A native dialog can remain open while a message or its source disappears.
    const current = await resolve()
    availability = current.availability
    if (!current.target || current.target.kind !== 'file') {
      return { saved: false, error: 'target_unavailable', availability }
    }
    await copyAttachmentFile(current.target.path, destination)
    return { saved: true, error: null, availability: 'available' }
  } catch {
    return { saved: false, error: 'save_failed', availability }
  }
}

async function copyAttachmentFile(source: string, destination: string): Promise<void> {
  // Source Refs already permit links; follow that authorized reference once,
  // then hold the final regular file rather than reopening its name mid-copy.
  const canonicalSource = await realpath(source)
  if (!(await lstat(canonicalSource)).isFile()) throw new Error('Attachment is no longer a regular file')
  const input = await open(canonicalSource, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let temporary: string | null = null
  try {
    const sourceInfo = await input.stat()
    if (!sourceInfo.isFile()) throw new Error('Attachment is no longer a regular file')
    const existing = await stat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    // Saving to the original file (including a hard link) must not truncate it.
    if (existing?.dev === sourceInfo.dev && existing.ino === sourceInfo.ino) return
    const temporaryPath = join(dirname(destination), `.rovai-download-${randomUUID()}`)
    const output = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
    // A failed exclusive create never grants cleanup authority over that name.
    output.once('open', () => { temporary = temporaryPath })
    await pipeline(input.createReadStream({ autoClose: false }), output)
    await rename(temporaryPath, destination)
    temporary = null
  } finally {
    await input.close()
    if (temporary) await unlink(temporary).catch(() => undefined)
  }
}
