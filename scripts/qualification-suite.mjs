import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  ensurePrivateDirectory,
  sha256,
  validateRelativeLocator
} from './lib/qualification-common.mjs'

const root = resolve(import.meta.dirname, '..')
const options = parseArguments(process.argv.slice(2))
const packRoot = resolve(options.pack)
const suite = JSON.parse(await readFile(join(packRoot, 'suite.json'), 'utf8'))
validateSuite(suite)
const suiteEvidenceRoot = await ensurePrivateDirectory(join(options.evidenceRoot, options.suiteId))
const trialEvidenceRoot = await ensurePrivateDirectory(join(suiteEvidenceRoot, 'trials'))
const outcomes = []
let compatibilityDigest = null
let priorCalibration = null

if (options.diagnosticNoCalibration) {
  priorCalibration = await readPriorCalibration(options.priorCalibrationSummary)
  console.log(`[qualification] diagnostic mode after failed calibration ${priorCalibration.suiteId}`)
} else {
  console.log(`[qualification] calibration ${suite.calibration.id}`)
  const calibration = await runOne(suite.calibration, 'calibration')
  outcomes.push(calibration)
  if (calibration.summary.overall !== 'pass') {
    await finish('calibration_failed')
    process.exitCode = 2
  }
}

if (!process.exitCode) {
  const formalOrder = []
  for (let round = 1; round <= suite.rounds; round += 1) {
    const ordered = [...suite.cases].sort((left, right) => (
      sha256(`${suite.seed}:${round}:${left.id}`).localeCompare(sha256(`${suite.seed}:${round}:${right.id}`))
    ))
    for (const caseEntry of ordered) formalOrder.push({ round, caseEntry })
  }
  for (const { round, caseEntry } of formalOrder) {
    console.log(`[qualification] round ${round}/${suite.rounds} ${caseEntry.id}`)
    const trial = await runOne(caseEntry, `r${round}`)
    outcomes.push(trial)
    if (trial.summary.validity === 'invalid') {
      await finish('environment_drift_or_invalid')
      process.exitCode = 2
      break
    }
  }
  if (!process.exitCode) {
    await finish(options.diagnosticNoCalibration ? 'diagnostic_completed' : 'completed')
  }
}

async function readPriorCalibration(path) {
  const raw = await readFile(path, 'utf8')
  const summary = JSON.parse(raw)
  if (summary?.suiteVersion !== suite.version
      || summary.calibration !== 'fail'
      || summary.formalTrialsCompleted !== 0
      || typeof summary.suiteId !== 'string') {
    throw new Error('diagnostic mode requires a failed same-version calibration suite summary')
  }
  return {
    suiteId: summary.suiteId,
    result: summary.calibration,
    summaryDigest: sha256(raw)
  }
}

async function runOne(caseEntry, phase) {
  const casePath = resolveInsidePack(packRoot, caseEntry.directory)
  const trialId = `${options.suiteId}-${phase}-${caseEntry.id}`
  const args = [
    join(root, 'scripts', 'qualification-runner.mjs'),
    '--mode', 'formal',
    '--core', options.core,
    '--case', casePath,
    '--expected-seal', caseEntry.seal,
    '--evidence-root', trialEvidenceRoot,
    '--team-private-dir', options.teamPrivateDirectory,
    '--trial-id', trialId
  ]
  const run = await spawnRunner(args)
  let summary
  try {
    summary = JSON.parse(run.stdout.trim())
  } catch (error) {
    throw new Error(`qualification Trial returned invalid summary: ${error.message}; stderr=${run.stderr.slice(-2000)}`)
  }
  const manifest = JSON.parse(await readFile(join(trialEvidenceRoot, trialId, 'environment-manifest.json'), 'utf8').catch(() => 'null'))
  if (summary.validity === 'valid') {
    if (!manifest?.teamRuntimeCompatibilityDigest) throw new Error('valid Trial has no environment compatibility digest')
    compatibilityDigest ??= manifest.teamRuntimeCompatibilityDigest
    if (manifest.teamRuntimeCompatibilityDigest !== compatibilityDigest) {
      summary = { ...summary, validity: 'invalid', overall: 'invalid', driftDetected: true }
    }
  }
  if (phase === 'calibration' && summary.validity === 'valid') {
    const audit = await auditCalibration(trialId)
    summary = {
      ...summary,
      calibrationAudit: audit,
      ...(audit.passed ? {} : { orchestrationConvergence: false, overall: 'fail' })
    }
  }
  console.log(`[qualification] ${caseEntry.id} ${summary.overall}`)
  return { phase, trialId, caseId: caseEntry.id, caseVersion: caseEntry.version, caseSeal: caseEntry.seal, summary }
}

async function auditCalibration(trialId) {
  const result = JSON.parse(await readFile(join(trialEvidenceRoot, trialId, 'result.json'), 'utf8'))
  const observations = (await readFile(join(trialEvidenceRoot, trialId, 'observations.ndjson'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const finalObservation = observations.at(-1)?.snapshot
  const expectedMembers = ['agent-luoke', 'agent-muwa', 'agent-mianzhi', 'agent-qilu']
  const actualMembers = [...new Set(result.collaborationEvidence?.members ?? [])].sort()
  const rabbitRunIds = new Set((finalObservation?.agentRuns ?? [])
    .filter((run) => run.agentProfileId === 'agent-qilu')
    .map((run) => run.id))
  const rabbitToolTitles = (finalObservation?.executionEvidence ?? [])
    .filter((evidence) => rabbitRunIds.has(evidence.agentRunId))
    .flatMap((evidence) => Object.values(evidence.safeIdentity ?? {}))
    .filter((value) => typeof value === 'string')
  const checks = {
    allFourMembersRan: canonicalSet(actualMembers) === canonicalSet(expectedMembers),
    atLeastThreeAcceptedA2a: (result.collaborationEvidence?.a2a?.length ?? 0) >= 3,
    antigravityTeamCall: rabbitToolTitles.some((value) => value.includes('team.call_member')),
    antigravityContextCall: rabbitToolTitles.some((value) => value.startsWith('context.')),
    antigravityMemoryCall: rabbitToolTitles.some((value) => value.startsWith('memory.')),
    verifiedDelivery: result.verifiedDelivery === true,
    converged: result.orchestrationConvergence === true
  }
  return { passed: Object.values(checks).every(Boolean), checks }
}

function canonicalSet(values) {
  return [...values].sort().join(',')
}

async function finish(status) {
  const formal = outcomes.filter((outcome) => outcome.phase !== 'calibration')
  const calibration = outcomes.find((outcome) => outcome.phase === 'calibration')
  const passes = formal.filter((outcome) => outcome.summary.overall === 'pass').length
  const diagnostic = options.diagnosticNoCalibration
  const perCase = Object.fromEntries(suite.cases.map((entry) => {
    const results = formal.filter((outcome) => outcome.caseId === entry.id).map((outcome) => outcome.summary.overall)
    return [entry.id, { passes: results.filter((value) => value === 'pass').length, repeats: results.length, results }]
  }))
  const summary = {
    schemaVersion: 1,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    suiteId: options.suiteId,
    suiteVersion: suite.version,
    seed: suite.seed,
    status,
    resultClass: diagnostic ? 'post_gate_diagnostic_benchmark' : 'qualification',
    qualificationEligible: !diagnostic && calibration?.summary.overall === 'pass',
    calibration: calibration?.summary.overall ?? (priorCalibration ? 'failed_prior' : 'not_run'),
    priorCalibration,
    formalTrialsCompleted: formal.length,
    formalPasses: passes,
    totalPlanned: suite.rounds * suite.cases.length,
    passRate: diagnostic || formal.length === 0 ? null : passes / formal.length,
    diagnosticPassRate: diagnostic && formal.length > 0 ? passes / formal.length : null,
    perCase,
    outcomes: outcomes.map((outcome) => ({
      phase: outcome.phase,
      trialId: outcome.trialId,
      caseId: outcome.caseId,
      caseVersion: outcome.caseVersion,
      caseSeal: outcome.caseSeal,
      result: outcome.summary.overall,
      verifiedDelivery: outcome.summary.verifiedDelivery,
      orchestrationConvergence: outcome.summary.orchestrationConvergence,
      postDispatchHumanIntervention: outcome.summary.postDispatchHumanIntervention,
      observedAgentRuns: outcome.summary.budget?.observedAgentRuns ?? null,
      observedAcceptedA2a: outcome.summary.budget?.observedAcceptedA2a ?? null,
      collaborationAuditPassed: outcome.summary.collaborationAudit?.passed ?? null
    })),
    teamRuntimeCompatibilityDigest: compatibilityDigest,
    judge: 'not_included',
    metric: 'raw_repeat_outcomes_not_pass_at_k',
    ambientMcpIsolation: 'preserved_uncontrolled'
  }
  await atomicWriteJson(join(suiteEvidenceRoot, 'suite-summary.json'), summary)
  console.log(JSON.stringify(summary, null, 2))
}

function spawnRunner(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectRun)
    child.once('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }))
  })
}

function resolveInsidePack(packRoot, locator) {
  const normalized = validateRelativeLocator(locator, 'suite case directory')
  const target = resolve(packRoot, normalized)
  if (!target.startsWith(`${packRoot}${sep}`)) throw new Error('suite case directory escapes the pack')
  return target
}

function validateSuite(suite) {
  if (suite?.schemaVersion !== 1 || suite.version !== 'v0.32' || !Number.isInteger(suite.rounds) || suite.rounds !== 3) {
    throw new Error('qualification suite manifest is invalid')
  }
  if (typeof suite.seed !== 'string' || suite.seed === '' || !suite.calibration || !Array.isArray(suite.cases) || suite.cases.length !== 4) {
    throw new Error('qualification suite composition is invalid')
  }
  const entries = [suite.calibration, ...suite.cases]
  for (const entry of entries) {
    validateRelativeLocator(entry.directory, 'suite case directory')
    if (typeof entry.id !== 'string' || typeof entry.version !== 'string' || !/^[a-f0-9]{64}$/.test(entry.seal ?? '')) {
      throw new Error('qualification suite case entry is invalid')
    }
  }
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (key === 'diagnostic-no-calibration') {
      values[key] = true
      continue
    }
    if (!['pack', 'core', 'evidence-root', 'team-private-dir', 'suite-id', 'prior-calibration-summary'].includes(key)) usage()
    values[key] = args.shift()
  }
  if (!values.pack || !values.core || !values['evidence-root'] || !values['team-private-dir'] || !values['suite-id']) usage()
  if (Boolean(values['diagnostic-no-calibration']) !== Boolean(values['prior-calibration-summary'])) usage()
  return {
    pack: resolve(values.pack),
    core: resolve(values.core),
    evidenceRoot: resolve(values['evidence-root']),
    teamPrivateDirectory: resolve(values['team-private-dir']),
    suiteId: values['suite-id'],
    diagnosticNoCalibration: values['diagnostic-no-calibration'] === true,
    priorCalibrationSummary: values['prior-calibration-summary']
      ? resolve(values['prior-calibration-summary'])
      : null
  }
}

function usage() {
  console.error('Usage: node scripts/qualification-suite.mjs --pack <private-pack> --core <packaged-core> --evidence-root <private-root> --team-private-dir <path> --suite-id <id> [--diagnostic-no-calibration --prior-calibration-summary <path>]')
  process.exit(2)
}
