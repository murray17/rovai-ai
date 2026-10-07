// Opt-in integration acceptance against the selected, unmodified Cline CLI.
// Core commands mutate only this newly created private fixture; SQL is read-only.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, copyFile, chmod, writeFile, readFile, access, rm, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startQualificationCore } from '../../../../scripts/lib/qualification-core.mjs'
import { configureProductRuntime } from '../../../../scripts/configure-product-runtime.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from '../../../../scripts/lib/create-configured-camp.mjs'
import { seedCompletedOnboardingForAcceptance } from '../../../../scripts/lib/dev-desktop.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from '../../../../scripts/lib/runtime-camp-files-root.mjs'

const { values } = parseArgs({ options: { root: { type: 'string' }, core: { type: 'string' }, cline: { type: 'string' }, 'settings-source': { type: 'string' }, extended: { type: 'boolean', default: false }, 'lifecycle-only': { type: 'boolean', default: false }, 'extensions-only': { type: 'boolean', default: false } } })
for (const key of ['root', 'core', 'cline', 'settings-source']) assert(values[key], `${key} required`)
const root = resolve(values.root)
await mkdir(root, { mode: 0o700 })
const data = join(root, 'core-data')
const workspace = join(root, 'workspace')
const native = join(root, 'native')
const settings = join(native, 'data/settings')
await mkdir(settings, { recursive: true, mode: 0o700 })
await mkdir(workspace, { mode: 0o700 })
seedCompletedOnboardingForAcceptance(data)
for (const file of ['providers.json', 'models.json']) {
  await copyFile(join(values['settings-source'], file), join(settings, file))
  await chmod(join(settings, file), 0o600)
}
const skillMarker = `HUB_SKILL_${randomUUID()}`
if (values['extensions-only']) {
  const skillRoot = join(native, 'skills/hub-native-acceptance')
  await mkdir(skillRoot, { recursive: true, mode: 0o700 })
  await writeFile(join(skillRoot, 'SKILL.md'), `---\nname: hub-native-acceptance\ndescription: A synthetic isolated Native Hub Skill acceptance fixture.\n---\n\nThe exact fixture marker is ${skillMarker}. Publish it when the synthetic acceptance request asks.\n`, { mode: 0o600 })
}
const save = (file, value) => writeFile(join(root, file), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
await writeFile(join(settings, 'global-settings.json'), JSON.stringify({ telemetryOptOut: true, autoUpdateEnabled: false }), { mode: 0o600 })
const configurationDigest = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const protectedConfigurations = [
  ...['providers.json', 'models.json', 'global-settings.json'].map(file => ({ scope: 'fixture-native-source', file, path: join(settings, file) })),
  ...['providers.json', 'models.json'].map(file => ({ scope: 'authorized-settings-source', file, path: join(values['settings-source'], file) }))
]
for (const configuration of protectedConfigurations) configuration.before = await configurationDigest(configuration.path)
await writeFile(join(data, 'mcp.json'), '{"mcpServers":{}}', { mode: 0o600 })
const secrets = Object.values(JSON.parse(await readFile(join(settings, 'providers.json'), 'utf8')).providers)
  .flatMap(provider => ['apiKey', 'baseUrl'].map(key => provider.settings?.[key])).filter(Boolean)
const redact = text => secrets.reduce((text, secret) => text.replaceAll(secret, '<redacted>'), text)
for (const key of Object.keys(process.env)) if (/^(ROVAI_|CLINE_)/.test(key)) delete process.env[key]
const report = { scope: values['extensions-only'] ? 'extensions' : values['lifecycle-only'] ? 'lifecycle' : values.extended ? 'extended' : 'continuity', selectedCli: resolve(values.cline), turns: [], hosts: [], processes: [], actions: [], approvals: [], privateRoot: root }
let core, threadId
const sleep = ms => new Promise(done => setTimeout(done, ms))
const exists = path => access(path).then(() => true, () => false)
async function start() {
  core = startQualificationCore({ coreExecutable: values.core, dataDirectory: data, workingDirectory: workspace,
    runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(data, 'mcp.json'),
    onNotification(message) {
      if (message.method === 'agent_run.started') report.hosts.push({ run: message.params.agentRunId, host: message.params.hostInstanceId, session: message.params.nativeThreadId, nativeRun: message.params.nativeRunId })
      if (message.method === 'runtime.action') report.actions.push(message.params)
    } })
  report.processes.push({ pid: core.pid })
  await core.request('health.check')
}
async function stop() {
  if (!core) return
  const result = await core.stop()
  await writeFile(join(root, `core-${core.pid}.private.log`), redact(result.stderrTail), { mode: 0o600 })
  delete result.stderrTail
  Object.assign(report.processes.at(-1), result)
  core = undefined
}
function evidence() {
  const source = `import json,sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
print(json.dumps({'bindings':[dict(r) for r in c.execute('select id,agent_id,native_session_id,native_binding_id,native_binding_generation from conversation where native_session_id is not null')], 'sends':[dict(r) for r in c.execute('select id,source_agent_run_id,source_operation_id from camp_message where source_operation_id is not null')], 'runs':[dict(r) for r in c.execute('select id,status,runtime_protocol_version,runtime_model_selection_json from agent_run')], 'usage':[dict(r) for r in c.execute('select * from runtime_usage_run_summary')], 'files':[dict(r) for r in c.execute('select * from agent_run_file_change_projection')]}))`
  const result = spawnSync('python3', ['-c', source, join(data, 'rovai.sqlite')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
async function collect(label, sent, marker, { denyFirst = false, cancel = false } = {}) {
  assert.equal((sent.commandResult ?? sent).status, 'accepted', JSON.stringify(sent))
  const old = new Set(report.turns.map(turn => turn.run.id))
  let run, snapshot, cancellationRequested = false
  const resolved = new Set()
  for (let count = 0; count < 300; count++) {
    snapshot = await core.request('threads.snapshot', { threadId })
    run = snapshot.agentRuns.find(run => !old.has(run.id))
    const actions = snapshot.actions.filter(action => action.agentRunId === run?.id)
    for (const approval of snapshot.approvals.filter(approval => approval.status === 'pending'
      && !resolved.has(approval.id) && actions.some(action => action.id === approval.actionId))) {
      const kind = denyFirst && resolved.size === 0 ? 'deny' : 'allow_once'
      const option = approval.options.find(option => option.kind === kind)
      assert(option, `missing ${kind} option`)
      const resolution = await core.request('action.approvals.resolve', {
        commandId: randomUUID(), threadId, approvalId: approval.id, expectedVersion: approval.version,
        optionId: option.optionId, reason: 'Isolated Cline Native Hub acceptance'
      })
      assert.notEqual(resolution.status, 'rejected', JSON.stringify(resolution))
      report.approvals.push({ label, id: approval.id, actionId: approval.actionId, kind, resolution })
      resolved.add(approval.id)
    }
    if (cancel && !cancellationRequested && run && await exists(join(workspace, 'cancel.started'))) {
      let version = run.version
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = await core.request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId, agentRunId: run.id, expectedVersion: version } })
        if (result.status !== 'rejected') { cancellationRequested = true; break }
        assert.equal(result.code, 'command.version_conflict', JSON.stringify(result))
        version = result.payload.currentVersion
      }
      assert(cancellationRequested, 'bounded cancellation command failed')
    }
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) break
    await sleep(500)
  }
  const messages = snapshot.messages.filter(message => message.sourceAgentRunId === run?.id)
  report.turns.push({ label, run, messages, approvals: [...resolved], actions: snapshot.actions.filter(action => action.agentRunId === run?.id), ...evidence() })
  await save('report.private.json', report)
  console.log(JSON.stringify({ label, run: run?.id, status: run?.status, failure: run?.failure, messages: messages.map(m => m.body) }))
  assert.equal(run?.status, cancel ? 'cancelled' : 'succeeded', `${label} failed`)
  if (denyFirst || cancel) assert(resolved.size > 0, `${label} must exercise real Core approval`)
  if (cancel) { assert(cancellationRequested); return }
  assert.equal(messages.length, 1)
  assert.equal(evidence().sends.filter(send => send.source_agent_run_id === run.id).length, 1, `${label} requires a committed builtin send; missing-send recovery is insufficient`)
  assert(messages[0].body.includes(marker), `${label} missing marker`)
  return messages[0].body
}
async function turn(agent, label, body, marker, options) {
  if (!options?.cancel) body += ' After publishing, finish the native turn with a brief non-empty final response.'
  return collect(label, await core.request('thread.messages.send', { commandId: randomUUID(), threadId,
    content: composerDocumentForAddress({ mode: 'explicit', agentIds: [agent] }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'isolated Native Hub acceptance', completionRole: 'required' } }), marker, options)
}
try {
  await start()
  const runtimeKind = 'cline-cli'
  const current = await core.request('runtime.startup.get', { runtimeKind })
  await core.request('runtime.startup.save', { runtimeKind, expectedRevision: current.revision, configuration: {
    programPath: resolve(values.cline), environment: [{ name: 'CLINE_DIR', value: native }, { name: 'CLINE_DATA_DIR', value: join(native, 'data') }] } })
  const agents = []
  for (const letter of ['A', 'B']) {
    const result = await core.request('members.create', { commandId: randomUUID(), command: {
      displayName: `Hub Tester ${letter}`, teamRole: 'Isolated integration tester', professionalResponsibilities: 'Follow synthetic acceptance requests and publish using the bundled rovai CLI.',
      personalityTraits: ['precise'], workingPrinciples: `Your System identity marker is HUB_PRODUCT_MEMBER_${letter}. Always include your own marker when asked for identity.`, growthTopic: 'Native session continuity.' } })
    assert.equal(result.status, 'applied')
    agents.push(result.payload.agentId)
  }
  report.agents = agents
  const installation = await configureProductRuntime(core.request, runtimeKind, agents)
  report.readiness = { status: installation.snapshot.probeStatus, protocols: installation.snapshot.protocols, version: installation.snapshot.reportedVersion }
  const first = 'Remember HUB_MEMORY_A_950871. Run rovai send --help, then use the bundled rovai send --public-only exactly once to publish your System identity and the memory marker. Do not use any other command or modify files. After publishing, finish the native turn with a brief non-empty final response.'
  const sent = await createConfiguredCampAndSend(core.request, { commandId: randomUUID(), name: 'Native Hub isolated product acceptance', workspace: { projectPath: workspace }, memberAgentIds: agents, defaultLeadAgentId: agents[0], address: { mode: 'explicit', agentIds: [agents[0]] }, body: first, purpose: 'Native Hub product acceptance' })
  threadId = sent.payload.threadId
  report.threadId = threadId
  await collect('first', sent, 'HUB_PRODUCT_MEMBER_A')
  if (!values['lifecycle-only'] && !values['extensions-only']) {
    await turn(agents[1], 'member-b', 'Use the bundled rovai CLI to publish exactly one message with your System identity. Do not modify files.', 'HUB_PRODUCT_MEMBER_B')
    const warm = await turn(agents[0], 'warm', 'Use the bundled rovai CLI to publish exactly once your own System identity and the early memory marker you remember. Do not guess missing memory.', 'HUB_MEMORY_A_950871')
    assert(warm.includes('HUB_PRODUCT_MEMBER_A') && !warm.includes('HUB_PRODUCT_MEMBER_B'))
    await stop()
    await start()
    const cold = await turn(agents[0], 'cold', 'After this cold restart, use the bundled rovai CLI exactly once to publish your System identity and the early memory marker from our first exchange.', 'HUB_MEMORY_A_950871')
    assert(cold.includes('HUB_PRODUCT_MEMBER_A'))
    const bindings = report.turns.filter(turn => ['first', 'warm', 'cold'].includes(turn.label))
      .map(turn => turn.bindings.find(binding => binding.agent_id === agents[0]))
    assert(bindings.every(binding => binding.native_session_id === bindings[0].native_session_id
      && binding.native_binding_id === bindings[0].native_binding_id
      && binding.native_binding_generation === bindings[0].native_binding_generation), 'full Session/Binding must survive warm and cold')
    assert.notEqual(evidence().bindings.find(binding => binding.agent_id === agents[1]).native_session_id, bindings[0].native_session_id)
    assert(evidence().runs.every(run => run.runtime_protocol_version === 'cline-hub-v1'))
    const host = label => report.hosts.find(host => host.run === report.turns.find(turn => turn.label === label).run.id)?.host
    assert(host('first') && host('cold'))
    assert.equal(host('first'), host('warm'))
    assert.notEqual(host('first'), host('cold'))
  }
  if (values.extended || values['lifecycle-only']) {
    if (!values['lifecycle-only']) {
      await turn(agents[0], 'files', 'Use native apply_patch to add hub-file.txt with one line: one. Read it with native read_files. Use native apply_patch to change that line to two. Then publish exactly once with bundled rovai CLI: HUB_FILE_OK. The final bytes must be exactly two without a trailing newline. Do not use shell for editing.', 'HUB_FILE_OK')
      assert.equal(await readFile(join(workspace, 'hub-file.txt'), 'utf8'), 'two')
      const fileRun = report.turns.at(-1).run.id
      const files = evidence().files.find(row => row.agent_run_id === fileRun)
      assert(files && files.file_count === 1 && files.additions >= 1, 'native mutation must produce the shared file projection')
      assert(report.actions.some(action => action.agentRunId === fileRun && action.payload?.runtimeFileOperation?.operationKind === 'read'), 'native read needs a shared file operation')
    }
    const profile = await core.request('members.get', { agentId: agents[0] })
    const updated = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
      agentId: agents[0], expectedVersion: profile.version, adapterKind: 'cline-cli', model: profile.runtimeConfiguration.model,
      permissions: { adapterKind: 'cline-cli', schemaVersion: 1, values: { mode: 'act', auto_approve: 'false' } }
    } })
    assert.equal(updated.status, 'applied', JSON.stringify(updated))
    if (!values['lifecycle-only']) {
      await turn(agents[0], 'allow', 'Use native apply_patch to create allowed.txt with the exact bytes allowed, without a trailing newline. Then publish exactly once using bundled rovai CLI: HUB_ALLOWED. Do not use shell to write files.', 'HUB_ALLOWED')
      assert.equal(await readFile(join(workspace, 'allowed.txt'), 'utf8'), 'allowed')
      assert(report.approvals.some(approval => approval.label === 'allow' && approval.kind === 'allow_once'))
    }
    await turn(agents[0], 'deny', 'Your FIRST tool call must be native apply_patch to create denied.txt containing denied. Expect it to be denied: do not retry or use another tool to write it. After denial, use bundled rovai CLI to publish exactly once HUB_DENIED.', 'HUB_DENIED', { denyFirst: true })
    assert.equal(await exists(join(workspace, 'denied.txt')), false)
    await turn(agents[0], 'cancel', "Run exactly this shell command and wait for it to finish: printf started > cancel.started; sleep 15; printf late > cancelled.txt. Do not publish yet.", null, { cancel: true })
    await sleep(16_000)
    assert.equal(await exists(join(workspace, 'cancelled.txt')), false, 'cancel must stop the owned command before its delayed side effect')
    await turn(agents[0], 'after-cancel', 'After the cancellation, publish exactly once using bundled rovai CLI: HUB_CANCEL_RECOVERED. Include your own System identity.', 'HUB_CANCEL_RECOVERED')
  }
  if (values['extensions-only']) {
    const mcpReceipt = `HUB_MCP_${randomUUID()}`
    const calls = join(root, 'mcp-calls.txt')
    const definition = { mcpServers: { hub_fixture: { command: process.execPath,
      args: [resolve(import.meta.dirname, '../../../../crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')],
      env: { ROVAI_MCP_SMOKE_SOURCE: mcpReceipt, ROVAI_MCP_SMOKE_CALL_MARKER: calls } } } }
    const mutate = async (method, params) => {
      const config = await core.request('mcp.config.get')
      const result = await core.request(method, { expectedConfigDigest: config.configDigest, ...params })
      assert.equal(result.status, 'ok', JSON.stringify(result))
    }
    await mutate('mcp.servers.create', { definitionJson: JSON.stringify(definition) })
    const config = await core.request('mcp.config.get')
    const server = config.servers.find(server => server.name === 'hub_fixture')
    assert(server, 'created MCP server is required')
    await mutate('mcp.servers.setEnabled', { serverId: server.serverId, enabled: true })
    await mutate('mcp.assignments.set', { serverId: server.serverId, agentId: agents[0], assigned: true })
    await turn(agents[0], 'mcp', 'Actually invoke MCP server hub_fixture tool echo once with text native-hub. Do not simulate it with shell. Then publish exactly one bundled rovai CLI message with its complete actual response.', `${mcpReceipt}:native-hub`)
    report.mcpCallCount = (await readFile(calls, 'utf8')).trim().split('\n').length
    assert.equal(report.mcpCallCount, 1, 'exactly one real tools/call receipt required')
    await turn(agents[0], 'skill', 'Load the native skill hub-native-acceptance through the native skills tool. Read its exact private fixture marker, then publish that marker once using bundled rovai CLI. Do not guess the marker.', skillMarker)
    report.skillMarkerObserved = true
  }
  report.passed = true
} catch (error) {
  report.error = redact(error.stack ?? String(error))
  process.exitCode = 1
} finally {
  await stop()
  report.hostTempRemaining = await readdir(join(data, 'runtime/cline-hub/hosts')).catch(() => [])
  if (report.hostTempRemaining.length) { report.passed = false; report.error ??= 'owned Host temp was not reaped'; process.exitCode = 1 }
  report.runtimeFilesRemoved = await removeEphemeralRuntimeCampFilesRoot(data, { temporaryDirectory: root })
  report.configurationIntegrity = await Promise.all(protectedConfigurations.map(async ({ scope, file, path, before }) => {
    const after = await configurationDigest(path)
    return { scope, file, before, after, unchanged: before === after }
  }))
  if (report.configurationIntegrity.some(configuration => !configuration.unchanged)) {
    report.passed = false; report.error ??= 'source native configuration changed'; process.exitCode = 1
  }
  await rm(join(settings, 'providers.json'), { force: true })
  report.privateProviderCopyRemoved = true
  await save('report.private.json', report)
  console.log(JSON.stringify({ root, passed: report.passed ?? false, error: report.error, turns: report.turns.length }))
}
