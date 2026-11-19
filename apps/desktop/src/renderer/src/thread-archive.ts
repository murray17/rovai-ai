import type { ArchiveCommand, ArchiveCommandPayload, CoreEvent, DeleteThreadCommand, StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'
import { desktopThreadClient } from './desktop-camp-client'
import { uiAttribute } from './interface-language'
import { isReferenceDirectoryEvent } from './useReferenceAvailability'

export const ARCHIVE_CHANGE_REASON = 'threads.archive_changed'

export function isArchiveChangeEvent(event: CoreEvent): boolean {
  return event.method === 'navigation.invalidated'
    && (event.params as { reason?: string } | undefined)?.reason === ARCHIVE_CHANGE_REASON
}

export function invalidatesArchiveRecords(event: CoreEvent): boolean {
  return isArchiveChangeEvent(event) || isReferenceDirectoryEvent(event)
    || (event.method === 'thread.messages.changed'
      && Boolean((event.params as { unavailableMessageIds?: string[] } | undefined)?.unavailableMessageIds?.length))
}

export function normalizeArchiveText(value: string): string {
  return Array.from(value.normalize('NFKC'), char => char.toLowerCase()).join('')
}

export class ArchiveCommandRejected extends Error {
  constructor(readonly code: string) {
    const messages: Record<string, string> = {
      'camp.not_found': uiAttribute('目标已移除'),
      'camp.archive_conflict': uiAttribute('归档状态已变化，请刷新后重试。'),
      'command.version_conflict': uiAttribute('记录已变化，请重新确认。'),
      'camp.deletion_in_progress': uiAttribute('记录正在删除。')
    }
    super(messages[code] ?? code)
  }
}

export function archiveTargetIsRemoved(error: unknown): boolean {
  return error instanceof ArchiveCommandRejected
    && (error.code === 'camp.not_found' || error.code === 'camp.deletion_in_progress')
}

const desktopAttempts = new Map<string, { identity: string; commandId: string }>()

export async function requestArchiveCommand(
  client: Pick<ThreadClient, 'request'>,
  method: 'threads.archive' | 'threads.unarchive' | 'threads.delete',
  command: ArchiveCommand | DeleteThreadCommand
): Promise<StoredCommandResult> {
  // Web keeps the original request active through its own recovery UI. Desktop
  // IPC can reject after dispatch, so a repeat of the same action reuses its ID.
  const key = `${method}:${command.threadId}`
  const identity = JSON.stringify(command)
  const desktop = client === desktopThreadClient
  const previous = desktop ? desktopAttempts.get(key) : undefined
  const attempt = previous?.identity === identity ? previous : { identity, commandId: newCommandId() }
  if (desktop) desktopAttempts.set(key, attempt)
  const result = await client.request<StoredCommandResult>(method, { commandId: attempt.commandId, command })
  if (desktop && desktopAttempts.get(key) === attempt) desktopAttempts.delete(key)
  if (result.status === 'rejected') throw new ArchiveCommandRejected(result.code)
  return result
}

export async function writeArchive(
  client: Pick<ThreadClient, 'request'>,
  archived: boolean,
  command: ArchiveCommand
): Promise<ArchiveCommandPayload> {
  const result = await requestArchiveCommand(client, archived ? 'threads.archive' : 'threads.unarchive', command)
  return result.payload as unknown as ArchiveCommandPayload
}
