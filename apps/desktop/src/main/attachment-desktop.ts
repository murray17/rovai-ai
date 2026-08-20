import { isAbsolute } from 'node:path'
import type { AttachmentOpenResult, AttachmentRevealResult } from '@contracts'

export interface DesktopAttachmentTarget {
  attachmentId: string
  displayName: string
  kind: 'file' | 'directory'
  mediaType: string
  path: string
  openRisk: 'normal' | 'confirm'
}

export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
}

export function parseDesktopAttachmentTarget(
  value: unknown,
  requestedAttachmentId: string
): DesktopAttachmentTarget | null {
  if (!value || typeof value !== 'object') return null
  const keys = Object.keys(value).sort()
  if (keys.join(',') !== 'attachmentId,displayName,kind,mediaType,openRisk,path') return null
  const target = value as Partial<DesktopAttachmentTarget>
  if (
    target.attachmentId !== requestedAttachmentId
    || typeof target.displayName !== 'string'
    || !target.displayName
    || Array.from(target.displayName).length > 120
    || (target.kind !== 'file' && target.kind !== 'directory')
    || typeof target.mediaType !== 'string'
    || !target.mediaType
    || typeof target.path !== 'string'
    || !isAbsolute(target.path)
    || (target.openRisk !== 'normal' && target.openRisk !== 'confirm')
  ) return null
  return target as DesktopAttachmentTarget
}

export function attachmentOpenResultFromNativeError(error: string): AttachmentOpenResult {
  return error
    ? { opened: false, error: 'open_failed' }
    : { opened: true, error: null }
}

export async function openDesktopAttachmentTarget(
  target: DesktopAttachmentTarget,
  actions: {
    confirm(displayName: string): Promise<boolean>
    openPath(path: string): Promise<string>
  }
): Promise<AttachmentOpenResult> {
  try {
    if (target.openRisk === 'confirm' && !(await actions.confirm(target.displayName))) {
      return { opened: false, error: null }
    }
    return attachmentOpenResultFromNativeError(await actions.openPath(target.path))
  } catch {
    return { opened: false, error: 'open_failed' }
  }
}

export function revealDesktopAttachmentTarget(
  target: DesktopAttachmentTarget,
  revealPath: (path: string) => void
): AttachmentRevealResult {
  try {
    revealPath(target.path)
    return { revealed: true, error: null }
  } catch {
    return { revealed: false, error: 'reveal_failed' }
  }
}
