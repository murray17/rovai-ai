import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompletionObserver, requestEvidence, digest, targetName } from './mcp_delivery_observer.mjs';
import { evaluate } from './mcp_delivery_probe.mjs';

test('provider evidence excludes prompts, headers, descriptions and argument values', () => {
  const evidence = requestEvidence({ model: 'gpt-6-sol', headers: { authorization: 'secret-header' },
    messages: [{ role: 'system', content: 'private-bootstrap' }, { role: 'user', content: 'private-prompt' },
      { role: 'tool', content: `Loaded 1 tool schema(s). ${targetName}\nParameters:\nprivate-tool-result` }],
    tools: [{ type: 'function', function: { name: targetName, description: 'private-description',
      parameters: { type: 'object', properties: { value: { type: 'string', default: 'private-default' } } } } }], tool_choice: 'auto' });
  const raw = JSON.stringify(evidence);
  assert.equal(evidence.targetCallable, true);
  assert.equal(evidence.targetSchemaInToolResult, true);
  assert.doesNotMatch(raw, /private-|secret-header/);
  assert.equal(digest(Buffer.from('abc')), digest('abc'));
});

test('split SSE preserves tool call association but hashes arguments', () => {
  const observer = new CompletionObserver();
  const stream = [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_tools', arguments: '{"que' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"private-argument"}' } }] }, finish_reason: 'tool_calls' }] },
  ].map(body => `data: ${JSON.stringify(body)}\r\n\r\n`).join('') + 'data: [DONE]\n\n';
  for (let i = 0; i < stream.length; i += 7) observer.push(stream.slice(i, i + 7));
  assert.equal(observer.evidence().toolCalls[0].name, 'search_tools');
  assert.equal(observer.evidence().toolCalls[0].id, 'call_1');
  assert.equal(observer.evidence().parseErrors, 0);
  assert.doesNotMatch(JSON.stringify(observer.evidence()), /private-argument/);
});

test('search/schema/completed and model claims never substitute for a server call', () => {
  const receipt = 'RCP_00000000-0000-0000-0000-000000000001';
  const events = [
    { kind: 'provider_request', sessionId: 's1', requestId: 1, targetCallable: true, targetSchemaInToolResult: true, inputReceipts: [receipt] },
    { kind: 'provider_response', sessionId: 's1', requestId: 1, toolCalls: [{ name: targetName }], status: 200, parseErrors: 0 },
    { kind: 'acp_update', sessionId: 's1', status: 'completed', receipts: [receipt] },
  ];
  assert.equal(evaluate(events, 's1').fullChainPassed, false);
  events.push({ kind: 'receipt', receipt });
  // A receipt log also needs a recorded invocation, discovery and correlation.
  assert.equal(evaluate(events, 's1').fullChainPassed, false);
  events.push(...['initialize', 'tools/list', 'tools/call'].map(method => ({ kind: 'mcp', method, target: true })));
  assert.equal(evaluate(events, 's1').fullChainPassed, true);
  assert.equal(evaluate(events, 's2').fullChainPassed, false);
});

test('fixture creates a different receipt only after each actual tools/call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-mcp-fixture-test-'));
  const log = join(root, 'events.jsonl');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./mcp_delivery_probe.mjs', import.meta.url)),
    '--server-stdio', '--record', log, '--probe-run', 'unit-test'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map(); let next = 0;
  createInterface({ input: child.stdout }).on('line', line => { const row = JSON.parse(line); pending.get(row.id)?.(row); });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; const timeout = setTimeout(() => reject(new Error('Fixture timeout')), 5000);
    pending.set(id, row => { clearTimeout(timeout); pending.delete(id); resolve(row.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const list = await rpc('tools/list');
    assert.doesNotMatch(JSON.stringify(list), /RCP_/);
    assert.equal(readFileSync(log, 'utf8').includes('receipt"'), false);
    const a = await rpc('tools/call', { name: 'issue_receipt', arguments: {} });
    const b = await rpc('tools/call', { name: 'issue_receipt', arguments: {} });
    assert.match(a.content[0].text, /^RCP_[0-9a-f-]{36}$/);
    assert.notEqual(a.content[0].text, b.content[0].text);
    const events = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(e => e.method ?? e.kind), ['tools/list', 'tools/call', 'receipt', 'tools/call', 'receipt']);
  } finally { child.stdin.end(); child.kill(); rmSync(root, { recursive: true, force: true }); }
});

test('published evidence joins real requests, schema digests, ACP calls and the separate positive control', () => {
  const evidence = JSON.parse(readFileSync(new URL('../mcp-delivery-ab-2026-10-06.evidence.json', import.meta.url)));
  assert.equal(evidence.cases.length, 4);
  assert.equal(new Set(evidence.cases.map(c => c.sessionId)).size, 4);
  assert.equal(new Set(evidence.cases.map(c => c.pid)).size, 4);
  for (const run of evidence.cases) {
    assert.equal(run.delivery.nativeServerCount + run.delivery.sessionServerCount, 1);
    assert.equal(run.fullChainPassed, false);
    assert.equal(run.actualTargetCalls, 0);
    assert.equal(run.observationErrors, 0);
    for (const request of run.providerRequestsDetail) {
      assert.ok(evidence.toolSets[request.toolSetSha256]);
      assert.equal(evidence.toolSets[request.toolSetSha256].some(t => t.name === targetName), false);
      const response = run.providerResponses.find(r => r.requestId === request.requestId);
      assert.equal(response.status, 200);
      for (const call of response.toolCalls) {
        assert.equal(call.name, 'search_tools');
        assert.ok(run.acpToolUpdates.some(u => u.toolCallId === call.id && u.status === 'completed' && u.targetSchemaPresent));
      }
    }
  }
  const control = evidence.providerPositiveControl;
  assert.equal(control.diagnosticOnly, true);
  assert.equal(control.commandAcpAcceptance, false);
  assert.ok(control.events.some(e => e.kind === 'receipt' && e.receipt === control.receipt));
  assert.ok(control.events.some(e => e.kind === 'provider_response' && e.receipts.includes(control.receipt)));
});
