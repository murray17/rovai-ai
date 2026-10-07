// Real DSH/Core, controlled loopback Responses endpoint. No credentials or
// remote model calls. This verifies wire compatibility and native tool results,
// not model quality or public-message delivery.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-dsh-responses-')))
const data = join(root, 'data'), project = join(root, 'project'), home = join(root, 'home')
const cases = [
  { id: 'default', provider: 'fixture', strict: false },
  { id: 'model-off', provider: 'fixture', strict: undefined },
  { id: 'provider-off', provider: 'explicit-off', strict: undefined },
  { id: 'invalid-justification', provider: 'fixture', strict: false, rejected: true }
]
const requests = new Map(), results = []
let core, wireFailure
const marker = 'ROVAI_DSH_RESPONSES_OK'
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/v1/responses')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const scenario = cases.find(item => item.id === body.model)
    assert(scenario, 'Unexpected model')
    const index = requests.get(scenario.id) ?? 0
    assert(index < 2, 'Unexpected model retry')
    requests.set(scenario.id, index + 1)
    const toolName = process.platform === 'win32' ? 'pwsh' : 'bash'
    const tool = body.tools.find(item => item.name === toolName)
    assert(tool, 'Native shell tool missing')
    assert.equal(tool.strict, scenario.strict, `${scenario.id}: wire strict`)
    assert(tool.parameters.properties.justification, 'Expected native optional justification')
    assert(!tool.parameters.required.includes('justification'), 'Optional argument became required')
    const id = `${scenario.id}-${index}`
    let item
    if (index === 0) {
      const markerPath = join(project, `marker-${scenario.id}.txt`)
      const command = process.platform === 'win32'
        ? `Set-Content -LiteralPath '${markerPath.replaceAll("'", "''")}' -Value ${marker}`
        : `printf '${marker}\\n' > '${markerPath.replaceAll("'", "'\\''")}'`
      const args = { command, description: 'Write an isolated verification marker',
        ...(scenario.rejected ? { sandbox_permissions: tool.parameters.properties.sandbox_permissions.enum[0], justification: '' } : {}) }
      item = { id: `fc-${id}`, call_id: `call-${id}`, type: 'function_call', name: toolName, arguments: JSON.stringify(args), status: 'completed' }
    } else {
      const output = body.input.find(item => item.type === 'function_call_output')
      assert(output, 'Native tool result missing on next request')
      assert.equal(JSON.stringify(output.output).includes('invalid justification'), !!scenario.rejected)
      if (!scenario.rejected) assert(!JSON.stringify(output.output).includes('Error:'), `Native fixture tool failed: ${JSON.stringify(output.output)}`)
      item = { id: `msg-${id}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: marker, annotations: [] }] }
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    const emit = event => response.write(`data: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`)
    emit({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
    emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, ...(index === 0 ? { arguments: '' } : { content: [] }) } })
    if (index === 0) emit({ type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments })
    else emit({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: marker })
    emit({ type: 'response.output_item.done', output_index: 0, item })
    emit({ type: 'response.completed', response: { id, status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } })
    response.end()
  } catch (error) {
    wireFailure ??= error
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'Controlled DSH wire assertion failed', type: 'invalid_request_error' } }))
  }
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
try {
  await mkdir(project)
  await mkdir(home, { mode: 0o700 })
  const route = {
    api: 'openai-responses', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    apiKeyEnv: 'ROVAI_DSH_FIXTURE_KEY', models: cases.map(item => ({
      id: item.id, contextWindow: 200000, maxTokens: 4096, reasoningEfforts: { high: 'high' },
      ...(item.id === 'model-off' ? { compat: { supportsStrictMode: false } } : {})
    }))
  }
  const settings = JSON.stringify({ 'llm-pi-ai': { providers: {
    fixture: route, 'explicit-off': { ...route, compat: { supportsStrictMode: false } }
  } } })
  await writeFile(join(home, 'settings.yaml'), settings, { mode: 0o600 })
  await writeFile(join(root, 'mcp.json'), '{}')
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = join(root, 'agents-home')
  process.env.DSH_TELEMETRY_DISABLED = '1'
  process.env.ROVAI_DSH_FIXTURE_KEY = 'synthetic-loopback-only'
  core = startQualificationCore({
    coreExecutable: join(repository, 'target/debug/rovai-core'), dataDirectory: data,
    workingDirectory: repository, runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(root, 'mcp.json')
  })
  await core.request('health.check')
  const installation = await configureProductRuntime(core.request, 'deepseek-harness', ['agent_2'])
  const workspace = await core.request('workspaces.inspect', { path: project })
  for (const scenario of cases) {
    const profile = await core.request('members.get', { agentId: 'agent_2' })
    const configured = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: 'agent_2', expectedVersion: profile.version, adapterKind: 'deepseek-harness',
      model: { mode: 'explicit', modelId: JSON.stringify([scenario.provider, scenario.id]), options: { reasoning_effort: 'high' } },
      permissions: { ...profile.runtimeConfiguration.permissions, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
    } })
    assert.equal(configured.status, 'applied')
    const sent = await createConfiguredCampAndSend(core.request, {
      commandId: crypto.randomUUID(), workspace, memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2',
      body: 'Execute the controlled shell verification once, then finish.',
      address: { mode: 'explicit', agentIds: ['agent_2'] }, purpose: 'DSH Responses compatibility verification'
    })
    const command = sent.commandResult ?? sent
    assert.equal(command.status, 'accepted')
    const { threadId, threadMessageId } = command.payload
    const deadline = Date.now() + 90000
    let run
    while (Date.now() < deadline) {
      if (wireFailure) throw wireFailure
      const snapshot = await core.request('camps.snapshot', { threadId })
      run = snapshot.agentRuns.find(item => item.inputMessageIds?.includes(threadMessageId) || item.anchorMessageId === threadMessageId)
      if (['succeeded', 'failed', 'cancelled'].includes(run?.status)) break
      await new Promise(resolveWait => setTimeout(resolveWait, 200))
    }
    if (run?.status !== 'succeeded') {
      const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
      try {
        const failure = db.prepare('SELECT last_error_code, public_runtime_failure_json FROM agent_run WHERE id = ?').get(run?.id)
        assert.fail(JSON.stringify(failure))
      } finally { db.close() }
    }
    const runId = run.id
    assert.equal(requests.get(scenario.id), 2)
    const file = await readFile(join(project, `marker-${scenario.id}.txt`), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    assert.equal(file?.trim() ?? null, scenario.rejected ? null : marker)
    const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
    try {
      const evidence = db.prepare("SELECT result_preview_json FROM agent_run_execution_evidence WHERE agent_run_id = ? AND kind = 'tool_result'").all(runId)
      assert(evidence.length > 0, 'Core omitted tool result')
      assert.equal(evidence.some(row => row.result_preview_json?.includes('invalid justification')), !!scenario.rejected)
    } finally { db.close() }
    results.push({ scenario: scenario.id, strict: scenario.strict ?? 'omitted', requests: 2,
      nativeTool: scenario.rejected ? 'rejected' : 'succeeded', markerWritten: file !== null })
  }
  assert.equal(await readFile(join(home, 'settings.yaml'), 'utf8'), settings, 'Native settings changed')
  console.log(JSON.stringify({ passed: true, runtimeVersion: installation.reportedVersion ?? installation.snapshot?.reportedVersion,
    platform: `${process.platform}-${process.arch}`, controlledEndpoint: true, nativeSettingsUnchanged: true, results }, null, 2))
} finally {
  if (core) await core.stop()
  await new Promise(resolveClose => server.close(resolveClose))
  await removeEphemeralRuntimeCampFilesRoot(data)
  await rm(root, { recursive: true, force: true })
}
