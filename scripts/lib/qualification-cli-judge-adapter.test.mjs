import assert from 'node:assert/strict'
import test from 'node:test'
import { assertNoModelTools, parseCliResult, createAdapter, judgeOutputSchema } from './qualification-cli-judge-adapter.mjs'
import { buildSemanticJudgeConfiguration } from './qualification-semantic-judge.mjs'
import { validateCatalogedQualificationArtifact } from './qualification-schema-validation.mjs'
import { runCaptured } from './qualification-common.mjs'

test('tool-free admission checks both standard and additional-tools transport declarations', () => {
  assertNoModelTools({ tools: [], input: [{ type: 'message' }] })
  assert.throws(() => assertNoModelTools({ tools: [{ name: 'shell' }] }), /tools_not_disabled/)
  assert.throws(() => assertNoModelTools({ input: [{ type: 'additional_tools', tools: [{ name: 'functions', tools: [{ name: 'exec' }] }] }] }), /tools_not_disabled/)
})
test('CLI Judge requires terminal text and rejects tool effects, failures and truncated output', () => {
  const events = [{ type: 'thread.started' }, { type: 'item.completed', item: { type: 'agent_message', text: '{"items":[]}' } }, { type: 'turn.completed', usage: { output_tokens: 5 } }]
  const execution = items => ({ code: 0, stdout: items.map(item => JSON.stringify(item)).join('\n') })
  assert.deepEqual(parseCliResult(execution(events), 1024).value, { items: [] })
  assert.throws(() => parseCliResult(execution(events.slice(0, -1)), 1024), /non_text/)
  assert.throws(() => parseCliResult(execution([...events, { type: 'item.completed', item: { type: 'command_execution' } }]), 1024), /non_text/)
  assert.throws(() => parseCliResult({ ...execution(events), timedOut: true }, 1024), /incomplete/)
  assert.throws(() => parseCliResult(execution(events), 1), /output_unavailable/)
  assert.throws(() => createAdapter({ cli: { modelVersionPolicy: 'pinned_snapshot' } }), /frozen/)
})
test('Semantic Review public CLI reaches argument validation without shadowing Node process', async () => {
  const result = await runCaptured(process.execPath, ['scripts/qualification-semantic-review.mjs', '--help'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Usage:/)
  assert.doesNotMatch(result.stderr, /ReferenceError/)
})


test('CLI decoding metadata uses its own cataloged schema without fabricating API parameters', () => {
  const configuration = buildSemanticJudgeConfiguration({ provider: 'cli-test', snapshotId: 'declared-alias', snapshotDigest: 'a'.repeat(64), producerDigest: 'b'.repeat(64), decodingParameters: { reasoningEffort: 'medium' } })
  assert.equal(configuration.schemaVersion, '1.1.0')
  validateCatalogedQualificationArtifact(configuration)
  assert.deepEqual(configuration.payload.decodingParameters, { reasoningEffort: 'medium' })
  const schema = judgeOutputSchema(['SER.response.claim_accuracy'])
  assert.ok(schema.properties.items.items.required.includes('abstainReason'))
  assert.ok(schema.properties.items.items.properties.verdict.enum.includes('indeterminate'))
})

test('v6 Outcome requires a claim audit while legacy and Process output stay unchanged', () => {
  const order = ['SER.response.claim_accuracy']
  const schema = judgeOutputSchema(order, 'generic-task-v6')
  assert.ok(schema.required.includes('claimsAudit'))
  assert.ok(schema.properties.claimsAudit.required.includes('claimsComplete'))
  assert.ok(schema.properties.claimsAudit.properties.claims.items.required.includes('sourceSegmentId'))
  assert.equal(judgeOutputSchema(order).properties.claimsAudit, undefined)
  assert.equal(judgeOutputSchema(['SER.collaboration.delegation'], 'generic-task-v6').properties.claimsAudit, undefined)
})
