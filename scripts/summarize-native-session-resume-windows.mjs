// Usage: node ... <private manifest.json> <public evidence.json>
// The manifest contains { cases: [{ adapter, fixture }] }. Never publish that input.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

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
const evidence = { schemaVersion: 1, date: '2026-10-13', hostPlatform: 'windows-x64',
  baseline: raw[0].result.base, coreSha256: raw[0].result.coreSha256,
  excluded: ['cursor-agent', 'cline-cli', 'command-code-cli'], runtimes: [] }
for (const { result: r, sha256 } of raw) {
  assert.equal(r.base, evidence.baseline); assert.equal(r.coreSha256, evidence.coreSha256)
  const original = r.stages.find(s => s.stage === 'seed')?.currentId
  const missing = r.stages.find(s => s.stage === 'missing')
  const replacement = missing?.currentId !== original ? missing?.currentId : undefined
  const ids = new Map([[original, '<original-session>'], [replacement, '<replacement-session>']].filter(([v]) => v))
  const replacements = [[r.project, '<project with spaces>'], [r.native, '<native>'],
    [join(r.fixture, 'native'), '<native>'], [r.data, '<core>'], [r.fixture, '<fixture>'],
    [process.env.LOCALAPPDATA, '%LOCALAPPDATA%'], [process.env.APPDATA, '%APPDATA%'], [homedir(), '%USERPROFILE%'],
    ...ids].filter(([s]) => s).sort((a, b) => b[0].length - a[0].length)
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
  const row = { adapter: r.adapter, version: r.version, executable: r.executable,
    executableSha256: r.executableSha256, resolvedLaunch: r.resolvedLaunch,
    officialAppKernel: r.stages.flatMap(s => s.requests).find(q => q.officialKernel)?.officialKernel,
    provider: r.provider ? { name: r.provider.provider, model: r.provider.model, endpoint: r.provider.endpoint } : { name: 'native-account' },
    authentication: { probe: r.installation?.snapshot?.authenticationStatus, realLlmRoundSucceeded: r.stages.some(s => s.status === 'succeeded') },
    admission: (r.platformAdmission ?? admission).find(a => a.platform === 'windows-x64' && a.runtimeKind === r.adapter),
    startedAt: r.startedAt, finishedAt: r.finishedAt, privateEvidenceSha256: sha256,
    allTestProcessesReaped: r.shutdowns.every(s => s.remaining.length === 0) && !r.cleanupFailure,
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
    const restores = calls.filter(q => ['thread/resume','session/resume','session/load','switch_session'].includes(q.method))
    const errors = s.requests.filter(q => q.error).map(q => ({ method: q.requestMethod, code: q.error.code,
      data: typeof q.error.data === 'object' ? Object.fromEntries(Object.entries(q.error.data ?? {}).filter(([k]) => ['code','uri','sessionId','projectRoot'].includes(k))) : undefined }))
    const output = db.prepare("SELECT payload_preview_json FROM agent_run_execution_evidence WHERE agent_run_id=? AND kind='narration'").all(s.runId)
    const usage = db.prepare('SELECT provider_key,model_key,output_tokens,usage_source,usage_quality FROM runtime_usage_run_summary WHERE agent_run_id=?').all(s.runId)
    row.stages.push({ stage, tested: true, status: s.status, coreError: s.error, timedOut: s.timedOut,
      bindingBefore: s.previousId ?? null, bindingAfter: s.currentId ?? null,
      originalBindingRetained: s.currentId === original, businessInputCount: s.businessInputCount,
      inputDeliveryStates: s.input, continuityNoticeCount: s.noticeCount,
      businessProcess: pid(inputs[0]?.pid), sameProcessAsSeed: inputs.length > 0 ? inputs[0].pid === seedPid : null,
      actualRestoreCarriedOriginalId: restores.some(q => q.sessionId === original || q.sessionPath?.includes(original)) || launches.some(q => q.resumeArgument === original),
      calls: calls.map(q => ({ method: q.method, sessionId: q.sessionId, sessionPath: q.sessionPath, target: q.target })),
      resumeArguments: launches.filter(q => q.resumeArgument).map(q => ({ flag: q.resumeFlag, id: q.resumeArgument })),
      errors, nativeNewCallCount: calls.filter(q => ['session/new','session/create','new_session'].includes(q.method)).length,
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
  if (r.replacementFailureReproduced) {
    const s = r.stages.find(s => s.stage === 'replacement_check')
    row.replacementFailureReproduction = { commandFlag: '--reproduce-replacement-failure', expectedExitCode: 1,
      status: s.status, originalBindingRetained: s.currentId === original, businessInputCount: s.businessInputCount,
      continuityNoticeCount: s.noticeCount,
      additionalDirectoriesAtEachLaunch: s.requests.filter(q => q.direction === 'launch').map(q => q.additionalDirectories) }
  }
  evidence.runtimes.push(redact(row))
}
const text = JSON.stringify(evidence, null, 2) + '\n'
for (const secret of [process.env.SUB2API_API_KEY, process.env.CODEBUDDY_API_KEY].filter(Boolean)) assert.ok(!text.includes(secret), 'Credential in public evidence')
assert.ok(!text.includes(homedir()) && !text.includes(homedir().replaceAll('\\', '/')), 'Unredacted personal path')
await writeFile(process.argv[3], text)
console.log(JSON.stringify({ runtimes: evidence.runtimes.length, output: process.argv[3] }))
