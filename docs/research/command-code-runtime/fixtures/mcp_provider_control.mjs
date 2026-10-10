#!/usr/bin/env node
// Diagnostic positive control ONLY. This is not Command Code, ACP, or a Rovai Run.
// It checks the same real BYOK model with the MCP schema actually in tools.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompletionObserver, requestEvidence, targetName, digest } from './mcp_delivery_observer.mjs';

const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
const sourceHome = arg('--source-home'); const out = arg('--out');
if (!sourceHome || !out || !isAbsolute(sourceHome) || !isAbsolute(out) || existsSync(out)) throw new Error('Use absolute --source-home and NEW --out');
mkdirSync(out, { mode: 0o700, recursive: true });
const probeRunId = randomUUID(); const sessionId = `provider-control-${probeRunId}`;
const log = join(out, 'events.jsonl');
const record = (kind, data) => appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), probeRunId, sessionId, kind, ...data }) + '\n', { mode: 0o600 });
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'mcp_delivery_probe.mjs');
const server = spawn(process.execPath, [fixture, '--server-stdio', '--record', log, '--probe-run', probeRunId], { stdio: ['pipe', 'pipe', 'ignore'] });
let next = 0; const pending = new Map();
createInterface({ input: server.stdout }).on('line', line => { const row = JSON.parse(line); pending.get(row.id)?.(row.result); });
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP_TIMEOUT')); }, 10000);
  pending.set(id, result => { clearTimeout(timer); pending.delete(id); resolve(result); });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
let sequence = 0;
let summary = { diagnosticOnly: true, commandAcpAcceptance: false, probeRunId, sessionId,
  scriptSha256: digest(readFileSync(fileURLToPath(import.meta.url))), model: 'sub2api/gpt-6-sol' };
try {
  const provider = JSON.parse(readFileSync(join(sourceHome, '.commandcode/providers.json'))).provider.sub2api;
  if (provider.api !== 'openai-completions' || !provider.models?.['gpt-6-sol']) throw new Error('Unsupported control configuration');
  // Resolve the already-configured provider key privately, exactly as its native declaration specifies.
  const reference = provider.apiKey;
  let key;
  if (typeof reference === 'string' && reference.startsWith('!')) key = execFileSync('/bin/sh', ['-c', reference.slice(1)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
  else if (typeof reference === 'string' && reference.startsWith('$')) key = process.env[reference.slice(1)];
  else throw new Error('Unsupported private key reference');
  if (!key) throw new Error('Missing private key');
  const request = async body => {
    const requestId = ++sequence; record('provider_request', { requestId, ...requestEvidence(body) });
    const response = await fetch(provider.baseURL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(provider.headers ?? {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
    });
    const observer = new CompletionObserver(); const decoder = new TextDecoder();
    for await (const chunk of response.body) observer.push(decoder.decode(chunk, { stream: true }));
    observer.push(decoder.decode());
    record('provider_response', { requestId, status: response.status, ...observer.evidence() });
    if (!response.ok || observer.parseErrors) throw new Error('Provider control response failed');
    return observer;
  };
  await rpc('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'rovai-provider-control', version: '1' }, capabilities: {} });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { tools } = await rpc('tools/list', {});
  const tool = tools.find(tool => tool.name === 'issue_receipt');
  const messages = [{ role: 'user', content: 'Call the provided MCP issue_receipt tool once with {}. Reply only with the receipt returned by that actual invocation. Do not invent a receipt.' }];
  const body = { model: 'gpt-6-sol', stream: true, tool_choice: 'auto', tools: [{ type: 'function', function: {
    name: targetName, description: tool.description, parameters: tool.inputSchema } }], messages };
  const first = await request(body);
  const calls = [...first.calls.values()];
  if (calls.length !== 1 || calls[0].name !== targetName || Object.keys(JSON.parse(calls[0].arguments)).length !== 0) throw new Error('Model did not select the expected empty-argument tool');
  const call = calls[0]; const result = await rpc('tools/call', { name: 'issue_receipt', arguments: {} });
  const receipt = result.content[0].text;
  messages.push({ role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] },
    { role: 'tool', tool_call_id: call.id, content: receipt });
  const second = await request(body);
  summary = { ...summary, controlPassed: second.calls.size === 0 && second.text.trim() === receipt, actualTargetCalls: 1,
    receipt, modelReturnedReceipt: second.evidence().receipts.includes(receipt), providerRequests: sequence };
} catch {
  summary = { ...summary, controlPassed: false, error: 'CONTROL_FAILED' };
} finally {
  server.stdin.end(); server.kill();
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(summary));
}
