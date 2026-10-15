// Usage: node ... <private manifest.json> <public evidence.json>
// The manifest contains { cases: [{ adapter, fixture }] }. Never publish that input.
import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { descendantsOf, processStartedAtMilliseconds, processTable, sameProcessIdentity } from './lib/qualification-core.mjs'

const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'))
const raw = await Promise.all(manifest.cases.map(async c => {
  const bytes = await readFile(join(c.fixture, 'result.json'))
  const result = JSON.parse(bytes)
  assert.equal(result.adapter, c.adapter)
  assert.ok(result.finishedAt, 'An unfinished run cannot be a final result')
  return { result, sha256: createHash('sha256').update(bytes).digest('hex') }
}))
const admission = raw.find(r => r.result.platformAdmission)?.result.platformAdmission
const stages = ['seed', 'warm', 'cold', 'missing']
const evidence = { schemaVersion: 1, date: raw[0].result.startedAt.slice(0, 10), hostPlatform: 'windows-x64',
  baseline: raw[0].result.base, coreSha256: raw[0].result.coreSha256,
  sourceMain: manifest.sourceMain, fixCommit: manifest.fixCommit,
  excluded: ['cursor-agent', 'cline-cli', 'command-code-cli'], runtimes: [] }
for (const { result: r, sha256 } of raw) {
  assert.equal(r.base, evidence.baseline); assert.equal(r.coreSha256, evidence.coreSha256)
  const original = r.stages.find(s => s.stage === 'seed')?.currentId
  const missing = r.stages.find(s => s.stage === 'missing')
  const replacement = missing?.currentId !== original ? missing?.currentId : undefined
  const ids = new Map([[original, '<original-session>'], [replacement, '<replacement-session>']].filter(([v]) => v))
  const contexts = new Map()
  for (const q of r.stages.flatMap(s => s.requests).filter(q => q.direction === 'launch' && q.processContext?.processId)) {
    const c = q.processContext
    if (!contexts.has(c.processId)) contexts.set(c.processId, { ...c, label: `<process-tools-${contexts.size + 1}>` })
  }
  const replacements = [[r.project, '<project with spaces>'], [r.native, '<native>'],
    [join(r.fixture, 'native'), '<native>'], [r.data, '<core>'], [r.fixture, '<fixture>'],
    [process.env.LOCALAPPDATA, '%LOCALAPPDATA%'], [process.env.APPDATA, '%APPDATA%'], [homedir(), '%USERPROFILE%'],
    ...ids, ...[...contexts.values()].flatMap(c => [[dirname(c.contextPath), c.label], [c.processId, c.label]])]
    .filter(([s]) => s).sort((a, b) => b[0].length - a[0].length)
  function redact(value) {
    if (typeof value === 'string') {
      let text = value
      for (const [from, to] of replacements) for (const spelling of new Set([from, from.replaceAll('\\', '/'), encodeURIComponent(from)])) text = text.replaceAll(spelling, to)
      return text.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '<id>')
        .replace(/rvcamp_[a-z0-9]+/gi, '<camp>')
    }
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]))
    return value
  }
  const pidLabels = new Map()
  const pid = value => { if (value === undefined) return null; if (!pidLabels.has(value)) pidLabels.set(value, `process-${pidLabels.size + 1}`); return pidLabels.get(value) }
  const business = s => s.requests.filter(q => q.direction === 'in' && q.businessMarkers?.includes(`WIN_RESUME_${s.stage.toUpperCase()}_OK`) && ['session/prompt','turn/start','prompt','user','v4/command','user_input'].includes(q.method))
  const seedPid = business(r.stages.find(s => s.stage === 'seed') ?? { stage: '', requests: [] })[0]?.pid
  const cleanupOwnershipReviews = []
  for (const review of (manifest.cleanupReviews ?? []).filter(q => q.adapter === r.adapter)) {
    const shutdown = r.shutdowns.find(s => s.stage === review.stage)
    assert.ok(shutdown?.remaining.length, 'Review must reference a recorded cleanup failure')
    const root = shutdown.identities.find(p => p.pid === review.corePid)
    assert.equal(root?.executable?.replaceAll('\\', '/').toLowerCase(),
      join(import.meta.dirname, '../target/debug/rovai-core.exe').replaceAll('\\', '/').toLowerCase(), 'Review must identify this test Core')
    const ownedPids = new Set([root.pid, ...descendantsOf(shutdown.identities, root.pid)])
    const owned = shutdown.identities.filter(p => ownedPids.has(p.pid))
    const excluded = shutdown.identities.filter(p => !ownedPids.has(p.pid))
    // This audit only corrects a proven older-parent edge. It never excuses a
    // late owned child or stops a process, and preserves the initial failure.
    assert.ok(excluded.length > 0 && shutdown.remaining.every(p => excluded.some(x => sameProcessIdentity(x, p))))
    for (const p of excluded) {
      const parent = shutdown.identities.find(x => x.pid === p.ppid)
      assert.ok(parent && processStartedAtMilliseconds(p.startedAt) < processStartedAtMilliseconds(parent.startedAt), 'Excluded process must predate the recorded parent')
    }
    const live = await processTable()
    assert.ok(owned.every(p => !live.some(x => sameProcessIdentity(p, x))), 'Owned test process still alive')
    cleanupOwnershipReviews.push({ stage: review.stage, reason: 'numeric_parent_pid_reused',
      initialRemainingCount: shutdown.remaining.length, excludedOlderProcesses: excluded.length,
      ownedProcessesRemaining: 0, excludedProcessesStillAlive: excluded.every(p => live.some(x => sameProcessIdentity(p, x))),
      terminationPerformed: false })
  }
  if (cleanupOwnershipReviews.length) assert.equal(cleanupOwnershipReviews.length, r.shutdowns.filter(s => s.remaining.length > 0).length)
  const row = { adapter: r.adapter, version: r.version, executable: r.executable,
    executableSha256: r.executableSha256, resolvedLaunch: r.resolvedLaunch,
    officialAppKernel: r.stages.flatMap(s => s.requests).find(q => q.officialKernel)?.officialKernel,
    provider: r.provider ? { name: r.provider.provider, model: r.provider.model, endpoint: r.provider.endpoint } : { name: 'native-account' },
    authentication: { probe: r.installation?.snapshot?.authenticationStatus, realLlmRoundSucceeded: r.stages.some(s => s.status === 'succeeded') },
    admission: (r.platformAdmission ?? admission).find(a => a.platform === 'windows-x64' && a.runtimeKind === r.adapter),
    startedAt: r.startedAt, finishedAt: r.finishedAt, privateEvidenceSha256: sha256,
    initialCleanupCheckPassed: r.shutdowns.every(s => s.remaining.length === 0) && !r.cleanupFailure,
    initialCleanupFailure: r.cleanupFailure, cleanupOwnershipReviews,
    allTestProcessesReaped: (r.shutdowns.every(s => s.remaining.length === 0) && !r.cleanupFailure) || cleanupOwnershipReviews.length > 0,
    stages: [], historyDeletion: { completed: !!r.historyRemoved, targets: r.deletionManifest?.map(f => ({
      path: f.path, backup: `<private-backup>/${relative(join(r.fixture, 'removed-history'), f.backup)}`,
      exactSessionId: f.sessionId, projectVerified: f.cwdVerified ?? null,
      sharedStore: !!f.sharedRoot, stoppedBeforeDeletion: true
    })) }, failure: r.failure }
  const db = new DatabaseSync(join(r.data, 'rovai.sqlite'), { readOnly: true })
  for (const stage of stages) {
    const s = r.stages.find(s => s.stage === stage)
    if (!s) { row.stages.push({ stage, tested: false }); continue }
    const inputs = business(s), calls = s.requests.filter(q => q.direction === 'in' && ['thread/resume','session/resume','session/load','switch_session','session/new','session/create','new_session'].includes(q.method))
    const launches = s.requests.filter(q => q.direction === 'launch')
    const processContexts = launches.filter(q => q.processContext)
    const cwdIdentities = new Map()
    for (const q of processContexts) {
      // Keep the exact spelling in evidence. A Win32 verbatim path can name the
      // same directory; prove that with NTFS file identity, not string rewriting.
      const [actualCwd, projectCwd] = await Promise.all([
        stat(q.cwd, { bigint: true }).catch(error => { if (error.code === 'ENOENT') return null; throw error }),
        stat(r.project, { bigint: true })
      ])
      const sameDirectory = actualCwd && actualCwd.isDirectory() && projectCwd.isDirectory()
        && actualCwd.dev === projectCwd.dev && actualCwd.ino !== 0n && actualCwd.ino === projectCwd.ino
      if (manifest.requireReplacementSuccess?.includes(r.adapter)) {
        assert.equal(sameDirectory, true, `${r.adapter}/${stage}: replacement owner must keep the project cwd`)
      }
      cwdIdentities.set(q, sameDirectory)
      assert.equal(q.processContext.runTmpExists, true, `${r.adapter}/${stage}: run-tmp missing at launch`)
      // The ACP/Pi replacement owner starts unbound. One-shot adapters can bind
      // their own lease before spawn; preserve that observation without imposing
      // ACP's ordering on a different launch protocol.
      if (manifest.requireReplacementSuccess?.includes(r.adapter)) {
        assert.equal(q.processContext.unbound, true, `${r.adapter}/${stage}: replacement owner starts unbound`)
      }
      assert.ok((q.additionalDirectories ?? []).every(d => d.exists), `${r.adapter}/${stage}: invalid additional directory`)
    }
    for (const field of ['processId', 'contextPath', 'runTmp']) {
      assert.equal(new Set(processContexts.map(q => q.processContext[field])).size, processContexts.length,
        `${r.adapter}/${stage}: reused ${field} between processes`)
    }
    const restores = calls.filter(q => ['thread/resume','session/resume','session/load','switch_session'].includes(q.method))
    const errors = s.requests.filter(q => q.error).map(q => ({ method: q.requestMethod, code: q.error.code,
      data: typeof q.error.data === 'object' ? Object.fromEntries(Object.entries(q.error.data ?? {}).filter(([k]) => ['code','uri','sessionId','projectRoot'].includes(k))) : undefined }))
    const output = db.prepare("SELECT payload_preview_json FROM agent_run_execution_evidence WHERE agent_run_id=? AND kind='narration'").all(s.runId)
    const usage = db.prepare('SELECT provider_key,model_key,output_tokens,usage_source,usage_quality FROM runtime_usage_run_summary WHERE agent_run_id=?').all(s.runId)
    const bindingEvents = db.prepare("SELECT event_type AS type, json_extract(payload_json,'$.nativeSessionId') AS nativeSessionId FROM event_log WHERE json_extract(payload_json,'$.agentRunId')=? AND event_type IN ('conversation.native_session_bound','agent_run.native_session_continuity_lost') ORDER BY id").all(s.runId)
    row.stages.push({ stage, tested: true, status: s.status, coreError: s.error, timedOut: s.timedOut,
      bindingBefore: s.previousId ?? null, bindingAfter: s.currentId ?? null,
      originalBindingRetained: s.currentId === original, businessInputCount: s.businessInputCount,
      inputDeliveryStates: s.input, continuityNoticeCount: s.noticeCount,
      businessProcess: pid(inputs[0]?.pid), sameProcessAsSeed: inputs.length > 0 ? inputs[0].pid === seedPid : null,
      actualRestoreCarriedOriginalId: restores.some(q => q.sessionId === original || q.sessionPath?.includes(original)) || launches.some(q => q.resumeArgument === original),
      calls: calls.map(q => ({ method: q.method, sessionId: q.sessionId, sessionPath: q.sessionPath, target: q.target })),
      resumeArguments: launches.filter(q => q.resumeArgument).map(q => ({ flag: q.resumeFlag, id: q.resumeArgument })),
      launches: launches.map(q => ({ process: pid(q.pid), cwd: q.cwd, environment: q.environment,
        cwdMatchesProjectByFileIdentity: cwdIdentities.get(q),
        processContext: q.processContext, additionalDirectories: q.additionalDirectories })),
      errors, bindingEvents, nativeNewCallCount: calls.filter(q => ['session/new','session/create','new_session'].includes(q.method)).length,
      expectedMarkerObservedInWireFrame: s.requests.some(q => q.direction === 'out' && q.responseMarkers?.includes(`WIN_RESUME_${stage.toUpperCase()}_OK`)),
      expectedMarkerObservedInCoreNarration: output.some(q => JSON.parse(q.payload_preview_json).text?.includes(`WIN_RESUME_${stage.toUpperCase()}_OK`)),
      usage })
  }
  db.close()
  for (const s of row.stages.filter(s => s.tested)) {
    assert.ok(s.businessInputCount <= 1 && s.continuityNoticeCount <= 1, `${r.adapter}/${s.stage}: duplicated input or notice`)
    if (s.status === 'succeeded') assert.ok(s.expectedMarkerObservedInCoreNarration || s.expectedMarkerObservedInWireFrame, `${r.adapter}/${s.stage}: real output marker not observed`)
  }
  const cold = row.stages.find(s => s.stage === 'cold')
  assert.ok(cold.status === 'succeeded' && cold.actualRestoreCarriedOriginalId && cold.originalBindingRetained, `${r.adapter}: cold continuity not established`)
  assert.ok(row.allTestProcessesReaped, `${r.adapter}: test process cleanup not established`)
  if (manifest.requireReplacementSuccess?.includes(r.adapter)) {
    const s = row.stages.find(s => s.stage === 'missing')
    assert.ok(s.status === 'succeeded' && !s.originalBindingRetained && s.bindingAfter,
      `${r.adapter}: replacement did not succeed and bind`)
    assert.equal(s.nativeNewCallCount, 1, `${r.adapter}: replacement must create once`)
    assert.equal(s.businessInputCount, 1, `${r.adapter}: replacement must submit once`)
    assert.equal(s.continuityNoticeCount, 1, `${r.adapter}: replacement must notify once`)
    const boundIndex = s.bindingEvents.findIndex(e => e.type === 'conversation.native_session_bound' && e.nativeSessionId === s.bindingAfter)
    const noticeIndex = s.bindingEvents.findIndex(e => e.type === 'agent_run.native_session_continuity_lost')
    assert.ok(boundIndex >= 0 && noticeIndex > boundIndex, `${r.adapter}: notice must follow normal replacement binding`)
    if (['copilot-cli', 'pi'].includes(r.adapter)) {
      assert.equal(s.launches.length, 2, `${r.adapter}: restore and replacement processes`)
      assert.ok(s.launches.every(q => q.processContext?.runTmpExists), `${r.adapter}: missing launch evidence`)
    }
  }
  if (r.replacementFailureReproduced) {
    const s = r.stages.find(s => s.stage === 'replacement_check')
    row.replacementFailureReproduction = { commandFlag: '--reproduce-replacement-failure', expectedExitCode: 1,
      status: s.status, originalBindingRetained: s.currentId === original, businessInputCount: s.businessInputCount,
      continuityNoticeCount: s.noticeCount,
      additionalDirectoriesAtEachLaunch: s.requests.filter(q => q.direction === 'launch').map(q => q.additionalDirectories) }
  }
  evidence.runtimes.push(redact(row))
}
evidence.preflightAttempts = []
for (const prior of manifest.priorUnmeasuredCases ?? []) {
  const bytes = await readFile(join(prior.fixture, 'result.json')), r = JSON.parse(bytes)
  assert.equal(r.adapter, prior.adapter)
  assert.ok(r.finishedAt && r.stages.length === 0, 'Preflight records cannot hide executed business stages')
  const db = new DatabaseSync(join(r.data, 'rovai.sqlite'), { readOnly: true })
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_run').get().n, 0)
    const snapshot = db.prepare('SELECT reported_version,authentication_status,probe_status,last_error FROM adapter_capability_snapshot').all()
    evidence.preflightAttempts.push({ adapter: r.adapter, installedVersion: r.version,
      base: r.base, coreSha256: r.coreSha256, stage: r.failure?.stage,
      businessInputCount: 0, nativeHistoryDeleted: !!r.historyRemoved, snapshot,
      allTestProcessesReaped: r.shutdowns.every(s => s.remaining.length === 0) && !r.cleanupFailure,
      privateEvidenceSha256: createHash('sha256').update(bytes).digest('hex') })
  } finally { db.close() }
}
const text = JSON.stringify(evidence, null, 2) + '\n'
for (const secret of [process.env.SUB2API_API_KEY, process.env.CODEBUDDY_API_KEY].filter(Boolean)) assert.ok(!text.includes(secret), 'Credential in public evidence')
assert.ok(!text.includes(homedir()) && !text.includes(homedir().replaceAll('\\', '/')), 'Unredacted personal path')
await writeFile(process.argv[3], text)
console.log(JSON.stringify({ runtimes: evidence.runtimes.length, output: process.argv[3] }))
