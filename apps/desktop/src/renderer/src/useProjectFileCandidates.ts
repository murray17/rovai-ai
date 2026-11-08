import { useEffect, useRef, useState } from 'react'
import type { ProjectFileReferenceSource, ProjectFileEntry, ProjectFilesPage, ProjectFilesResult, ProjectFilesScope, ProjectFileReferenceAtom, ProjectFileReferenceResolution } from '@contracts'
import type { ReferenceScope } from './useReferencePicker'

export function useProjectFileReferenceCapability(client: ReferenceScope['client'] | undefined) {
  const [state, setState] = useState<{ client: unknown; supported: boolean }>({ client: null, supported: false })
  useEffect(() => {
    if (!client) return
    let cancelled = false
    const read = () => { void client.request<{ composerProjectFileReferenceVersion?: number }>('app.info').then(info => {
      if (!cancelled) setState({ client, supported: info.composerProjectFileReferenceVersion === 2 })
    }).catch(() => { if (!cancelled) setState({ client, supported: false }) }) }
    read()
    const stop = client.onInvalidated?.(change => { if (!change || change.resync) read() })
    return () => { cancelled = true; stop?.() }
  }, [client])
  return state.client === client && state.supported
}

export async function createProjectFileReference(client: ReferenceScope['client'], threadId: string,
  source: Extract<ProjectFileReferenceSource, { kind: 'project_file' }>): Promise<ProjectFileReferenceAtom> {
  const result = await client.request<ProjectFilesResult<ProjectFileReferenceResolution[]>>('projectFileReferences.resolve', { threadId, references: [{ threadId: source.threadId, rawReference: source.rawReference, ...(source.targetKind ? { targetKind: source.targetKind } : {}) }] })
  if (!result.ok) throw new Error(result.error.code)
  const item = result.value[0]
  if (item?.status !== 'available') throw new Error(item?.reason ?? 'invalid_reference')
  return item.reference
}

/** Scope ownership is independent from the file tree. No watcher, poller, or recursive empty search. */
export function useProjectFileCandidates(scope: ReferenceScope | undefined, anchor: string, query: string | null, enabled: boolean, retry: number) {
  const [resolved, setResolved] = useState<{ key: string; scope: ProjectFilesScope } | null>(null)
  const [state, setState] = useState<{ key: string; items: ProjectFileEntry[]; partial: boolean; loading: boolean; error: string | null }>({ key: '', items: [], partial: false, loading: false, error: null })
  const generation = useRef(0), revision = useRef(0)
  const scopeKey = JSON.stringify([scope?.threadId, anchor, enabled, retry])
  const key = JSON.stringify([scopeKey, query])
  const currentKey = useRef(key); currentKey.current = key
  useEffect(() => {
    if (!scope || !enabled || !anchor) { setResolved(null); return }
    let cancelled = false, held: ProjectFilesScope | undefined
    const release = (item: ProjectFilesScope) => { void scope.client.request('projectFiles.request', { threadId: scope.threadId, action: 'release', scopeId: item.scopeId }).catch(() => undefined) }
    setResolved(null)
    void scope.client.request<ProjectFilesResult<ProjectFilesScope>>('projectFiles.request', { threadId: scope.threadId, action: 'resolve' }).then(result => {
      if (!result.ok) throw new Error(result.error.code)
      if (cancelled) { release(result.value); return }
      held = result.value
      setResolved({ key: scopeKey, scope: result.value })
    }).catch(error => { if (!cancelled) setState({ key: currentKey.current, items: [], partial: false, loading: false, error: error instanceof Error ? error.message : 'read_failed' }) })
    return () => { cancelled = true; if (held) release(held) }
  }, [scope?.client, scope?.threadId, scopeKey])
  useEffect(() => {
    const ticket = ++generation.current
    if (!scope || !enabled || query === null || resolved?.key !== scopeKey) return
    const scopeId = resolved.scope.scopeId, queryRevision = ++revision.current
    setState({ key, items: [], partial: false, loading: true, error: null })
    const timer = setTimeout(() => {
      void scope.client.request<ProjectFilesResult<ProjectFilesPage>>('projectFiles.request', {
        threadId: scope.threadId, action: query ? 'search' : 'list', scopeId, entryId: query ? undefined : 'root', query, queryRevision
      }).then(result => {
        if (ticket !== generation.current || currentKey.current !== key) return
        if (!result.ok) throw new Error(result.error.code)
        setState({ key, items: result.value.entries.filter(item => !item.unavailable), partial: result.value.partial, loading: false, error: null })
      }).catch(error => { if (ticket === generation.current && currentKey.current === key) setState({ key, items: [], partial: false, loading: false, error: error instanceof Error ? error.message : 'read_failed' }) })
    }, query ? 150 : 0)
    return () => {
      clearTimeout(timer); generation.current++
      void scope.client.request('projectFiles.request', { threadId: scope.threadId, action: 'cancelSearch', scopeId, queryRevision: ++revision.current }).catch(() => undefined)
    }
  }, [scope?.client, scope?.threadId, resolved, scopeKey, query, enabled, key])
  const current = state.key === key
  return { items: current ? state.items : [], partial: current && state.partial, error: current ? state.error : null,
    loading: enabled && (!current || state.loading), scope: resolved?.key === scopeKey ? resolved.scope : null, key }
}
