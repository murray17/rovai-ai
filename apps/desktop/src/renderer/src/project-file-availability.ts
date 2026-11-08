import type { ProjectFileReferenceAtom, ProjectFileReferenceResolution } from '@contracts'
import { validProjectFileAtom } from './project-file-reference'

export type FileAvailability = ProjectFileReferenceResolution
  | { status: 'network_error' }
  | { status: 'protocol_error'; reason: string }
type Identity = Pick<ProjectFileReferenceAtom, 'threadId' | 'rawReference'>
const businessErrors = new Set(['invalid_reference', 'thread_mismatch', 'root_unavailable', 'root_changed', 'file_missing', 'outside_root', 'not_regular_file', 'unreadable'])
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const fields = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
const protocolError = (reason: string): FileAvailability => ({ status: 'protocol_error', reason })

/** Decode resolved business responses separately from transport rejection. Never invent a missing file. */
export function projectFileAvailabilityResult(result: unknown, target: string, references: readonly Identity[]): FileAvailability[] {
  const all = (value: FileAvailability) => references.map(() => value)
  if (!object(result)) return all(protocolError('invalid_result'))
  if (result.ok === false && fields(result, ['ok', 'error']) && object(result.error) && fields(result.error, ['code']) && typeof result.error.code === 'string') {
    return all(businessErrors.has(result.error.code) ? { status: 'unavailable', reason: result.error.code } : protocolError('unexpected_error_code'))
  }
  if (result.ok !== true || !fields(result, ['ok', 'value']) || !Array.isArray(result.value) || result.value.length !== references.length) return all(protocolError('invalid_result'))
  return result.value.map((item: unknown, index): FileAvailability => {
    if (!object(item)) return protocolError('invalid_resolution')
    if (item.status === 'available' && fields(item, ['status', 'reference']) && object(item.reference) && validProjectFileAtom(item.reference)
      && item.reference.threadId === target && (references[index]!.threadId !== target || item.reference.rawReference === references[index]!.rawReference)) {
      return { status: 'available', reference: item.reference }
    }
    if (item.status === 'needs_reselect' && fields(item, ['status', 'reason']) && (item.reason === 'root_mismatch' || item.reason === 'source_unavailable')) return { status: 'needs_reselect', reason: item.reason }
    if (item.status === 'unavailable' && fields(item, ['status', 'reason']) && typeof item.reason === 'string' && item.reason.length > 0) return { status: 'unavailable', reason: item.reason }
    return protocolError('invalid_resolution')
  })
}

export function projectFileAvailabilityFailure(error: unknown): FileAvailability {
  if (object(error) && typeof error.code === 'string' && businessErrors.has(error.code)) return { status: 'unavailable', reason: error.code }
  if (error instanceof SyntaxError) return protocolError('invalid_json')
  return { status: 'network_error' }
}
