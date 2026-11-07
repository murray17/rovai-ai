import { useEffect, useState } from 'react'
import type { ComposerDocument, ProjectFileReferenceAtom, ProjectFileReferenceResolution, ProjectFilesResult } from '@contracts'
import { fileReferenceKey, isProjectFileAtom } from './project-file-reference'
import type { ReferenceScope } from './useReferencePicker'

export function composerProjectFiles(document: ComposerDocument): ProjectFileReferenceAtom[] {
  return [...new Map(document.segments.flatMap(segment => segment.kind === 'atom' && isProjectFileAtom(segment.atom)
    ? [[fileReferenceKey(segment.atom), segment.atom] as const] : [])).values()]
}
export type FileAvailability = ProjectFileReferenceResolution | { status: 'network_error' }
const EMPTY = new Map<string, FileAvailability>()
const listeners = new Set<(thread: string, raw: string, reason: string) => void>()
export function reportProjectFileReferenceRejection(thread: string, raw: string, reason: string): void {
  listeners.forEach(listener => listener(thread, raw, reason))
}
export function useProjectFileAvailability(scope: ReferenceScope | undefined, files: readonly ProjectFileReferenceAtom[], supported: boolean) {
  const key = JSON.stringify(files.map(file => [file.threadId, file.rawReference]))
  const [state, setState] = useState<{ thread: string; items: ReadonlyMap<string, FileAvailability> }>({ thread: '', items: new Map() })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!scope || !files.length || !supported) return
    let cancelled = false
    const refs = JSON.parse(key) as [string, string][]
    void (async () => {
      const items = new Map<string, FileAvailability>()
      try {
        for (let offset = 0; offset < refs.length; offset += 32) {
          const batch = refs.slice(offset, offset + 32)
          const result = await scope.client.request<ProjectFilesResult<ProjectFileReferenceResolution[]>>('projectFileReferences.resolve', { threadId: scope.threadId, references: batch.map(([threadId, rawReference]) => ({ threadId, rawReference })) })
          if (!result.ok) throw new Error(result.error.code)
          batch.forEach(([threadId, rawReference], index) => items.set(fileReferenceKey({ threadId, rawReference }), result.value[index] ?? { status: 'unavailable', reason: 'invalid_reference' }))
        }
      } catch { refs.forEach(([threadId, rawReference]) => items.set(fileReferenceKey({ threadId, rawReference }), { status: 'network_error' })) }
      if (!cancelled) setState({ thread: scope.threadId, items })
    })()
    const refresh = () => setRevision(value => value + 1)
    const stop = scope.client.onInvalidated?.(change => { if (!change || change.resync || change.referencesChanged) refresh() })
    const stopEvent = scope.client.onEvent?.(event => {
      if (event.method === 'navigation.invalidated' && /project|workspace|mission/u.test(String((event.params as { reason?: string })?.reason))) refresh()
    })
    const rejected = (thread: string, raw: string, reason: string) => {
      if (thread !== scope.threadId) return
      setState(previous => ({ thread, items: new Map(previous.thread === thread ? previous.items : []).set(fileReferenceKey({ threadId: thread, rawReference: raw }), { status: 'unavailable', reason }) }))
    }
    listeners.add(rejected)
    return () => { cancelled = true; stop?.(); stopEvent?.(); listeners.delete(rejected) }
  }, [scope?.client, scope?.threadId, key, supported, revision])
  return { items: state.thread === scope?.threadId ? state.items : EMPTY, retry: () => setRevision(value => value + 1) }
}
