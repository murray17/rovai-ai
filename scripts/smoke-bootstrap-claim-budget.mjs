// Real OpenCode acceptance. All Core data, Skills, MCP and project files are isolated.
// Usage: node scripts/smoke-bootstrap-claim-budget.mjs <empty-absolute-root> <core-executable> [--baseline]
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'

const [fixture, executable, mode] = process.argv.slice(2)
assert.ok(isAbsolute(fixture) && isAbsolute(executable))
assert.deepEqual(await readdir(fixture), [], 'Require a new empty fixture directory')
const baseline = mode === '--baseline'
const data = join(fixture, 'core'), project = join(fixture, 'project')
await mkdir(data); await mkdir(project)
const report = { baseline, coreExecutable: resolve(executable), startedAt: new Date().toISOString(), status: 'running' }
console.error(`Automatic acceptance: Core=${executable}; data=${data}; skills=${join(data, 'managed-skill-library')}; MCP=${join(data, 'mcp.json')}`)
let core, database
const wait = async (check, label) => {
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out: ${label}`)
}
try {
  core = startQualificationCore({ coreExecutable: executable, dataDirectory: data, workingDirectory: project,
    runtimeCacheDirectory: join(fixture, 'cache'), mcpConfigPath: join(data, 'mcp.json') })
  await core.request('health.check')
  const profile = await core.request('members.get', { agentId: 'agent_1' })
  const prefix = '处理明确的隔离验收指令。以下是无须解读的容量填充：'
  const duties = prefix + '😀'.repeat((baseline ? 10_000 : 30_000) - Array.from(prefix).length)
  report.responsibilityScalars = Array.from(duties).length
  report.responsibilitiesSha256 = createHash('sha256').update(duties).digest('hex')
  const saved = await core.request('members.update', { commandId: randomUUID(), command: {
    agentId: 'agent_1', expectedVersion: profile.version, displayName: profile.displayName,
    teamRole: '容量验收', professionalResponsibilities: duties,
    personalityTraits: [], workingPrinciples: '只操作当前验收目录，按消息要求完成并公开报告。', growthTopic: '' } })
  assert.equal(saved.status, 'applied')
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  await core.request('runtime.product.check', { runtimeKind: 'opencode-cli' })
  const installation = (await core.request('runtime.installations.list')).find(item =>
    item.adapterKind === 'opencode-cli' && item.installationClass === 'managed_default' && item.authScope === 'default' && item.memberRuntimeDefaults)
  assert.ok(installation, 'OpenCode with saved defaults is required')
  const current = await core.request('members.get', { agentId: 'agent_1' })
  const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
    agentId: 'agent_1', expectedVersion: current.version, adapterKind: 'opencode-cli',
    model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions } })
  assert.equal(configured.status, 'applied')
  report.model = installation.memberRuntimeDefaults.model
  const created = await core.request('threads.create', { commandId: randomUUID(), name: 'Bootstrap capacity acceptance',
    workspace: { projectPath: project }, memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
  assert.equal(created.status, 'applied')
  const threadId = created.payload.threadId
  database = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  const runs = () => database.prepare('SELECT id,status,last_error_code FROM agent_run WHERE camp_id=? ORDER BY created_at,id').all(threadId)
  const waitRun = index => wait(() => {
    const row = runs()[index]
    return row && ['succeeded', 'failed', 'cancelled'].includes(row.status) ? row : null
  }, `Run ${index}`)
  const send = body => core.request('thread.messages.send', { commandId: randomUUID(), threadId,
    content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_1'] }, body),
    sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Bootstrap full-budget regression', completionRole: 'required' } })
  await writeFile(join(project, 'hold.mjs'), `import {access,writeFile} from 'node:fs/promises';\nawait writeFile('hold.ready','ready');\nwhile(true){try{await access('release');break}catch{await new Promise(r=>setTimeout(r,100))}}\nconsole.log('HOLD_COMPLETE');\n`)
  console.error('Establishing an accepted native Session before holding the next turn')
  await send('这是隔离验收预热。请用 rovai send --public-only 报告 WARMUP_OK，然后结束本轮，不执行其他任务。')
  assert.equal((await waitRun(0)).status, 'succeeded')
  await send('这是隔离容量验收。请只执行 node ./hold.mjs（不要修改脚本），等待它正常结束后，用 rovai send --public-only 报告 HOLD_COMPLETE，然后结束本轮。不要联系其他队员。')
  await wait(async () => { try { await access(join(project, 'hold.ready')); return true } catch { return false } }, 'controlled first Run')
  const binding = database.prepare('SELECT native_session_id,native_binding_generation,native_charter_digest FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_1')
  assert.ok(binding.native_session_id && binding.native_charter_digest)
  const memory = await core.request('memory.create', { commandId: randomUUID(), command: {
    scope: 'hearth', kind: 'preference', body: 'Bootstrap 容量验收期间按公开消息顺序处理。', retrievalKeys: ['bootstrap budget'],
    companionAgentId: null, relationshipAgentIds: [], direction: null, directedActorAgentId: null, reviewAfter: null } })
  assert.equal(memory.status, 'applied', JSON.stringify(memory))
  for (const number of [1, 2]) {
    const body = `这是隔离容量验收消息 ${number}。请忽略下方容量填充，只把 BATCH_${number}_OK 写入当前目录 batch-${number}.txt，然后用 rovai send --public-only 报告 BATCH_${number}_OK。不要联系其他队员。\n容量填充：\n` + '中'.repeat(40_000)
    const sent = await send(body)
    assert.equal(sent.commandResult.status, 'accepted')
  }
  assert.equal(database.prepare("SELECT count(*) AS count FROM camp_message_delivery WHERE camp_id=? AND status='waiting'").get(threadId).count, 2)
  await writeFile(join(project, 'release'), 'release')
  assert.equal((await waitRun(1)).status, 'succeeded')
  const second = await waitRun(2)
  const inputCount = run => database.prepare('SELECT count(*) AS count FROM agent_run_input WHERE agent_run_id=?').get(run.id).count
  if (baseline) {
    assert.equal(inputCount(second), 2)
    assert.equal(second.status, 'failed')
    assert.equal(second.last_error_code, 'context_payload_too_large')
    report.reproducedOriginalFailure = true
  } else {
    assert.equal(second.status, 'succeeded', second.last_error_code)
    assert.equal(inputCount(second), 1)
    const third = await waitRun(3)
    assert.equal(third.status, 'succeeded', third.last_error_code)
    assert.equal(inputCount(third), 1)
    for (const number of [1, 2]) assert.equal((await readFile(join(project, `batch-${number}.txt`), 'utf8')).trim(), `BATCH_${number}_OK`)
    const resumed = database.prepare('SELECT native_session_id,native_binding_generation FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_1')
    assert.equal(resumed.native_session_id, binding.native_session_id)
    assert.equal(resumed.native_binding_generation, binding.native_binding_generation)
    report.nativeSessionPreserved = true
    report.claims = []
    for (const run of [second, third]) {
      const row = database.prepare('SELECT context_json FROM agent_run_claim_context WHERE agent_run_id=?').get(run.id)
      const claim = JSON.parse(row.context_json)
      assert.equal(claim.memberIdentity.professionalResponsibilities, duties)
      await writeFile(join(fixture, `${run.id}-claim.json`), row.context_json)
      report.claims.push({ runId: run.id, bytes: Buffer.byteLength(row.context_json), sha256: createHash('sha256').update(row.context_json).digest('hex') })
    }
    report.deliveries = database.prepare('SELECT id,agent_run_id,status,native_binding_id,native_binding_generation,runtime_payload_digest FROM runtime_input_delivery WHERE agent_run_id IN (SELECT id FROM agent_run WHERE camp_id=?)').all(threadId)

    report.manifests = database.prepare('SELECT context_manifest_version,context_delivery_profile_version FROM context_manifest WHERE agent_run_id IN (SELECT id FROM agent_run WHERE camp_id=?) ORDER BY created_at').all(threadId)
  }
  report.runs = runs().map(run => ({ ...run, inputCount: inputCount(run) }))
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1
} finally {
  await writeFile(join(project, 'release'), 'release')
  database?.close()
  if (core) report.coreExit = await core.stop()
  report.finishedAt = new Date().toISOString()
  await writeFile(join(fixture, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
