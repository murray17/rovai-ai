import { useEffect, useRef, useState } from 'react'
import type { ProjectFileEntry, ReferenceCandidate, ReferencePage } from '@contracts'
import type { ThreadClient } from './camp-client'
import type { ComposerTriggerMatch } from './composer-trigger'
import type { StructuredMentionOption } from './StructuredMentionComposer'
import { useProjectFileCandidates } from './useProjectFileCandidates'

export type ReferenceFilter = 'members' | 'file' | 'thread' | 'mission'
export type ReferencePickerOption = StructuredMentionOption | { kind: 'reference'; item: ReferenceCandidate } | { kind: 'file'; item: ProjectFileEntry; scopeId: string }
export interface ReferenceScope { threadId: string; client: Pick<ThreadClient, 'request' | 'onEvent' | 'onInvalidated'>; projectBound?: boolean }
interface Source { key: string; status: 'loading' | 'ready' | 'error' | 'more'; items: ReferenceCandidate[]; nextCursor: string | null }
const empty: Source = { key: '', status: 'ready', items: [], nextCursor: null }
export const pickerOptionKey = (option: ReferencePickerOption): string => option.kind === 'file' ? `file:${option.scopeId}:${option.item.id}` : option.kind === 'reference' ? `${option.item.kind}:${option.item.id}` : option.kind === 'member' ? `member:${option.member.agentId}` : option.kind

/** Each source returns independently. A member hit never suppresses project files. */
export function useReferencePicker(scope: ReferenceScope | undefined, match: ComposerTriggerMatch | null,
  inviteLayer: boolean, members: readonly StructuredMentionOption[], filesSupported = false) {
  const query = match?.kind === 'member' ? match.query : null
  const anchor = match?.kind === 'member' ? `${scope?.threadId}:${match.nodeKey}:${match.fromOffset}` : ''
  const [manual, setManual] = useState<{ anchor: string; filter: ReferenceFilter } | null>(null)
  const [sources, setSources] = useState<{ thread: Source; mission: Source }>({ thread: empty, mission: empty })
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const manualFilter = manual?.anchor === anchor ? manual.filter : null
  const filter = inviteLayer ? 'members' : manualFilter ?? (query?.trim() ? 'all' : 'members')
  const key = JSON.stringify([scope?.threadId, anchor, query, manualFilter, inviteLayer, retry])
  const currentKey = useRef(key); currentKey.current = key
  const enabled = !!scope && query !== null && !inviteLayer
  const files = useProjectFileCandidates(scope, anchor, query, enabled && filesSupported && scope?.projectBound !== false && (filter === 'all' || filter === 'file'), retry)
  useEffect(() => {
    const ticket = ++generation.current
    if (!scope || query === null || inviteLayer) { if (query === null) setManual(null); return }
    const kinds = (['thread', 'mission'] as const).filter(kind => filter === 'all' || filter === kind)
    for (const kind of kinds) setSources(previous => ({ ...previous, [kind]: { ...empty, key, status: 'loading' } }))
    const timer = setTimeout(() => { for (const kind of kinds) {
      void scope.client.request<ReferencePage>('threadReferences.list', { threadId: scope.threadId, kind, query }).then(result => {
        if (ticket === generation.current && currentKey.current === key) setSources(previous => ({ ...previous, [kind]: { key, status: 'ready', ...result } }))
      }).catch(() => { if (ticket === generation.current && currentKey.current === key) setSources(previous => ({ ...previous, [kind]: { ...empty, key, status: 'error' } })) })
    } }, query.trim() ? 150 : 0)
    return () => { clearTimeout(timer); generation.current++ }
  }, [scope?.client, scope?.threadId, key, filter])
  const source = (kind: 'thread' | 'mission') => sources[kind].key === key ? sources[kind] : { ...empty, status: 'loading' as const }
  const fileOptions: ReferencePickerOption[] = files.scope ? files.items.map(item => ({ kind: 'file', item, scopeId: files.scope!.scopeId })) : []
  const referenceOptions = (kind: 'thread' | 'mission'): ReferencePickerOption[] => source(kind).items.map(item => ({ kind: 'reference', item }))
  const pathQuery = !!query && /[\\/]|\.[\p{L}\p{N}]+$/u.test(query)
  const grouped = filter === 'all'
  const options: readonly ReferencePickerOption[] = !enabled ? members : filter === 'members' ? members : filter === 'file' ? fileOptions
    : filter === 'thread' || filter === 'mission' ? referenceOptions(filter)
      : [...(pathQuery ? fileOptions.slice(0, 8) : members.slice(0, 8)), ...(pathQuery ? members.slice(0, 8) : fileOptions.slice(0, 8)), ...referenceOptions('thread').slice(0, 4), ...referenceOptions('mission').slice(0, 4)]
  const loading = enabled && (filter === 'file' ? files.loading : filter === 'thread' || filter === 'mission' ? source(filter).status === 'loading' : grouped && (files.loading || source('thread').status === 'loading' || source('mission').status === 'loading'))
  const status = filter === 'file' ? files.error ? 'error' : files.loading ? 'loading' : 'ready'
    : filter === 'thread' || filter === 'mission' ? source(filter).status : 'ready'
  const more = async (): Promise<void> => {
    if (!scope || filter !== 'thread' && filter !== 'mission') return
    const previous = source(filter), cursor = previous.nextCursor, ticket = generation.current
    if (!cursor || previous.status !== 'ready') return
    setSources(sources => ({ ...sources, [filter]: { ...previous, status: 'more' } }))
    try {
      const result = await scope.client.request<ReferencePage>('threadReferences.list', { threadId: scope.threadId, kind: filter, query, cursor })
      if (ticket === generation.current && currentKey.current === key) setSources(sources => ({ ...sources, [filter]: { ...previous, status: 'ready', nextCursor: result.nextCursor, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.id === item.id))] } }))
    } catch { if (ticket === generation.current) setSources(sources => ({ ...sources, [filter]: { ...previous, status: 'ready' } })) }
  }
  return { options, filter, loading, status, hasMore: (filter === 'thread' || filter === 'mission') && !!source(filter).nextCursor,
    selectFilter: (filter: ReferenceFilter) => setManual({ anchor, filter }), more, retry: () => setRetry(value => value + 1), query, key, files, filesSupported, grouped,
    hasProject: scope?.projectBound !== false, sourceErrors: (['thread', 'mission'] as const).filter(kind => (grouped || filter === kind) && source(kind).status === 'error') }
}
