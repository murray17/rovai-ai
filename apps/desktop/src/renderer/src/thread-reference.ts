import { isThreadId, type ComposerAtom, type ReferenceCandidate, type ReferenceIdentity, type StructuredThreadMessageSegment } from '@contracts'
import { escapeReferenceLinkLabel } from './reference-markdown'

export type ReferenceAtom = Extract<ComposerAtom, { type: 'thread_reference' | 'mission_reference' }>
export type ReferenceSegment = Extract<StructuredThreadMessageSegment, { kind: 'thread_reference' | 'mission_reference' }>
export const isReferenceAtom = (atom: ComposerAtom): atom is ReferenceAtom => atom.type === 'thread_reference' || atom.type === 'mission_reference'
export const isReferenceSegment = (segment: StructuredThreadMessageSegment): segment is ReferenceSegment => segment.kind === 'thread_reference' || segment.kind === 'mission_reference'
export function referenceIdentity(value: ReferenceAtom | ReferenceSegment): ReferenceIdentity {
  return 'threadId' in value ? { kind: 'thread', id: value.threadId } : { kind: 'mission', id: value.missionId }
}
export function referenceAtom(item: ReferenceCandidate): ReferenceAtom {
  return item.kind === 'thread'
    ? { type: 'thread_reference', threadId: item.id, labelFallback: item.title }
    : { type: 'mission_reference', missionId: item.id, labelFallback: item.title }
}
export function validReferenceAtom(value: Record<string, unknown>): value is Record<string, unknown> & ReferenceAtom {
  const key = value.type === 'thread_reference' ? 'threadId' : value.type === 'mission_reference' ? 'missionId' : null
  if (!key || Object.keys(value).some(k => !['type', key, 'labelFallback'].includes(k))) return false
  const id = value[key]
  if (key === 'threadId' ? !isThreadId(id) : typeof id !== 'string' || !/^rvm_[a-f0-9]{12}7[a-f0-9]{3}[89ab][a-f0-9]{15}$/u.test(id)) return false
  const label = value.labelFallback
  return label === undefined || typeof label === 'string' && label.length > 0 && label.trim() === label
    && Array.from(label).length <= 500
}
export function projectReference(value: ReferenceAtom | ReferenceSegment): string {
  const ref = referenceIdentity(value)
  const title = 'titleAtSend' in value ? value.titleAtSend : value.labelFallback ?? ref.id
  const escaped = escapeReferenceLinkLabel(title.replace(/[\p{White_Space}\p{Cc}]/gu, ' '))
  return `[${escaped}](rovai://${ref.kind}/${ref.id})`
}
export function referenceProject(item: ReferenceCandidate): string {
  return item.projectBindingKind === 'directory' ? item.projectPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? item.projectPath : '快速对话'
}
export function fuzzyContains(value: string, query: string): boolean {
  const text = value.normalize('NFKC').toLowerCase()
  let cursor = 0
  for (const char of query.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\uFEFF]/gu, '')) {
    const found = text.indexOf(char, cursor)
    if (found < 0) return false
    cursor = found + char.length
  }
  return true
}
