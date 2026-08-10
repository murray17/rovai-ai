import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readJsonSource, readLegacyTrialSource } from './source-reader.mjs'
import {
  normalizeLegacySource,
  selectionFromLegacyQualification,
  validateLegacySelection,
  validateLegacySourceSummaries
} from './legacy-selection.mjs'
import { normalizeLegacyProjectTrial } from './legacy-trial-normalizer.mjs'
import { aggregateLegacyProjectSummary } from './legacy-aggregation.mjs'
import {
  legacyReviewCampBody,
  legacyTrialCampBody,
  renderBenchmarkReview,
  renderLegacyProjectReport
} from './markdown.mjs'
import { projectReviewFiles } from './filesystem-projection.mjs'
import { importBenchmarkReviewCamps } from './camp-import.mjs'
import { readBenchmarkRunV3 } from '../protocol/v3.mjs'
import { compareBenchmarkRuns } from '../evaluation/comparison.mjs'
import { sha256 } from '../protocol/canonical.mjs'

export async function projectLegacyQualificationBenchmark(options) {
  const source = await readJsonSource(options.suiteSummary)
  const sourceSuite = source.value
  const normalizedSource = normalizeLegacySource(sourceSuite)
  const formal = sourceSuite.resultClass === 'qualification'
  if (!formal && (!options.selection || !options.priorCalibrationSummary)) {
    throw new Error('diagnostic benchmark import requires --selection and --prior-calibration-summary')
  }
  const selectionSource = formal
    ? {
        value: selectionFromLegacyQualification(sourceSuite, normalizedSource),
        raw: null,
        path: join(dirname(options.suiteSummary), 'benchmark-selection.json')
      }
    : await readJsonSource(options.selection)
  selectionSource.raw ??= `${JSON.stringify(selectionSource.value, null, 2)}\n`
  validateLegacySelection(selectionSource.value, normalizedSource)
  const priorSource = formal ? null : await readJsonSource(options.priorCalibrationSummary)
  validateLegacySourceSummaries({
    sourceSuite,
    normalizedSource,
    priorCalibration: priorSource?.value ?? null
  })
  const trials = await Promise.all(selectionSource.value.trials.map(async (entry) => (
    normalizeLegacyProjectTrial({
      entry,
      source: await readLegacyTrialSource(options.trialRoot, entry.trialId),
      adapterId: normalizedSource.adapterId
    })
  )))
  trials.sort((left, right) => left.round - right.round || left.caseId.localeCompare(right.caseId))
  const invalidatedAttempts = await Promise.all(selectionSource.value.invalidatedAttempts.map(async (entry) => {
    const attempt = await readJsonSource(join(options.trialRoot, entry.trialId, 'result.json'))
    return {
      trialId: entry.trialId,
      classification: entry.classification,
      reasonCode: entry.reasonCode,
      recordedValidity: attempt.value.validity,
      recordedResult: attempt.value.overall,
      evidenceDigest: sha256(attempt.raw)
    }
  }))
  const summary = aggregateLegacyProjectSummary({
    selection: selectionSource.value,
    selectionRaw: selectionSource.raw,
    sourceSuite,
    sourceSuiteRaw: source.raw,
    normalizedSource,
    priorCalibration: priorSource?.value ?? null,
    priorCalibrationRaw: priorSource?.raw ?? null,
    trials,
    invalidatedAttempts
  })
  const markdown = renderLegacyProjectReport(summary)
  const evidenceSummaryPath = join(dirname(options.suiteSummary), 'benchmark-summary.json')
  await mkdir(dirname(evidenceSummaryPath), { recursive: true, mode: 0o700 })
  await writeFile(evidenceSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 })
  if (formal) await writeFile(selectionSource.path, selectionSource.raw, { mode: 0o600 })
  const reportDirectory = await projectReviewFiles({
    projectPath: options.projectPath,
    projectionId: summary.benchmarkId,
    machineFileName: 'benchmark-summary.json',
    machineValue: summary,
    markdown
  })
  const imported = options.noImport ? null : await importBenchmarkReviewCamps({
    coreExecutable: options.core,
    dataDirectory: options.dataDir,
    projectPath: options.projectPath,
    review: {
      id: summary.benchmarkId,
      title: `${summary.qualificationEligible ? 'Team ' : ''}Benchmark ${summary.suiteVersion} · Review`,
      body: legacyReviewCampBody(summary, options.projectPath)
    },
    trialReviews: summary.trials.map((trial) => ({
      id: `r${trial.round}-${trial.caseId}`,
      title: `${summary.qualificationEligible ? 'Team ' : ''}R${trial.round} · ${trial.caseId} · ${trial.result.toUpperCase()}`,
      body: legacyTrialCampBody(summary, trial)
    })),
    legacyTrialCamps: options.legacyTrialCamps
  })
  return {
    ok: true,
    benchmarkId: summary.benchmarkId,
    score: summary.score,
    projectPath: options.projectPath,
    reportDirectory,
    evidenceSummaryPath,
    evidenceSelectionPath: selectionSource.path,
    imported
  }
}

export async function projectBenchmarkProtocolRun(options) {
  const run = await readBenchmarkRunV3(options.run)
  const raw = (await readJsonSource(options.run)).raw
  const baseline = options.baseline ? await readBenchmarkRunV3(options.baseline) : null
  const comparison = baseline ? compareBenchmarkRuns(baseline, run) : null
  const markdown = renderBenchmarkReview(run, { comparison })
  const reportDirectory = await projectReviewFiles({
    projectPath: options.projectPath,
    projectionId: run.runId,
    machineFileName: 'benchmark-run.json',
    machineValue: run,
    markdown,
    sourceRaw: raw
  })
  if (comparison) {
    await writeFile(join(reportDirectory, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o644 })
  }
  const imported = options.noImport ? null : await importBenchmarkReviewCamps({
    coreExecutable: options.core,
    dataDirectory: options.dataDir,
    projectPath: options.projectPath,
    review: {
      id: run.runId,
      title: `Benchmark ${run.profile.id}@${run.profile.version} · Review`,
      body: `[Imported benchmark evidence — no AgentRun was created]\n\n${markdown}`
    },
    trialReviews: run.artifactIndex.filter((entry) => entry.artifactRole === 'trial').map((entry, index) => ({
      id: `trial-${index + 1}`,
      title: `Benchmark Trial ${index + 1}`,
      body: `[Imported benchmark evidence — no AgentRun was created]\n\nArtifact digest: ${entry.payloadDigest}`
    })),
    legacyTrialCamps: options.legacyTrialCamps
  })
  return { ok: true, runId: run.runId, projectPath: options.projectPath, reportDirectory, imported }
}

export function parseLegacyProjectArguments(args) {
  const values = parseFlags(args, new Set(['no-import', 'legacy-trial-camps']), new Set([
    'selection', 'trial-root', 'suite-summary', 'prior-calibration-summary', 'project-path', 'core', 'data-dir'
  ]))
  if (!values || !values['trial-root'] || !values['suite-summary'] || !values['project-path']) return null
  if (Boolean(values.selection) !== Boolean(values['prior-calibration-summary'])) return null
  if (!values['no-import'] && (!values.core || !values['data-dir'])) return null
  return {
    selection: values.selection ? resolve(values.selection) : null,
    trialRoot: resolve(values['trial-root']),
    suiteSummary: resolve(values['suite-summary']),
    priorCalibrationSummary: values['prior-calibration-summary'] ? resolve(values['prior-calibration-summary']) : null,
    projectPath: resolve(values['project-path']),
    core: values.core ? resolve(values.core) : null,
    dataDir: values['data-dir'] ? resolve(values['data-dir']) : null,
    noImport: values['no-import'] === true,
    legacyTrialCamps: values['legacy-trial-camps'] === true
  }
}

export function parseProtocolProjectArguments(args) {
  const values = parseFlags(args, new Set(['no-import', 'legacy-trial-camps']), new Set([
    'run', 'baseline', 'project-path', 'core', 'data-dir'
  ]))
  if (!values?.run || !values['project-path']) return null
  if (!values['no-import'] && (!values.core || !values['data-dir'])) return null
  return {
    run: resolve(values.run),
    baseline: values.baseline ? resolve(values.baseline) : null,
    projectPath: resolve(values['project-path']),
    core: values.core ? resolve(values.core) : null,
    dataDir: values['data-dir'] ? resolve(values['data-dir']) : null,
    noImport: values['no-import'] === true,
    legacyTrialCamps: values['legacy-trial-camps'] === true
  }
}

function parseFlags(args, booleans, valuesWithArgument) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument?.startsWith('--')) return null
    const key = argument.slice(2)
    if (booleans.has(key)) values[key] = true
    else if (valuesWithArgument.has(key)) values[key] = args.shift()
    else return null
  }
  return values
}
