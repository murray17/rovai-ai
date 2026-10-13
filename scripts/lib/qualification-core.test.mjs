import assert from 'node:assert/strict'
import test from 'node:test'
import { descendantsOf, qualificationRuntimePrivateDiagnostic, sameProcessIdentity } from './qualification-core.mjs'

test('process ancestry and long waits reject a reused Windows PID by creation identity', () => {
  const expected = { pid: 42, startedAt: '/Date(1000)/' }
  assert.equal(sameProcessIdentity(expected, { pid: 42, startedAt: '/Date(1000)/' }), true)
  assert.equal(sameProcessIdentity(expected, { pid: 42, startedAt: '/Date(2000)/' }), false)
  assert.equal(sameProcessIdentity(expected, { pid: 43, startedAt: '/Date(1000)/' }), false)
  assert.equal(sameProcessIdentity(expected, { pid: 42 }), true)
  assert.equal(sameProcessIdentity({ pid: 42 }, { pid: 42 }), true)
  const table = [
    { pid: 42, ppid: 1, startedAt: '2026-10-13T06:28:52.335Z' },
    { pid: 43, ppid: 42, startedAt: '2026-10-13T06:29:25.755Z' },
    // An older service retains the numeric PID of a long-exited parent. That
    // PID now belongs to the test's git child; the service is not our child.
    { pid: 44, ppid: 43, startedAt: '2026-10-13T05:43:43.433Z' },
    { pid: 45, ppid: 44, startedAt: '2026-10-13T05:44:00.000Z' },
    { pid: 46, ppid: 43, startedAt: '2026-10-13T06:29:25.764Z' },
    { pid: 47, ppid: 42, startedAt: '2026-10-13T05:00:00.000Z' }
  ]
  assert.deepEqual(descendantsOf(table, 42), [43, 46])
  const windowsPowerShellTable = table.map(p => ({ ...p, startedAt: `/Date(${Date.parse(p.startedAt)})/` }))
  assert.deepEqual(descendantsOf(windowsPowerShellTable, 42), [43, 46])
  assert.deepEqual(descendantsOf([{ pid: 1, ppid: 0 }, { pid: 2, ppid: 1 }], 1), [2])
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
