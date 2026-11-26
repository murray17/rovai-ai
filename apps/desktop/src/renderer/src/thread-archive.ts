import { chatDraftRecovery } from './chat-draft-recovery'
import { clearLocalThreadComposerDraft } from './camp-composer-local-store'
import type { ArchiveCommand, ArchiveCommandPayload, ArchiveItem, ArchiveKind, CoreEvent, DeleteThreadCommand, StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'
import { uiAttribute } from './interface-language'
import { isReferenceDirectoryEvent } from './useReferenceAvailability'

export const ARCHIVE_CHANGE_REASON = 'threads.archive_changed'

export function isArchiveChangeEvent(event: CoreEvent): boolean {
  return event.method === 'navigation.invalidated'
    && (event.params as { reason?: string } | undefined)?.reason === ARCHIVE_CHANGE_REASON
}

export function invalidatesArchiveRecords(event: CoreEvent): boolean {
  return event.method === 'chats.listChanged' || isArchiveChangeEvent(event) || isReferenceDirectoryEvent(event)
}

export function normalizeArchiveText(value: string): string {
  return Array.from(value.normalize('NFKC'), char => char.toLowerCase()).join('')
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function messageTime(item: ArchiveItem): number {
  return item.lastMessageAt ? Date.parse(item.lastMessageAt) : -Infinity
}

export function archiveView(items: ArchiveItem[], kind: ArchiveKind, query: string, selectedProjects: string[], firstThreadId?: string) {
  const totals = { chat: 0, mission: 0 }
  const matchingCounts = { chat: 0, mission: 0 }
  const projects = new Map(selectedProjects.map(key => [key, 0]))
  const groups = new Map<string, ArchiveItem[]>()
  let firstProjectKey: string | undefined
  for (const item of items) {
    const type = item.missionId === null ? 'chat' : 'mission'
    totals[type]++
    projects.set(item.projectKey, (projects.get(item.projectKey) ?? 0) + Number(type === kind))
    if (selectedProjects.length && !selectedProjects.includes(item.projectKey)) continue
    if (query && !normalizeArchiveText(item.title).includes(query) && !normalizeArchiveText(item.threadId).includes(query)) continue
    matchingCounts[type]++
    if (type !== kind) continue
    if (item.threadId === firstThreadId) firstProjectKey = item.projectKey
    const group = groups.get(item.projectKey)
    if (group) group.push(item)
    else groups.set(item.projectKey, [item])
  }
  for (const rows of groups.values()) rows.sort((a, b) => messageTime(b) - messageTime(a) || compareIds(a.threadId, b.threadId))
  const sortedGroups = [...groups].sort(([ka, a], [kb, b]) => messageTime(b[0]) - messageTime(a[0]) || compareIds(ka, kb))
  const firstGroup = sortedGroups.findIndex(([key]) => key === firstProjectKey)
  if (firstGroup >= 0) {
    const [group] = sortedGroups.splice(firstGroup, 1)
    const rows = group[1]
    const [item] = rows.splice(rows.findIndex(row => row.threadId === firstThreadId), 1)
    rows.unshift(item)
    sortedGroups.unshift(group)
  }
  return { totals, matchingCounts, projects, groups: sortedGroups }
}

export class ArchiveCommandRejected extends Error {
  constructor(readonly code: string) {
    const messages: Record<string, string> = {
      'camp.not_found': uiAttribute('目标已移除'),
      'camp.workspace_cleanup_pending': uiAttribute('工作区正在清理，请稍后重试。'),
      'camp.deletion_in_progress': uiAttribute('记录正在删除。')
    }
    super(messages[code] ?? code)
  }
}

export function archiveTargetIsRemoved(error: unknown): boolean {
  return error instanceof ArchiveCommandRejected
    && (error.code === 'camp.not_found' || error.code === 'camp.deletion_in_progress')
}

export async function requestArchiveCommand(
  client: Pick<ThreadClient, 'request'>,
  method: 'threads.archive' | 'threads.unarchive' | 'threads.delete' | 'chats.setArchived' | 'chats.delete',
  command: ArchiveCommand | DeleteThreadCommand | {chatId:string; archived?:boolean}
): Promise<StoredCommandResult> {
  const result = await client.request<StoredCommandResult>(method, { commandId: newCommandId(), command })
  if (result.status === 'rejected') throw new ArchiveCommandRejected(result.code)
  return result
}

export async function deleteChat(client: Pick<ThreadClient, 'request'>, chatId: string): Promise<void> {
  await requestArchiveCommand(client, 'chats.delete', { chatId })
  chatDraftRecovery.clear(chatId)
  clearLocalThreadComposerDraft('chat:' + chatId)
}

export async function writeArchive(
  client: Pick<ThreadClient, 'request'>,
  archived: boolean,
  command: ArchiveCommand
): Promise<ArchiveCommandPayload> {
  const result = await requestArchiveCommand(client, archived ? 'threads.archive' : 'threads.unarchive', command)
  return result.payload as unknown as ArchiveCommandPayload
}
