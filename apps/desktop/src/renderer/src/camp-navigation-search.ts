import { isThreadId, type NavigationThreadTarget } from '@contracts'
import { formatThreadTitle } from './camp-title'
import { uiAttribute } from './interface-language'

export function navigationThreadSearch(
  query: string,
  threads: readonly NavigationThreadTarget[],
  projectNameByPath: ReadonlyMap<string, string>,
  firstRunThreadId: string | null = null
): { kind: 'id'; threadId: string } | { kind: 'text'; threads: NavigationThreadTarget[] } {
  const trimmed = query.trim()
  if (isThreadId(trimmed)) return { kind: 'id', threadId: trimmed }

  const text = query.trim().toLowerCase()
  return {
    kind: 'text',
    threads: (text ? threads.filter((thread) => {
      const projectName = thread.projectBindingKind === 'directory'
        ? projectNameByPath.get(thread.projectPath) ?? ''
        : uiAttribute('快速对话')
      return formatThreadTitle(thread, firstRunThreadId).toLowerCase().includes(text)
        || thread.title.toLowerCase().includes(text)
        || projectName.toLowerCase().includes(text)
    }) : threads).slice(0, 12)
  }
}

export interface NavigationThreadLookup {
  threadId: string
  thread: NavigationThreadTarget | null
  error: string | null
}

export function startNavigationThreadLookup(
  threadId: string,
  publish: (result: NavigationThreadLookup) => void,
  findThread: (threadId: string) => Promise<NavigationThreadTarget | null> = (id) =>
    window.rovai.request('navigation.findThread', { threadId: id })
): () => void {
  let cancelled = false
  // A complete ID can still be edited quickly; only dispatch the settled input.
  const timer = setTimeout(() => {
    void findThread(threadId).then(
      (thread) => {
        if (!cancelled) publish({ threadId, thread, error: null })
      },
      () => {
        if (!cancelled) publish({ threadId, thread: null, error: '暂时无法查询会话，请重试。' })
      }
    )
  }, 150)
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
