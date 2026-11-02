// Real model acceptance: isolated Core, full identity, CLI transport, and native resume.
// Usage: node scripts/smoke-member-routing.mjs <empty-absolute-fixture-root> [adapter-kind] [responsibility-scalars] [core-executable]
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { glob, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'

const source = resolve(import.meta.dirname, '..')
const fixture = process.argv[2]
const adapterKind = process.argv[3] ?? 'opencode-cli'
const responsibilityScalars = Number(process.argv[4] ?? 30_000)
const coreExecutable = resolve(process.argv[5] ?? join(source, 'target/debug/rovai-core'))
assert.ok([10_000, 30_000].includes(responsibilityScalars))
assert.ok(fixture && isAbsolute(fixture), 'Supply an empty absolute fixture root')
assert.deepEqual(await readdir(fixture), [], 'Never reuse an existing data directory')
const data = join(fixture, 'core'), project = join(fixture, 'project')
await mkdir(data); await mkdir(project)
console.error(`Automatic acceptance: Core=${coreExecutable}; data=${data}; skills=${join(data, 'managed-skill-library')}; MCP=${join(data, 'mcp.json')}`)
const markers = Object.fromEntries(['begin', 'middle', 'end'].map(key => [key, `${key.toUpperCase()}_${randomUUID()}`]))
const filler = '😀'.repeat(responsibilityScalars)
const scalarLength = value => Array.from(value).length
const prefix = `${markers.begin}\n中文与 JSON 转义："\\\n${Array.from(filler).slice(0, responsibilityScalars / 2 - 200).join('')}\n${markers.middle}\n`
const duties = prefix + Array.from(filler).slice(0, responsibilityScalars - scalarLength(prefix) - scalarLength(markers.end) - 1).join('') + `\n${markers.end}`
assert.equal(scalarLength(duties), responsibilityScalars)
const hash = value => createHash('sha256').update(value).digest('hex')
const report = { adapterKind, startedAt: new Date().toISOString(), scalars: scalarLength(duties), utf8Bytes: Buffer.byteLength(duties), responsibilitiesSha256: hash(duties), status: 'running' }
const notifications = []
let database, core
const startCore = () => startQualificationCore({ coreExecutable, dataDirectory: data,
  workingDirectory: project, runtimeCacheDirectory: join(fixture, 'cache'), mcpConfigPath: join(data, 'mcp.json'),
  onNotification: message => notifications.push(message) })
try {
  core = startCore()
  await core.request('health.check')
  for (const agentId of ['agent_1', 'agent_2']) {
    const profile = await core.request('members.get', { agentId })
    const command = { agentId, expectedVersion: profile.version, displayName: profile.displayName,
      teamRole: agentId === 'agent_1' ? '执行验收' : '资料读取验收', professionalResponsibilities: duties,
      personalityTraits: [], workingPrinciples: '按明确测试要求操作，不修改验收脚本。', growthTopic: '' }
    const result = await core.request('members.update', { commandId: randomUUID(), command })
    assert.equal(result.status, 'applied')
    assert.equal((await core.request('members.get', { agentId })).professionalResponsibilities, duties)
  }
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  console.error('Profiles saved; checking the selected Runtime')
  await core.request('runtime.product.check', { runtimeKind: adapterKind })
  const installation = (await core.request('runtime.installations.list')).find(candidate =>
    candidate.adapterKind === adapterKind && candidate.installationClass === 'managed_default'
      && candidate.authScope === 'default' && candidate.memberRuntimeDefaults)
  assert.ok(installation, 'Managed Runtime installation and defaults must be available')
  const current = await core.request('members.get', { agentId: 'agent_1' })
  const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
    agentId: 'agent_1', expectedVersion: current.version, adapterKind,
    model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions } })
  assert.equal(configured.status, 'applied')
  const resolved = await core.request('members.get', { agentId: 'agent_1' })
  assert.equal(resolved.runtimeConfiguration.adapterKind, adapterKind)
  assert.deepEqual(resolved.runtimeReadiness.blockers, [])
  // Current readiness is advisory; execution performs the authoritative check.
  assert.equal(resolved.runtimeReadiness.status, 'installed_unverified')
  report.readiness = resolved.runtimeReadiness.status
  report.runtimeVersion = installation.snapshot?.reportedVersion ?? null
  report.model = (await core.request('members.get', { agentId: 'agent_1' })).runtimeConfiguration.model
  const created = await core.request('threads.create', { commandId: randomUUID(), name: 'Long identity acceptance',
    workspace: { projectPath: project }, memberAgentIds: ['agent_1', 'agent_2'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
  assert.equal(created.status, 'applied')
  const threadId = created.payload.threadId
  database = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  await writeFile(join(project, 'verify-cli.mjs'), `import { execFileSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst invoke = args => JSON.parse(execFileSync(process.env.ROVAI_AGENT_CLI, args, {encoding:'utf8',maxBuffer:2*1024*1024}));\nwriteFileSync('members-list.json', JSON.stringify(invoke(['member','list'])));\nwriteFileSync('peer-identity.json', JSON.stringify(invoke(['member','get','--agent-id','agent_2'])));\nconsole.log('CLI_READ_COMPLETE');\n`)
  const send = body => core.request('thread.messages.send', { commandId: randomUUID(), threadId,
    content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_1'] }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Verify long member identity and native resume', completionRole: 'required' } })
  const firstPrompt = `这是隔离验收。请直接完成两步：1. 从你当前 MEMBER_IDENTITY 的专业职责中找出 BEGIN_、MIDDLE_、END_ 开头的三个完整标记，写入当前目录 identity-markers.json，键为 begin、middle、end；不要通过 member get 读取自己。2. 使用原生终端执行 node ./verify-cli.mjs（不要修改脚本），然后公开报告完成。只操作当前验收目录，不联系其他队员。`
  console.error('Starting the first real Run with a full long identity')
  await send(firstPrompt)
  const first = await waitRun(0)
  assert.equal(first.status, 'succeeded', first.last_error_code)
  assert.deepEqual(JSON.parse(await readFile(join(project, 'identity-markers.json'), 'utf8')), markers)
  const list = JSON.parse(await readFile(join(project, 'members-list.json'), 'utf8'))
  for (const item of list.items) assert.deepEqual(Object.keys(item).sort(), ['agentId', 'displayName', 'isDefaultLead', 'teamRole'])
  const peer = JSON.parse(await readFile(join(project, 'peer-identity.json'), 'utf8'))
  assert.equal(peer.professionalResponsibilities, duties)
  const binding = database.prepare('SELECT native_session_id,native_binding_generation FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_1')
  assert.ok(binding.native_session_id)
  const manifests = () => database.prepare('SELECT context_manifest_version,formatter_version,context_delivery_profile_version,collaboration_state_included FROM context_manifest WHERE agent_run_id IN (SELECT id FROM agent_run WHERE camp_id=?) ORDER BY created_at').all(threadId)
  assert.equal(manifests()[0].context_manifest_version, 43)
  const claim = database.prepare('SELECT context_json FROM agent_run_claim_context WHERE agent_run_id=?').get(first.id)
  const frozen = JSON.parse(claim.context_json)
  assert.equal(frozen.memberIdentity.professionalResponsibilities, duties)
  await writeFile(join(fixture, 'first-claim.json'), claim.context_json)
  report.frozenClaimEvidence = { runId: first.id, bytes: Buffer.byteLength(claim.context_json), sha256: hash(claim.context_json), responsibilitiesSha256: hash(frozen.memberIdentity.professionalResponsibilities) }
  report.deliveries = database.prepare('SELECT id,agent_run_id,status,native_binding_id,native_binding_generation,runtime_payload_digest FROM runtime_input_delivery WHERE agent_run_id=?').all(first.id)
  assert.ok(report.deliveries.some(delivery => delivery.status === 'accepted'))
  if (adapterKind === 'cline-cli') {
    const bindings = []
    for await (const path of glob('**/config/rules/rovai-managed-bootstrap.md', { cwd: fixture })) {
      const rule = await readFile(join(fixture, path), 'utf8')
      if (!rule.includes('[MEMBER_IDENTITY]')) continue
      const identity = JSON.parse(rule.split('[MEMBER_IDENTITY]\n')[1].split('\n[/MEMBER_IDENTITY]')[0])
      assert.equal(identity.professionalResponsibilities, duties)
      bindings.push({ path, bytes: Buffer.byteLength(rule), sha256: hash(rule), responsibilitiesSha256: hash(identity.professionalResponsibilities) })
    }
    assert.ok(bindings.length, 'The native Rule must retain the complete bound responsibilities')
    report.nativeRuleEvidence = bindings
  }

  if (adapterKind === 'opencode-cli') {
    const native = execFileSync('opencode', ['session', 'export', binding.native_session_id], { cwd: project, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000 })
    await writeFile(join(fixture, 'native-session.json'), native)
    const payloads = []
    const visit = value => {
      if (!value || typeof value !== 'object') return
      if (typeof value.text === 'string' && value.text.includes('[MEMBER_IDENTITY]\n')) payloads.push(value.text)
      for (const child of Object.values(value)) if (typeof child === 'object') visit(child)
    }
    visit(JSON.parse(native))
    const payload = payloads.find(text => report.deliveries.some(delivery => delivery.runtime_payload_digest === `sha256:${hash(text)}`))
    assert.ok(payload, 'Native user input must match the accepted runtime payload digest in full')
    const identity = JSON.parse(payload.split('[MEMBER_IDENTITY]\n')[1].split('\n[/MEMBER_IDENTITY]')[0])
    assert.equal(identity.professionalResponsibilities, duties)
    const bootstrapEnd = Math.max(...['[/MEMORY_ENTRYPOINT]', '[/ROVAI_PLATFORM_SKILLS]'].map(marker => payload.indexOf(marker) < 0 ? 0 : payload.indexOf(marker) + marker.length))
    const bootstrap = payload.slice(payload.indexOf('[SESSION_CHARTER]'), bootstrapEnd)
    await writeFile(join(fixture, 'first-runtime-payload.txt'), payload)
    await writeFile(join(fixture, 'first-bootstrap.txt'), bootstrap)
    report.nativePayloadEvidence = { bytes: Buffer.byteLength(payload), sha256: hash(payload), bootstrapBytes: Buffer.byteLength(bootstrap), bootstrapSha256: hash(bootstrap), responsibilitiesSha256: hash(identity.professionalResponsibilities) }
  }
  // Editing only a peer's details must not force roster redelivery or reset the native session.
  const peerProfile = await core.request('members.get', { agentId: 'agent_2' })
  await core.request('members.update', { commandId: randomUUID(), command: { agentId: 'agent_2', expectedVersion: peerProfile.version,
    ...Object.fromEntries(['displayName','teamRole','personalityTraits','workingPrinciples','growthTopic'].map(key => [key, peerProfile[key]])),
    professionalResponsibilities: duties.replace('😀', '界') } })
  console.error('First Run verified; checking native resume after editing only peer responsibilities')
  await send('继续刚才的隔离验收。请只把文本 RESUME_OK 写入当前目录 resume.txt，并公开报告完成。')
  const second = await waitRun(1)
  assert.equal(second.status, 'succeeded', second.last_error_code)
  assert.equal((await readFile(join(project, 'resume.txt'), 'utf8')).trim(), 'RESUME_OK')
  assert.deepEqual(database.prepare('SELECT native_session_id,native_binding_generation FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_1'), binding)
  assert.equal(manifests()[1].collaboration_state_included, 0)
  console.error('Warm resume verified; restarting only the isolated Core for cold resume')
  database.close(); database = null
  report.warmCoreExit = await core.stop(); core = null
  core = startCore()
  await core.request('health.check')
  database = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  await send('这是 Core 重启后的隔离验收。请从 MEMBER_IDENTITY 的专业职责中读取 BEGIN_、MIDDLE_、END_ 三个完整标记，写入 cold-identity-markers.json，键为 begin、middle、end；不调用 member get。然后把 COLD_RESUME_OK 写入 cold-resume.txt，并公开报告完成。')
  const third = await waitRun(2)
  assert.equal(third.status, 'succeeded', third.last_error_code)
  assert.deepEqual(JSON.parse(await readFile(join(project, 'cold-identity-markers.json'), 'utf8')), markers)
  assert.equal((await readFile(join(project, 'cold-resume.txt'), 'utf8')).trim(), 'COLD_RESUME_OK')
  assert.deepEqual(database.prepare('SELECT native_session_id,native_binding_generation FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_1'), binding)
  report.nativeSessionId = binding.native_session_id
  report.observedRuntime = database.prepare('SELECT runtime_adapter_kind,runtime_reported_version,runtime_observed_model_id FROM agent_run WHERE camp_id=? ORDER BY created_at').all(threadId)
  assert.ok(report.observedRuntime.every(run => run.runtime_adapter_kind === adapterKind))
  if (adapterKind === 'codex-cli') {
    // Audit only this fixture's native session, never unrelated model transcripts.
    const sessionRoot = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
    const observed = []
    const nativeModels = new Set()
    for await (const path of glob(`**/*${binding.native_session_id}.jsonl`, { cwd: sessionRoot })) {
      for (const line of (await readFile(join(sessionRoot, path), 'utf8')).trim().split('\n')) {
        const record = JSON.parse(line)
        if (record.type === 'turn_context' && typeof record.payload?.model === 'string') nativeModels.add(record.payload.model)
        if (record.type !== 'response_item' || record.payload?.role !== 'developer') continue
        for (const part of record.payload.content ?? []) {
          const text = part.text ?? ''
          if (!text.includes('[MEMBER_IDENTITY]\n')) continue
          const identity = JSON.parse(text.split('[MEMBER_IDENTITY]\n')[1].split('\n[/MEMBER_IDENTITY]')[0])
          assert.equal(identity.professionalResponsibilities, duties)
          observed.push({ instructionsBytes: Buffer.byteLength(text), responsibilitiesSha256: hash(identity.professionalResponsibilities) })
        }
      }
    }
    assert.ok(observed.length > 0, 'Native transcript must contain the full injected identity')
    report.nativeIdentityEvidence = observed
    report.nativeModels = [...nativeModels]
  }
  Object.assign(report, { status: 'passed', runIds: [first.id, second.id, third.id], nativeSessionPreserved: true,
    coldResumeAfterCoreRestart: true, memberListFields: 4,
    peerGetSha256: hash(peer.professionalResponsibilities), identityMarkersPresent: true, manifests: manifests() })
  async function waitRun(previousCount) {
    const deadline = Date.now() + 600_000
    while (Date.now() < deadline) {
      const runs = database.prepare('SELECT id,status,last_error_code FROM agent_run WHERE camp_id=? ORDER BY created_at').all(threadId)
      const run = runs[previousCount]
      if (run && ['succeeded','failed','cancelled'].includes(run.status)) return run
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Runtime acceptance timed out after 600 seconds')
  }
} catch (error) {
  Object.assign(report, { status: 'failed', error: error.message })
  process.exitCode = 1
} finally {
  database?.close()
  if (core) report.coreExit = await core.stop()
  report.finishedAt = new Date().toISOString()
  await writeFile(join(fixture, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(fixture, 'notifications.json'), JSON.stringify(notifications, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
