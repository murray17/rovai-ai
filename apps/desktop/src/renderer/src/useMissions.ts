import { uiAttribute } from './interface-language'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CoreEvent, CoreMethod, MissionRecord, StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { createNavigationRefreshCoordinator } from './navigation-refresh-coordinator'

export function missionError(error: unknown): string {
  const message = readErrorMessage(error)
  const reasons: Record<string, string> = {
    'mission.workspace_not_prepared': uiAttribute('使命尚未执行，工作区还未创建。'),
    'mission.git_not_applicable': uiAttribute('此工作目录不是 Git 项目。'),
    'mission.git_unavailable': uiAttribute('执行节点找不到 Git，暂时无法读取变更。'),
    'mission.not_found': uiAttribute('此使命已被删除。'),
    'mission.workspace_cleanup_pending': uiAttribute('工作区正在清理，暂时不能运行。'),
    'mission.workspace_in_use': uiAttribute('工作区仍被执行占用，请稍后重试。'),
    'mission.branch_changed': uiAttribute('本地分支已发生变化，未执行删除。'),
    'mission.branch_in_use': uiAttribute('本地分支正被其他 Worktree 使用，未执行删除。'),
    'mission.workspace_dirty': uiAttribute('存在未提交或未跟踪内容，未执行清理。请先保存需要保留的工作。'),
    'mission.detached_head_unreachable': uiAttribute('detached HEAD 的提交没有可保留引用，未执行清理。请先创建分支或标签。'),
    'mission.workspace_branch_mismatch': uiAttribute('Worktree 当前分支与使命记录不一致，未执行清理。'),
    'mission.workspace_branch_missing': uiAttribute('使命本地分支已缺失，无法确认清理范围。'),
    'mission.workspace_cleanup_failed': uiAttribute('使命 Worktree 清理未完成，请重试。'),
    'mission.base_unavailable': uiAttribute('固定比较基准暂不可用，当前无法生成累计文件变更。'),
    'mission.content_required': uiAttribute('请填写要修改的内容。'),
    'mission.details_version_required': uiAttribute('使命内容版本缺失，请刷新后重试。'),
    'mission.details_version_conflict': uiAttribute('使命内容刚刚发生变化，请基于最新内容重新编辑。'),
    'mission.invalid_title': uiAttribute('使命标题需要 1 至 200 个字符。'),
    'mission.description_too_long': uiAttribute('使命描述最多 12000 个字符。')
  }
  return Object.entries(reasons).find(([code]) => message.includes(code))?.[1] ?? message
}

export class MissionCommandRejected extends Error {
  constructor(public readonly result: StoredCommandResult) {
    super(missionError(result.code || uiAttribute('操作未完成')))
    this.name = 'MissionCommandRejected'
  }
}

export async function missionCommand(client: ThreadClient, method: CoreMethod, command: unknown, commandId = newCommandId()): Promise<StoredCommandResult> {
  const result = await client.request<StoredCommandResult>(method, { commandId, command })
  if (result.status === 'rejected') throw new MissionCommandRejected(result)
  return result
}

export function unreadMissionCount<T extends Pick<MissionRecord, 'hasUnread'>>(missions: readonly T[]): number {
  return missions.filter(mission => mission.hasUnread).length
}

/** Thread reads/acks do not invalidate the Mission board. */
export function shouldRefreshMissionsForEvent(event: CoreEvent, threadIds: ReadonlySet<string>): boolean {
  if (event.method === 'missions.invalidated') return true
  const params = event.params && typeof event.params === 'object' ? event.params as Record<string, unknown> : {}
  if (event.method === 'navigation.invalidated') {
    const reason = typeof params.reason === 'string' ? params.reason : ''
    return reason.startsWith('mission.') || reason.startsWith('missions.')
      || (typeof params.threadId === 'string' && threadIds.has(params.threadId)
        && reason !== 'navigation.campViewed' && reason !== 'threads.enter')
  }
  if (event.method !== 'events.batch' || !Array.isArray(params.events)) return false
  return params.events.some(value => {
    const item = value as { eventType?: string; threadId?: string }
    return item.eventType?.startsWith('mission.')
      || (item.threadId && threadIds.has(item.threadId))
  })
}

/** One list owner drives the board, navigation badge, and the current Mission card. */
export function useMissions(client: ThreadClient, enabled: boolean) {
  const [missions, setMissions] = useState<MissionRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const load = useCallback(async (throwOnError: boolean) => {
    if (!enabled) return
    const current = ++generation.current
    try {
      const next = await client.request<MissionRecord[]>('missions.list')
      if (current === generation.current) { setMissions(next); setError(null) }
    } catch (error) {
      if (current === generation.current) setError(missionError(error))
      if (throwOnError) throw error
    }
    finally { if (current === generation.current) setLoading(false) }
  }, [client, enabled])
  const coordinator = useMemo(() => createNavigationRefreshCoordinator(() => load(true), { debounceMs: 100 }), [load])
  const missionThreadIds = useRef<ReadonlySet<string>>(new Set())
  missionThreadIds.current = new Set(missions.map(mission => mission.threadId))
  const refresh = useCallback(() => coordinator.refresh('explicit').catch(() => undefined), [coordinator])
  const refreshOrThrow = useCallback(() => coordinator.refresh('explicit'), [coordinator])
  useEffect(() => {
    if (!enabled) return
    void refresh()
    const invalidate = () => { void coordinator.refresh('invalidation').catch(() => undefined) }
    const event = client.onEvent?.(event => { if (shouldRefreshMissionsForEvent(event, missionThreadIds.current)) invalidate() })
    const authorized = client.onInvalidated?.(invalidate)
    const onFocus = () => { if (document.visibilityState === 'visible') invalidate() }
    const poll = setInterval(onFocus, 20_000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { ++generation.current; coordinator.dispose(); clearInterval(poll); event?.(); authorized?.(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [client, enabled, refresh, coordinator])
  return { missions, error, loading, refresh, refreshOrThrow }
}
