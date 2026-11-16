import { randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { lstat, open, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { MessageBoxOptions, SaveDialogOptions } from 'electron'
import type { AttachmentSaveResult, LocalAttachmentAvailability } from '@contracts'
import type { DesktopAttachmentTarget } from './attachment-desktop'

/** A default destination component, never a change to stored display metadata. */
export function normalizeAttachmentSaveName(displayName: string): string {
  let name = displayName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/u, '') || 'file'
  const device = name.split('.')[0].replace(/[ ]+$/u, '')
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/iu.test(device)) name = '_' + name
  const extension = extname(name)
  const suffix = extension.length <= 32 && Buffer.byteLength(extension, 'utf8') <= 32 ? extension : ''
  const byteBudget = 240 - Buffer.byteLength(suffix, 'utf8')
  const unitBudget = 240 - suffix.length
  let stem = '', bytes = 0
  for (const point of name.slice(0, name.length - suffix.length)) {
    const size = Buffer.byteLength(point, 'utf8')
    if (bytes + size > byteBudget || stem.length + point.length > unitBudget) break
    stem += point
    bytes += size
  }
  return (stem.replace(/[. ]+$/u, '') || 'file') + suffix
}

export function attachmentSaveDialogOptions(directory: string, name: string, platform = process.platform): SaveDialogOptions {
  const options: SaveDialogOptions = { defaultPath: join(directory, name) }
  if (platform === 'linux') options.properties = ['showOverwriteConfirmation']
  return options
}

export function attachmentReplaceDialogOptions(name: string): MessageBoxOptions {
  return { type: 'warning', title: '替换文件', buttons: ['取消', '替换'], defaultId: 0, cancelId: 0, noLink: true,
    message: `替换“${name}”？`, detail: '此位置已存在同名文件，替换后将覆盖其内容。' }
}

class AttachmentSourceUnavailable extends Error {
  constructor(readonly availability: LocalAttachmentAvailability) { super('Attachment source unavailable') }
}

async function inspectSource<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new AttachmentSourceUnavailable('missing')
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') throw new AttachmentSourceUnavailable('unreadable')
    throw error
  }
}

/** Only Main supplies the owner-authorized source and the native dialog's destination. */
export async function saveDesktopAttachment(
  resolve: () => Promise<{ target: DesktopAttachmentTarget | null; availability: LocalAttachmentAvailability }>,
  chooseDestination: (name: string) => Promise<string | null>,
  confirmReplacement?: (name: string) => Promise<boolean>
): Promise<AttachmentSaveResult> {
  let availability: LocalAttachmentAvailability = 'unknown'
  try {
    const initial = await resolve()
    availability = initial.availability
    if (!initial.target || initial.target.kind !== 'file') {
      return { saved: false, error: 'target_unavailable', availability }
    }
    const name = normalizeAttachmentSaveName(initial.target.displayName)
    const destination = await chooseDestination(name)
    if (!destination) return { saved: false, error: null, availability }
    // Electron 43's GTK 3 accept response bypasses GTK's stock overwrite gate.
    // Linux Main therefore owns an explicit confirmation for existing targets.
    if (confirmReplacement) {
      const exists = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (exists && !await confirmReplacement(basename(destination))) return { saved: false, error: null, availability }
    }
    // Native dialogs can remain open while a message or its source disappears.
    const current = await resolve()
    availability = current.availability
    if (!current.target || current.target.kind !== 'file') {
      return { saved: false, error: 'target_unavailable', availability }
    }
    await copyAttachmentFile(current.target.path, destination)
    return { saved: true, error: null, availability: 'available' }
  } catch (error) {
    if (error instanceof AttachmentSourceUnavailable) return { saved: false, error: 'target_unavailable', availability: error.availability }
    return { saved: false, error: 'save_failed', availability }
  }
}

async function copyAttachmentFile(source: string, destination: string): Promise<void> {
  // Source Refs already permit links; follow that authorized reference once,
  // then hold the final regular file rather than reopening its name mid-copy.
  const canonicalSource = await inspectSource(() => realpath(source))
  if (!(await inspectSource(() => lstat(canonicalSource))).isFile()) throw new AttachmentSourceUnavailable('kind_changed')
  const input = await inspectSource(() => open(canonicalSource, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)))
  let temporary: string | null = null
  try {
    const sourceInfo = await inspectSource(() => input.stat())
    if (!sourceInfo.isFile()) throw new AttachmentSourceUnavailable('kind_changed')
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
