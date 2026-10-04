import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Cline official hooks emit only leased, structured observations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-cline-hooks-'));
  const previous = process.env.ROVAI_CLINE_OBSERVER_ROOT;
  process.env.ROVAI_CLINE_OBSERVER_ROOT = root;
  try {
    mkdirSync(join(root, 'bindings'));
    mkdirSync(join(root, 'observations'));
    const { default: plugin } = await import('../../crates/rovai-core/src/cline/observer.js');
    plugin.setup({}, { session: { sessionId: 'native-session' } });
    assert.throws(() => plugin.hooks.beforeRun({ snapshot: { runId: 'missing-lease' } }));
    const binding = join(root, 'bindings', `${createHash('sha256').update('native-session').digest('hex')}.json`);
    writeFileSync(binding, JSON.stringify({ schemaVersion: 1, sessionId: 'native-session', leaseId: 'agent-run:2' }));
    plugin.hooks.beforeRun({ snapshot: { runId: 'native-run', messages: ['private input'] } });
    plugin.hooks.beforeRun({ snapshot: { runId: 'child-run', parentAgentId: 'root-agent' } });
    plugin.hooks.afterModel({ snapshot: { runId: 'native-run', parentAgentId: 'root-agent' }, assistantMessage: { id: 'child-message', metrics: { inputTokens: 999 } } });
    plugin.hooks.afterModel({ snapshot: { runId: 'another-run' }, assistantMessage: { id: 'late-message', metrics: { inputTokens: 999 } } });
    plugin.hooks.afterModel({
      snapshot: { runId: 'native-run' }, requestId: 'request-1',
      assistantMessage: { id: 'message-1', content: ['private output'], metrics: {
        inputTokens: 120, outputTokens: 2, cacheReadTokens: 100, cacheWriteTokens: -1,
        reasoningTokenCount: 'unknown', totalCost: 0, privateMetadata: 'secret',
      }, modelInfo: { id: 'native-model', provider: 'native-provider' } },
    });
    plugin.hooks.onEvent({ type: 'status-notice', snapshot: { runId: 'native-run' }, message: 'private text',
      metadata: { kind: 'auto_compaction', phase: 'completed', tokensBefore: 1000, tokensAfter: 100 } });
    plugin.hooks.onEvent({ type: 'status-notice', snapshot: { runId: 'native-run' },
      metadata: { kind: 'auto_compaction', phase: 'unknown' } });
    plugin.hooks.afterRun({ result: { runId: 'native-run', status: 'completed', outputText: 'private final', usage: { inputTokens: 9999 } } });
    plugin.hooks.afterModel({ snapshot: { runId: 'native-run' }, assistantMessage: { id: 'late-message', metrics: { inputTokens: 999 } } });
    const records = readdirSync(join(root, 'observations')).sort().map(name => JSON.parse(readFileSync(join(root, 'observations', name), 'utf8')));
    assert.deepEqual(records.map(r => r.kind), ['run_started', 'model_completed', 'compaction', 'run_finished']);
    assert.deepEqual(records.map(r => r.seq), [1, 2, 3, 4]);
    assert.ok(records.every(r => Number.isFinite(Date.parse(r.observedAt))));
    assert.ok(records.every(r => r.leaseId === 'agent-run:2' && r.sessionId === 'native-session' && r.runId === 'native-run'));
    assert.deepEqual(records[1].metrics, { inputTokens: 120, outputTokens: 2, cacheReadTokens: 100 });
    assert.equal(records[2].phase, 'completed');
    assert.equal(records[2].tokensAfter, 100);
    assert.doesNotMatch(JSON.stringify(records), /private|secret|9999|999|totalCost/);
  } finally {
    if (previous === undefined) delete process.env.ROVAI_CLINE_OBSERVER_ROOT;
    else process.env.ROVAI_CLINE_OBSERVER_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
