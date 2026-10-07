// Opt-in real-Provider experiment through an unmodified, isolated Rovai Core.
// All mutations use normal Core commands; SQLite is opened read-only for evidence.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startQualificationCore } from '../../../../scripts/lib/qualification-core.mjs'
import { configureProductRuntime } from '../../../../scripts/configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from '../../../../scripts/lib/create-configured-camp.mjs'
import { seedCompletedOnboardingForAcceptance } from '../../../../scripts/lib/dev-desktop.mjs'

const { values } = parseArgs({ options: {
  root: { type: 'string' }, core: { type: 'string' }, 'settings-source': { type: 'string' },
  'case-name': { type: 'string', default: 'product' }, rounds: { type: 'string', default: '12' },
} })
for (const key of ['root', 'core', 'settings-source']) assert.ok(values[key], `${key} required`)
const root = resolve(values.root)
const fixtures = import.meta.dirname
const caseRoot = join(root, 'cases', values['case-name'])
await mkdir(caseRoot, { mode: 0o700 })
const dataDir = join(caseRoot, 'user-data')
const workspace = join(caseRoot, 'workspace')
const native = join(caseRoot, 'home/.cline')
const settings = join(native, 'data/settings')
await mkdir(settings, { recursive: true })
await mkdir(workspace)
seedCompletedOnboardingForAcceptance(dataDir)
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const quote = text => `'${text.replaceAll("'", "'\\''")}'`
for (const name of ['providers.json', 'models.json']) {
  await copyFile(join(values['settings-source'], name), join(settings, name))
  await chmod(join(settings, name), 0o600)
}
await save(join(settings, 'global-settings.json'), { telemetryOptOut: true, autoUpdateEnabled: false })
const providers = JSON.parse(await readFile(join(settings, 'providers.json'), 'utf8'))
const secrets = Object.values(providers.providers['openai-compatible'].settings).filter(v => typeof v === 'string' && v.length > 8)
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '<redacted>'), value)
const skill = join(workspace, '.agents/skills/shim72-native')
await mkdir(skill, { recursive: true })
await writeFile(join(skill, 'SKILL.md'), '---\nname: shim72-native\ndescription: Read the isolated native skill code.\n---\nThe skill code is SHIM72_SKILL_BLUE.\n')
const plugin = join(native, 'plugins/shim72-witness')
await mkdir(plugin, { recursive: true })
await copyFile(join(fixtures, 'compaction_witness.mjs'), join(plugin, 'witness.js'))
await save(join(plugin, 'package.json'), { name: 'shim72-readonly-witness', type: 'module', cline: { plugins: [{ paths: [join(plugin, 'witness.js')] }] } })
const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim()
await save(join(settings, 'mcp.json'), { mcpServers: { shim72: { command: python, args: [join(fixtures, 'compaction_mcp_server.py'), join(caseRoot, 'mcp-receipts.jsonl')] } } })
await save(join(dataDir, 'mcp.json'), { mcpServers: {} })
const launcher = join(caseRoot, 'rovai-cline-acp-experimental')
await copyFile(join(fixtures, 'compaction_acp_shim.mjs'), join(caseRoot, 'shim.mjs'))
await writeFile(launcher, `#!/bin/sh\nexec ${quote(join(root, 'install/node_modules/@oven/bun-darwin-aarch64/bin/bun'))} ${quote(join(caseRoot, 'shim.mjs'))} "$@"\n`, { mode: 0o700 })
const report = { kind: 'isolated_product_compaction_shim', turns: [], processes: [], compactionEvents: [],
  executableSha256: sha(await readFile(values.core)), shimSha256: sha(await readFile(join(caseRoot, 'shim.mjs'))) }
let core
let threadId
let agentId
const persist = () => save(join(caseRoot, 'report.json'), report)
const sleep = ms => new Promise(done => setTimeout(done, ms))

async function start() {
  core = startQualificationCore({ coreExecutable: values.core, dataDirectory: dataDir, workingDirectory: workspace,
    runtimeCacheDirectory: join(caseRoot, 'runtime-cache'), mcpConfigPath: join(dataDir, 'mcp.json'),
    onNotification(message) {
      if (message.method === 'runtime.compaction.display') report.compactionEvents.push(message)
    } })
  report.processes.push({ pid: core.pid, startedAt: new Date().toISOString() })
  await core.request('health.check')
}

async function stop() {
  if (!core) return
  const result = await core.stop()
  await writeFile(join(caseRoot, `core-${core.pid}.private.log`), redact(result.stderrTail), { mode: 0o600 })
  delete result.stderrTail
  Object.assign(report.processes.at(-1), result, { stoppedAt: new Date().toISOString() })
  core = undefined
  await persist()
}

function databaseEvidence() {
  const result = spawnSync(python, ['-c', `import json,sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); c.row_factory=sqlite3.Row
cols=['id','native_session_id','native_binding_id','native_binding_generation','native_adapter_installation_id','native_context_revision']
present={r[1] for r in c.execute('pragma table_info(conversation)')}; cols=[k for k in cols if k in present]
print(json.dumps({'bindings':[dict(r) for r in c.execute('select '+','.join(cols)+' from conversation where native_session_id is not null')]}))
`, join(dataDir, 'rovai.sqlite')], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Read-only binding evidence failed')
  return JSON.parse(result.stdout)
}

async function collect(label, input, sent) {
  const command = sent.commandResult ?? sent
  assert.equal(command.status, 'accepted', JSON.stringify(command))
  // Admission may return before the scheduler allocates a Run. This isolated
  // Camp has one member and one outstanding input, so observe its next Run.
  const previousRunIds = new Set(report.turns.map(item => item.run.id))
  let runId = command.payload.agentRunIds?.[0] ?? command.payload.agentRunId
  const deadline = Date.now() + 300_000
  let snapshot
  let run
  do {
    snapshot = await core.request('camps.snapshot', { threadId })
    if (!runId) {
      const candidates = snapshot.agentRuns.filter(item => !previousRunIds.has(item.id))
      assert.ok(candidates.length <= 1, 'Unexpected concurrent Run in isolated Camp')
      runId = candidates[0]?.id
    }
    run = snapshot.agentRuns.find(item => item.id === runId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) break
    await sleep(500)
  } while (Date.now() < deadline)
  const messages = snapshot.messages.filter(item => item.authorType === 'agent' && item.sourceAgentRunId === runId)
    .map(({ id, body, authorId, sourceAgentRunId }) => ({ id, body, authorId, sourceAgentRunId }))
  const witnessRows = (await readFile(join(caseRoot, 'request-witness.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
  const since = report.turns.reduce((total, item) => total + item.witness.length, 0)
  const witness = witnessRows.slice(since)
  assert.ok(witness.some(item => item.kind === 'readonly_before_model'), 'Missing durable request witness')
  const item = { label, inputBytes: Buffer.byteLength(input), inputSha256: sha(input), run, messages, witness, ...databaseEvidence() }
  report.turns.push(item)
  await persist()
  console.log(JSON.stringify({ label, runId, status: run?.status, messages: messages.map(item => item.body.slice(0, 160)), bindings: item.bindings, compactionEventCount: report.compactionEvents.length }))
  assert.equal(run?.status, 'succeeded', `${label}: Runtime did not succeed`)
  assert.equal(messages.length, 1, `${label}: expected exactly one public send`)
  return item
}

async function turn(label, input) {
  const sent = await core.request('thread.messages.send', { commandId: randomUUID(), threadId,
    content: { version: 2, segments: [{ kind: 'text', text: input }] }, sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Isolated compaction experiment', completionRole: 'required' } })
  return collect(label, input, sent)
}

function block(index) {
  const data = Array.from({ length: 350 }, (_, item) => createHash('sha512').update(`rovai-cline-shim72:${index}:${item}`).digest('base64')).join('\n')
  return `Context test data block ${index}. Keep the early memory marker. Do not repeat these records or request a summary. Use the bundled CLI exactly once: rovai send --public-only --body BLOCK_${String(index).padStart(2, '0')}_ACK. Then finish.\n${data}`
}

try {
  await start()
  const runtimeKind = 'cline-cli'
  const environment = {
    HOME: join(caseRoot, 'home'), CLINE_DIR: native, CLINE_DATA_DIR: join(native, 'data'),
    CLINE_PROVIDER_SETTINGS_PATH: join(settings, 'providers.json'), CLINE_GLOBAL_SETTINGS_PATH: join(settings, 'global-settings.json'),
    CLINE_MCP_SETTINGS_PATH: join(settings, 'mcp.json'), CLINE_PROVIDER: 'openai-compatible', CLINE_MODEL: 'gpt-6-sol',
    CLINE_WRAPPER_PATH: join(root, 'install/node_modules/cline/bin/cline'), CLINE_SESSION_BACKEND_MODE: 'local', DO_NOT_TRACK: '1',
    CLINE_ACP_EXPERIMENT_SOURCE_ROOT: join(root, 'upstream'), CLINE_ACP_EXPERIMENT_VARIANT: 'native-settings',
    CLINE_ACP_EXPERIMENT_CONFIG_LOG: join(caseRoot, 'config-witness.jsonl'),
    CLINE_ACP_EXPERIMENT_WITNESS_LOG: join(caseRoot, 'request-witness.jsonl'),
  }
  const current = await core.request('runtime.startup.get', { runtimeKind })
  await core.request('runtime.startup.save', { runtimeKind, expectedRevision: current.revision,
    configuration: { programPath: launcher, environment: Object.entries(environment).map(([name, value]) => ({ name, value })) } })
  const created = await core.request('members.create', { commandId: randomUUID(), command: {
    displayName: 'Shim72 Tester', teamRole: 'Isolated compaction test member', professionalResponsibilities: 'Follow synthetic test requests; use the bundled CLI for one public send each Run.',
    personalityTraits: ['precise'], workingPrinciples: 'Your system identity marker is SHIM72_SYSTEM_ALPHA. Return it when asked for system identity.', growthTopic: 'Preserve continuity across native compaction.' } })
  assert.equal(created.status, 'applied', JSON.stringify(created))
  agentId = created.payload.agentId
  report.agentId = agentId
  await configureProductRuntime(core.request, runtimeKind, [agentId])
  const profile = await core.request('members.get', { agentId })
  const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
    agentId, expectedVersion: profile.version, adapterKind: runtimeKind,
    model: profile.runtimeConfiguration.model,
    permissions: { ...profile.runtimeConfiguration.permissions, values: { ...profile.runtimeConfiguration.permissions.values, mode: 'act', auto_approve: 'true' } } } })
  assert.equal(configured.status, 'applied', JSON.stringify(configured))
  const first = 'Remember the early memory marker SHIM72_MEMORY_759cf7dba031. Use the bundled CLI to publish exactly one message containing your system identity and the memory marker, then finish.'
  const sent = await createConfiguredCampAndSend(core.request, { commandId: randomUUID(), name: 'Shim72 isolated native compaction',
    workspace: { projectPath: workspace }, memberAgentIds: [agentId], defaultLeadAgentId: agentId, body: first, purpose: 'Isolated compaction experiment' })
  threadId = sent.payload.threadId
  report.threadId = threadId
  const initial = await collect('first', first, sent)
  assert.ok(initial.messages[0].body.includes('SHIM72_SYSTEM_ALPHA'))
  await turn('capabilities-before', 'Read .agents/skills/shim72-native/SKILL.md, call MCP shim_receipt exactly once with phase before. Use the bundled CLI once to publish the skill code and actual receipt, then finish.')
  let firstCompactionBlock
  for (let index = 1; index <= Number(values.rounds); index++) {
    await turn(`block-${String(index).padStart(2, '0')}`, block(index))
    if (report.compactionEvents.some(event => event.params.payload.phase === 'completed')) firstCompactionBlock ??= index
    if (firstCompactionBlock && index >= firstCompactionBlock + 2) break
  }
  await turn('capabilities-after', 'Read the local shim72-native Skill and call MCP shim_receipt once with phase after. Use the bundled CLI exactly once to publish your system identity, early memory marker, skill code and actual receipt. Then finish.')
  await stop()
  await start()
  await turn('cold', 'Read the local shim72-native Skill and call MCP shim_receipt once with phase cold. Use the bundled CLI exactly once to publish your system identity, early memory marker, skill code and actual receipt. Then finish.')
} catch (error) {
  report.fatalError = redact(error.stack ?? String(error))
  console.log(JSON.stringify({ fatalError: report.fatalError }))
  process.exitCode = 1
} finally {
  await stop()
  await persist()
}
