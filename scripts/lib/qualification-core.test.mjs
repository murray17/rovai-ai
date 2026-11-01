import assert from 'node:assert/strict'
import test from 'node:test'
import { frozenMemberRuntimeDifferences, selectFrozenRuntimeInstallations, qualificationRuntimePrivateDiagnostic, sameProcessIdentity } from './qualification-core.mjs'

test('frozen Runtime configuration is exact while static readiness does not reject a verified installation', () => {
  const member = { adapterKind: 'codex-cli', model: { mode: 'explicit', modelId: 'model', options: { reasoning_effort: 'medium' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { approval_policy: 'never' } } }
  const profile = { runtimeReadiness: { status: 'ready', blockers: [] }, runtimeConfiguration: structuredClone(member), auth: 'private-auth' }
  assert.deepEqual(frozenMemberRuntimeDifferences(member, profile), [])
  profile.runtimeReadiness.status = 'installed_unverified'
  assert.deepEqual(frozenMemberRuntimeDifferences(member, profile), [])
  profile.runtimeReadiness.status = 'light_ready'
  assert.deepEqual(frozenMemberRuntimeDifferences(member, profile), [])
  profile.runtimeReadiness.blockers = [{ code: 'runtime_missing' }]
  assert.deepEqual(frozenMemberRuntimeDifferences(member, profile), [
    { field: 'runtimeReadiness.blockers', expected: [], actual: [{ code: 'runtime_missing' }] }
  ])
  profile.runtimeReadiness.blockers = []
  profile.runtimeReadiness.status = 'configuration_required'
  profile.runtimeConfiguration.model.options.reasoning_effort = 'high'
  profile.runtimeConfiguration.model.providerId = null
  profile.runtimeConfiguration.permissions.values.approval_policy = 'on-request'
  assert.deepEqual(frozenMemberRuntimeDifferences(member, profile), [
    { field: 'runtimeReadiness.status', expected: 'ready', actual: 'configuration_required' },
    { field: 'runtimeConfiguration.model.options.reasoning_effort', expected: 'medium', actual: 'high' },
    { field: 'runtimeConfiguration.model.providerId', expected: '<missing>', actual: null },
    { field: 'runtimeConfiguration.permissions.values.approval_policy', expected: 'never', actual: 'on-request' }
  ])
  assert.ok(frozenMemberRuntimeDifferences(member, null).some(diff => diff.actual === '<missing>'))
  assert.ok(!JSON.stringify(frozenMemberRuntimeDifferences(member, profile)).includes('private-auth'))
})

test('regression admits an installed executable without fabricating a successful deep probe', () => {
  const installation = { adapterKind: 'codex-cli', installationClass: 'managed_default', authScope: 'default',
    enabled: true, pathState: 'valid', executablePath: '/test/codex', snapshot: null }
  assert.equal(selectFrozenRuntimeInstallations([installation], ['codex-cli']), null)
  assert.equal(selectFrozenRuntimeInstallations([installation], ['codex-cli'], { allowUnverified: true })['codex-cli'], installation)
  for (const mutation of [{ enabled: false }, { pathState: 'missing' }, { executablePath: null }, { authScope: 'other' }]) {
    assert.equal(selectFrozenRuntimeInstallations([{ ...installation, ...mutation }], ['codex-cli'], { allowUnverified: true }), null)
  }
  assert.equal(selectFrozenRuntimeInstallations([installation], ['codex-cli', 'claude-code'], { allowUnverified: true }), null)
  const verified = { ...installation, snapshot: { probeStatus: 'ready' } }
  assert.equal(selectFrozenRuntimeInstallations([verified], ['codex-cli'])['codex-cli'], verified)
})

test('long process waits reject a reused Windows PID by creation identity', () => {
  const expected = { pid: 42, startedAt: '/Date(1000)/' }
  assert.equal(sameProcessIdentity(expected, { pid: 42, startedAt: '/Date(1000)/' }), true)
  assert.equal(sameProcessIdentity(expected, { pid: 42, startedAt: '/Date(2000)/' }), false)
  assert.equal(sameProcessIdentity(expected, { pid: 43, startedAt: '/Date(1000)/' }), false)
  assert.equal(sameProcessIdentity(expected, { pid: 42 }), true)
  assert.equal(sameProcessIdentity({ pid: 42 }, { pid: 42 }), true)
})

test('private Runtime diagnostics retain bounded stderr and failed native turn details', () => {
  const log = qualificationRuntimePrivateDiagnostic({
    method: 'agent_run.log',
    params: {
      agentRunId: 'run-1',
      executionEpoch: 2,
      stream: 'stderr',
      text: 'x'.repeat(20_000)
    }
  }, '2026-08-10T00:00:00.000Z')
  assert.equal(log.text.length, 16_384)
  assert.equal(log.textBytes, 20_000)
  assert.equal(log.truncated, true)
  assert.equal(log.observedAt, '2026-08-10T00:00:00.000Z')

  const turn = qualificationRuntimePrivateDiagnostic({
    method: 'turn.state',
    params: {
      agentRunId: 'run-1',
      payload: {
        native: {
          turn: {
            id: 'native-1',
            status: 'failed',
            error: { message: 'provider unavailable', codexErrorInfo: 'serverOverloaded' }
          }
        }
      }
    }
  })
  assert.equal(turn.nativeTurnStatus, 'failed')
  assert.deepEqual(turn.error, {
    message: 'provider unavailable',
    codexErrorInfo: 'serverOverloaded'
  })
})

test('successful Runtime notifications do not create failure diagnostics', () => {
  assert.equal(qualificationRuntimePrivateDiagnostic({
    method: 'turn.state',
    params: { payload: { native: { turn: { id: 'native-1', status: 'completed' } } } }
  }), null)
  assert.equal(qualificationRuntimePrivateDiagnostic({
    method: 'turn.state',
    params: { payload: { native: { turn: { id: 'native-1', status: 'inProgress' } } } }
  }), null)
  assert.equal(qualificationRuntimePrivateDiagnostic({
    method: 'agent_run.terminal',
    params: { result: { code: 'agent_run.succeeded' } }
  }), null)
})
