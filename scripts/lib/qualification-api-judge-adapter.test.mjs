import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdapter, capabilities } from './qualification-api-judge-adapter.mjs'

test('API adapter disables model tools, checks snapshot/finish and never falls back after refusal', async () => {
  const keyName = 'ROVAI_JUDGE_TEST_KEY'
  const previous = process.env[keyName]; process.env[keyName] = 'local-test-value'
  try {
    const config = { snapshotId: 'fixed-test-snapshot', api: { endpoint: 'http://127.0.0.1/completions', keyEnvironmentVariable: keyName, modelVersionPolicy: 'pinned_snapshot' } }
    const request = { judgeView: 'outcome', replica: 'A', systemPrompt: 'Evaluate evidence.', userPrompt: 'Return JSON.', evidencePack: {}, capabilities, decodingParameters: { maxOutputTokens: 256, temperature: 0 } }
    let response = { id: 'test-response', model: 'fixed-test-snapshot', choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] }
    const adapter = createAdapter(config, { fetchImplementation: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.tool_choice, 'none'); assert.equal(body.tools, undefined); assert.equal(body.store, false)
      assert.equal(body.max_completion_tokens, 256)
      return new Response(JSON.stringify(response), { status: 200 })
    } })
    assert.deepEqual(await adapter.invokeReplica(request), { items: [] })
    response.model = 'different-snapshot'
    await assert.rejects(adapter.invokeReplica(request), /model_snapshot_mismatch/)
    response.model = config.snapshotId; response.choices[0].finish_reason = 'length'
    await assert.rejects(adapter.invokeReplica(request), /incomplete_or_non_text_result/)
    delete process.env[keyName]
    await assert.rejects(adapter.invokeReplica(request), /credentials_unavailable/)
  } finally { if (previous === undefined) delete process.env[keyName]; else process.env[keyName] = previous }
})
