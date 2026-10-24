// Installed Hermes + deterministic model endpoint. Real native file operations,
// native reasoning, steering, cancellation, concurrency and sparse observations.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, realpath, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openHermesAcp } from './lib/hermes-native-acp.mjs'

const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermes-experience-')))
const home = join(root, 'home'), project = join(root, 'project')
await mkdir(home, { mode: 0o700 }); await mkdir(project)
const wire = [], queue = []
let fail = false, hold = false, release, count = 0, wireError
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] })); return
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!Array.isArray(body.input)) { response.end('{}'); return }
    wire.push(body)
    if (hold) { hold = false; await new Promise(done => { release = done }) }
    if (fail) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Model invalid-hermes-model does not exist', type: 'invalid_request_error', code: 'model_not_found' } })); return
    }
    const next = queue.shift(), index = ++count, id = `response-${index}`
    const items = next ? next.map((call, n) => ({ type: 'function_call', id: `fc-${index}-${n}`, call_id: `call-${index}-${n}`,
      name: call.name, arguments: JSON.stringify(call.args), status: 'completed' })) : [{ type: 'message', id: `message-${index}`,
      role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'EXPERIENCE_OK', annotations: [] }] }]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    const emit = event => response.write('data: ' + JSON.stringify({ ...event, sequence_number: sequence++ }) + '\n\n')
    emit({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
    for (const [output_index, item] of items.entries()) {
      emit({ type: 'response.output_item.added', output_index, item })
      emit({ type: 'response.output_item.done', output_index, item })
    }
    emit({ type: 'response.completed', response: { id, status: 'completed', output: items,
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } })
    response.end()
  } catch (error) { wireError = error; response.writeHead(500); response.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
await writeFile(join(home, 'config.yaml'), JSON.stringify({ model: { provider: 'fixture', default: 'fixture-model' },
  providers: { fixture: { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key_env: 'ROVAI_HERMES_FIXTURE_KEY',
    transport: 'codex_responses', models: ['fixture-model'] } },
  platform_toolsets: { acp: ['file', 'terminal', 'clarify'] },
  agent: { max_turns: 20, disabled_toolsets: ['clarify'], reasoning_effort: 'low' },
  gateway: null, auxiliary: { title_generation: null, background_review: null },
  memory: null, terminal: null, skills: null, hooks: { post_compaction: null },
  session_title: { enabled: false }, compression: { enabled: false } }), { mode: 0o600 })
let client
console.log('Isolated fixture:', root)
const options = { executable: process.env.ROVAI_HERMES_BIN,
  script: resolve(import.meta.dirname, '../crates/rovai-core/src/hermes/host.py'), cwd: project,
  env: { ...process.env, HERMES_HOME: home, ROVAI_HERMES_FIXTURE_KEY: 'controlled-fixture' } }
try {
  client = await openHermesAcp(options)
  const session = await client.request('session/new', { cwd: project, mcpServers: [] }), sessionId = session.sessionId
  await client.request('session/set_mode', { sessionId, modeId: 'dont_ask' })
  const prompt = id => client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Execute the fixture.' }], _meta: { rovai: { promptId: id } } })
  await client.request('session/set_model', { sessionId, modelId: 'custom:fixture:fixture-model' })
  assert.equal((await client.request('session/load', {sessionId, cwd: project, mcpServers: []})).models.currentModelId, 'custom:fixture:fixture-model')
  const path = join(project, '中文 space.txt'), second = join(project, 'second.txt')
  queue.push([{ name: 'write_file', args: { path, content: 'alpha\n' } }],
    [{ name: 'write_file', args: { path, content: 'beta\n' } }],
    [{ name: 'patch', args: { path, old_string: 'beta', new_string: 'gamma' } }],
    [{ name: 'patch', args: { mode: 'patch', patch: `*** Begin Patch\n*** Add File: ${second}\n+two\n*** Delete File: ${path}\n*** End Patch` } }])
  assert.equal((await prompt('file-turn')).stopReason, 'end_turn')
  assert.equal(await readFile(second, 'utf8'), 'two')
  await assert.rejects(access(path))
  assert(client.events.some(m => m.params?.update?.sessionUpdate === 'tool_call'))
  assert(client.events.some(m => m.params?.update?.status === 'completed'))
  assert(!client.events.some(m => m.params?.update?._meta?.rovaiHermesMutation))
  assert(wire.every(body => body.tools.every(tool => !/ask_user|clarify/.test(tool.name ?? ''))))
  assert(wire.some(body => body.reasoning?.effort === 'low'), 'Native reasoning configuration lost')
  const sql = join(project, 'headings.sql'), ordinary = join(project, 'ordinary.txt')
  await writeFile(sql, '-- heading\nold\n'); await writeFile(ordinary, 'before\n')
  queue.push([{ name: 'patch', args: { mode: 'patch', patch: `*** Begin Patch\n*** Update File: ${sql}\n@@\n -- heading\n-old\n+new\n*** Update File: ${ordinary}\n@@\n-before\n+after\n*** End Patch` } }])
  assert.equal((await prompt('two-updates')).stopReason, 'end_turn')
  assert.equal(await readFile(sql, 'utf8'), '-- heading\nnew\n')
  assert.equal(await readFile(ordinary, 'utf8'), 'after\n')
  queue.push([{ name: 'patch', args: { mode: 'patch', patch: `*** Begin Patch\n*** Update File: ${sql}\n@@\n--- heading\n new\n*** Update File: ${ordinary}\n@@\n-after\n+final\n*** End Patch` } }])
  assert.equal((await prompt('sql-header-deletion')).stopReason, 'end_turn')
  assert.equal(await readFile(sql, 'utf8'), 'new\n')
  assert.equal(await readFile(ordinary, 'utf8'), 'final\n')
  console.log('Native tools succeed with sparse ACP observations; native reasoning retained')
  hold = true
  const active = prompt('steer-turn')
  active.catch(() => {}) // Preserve the original assertion if cleanup closes a pending prompt.
  const deadline = Date.now() + 15000
  while (!release && Date.now() < deadline) await new Promise(done => setTimeout(done, 20))
  assert(release, 'Model request did not start')
  const steer = await client.control('steer', { sessionId, text: 'STEER-MARKER-8302' })
  assert.equal(steer.accepted, true, JSON.stringify(steer))
  release(); release = null
  assert.equal((await active).stopReason, 'end_turn')
  assert(JSON.stringify(wire.at(-1)).includes('STEER-MARKER-8302'), 'Native redirect never reached model')
  assert.equal((await client.control('steer', { sessionId, text: 'NEVER' })).accepted, false)
  hold = true
  const stopping = prompt('cancel-turn')
  stopping.catch(() => {})
  const cancelDeadline = Date.now() + 15000
  while (!release && Date.now() < cancelDeadline) await new Promise(done => setTimeout(done, 20))
  assert(release)
  // A second binding must finish while the first binding is still active.
  const parallel = await openHermesAcp({ ...options, env: { ...options.env, ROVAI_HERMES_STORAGE: join(root, 'parallel') } })
  try {
    const other = (await parallel.request('session/new', {cwd: project, mcpServers: []})).sessionId
    assert.notEqual(other, sessionId)
    assert.equal((await parallel.request('session/prompt', {sessionId: other, prompt: [{type: 'text', text: 'Independent task'}]})).stopReason, 'end_turn')
    assert(release, 'First binding must still be held during independent work')
  } finally { await parallel.close() }
  client.notify('session/cancel', {sessionId})
  assert.equal((await stopping).stopReason, 'cancelled')
  release(); release = null
  assert.equal((await prompt('after-cancel')).stopReason, 'end_turn')
  fail = true
  await assert.rejects(prompt('error-turn'), error => error.rpcError?.data?.details === 'admitted_turn_failed')
  fail = false
  await client.close()
  const fixture = join(root, 'mcp.mjs')
  await writeFile(fixture, `import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned-proof',version:'1'}}:
m.method==='tools/list'?{tools:[{name:'proof',description:'Controlled proof tool',inputSchema:{type:'object',properties:{}}}]}:
m.method==='tools/call'?{content:[{type:'text',text:process.env.PROOF_CODE}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`)
  let mcpSessionId
  const broken = { name: 'broken', command: join(root, 'missing-mcp'), args: [], env: [] }
  for (const [phase, code, unavailable] of [
    ['new', 'FIRST', true], ['cold', 'FIRST', true], ['changed', 'CHANGED', true],
    ['clear', null, false], ['all-failed', null, true],
  ]) {
    const config = JSON.parse(await readFile(join(home, 'config.yaml'), 'utf8'))
    config.mcp_servers = code ? { ownedproof: { command: process.execPath, args: [fixture], env: { PROOF_CODE: 'NATIVE_SHOULD_NOT_RUN' } } } : {}
    config.platform_toolsets.acp = ['file', 'terminal', 'clarify', ...(code ? ['mcp-ownedproof'] : [])]
    await writeFile(join(home, 'config.yaml'), JSON.stringify(config), { mode: 0o600 })
    const servers = code ? [{ name: 'ownedproof', command: process.execPath, args: [fixture], env: [{ name: 'PROOF_CODE', value: code }] }] : []
    if (unavailable) servers.push(broken)
    client = await openHermesAcp({ ...options, env: { ...options.env, ROVAI_HERMES_MCP_NAMES: JSON.stringify(servers.map(server => server.name)) } })
    if (phase === 'new') {
      mcpSessionId = (await client.request('session/new', { cwd: project, mcpServers: servers })).sessionId
      // The official creation binds MCP. No prepare_session/second discovery.
      await client.request('session/set_mode', { sessionId: mcpSessionId, modeId: 'dont_ask' })
    } else {
      await client.request('session/load', { sessionId: mcpSessionId, cwd: project, mcpServers: [] })
      assert(client.events.some(event => event.params?.sessionId === mcpSessionId && event.params.update?.sessionUpdate === 'user_message_chunk'), 'History must restore before MCP preparation')
      const prepared = await client.control('prepare_session', {sessionId: mcpSessionId, mcpServers: servers})
      assert.equal(prepared.sessionId, mcpSessionId)
      assert.equal(prepared.state, 'idle')
      assert.deepEqual(prepared.missingMcpServers ?? [], unavailable ? ['broken'] : [])
    }
    const mcpPrompt = () => client.request('session/prompt', { sessionId: mcpSessionId,
      prompt: [{ type: 'text', text: `MCP fixture ${phase}` }] })
    assert.equal((await mcpPrompt()).stopReason, 'end_turn', 'Unavailable MCP must not prevent ordinary dialogue')
    queue.push([{ name: 'tool_search', args: { queries: ['ownedproof'] } }])
    assert.equal((await mcpPrompt()).stopReason, 'end_turn')
    const searchResult = JSON.stringify(wire.at(-1).input.filter(item => item.type === 'function_call_output').at(-1))
    const toolName = searchResult.match(/mcp__editor_ownedproof_[a-z0-9]+__proof/)?.[0]
    assert.equal(Boolean(toolName), Boolean(code), `MCP ${code} did not match the native tool search: ${searchResult}`)
    if (toolName) {
      queue.push([{ name: 'tool_describe', args: { names: [toolName] } }],
        [{ name: 'tool_call', args: { calls: [{ name: toolName, arguments: {} }] } }])
      assert.equal((await mcpPrompt()).stopReason, 'end_turn')
      assert(JSON.stringify(wire.at(-1).input.filter(item => item.type === 'function_call_output').at(-1)).includes(code), 'Native MCP invoked stale credentials/configuration')
      assert(!JSON.stringify(wire.at(-1).input).includes('NATIVE_SHOULD_NOT_RUN'), 'Native same-name MCP displaced the Rovai assignment')
    }
    if (unavailable) assert(client.stderr.includes('failed discovery'), 'Native partial discovery must be diagnosed')
    await client.close()
    client = null
  }
  console.log('One Session MCP creation, partial failure, cold restore, changed specification and removal passed')
  if (wireError) throw wireError
  const summary = {nativeTools: true, successWithoutEnhancedDetails: true, nativeReasoning: true, questionnaireDisabled: true, steer: true, cancel: true, concurrency: true, nativeFailure: true, nullConfigSections: true, mcpSessionId, mcpAddChangeRemove: true, mcpRovaiWins: true, mcpPartialFailureContinues: true, mcpAllUnavailableContinues: true}
  await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('Experience acceptance passed:', root)
} catch (error) {
  await writeFile(join(root, 'wire.json'), JSON.stringify(wire, null, 2), { mode: 0o600 })
  await writeFile(join(root, 'events.json'), JSON.stringify(client?.events ?? [], null, 2))
  await writeFile(join(root, 'stderr.log'), client?.stderr ?? '')
  throw error
} finally {
  release?.(); if (client) console.log('Cleanup:', await client.close())
  server.closeAllConnections(); await new Promise(done => server.close(done))
}
