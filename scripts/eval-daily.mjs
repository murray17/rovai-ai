import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCaptured } from './lib/qualification-common.mjs'
import { dailyAnalysisSchema, recordDailyAnalysis } from '../packages/evaluation/src/daily-analysis.ts'
import { dailyWindow, digest, runDaily } from '../packages/evaluation/src/daily.ts'

const args = process.argv.slice(2)
if (args.includes('--help') || args.length === 0) {
  console.log('Usage: node scripts/eval-daily.mjs --config <json> [--date YYYY-MM-DD] [--trace <exported-trace.json>]\n  node scripts/eval-daily.mjs prepared --output <report-root> --timezone <IANA-zone>\n  node scripts/eval-daily.mjs analysis --report <directory> --input <analysis-submission.json>\nConfig: { timezone, output, cli, scope: { campIds, excludeCampIds, excludeAutomationIds } }. Defaults to the previous local calendar day. No task replay or model call.')
} else if (args[0] === 'analysis') {
  const options = {}
  for (let index = 1; index < args.length; index += 2) {
    if (!['--report', '--input'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Invalid analysis-record option')
    options[args[index]] = args[index + 1]
  }
  if (!options['--report'] || !options['--input']) throw new Error('Analysis requires --report <directory> --input <structured-analysis.json>')
  const result = await recordDailyAnalysis(options['--report'], JSON.parse(await readFile(resolve(options['--input']), 'utf8')))
  console.log(JSON.stringify({ id: result.id, reportId: result.reportId, status: result.status, failureCode: result.failureCode ?? null }, null, 2))
  if (result.status !== 'complete') process.exitCode = 2
} else if (args[0] === 'prepared') {
  const options = {}
  for (let index = 1; index < args.length; index += 2) {
    if (!['--output', '--timezone'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Invalid prepared-report option')
    options[args[index]] = args[index + 1]
  }
  if (!options['--output'] || !options['--timezone']) throw new Error('Prepared reports require an output root and timezone')
  const root = resolve(options['--output'])
  const latest = JSON.parse(await readFile(resolve(root, 'latest.json'), 'utf8'))
  const expected = dailyWindow(options['--timezone'])
  if (latest.date !== expected.date || !/^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/.test(latest.reportId) || latest.status !== 'available') throw new Error('Yesterday’s complete report is unavailable; do not analyze an older report as yesterday')
  const directory = resolve(root, latest.reportId)
  const pack = JSON.parse(await readFile(resolve(directory, 'analysis-input.json'), 'utf8'))
  if (pack.window.date !== expected.date || pack.window.timezone !== expected.timezone || pack.unavailableReason) throw new Error('Prepared report identity or timezone mismatch')
  const report = JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8'))
  if (pack.reportId !== latest.reportId || report.reportId !== latest.reportId || report.status !== 'available'
      || report.window?.since !== expected.since || report.window?.until !== expected.until
      || report.analysisInputDigest !== digest(pack)) throw new Error('Prepared report digest or identity mismatch; do not analyze altered statistics')
  console.log(JSON.stringify({ directory, analysisInput: pack, inputDigest: report.analysisInputDigest ?? null, analysisSchema: dailyAnalysisSchema(pack,report.analysisInputDigest), analysisOutput: resolve(directory, 'analysis-submission.json'), completionCommand: 'eval:daily analysis --report <directory> --input <analysis-submission.json>' }, null, 2))
} else {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    if (!['--config', '--date', '--trace'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Invalid or repeated option')
    options[args[index]] = args[index + 1]
  }
  if (!options['--config']) throw new Error('--config is required')
  const config = JSON.parse(await readFile(resolve(options['--config']), 'utf8'))
  const result = await runDaily({ ...config, date: options['--date'], exportTrace: async params => {
    if (options['--trace']) return JSON.parse(await readFile(resolve(options['--trace']), 'utf8'))
    if (!config.cli) throw new Error('No local Rovai CLI configured')
    // The CLI remains a user operation; managed Agents consume a prepared report.
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'rovai-trace-export-'))
    const argv = ['app', 'trace', 'export', '--since', params.since, '--until', params.until, '--output', join(root, 'export'), '--json']
    for (const [key, flag] of [['campIds', '--camp-id'], ['excludeCampIds', '--exclude-camp-id'], ['excludeAutomationIds', '--exclude-automation-id']]) for (const id of params[key]) argv.push(flag, id)
    try {
      const execution = await runCaptured(config.cli, argv, { timeoutMs: 60_000 })
      if (execution.code !== 0 || execution.timedOut) throw new Error(`Trace export unavailable (exit ${execution.code}); check the local App and user CLI boundary`)
      return JSON.parse(await readFile(join(root, 'export', 'trace.json'), 'utf8'))
    } finally {
      const { rm } = await import('node:fs/promises')
      await rm(root, { recursive: true, force: true })
    }
  } })
  console.log(JSON.stringify({ directory: result.directory, status: result.report.status, reused: result.reused }, null, 2))
  if (result.report.status !== 'available') process.exitCode = 2
}
