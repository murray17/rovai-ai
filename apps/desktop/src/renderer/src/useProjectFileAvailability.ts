import { useEffect, useRef, useState } from 'react'
import type { ComposerDocument, ProjectFileReferenceAtom } from '@contracts'
import { fileReferenceKey, isProjectFileAtom } from './project-file-reference'
import { projectFileAvailabilityResult, projectFileAvailabilityFailure, type FileAvailability } from './project-file-availability'
export type { FileAvailability } from './project-file-availability'
import type { ReferenceScope } from './useReferencePicker'

export function composerProjectFiles(document: ComposerDocument): ProjectFileReferenceAtom[] {
  return [...new Map(document.segments.flatMap(segment => segment.kind === 'atom' && isProjectFileAtom(segment.atom)
    ? [[fileReferenceKey(segment.atom), segment.atom] as const] : [])).values()]
}
const EMPTY = new Map<string, FileAvailability>()
const listeners = new Set<(thread: string, raw: string, reason: string) => void>()
export function reportProjectFileReferenceRejection(thread: string, raw: string, reason: string): void {
  listeners.forEach(listener => listener(thread, raw, reason))
}
export function useProjectFileAvailability(scope: ReferenceScope | undefined, files: readonly ProjectFileReferenceAtom[], supported: boolean) {
  const key = JSON.stringify(files.map(file => [file.threadId, file.rawReference, file.targetKind ?? 'file']))
  const [state, setState] = useState<{ thread: string; items: ReadonlyMap<string, FileAvailability> }>({ thread: '', items: new Map() })
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    if (!scope || !files.length || !supported) return
    let cancelled = false
    const ticket = ++generation.current
    const refs = JSON.parse(key) as [string, string, 'file' | 'directory'][]
    const refresh = () => setRevision(value => value + 1)
    const stop = scope.client.onInvalidated?.(change => { if (!change || change.resync || change.referencesChanged) refresh() })
    const stopEvent = scope.client.onEvent?.(event => {
      if (event.method === 'navigation.invalidated' && /project|workspace|mission/u.test(String((event.params as { reason?: string })?.reason))) refresh()
    })
    const rejected = (thread: string, raw: string, reason: string) => {
      if (thread !== scope.threadId) return
      // Only a check started after this rejection may clear its unavailable status.
      generation.current++
      setState(previous => { const items = new Map(previous.thread === thread ? previous.items : []); for (const file of files) if (file.rawReference === raw) items.set(fileReferenceKey(file), { status: 'unavailable', reason }); return { thread, items } })
    }
    listeners.add(rejected)
    void (async () => {
      const items = new Map<string, FileAvailability>()
      for (let offset = 0; offset < refs.length; offset += 32) {
        if (cancelled || ticket !== generation.current) return
        const batch = refs.slice(offset, offset + 32).map(([threadId, rawReference, targetKind]) => ({ threadId, rawReference, ...(targetKind === 'directory' ? { targetKind } : {}) }))
        let values: FileAvailability[]
        try {
          const result = await scope.client.request<unknown>('projectFileReferences.resolve', { threadId: scope.threadId, references: batch })
          values = projectFileAvailabilityResult(result, scope.threadId, batch)
        } catch (error) { values = batch.map(() => projectFileAvailabilityFailure(error)) }
        batch.forEach((reference, index) => items.set(fileReferenceKey(reference), values[index]!))
        if (values.some(value => value.status === 'protocol_error')) console.warn('Project file availability response violates its contract')
      }
      if (!cancelled && ticket === generation.current) setState({ thread: scope.threadId, items })
    })()
    return () => { cancelled = true; generation.current++; stop?.(); stopEvent?.(); listeners.delete(rejected) }
  }, [scope?.client, scope?.threadId, key, supported, revision])
  return { items: state.thread === scope?.threadId ? state.items : EMPTY, retry: () => setRevision(value => value + 1) }
}
