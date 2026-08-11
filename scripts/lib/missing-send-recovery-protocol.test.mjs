import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAcpRecoveryProtocolFixture } from './missing-send-recovery-protocol.mjs'

test('ACP recovery fixture validates tool then identified final chunks', () => {
  const result = validateAcpRecoveryProtocolFixture({
    adapterKind: 'opencode-cli',
    expectedFinal: 'FINAL',
    events: [
      { sequence: 1, kind: 'assistant', messageId: 'draft', messageIdSource: 'update', text: 'draft' },
      { sequence: 2, kind: 'tool' },
      { sequence: 3, kind: 'assistant', messageId: 'final', messageIdSource: 'update', text: 'FI' },
      { sequence: 4, kind: 'assistant', messageId: 'final', messageIdSource: 'update', text: 'NAL' },
      { sequence: 5, kind: 'turn_completed', stopReason: 'end_turn' }
    ]
  })
  assert.equal(result.candidate, 'FINAL')
  assert.equal(result.toolEventCount, 1)
  assert.equal(result.identifiedChunkCount, 3)
})

test('ACP recovery fixture accepts one anonymous suffix', () => {
  const result = validateAcpRecoveryProtocolFixture({
    adapterKind: 'qwen-code',
    expectedFinal: 'ANONYMOUS FINAL',
    events: [
      { sequence: 1, kind: 'tool' },
      { sequence: 2, kind: 'assistant', messageId: null, messageIdSource: null, text: 'ANONYMOUS ' },
      { sequence: 3, kind: 'assistant', messageId: null, messageIdSource: null, text: 'FINAL' },
      { sequence: 4, kind: 'turn_completed', stopReason: 'end_turn' }
    ]
  })
  assert.equal(result.anonymousChunkCount, 2)
})

test('ACP recovery fixture fails closed on mixed identities and missing tool evidence', () => {
  assert.throws(() => validateAcpRecoveryProtocolFixture({
    adapterKind: 'copilot-cli',
    expectedFinal: 'FINAL',
    events: [
      { sequence: 1, kind: 'tool' },
      { sequence: 2, kind: 'assistant', messageId: 'final', messageIdSource: 'content', text: 'FI' },
      { sequence: 3, kind: 'assistant', messageId: null, messageIdSource: null, text: 'NAL' },
      { sequence: 4, kind: 'turn_completed', stopReason: 'end_turn' }
    ]
  }), /candidate disagrees/)
  assert.throws(() => validateAcpRecoveryProtocolFixture({
    adapterKind: 'kiro-cli',
    expectedFinal: 'FINAL',
    events: [
      { sequence: 1, kind: 'assistant', messageId: null, messageIdSource: null, text: 'FINAL' },
      { sequence: 2, kind: 'turn_completed', stopReason: 'end_turn' }
    ]
  }), /real tool activity/)
})
