import assert from 'node:assert/strict'
import test from 'node:test'
import { qualificationRuntimePrivateDiagnostic } from './qualification-core.mjs'

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
