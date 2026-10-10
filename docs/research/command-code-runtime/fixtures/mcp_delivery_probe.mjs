#!/usr/bin/env node
// Real-model A/B reproduction; no production runtime or provider behavior overrides.
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, copyFileSync, chmodSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompletionObserver, requestEvidence, digest, receipts, targetName } from './mcp_delivery_observer.mjs';

const file = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const arg = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const put = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const privateDir = path => mkdirSync(path, { recursive: true, mode: 0o700 });
const serverName = 'rovai_delivery64';
const schema = { name: 'issue_receipt', description: 'Generate and return one fresh receipt for this actual MCP invocation.',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } };
const prompt = 'Use the MCP tool issue_receipt on server rovai_delivery64 to request one fresh receipt. If necessary, call search_tools once to load its schema, then invoke the target tool once with {}. Do not use shell, filesystem, web, other tools, or additional searches. Reply only with the receipt returned by this invocation. If the target tool is unavailable, reply UNAVAILABLE. Never invent a result.';
const bootstrap = 'You are an isolated MCP delivery acceptance session. Follow the user request and report the actual tool result accurately.';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function recorder(path, probeRunId) {
  return (kind, data = {}) => appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), probeRunId, kind, ...data }) + '\n', { mode: 0o600 });
}
function mcpHandler(record) {
  return request => {
    const method = request.method;
    if (!['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping'].includes(method)) {
      return request.id === undefined ? null : { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } };
    }
    record('mcp', { method, ...(method === 'tools/call' ? { target: request.params?.name === schema.name } : {}) });
    if (request.id === undefined) return null;
    let result;
    if (method === 'initialize') result = { protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: serverName, version: '1' } };
    else if (method === 'tools/list') result = { tools: [schema] };
    else if (method === 'tools/call' && request.params?.name === schema.name) {
      const receipt = `RCP_${randomUUID()}`; // Generated only AFTER tools/call arrives.
      record('receipt', { receipt });
      result = { content: [{ type: 'text', text: receipt }] };
    } else result = {};
    return { jsonrpc: '2.0', id: request.id, result };
  };
}
async function fixtureHttp(record) {
  const handle = mcpHandler(record);
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const reply = handle(JSON.parse(Buffer.concat(chunks)));
      if (!reply) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
    } catch { res.writeHead(400).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => { server.closeAllConnections(); server.close(); } };
}

async function providerProxy(upstream, record, session) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Unsupported provider URL');
  const transport = target.protocol === 'https:' ? https : http;
  let sequence = 0;
  const pending = new Set();
  const server = http.createServer(async (req, res) => {
    const requestId = ++sequence;
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString('utf8'));
      record('provider_request', { requestId, sessionId: session.id, ...requestEvidence(body) });
      const remote = transport.request({ hostname: target.hostname, port: target.port || undefined, protocol: target.protocol,
        method: req.method, path: req.url, headers: { ...req.headers, host: target.host } }, incoming => {
        res.writeHead(incoming.statusCode, incoming.headers);
        const observer = new CompletionObserver();
        const encoding = incoming.headers['content-encoding'];
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null;
        const inspected = decoder ? incoming.pipe(decoder) : incoming;
        inspected.setEncoding('utf8');
        let nonStreaming = '';
        inspected.on('data', chunk => { if (body.stream) observer.push(chunk); else nonStreaming += chunk; });
        inspected.on('end', () => {
          if (!body.stream) { try { observer.event(JSON.parse(nonStreaming)); } catch { observer.parseErrors += 1; } }
          record('provider_response', { requestId, sessionId: session.id, status: incoming.statusCode, ...observer.evidence() });
        });
        inspected.on('error', () => record('observation_error', { requestId }));
        incoming.pipe(res);
      });
      pending.add(remote); remote.on('close', () => pending.delete(remote));
      remote.on('error', () => { record('provider_transport_error', { requestId }); if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => { if (!res.writableFinished) remote.destroy(); });
      remote.end(bytes); // Unmodified JSON bytes, including native tool selection and prompts.
    } catch { record('proxy_parse_error', { requestId }); if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { baseURL: `http://127.0.0.1:${server.address().port}${target.pathname}`,
    close: () => { for (const req of pending) req.destroy(); server.closeAllConnections(); server.close(); } };
}

class AcpClient {
  constructor(cli, cwd, env, record, timeoutMs) { Object.assign(this, { cli, cwd, env, record, timeoutMs }); this.next = 0; this.pending = new Map(); this.text = ''; this.updates = []; this.stderrBytes = 0; }
  async start() {
    this.child = spawn(process.execPath, [this.cli, '--no-auto-update', '--skip-onboarding', 'acp'], { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    this.record('host_started', { pid: this.child.pid });
    this.child.stderr.on('data', bytes => { this.stderrBytes += bytes.length; }); // Discard: may contain native diagnostics with private inputs.
    this.child.on('error', () => this.rejectPending());
    this.child.on('exit', () => this.rejectPending());
    createInterface({ input: this.child.stdout }).on('line', line => {
      let row; try { row = JSON.parse(line); } catch { this.record('acp_non_json'); return; }
      if (row.method && row.id !== undefined) {
        this.record('acp_permission_request', { method: row.method });
        this.write({ jsonrpc: '2.0', id: row.id, result: { outcome: { outcome: 'cancelled' } } });
      } else if (row.id !== undefined) this.pending.get(row.id)?.(row);
      else if (row.method === 'session/update') {
        const update = row.params?.update ?? {};
        const entry = { sessionId: row.params?.sessionId, update: update.sessionUpdate };
        if (update.toolCallId) entry.toolCallId = update.toolCallId;
        if (update.status) entry.status = update.status;
        const serialized = JSON.stringify(update);
        entry.targetSchemaPresent = serialized.includes(targetName) && serialized.includes('Parameters:');
        entry.receipts = receipts(serialized);
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') this.text += update.content.text;
        this.updates.push(entry); this.record('acp_update', entry);
      }
    });
    return this.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'rovai-mcp-delivery-probe', version: '1' } });
  }
  rejectPending() { for (const done of this.pending.values()) done({ error: { code: 'HOST_EXITED' } }); }
  write(row) { this.child.stdin.write(JSON.stringify(row) + '\n'); }
  call(method, params) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`ACP_TIMEOUT:${method}`)); }, this.timeoutMs);
      this.pending.set(id, row => { clearTimeout(timer); this.pending.delete(id); row.error ? reject(new Error(`ACP_ERROR:${method}:${row.error.code}`)) : resolve(row.result); });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  async close() {
    this.child.stdin.end();
    const exited = () => this.child.exitCode !== null || this.child.signalCode !== null;
    for (let i = 0; i < 10 && !exited(); i++) await pause(100);
    // Only this probe's freshly spawned process group, never a daily Runtime.
    if (!exited()) { try { process.kill(-this.child.pid, 'SIGTERM'); } catch {} }
    for (let i = 0; i < 10 && !exited(); i++) await pause(100);
    try { process.kill(-this.child.pid, 'SIGKILL'); } catch {}
    this.record('host_stopped', { pid: this.child.pid, stderrBytesDiscarded: this.stderrBytes });
  }
}

export function evaluate(events, sessionId) {
  const requests = events.filter(e => e.kind === 'provider_request' && e.sessionId === sessionId);
  const responses = events.filter(e => e.kind === 'provider_response' && e.sessionId === sessionId);
  const issued = events.filter(e => e.kind === 'receipt').map(e => e.receipt);
  const updates = events.filter(e => e.kind === 'acp_update' && e.sessionId === sessionId);
  const returned = issued.filter(receipt => requests.some(e => e.inputReceipts.includes(receipt)) && updates.some(e => e.receipts.includes(receipt)));
  const targetRequests = requests.filter(e => e.targetCallable);
  const modelCalls = responses.filter(e => targetRequests.some(r => r.requestId === e.requestId)).flatMap(e => e.toolCalls).filter(e => e.name === targetName);
  const actualTargetCalls = events.filter(e => e.kind === 'mcp' && e.method === 'tools/call' && e.target).length;
  const mcpInitialized = events.some(e => e.kind === 'mcp' && e.method === 'initialize');
  const mcpDiscovered = events.some(e => e.kind === 'mcp' && e.method === 'tools/list');
  return { providerRequests: requests.length, searchCalls: responses.flatMap(e => e.toolCalls).filter(e => e.name === 'search_tools').length,
    requestsAfterSearchSchema: requests.filter(e => e.targetSchemaInToolResult).length,
    targetInRequestCount: targetRequests.length, targetModelCallCount: modelCalls.length,
    mcpInitialized, mcpDiscovered, actualTargetCalls,
    issuedReceipts: issued, returnedReceipts: returned,
    fullChainPassed: mcpInitialized && mcpDiscovered && actualTargetCalls > 0 && modelCalls.length > 0 && returned.length > 0,
    finalUnavailable: responses.some(e => e.unavailable),
    observationErrors: events.filter(e => /error/.test(e.kind)).length + responses.reduce((n, e) => n + e.parseErrors + (e.status === 200 ? 0 : 1), 0) };
}

async function main() {
  const cli = arg('--command-cli'); const sourceHome = arg('--source-home'); const out = arg('--out');
  if (![cli, sourceHome, out].every(value => value && isAbsolute(value)) || existsSync(out)) throw new Error('Require absolute --command-cli --source-home and a NEW --out directory');
  const version = json(join(dirname(cli), '..', 'package.json')).version;
  if (version !== '1.74.1') throw new Error('This reproduction is pinned to Command Code 1.74.1');
  const source = join(sourceHome, '.commandcode');
  const providers = json(join(source, 'providers.json'));
  const model = arg('--model', 'sub2api/gpt-6-sol'); const providerId = model.split('/')[0];
  if (providers.provider?.[providerId]?.api !== 'openai-completions') throw new Error('Observer supports openai-completions only');
  const repo = resolve(dirname(file), '../../../..');
  const mod = join(repo, 'crates/rovai-core/src/command_code/bootstrap.mjs');
  const cases = arg('--cases', 'native-stdio,acp-stdio,native-http,acp-http').split(',');
  if (cases.some(item => !/^(native|acp)-(stdio|http)$/.test(item))) throw new Error('Invalid case');
  privateDir(out); const cwd = join(out, 'workspace'); privateDir(cwd);
  const manifest = { commandVersion: version, commandCliSha256: digest(readFileSync(cli)),
    repositoryCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    probeSha256: digest(readFileSync(file)), observerSha256: digest(readFileSync(join(dirname(file), 'mcp_delivery_observer.mjs'))),
    bootstrapModSha256: digest(readFileSync(mod)), model, permissionMode: 'bypass',
    prompt, bootstrap, cwd: 'shared empty isolated workspace',
    observation: 'Loopback proxy forwards original request JSON and provider response bytes; no header, endpoint, full prompt or argument logging', cases: [] };
  put(join(out, 'manifest.json'), manifest);
  for (const label of cases) {
    const probeRunId = randomUUID(); const root = join(out, label); privateDir(root);
    const home = join(root, 'home'); const native = join(home, '.commandcode'); privateDir(native);
    const log = join(root, 'events.jsonl'); const record = recorder(log, probeRunId); const session = { id: null };
    const provider = structuredClone(providers.provider[providerId]);
    if (Object.values(provider.models ?? {}).some(m => m.baseURL || m.api && m.api !== provider.api)) throw new Error('Per-model overrides need a dedicated observer');
    const proxy = await providerProxy(provider.baseURL, record, session);
    provider.baseURL = proxy.baseURL; put(join(native, 'providers.json'), { provider: { [providerId]: provider } });
    if (existsSync(join(source, 'auth.json'))) { copyFileSync(join(source, 'auth.json'), join(native, 'auth.json')); chmodSync(join(native, 'auth.json'), 0o600); }
    put(join(native, 'config.json'), { model, localOnly: true });
    put(join(native, 'settings.json'), { mods: { paths: [mod] } });
    const bindingRoot = join(root, 'bootstrap'); privateDir(join(bindingRoot, 'bindings'));
    const fixture = label.endsWith('-http') ? await fixtureHttp(record) : null;
    const definition = fixture ? { name: serverName, type: 'http', url: fixture.url, headers: [] } : {
      name: serverName, command: process.execPath, args: [file, '--server-stdio', '--record', log, '--probe-run', probeRunId], env: [] };
    const nativeDefinition = fixture ? { transport: 'http', url: fixture.url } : { transport: 'stdio', command: definition.command, args: definition.args };
    const nativePath = label.startsWith('native-');
    put(join(native, 'mcp.json'), { mcpServers: nativePath ? { [serverName]: nativeDefinition } : {} });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ROVAI_|CLINE_|COMMAND_CODE_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$|CMD_LOCAL_ONLY$)/.test(key)));
    Object.assign(env, { HOME: home, DO_NOT_TRACK: '1', COMMANDCODE_SKIP_UPDATES: '1', ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT: bindingRoot, ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE: randomUUID() });
    const client = new AcpClient(cli, cwd, env, record, Number(arg('--timeout-ms', '90000')));
    let outcome = {};
    try {
      const initialized = await client.start();
      record('initialize', { version: initialized.agentInfo?.version, capabilities: initialized.agentCapabilities });
      const servers = nativePath ? [] : [definition];
      record('delivery', { path: nativePath ? 'native' : 'acp', nativeServerCount: nativePath ? 1 : 0, sessionServerCount: servers.length,
        transport: fixture ? 'http' : 'stdio', sessionMethod: 'session/new', absoluteLauncher: !fixture, explicitCwd: false });
      const created = await client.call('session/new', { cwd, mcpServers: servers }); session.id = created.sessionId;
      record('session', { sessionId: session.id, pid: client.child.pid });
      put(join(bindingRoot, 'bindings', `${session.id}.json`), { schemaVersion: 1, sessionId: session.id, bootstrap, sha256: digest(bootstrap) });
      await client.call('session/set_mode', { sessionId: session.id, modeId: 'bypass' });
      const result = await client.call('session/prompt', { sessionId: session.id, prompt: [{ type: 'text', text: prompt }] });
      outcome = { stopReason: result.stopReason };
      record('acp_final', { sessionId: session.id, receipts: receipts(client.text), unavailable: client.text.trim() === 'UNAVAILABLE' });
    } catch (error) {
      outcome = { error: /^ACP_(ERROR|TIMEOUT):[\w/:.-]+$/.test(error.message) ? error.message : 'PROBE_FAILURE' };
      record('case_error', outcome);
      if (session.id) client.write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: session.id } });
    } finally { await client.close(); proxy.close(); fixture?.close(); }
    const events = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    const result = { label, probeRunId, sessionId: session.id, pid: client.child.pid, ...outcome, ...evaluate(events, session.id) };
    manifest.cases.push(result); put(join(out, 'manifest.json'), manifest);
    console.log(JSON.stringify(result));
  }
}

if (resolve(process.argv[1] ?? '') === file) {
  if (args.includes('--server-stdio')) {
    const handle = mcpHandler(recorder(arg('--record'), arg('--probe-run')));
    for await (const line of createInterface({ input: process.stdin })) {
      try { const response = handle(JSON.parse(line)); if (response) process.stdout.write(JSON.stringify(response) + '\n'); } catch { process.exitCode = 1; }
    }
  } else await main().catch(error => { console.error(/^(Require|This reproduction|Observer|Invalid case|Per-model|Unsupported provider)/.test(error.message) ? error.message : 'Probe failed; inspect sanitized events.'); process.exitCode = 1; });
}
