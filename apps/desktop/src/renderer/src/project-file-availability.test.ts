import { describe, expect, it } from 'vitest'
import { projectFileAvailabilityResult, projectFileAvailabilityFailure } from './project-file-availability'

const reference = { threadId: 'target', rawReference: 'opaque' }
const atom = { type: 'project_file_reference', ...reference, labelFallback: 'src/auth/config.ts' }
const decode = (result: unknown) => projectFileAvailabilityResult(result, 'target', [reference])

describe('file availability response boundary', () => {
  it.each(['root_unavailable', 'root_changed', 'file_missing', 'outside_root', 'unreadable'])('preserves request-level business error %s', code => {
    expect(decode({ ok: false, error: { code } })).toEqual([{ status: 'unavailable', reason: code }])
  })
  it('retains per-file unavailability and target-confirmed identities', () => {
    expect(decode({ ok: true, value: [{ status: 'available', reference: atom }] })).toEqual([{ status: 'available', reference: atom }])
    expect(decode({ ok: true, value: [{ status: 'needs_reselect', reason: 'root_mismatch' }] })).toEqual([{ status: 'needs_reselect', reason: 'root_mismatch' }])
    expect(decode({ ok: true, value: [{ status: 'unavailable', reason: 'file_missing' }] })).toEqual([{ status: 'unavailable', reason: 'file_missing' }])
  })
  it.each([
    null, { ok: true, value: [] }, { ok: true, value: [null] },
    { ok: false, error: { code: 'future_unknown_error' } },
    { ok: true, value: [{ status: 'available', reference: { ...atom, threadId: 'wrong-target' } }] },
    { ok: true, value: [{ status: 'available', reference: { ...atom, rawReference: 'wrong-file' } }] },
    { ok: true, value: [{ status: 'available', reference: { ...atom, scopeId: 'not-identity' } }] }
  ])('records malformed responses as protocol errors: %j', result => {
    expect(decode(result)).toEqual([expect.objectContaining({ status: 'protocol_error' })])
  })
  it('classifies transport rejection and invalid JSON separately from business rejection', () => {
    expect(projectFileAvailabilityFailure(new TypeError('fetch failed'))).toEqual({ status: 'network_error' })
    expect(projectFileAvailabilityFailure(new DOMException('aborted', 'AbortError'))).toEqual({ status: 'network_error' })
    expect(projectFileAvailabilityFailure(new SyntaxError('invalid JSON'))).toEqual({ status: 'protocol_error', reason: 'invalid_json' })
    expect(projectFileAvailabilityFailure({ code: 'root_unavailable' })).toEqual({ status: 'unavailable', reason: 'root_unavailable' })
  })
})
