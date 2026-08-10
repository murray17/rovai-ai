import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveUnattendedRetryBoundary } from './qualification-observation.mjs'

test('unattended observation stops at a quiescent manual-retry boundary', () => {
  assert.deepEqual(deriveUnattendedRetryBoundary(snapshot(), 'turn-1'), {
    authority: 'runner_unattended_policy',
    reason: 'unattended_manual_retry',
    agentRuns: 1,
    failedRequiredAgentRunIds: ['run-1']
  })
})

test('unattended observation keeps waiting while automatic settlement remains possible', () => {
  assert.equal(deriveUnattendedRetryBoundary(snapshot({
    messageDeliveries: [{ campTurnId: 'turn-1', status: 'running' }]
  }), 'turn-1'), null)
  assert.equal(deriveUnattendedRetryBoundary(snapshot({
    actions: [{ agentRunId: 'run-1', status: 'executing', effectDisposition: null }]
  }), 'turn-1'), null)
  assert.equal(deriveUnattendedRetryBoundary(snapshot({
    run: { hasUnsettledExternalEffects: true }
  }), 'turn-1'), null)
})

test('unattended observation does not reinterpret non-retry states', () => {
  assert.equal(deriveUnattendedRetryBoundary(snapshot({ turnStatus: 'running' }), 'turn-1'), null)
  assert.equal(deriveUnattendedRetryBoundary(snapshot({ run: { status: 'running' } }), 'turn-1'), null)
  assert.equal(deriveUnattendedRetryBoundary(snapshot({
    run: { completionRole: 'optional' }
  }), 'turn-1'), null)
  assert.equal(deriveUnattendedRetryBoundary(snapshot({ budgetExhaustedAt: '2026-08-10T00:00:00Z' }), 'turn-1'), null)
})

function snapshot({
  turnStatus = 'waiting',
  budgetExhaustedAt = null,
  run = {},
  messageDeliveries = [],
  actions = []
} = {}) {
  return {
    turns: [{
      id: 'turn-1',
      status: turnStatus,
      executionBudget: { exhaustedAt: budgetExhaustedAt }
    }],
    agentRuns: [{
      id: 'run-1',
      campTurnId: 'turn-1',
      completionRole: 'required',
      status: 'failed',
      hasUnsettledExternalEffects: false,
      ...run
    }],
    messageDeliveries,
    actions
  }
}
