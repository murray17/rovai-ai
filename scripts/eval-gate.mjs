import { dirname, join, resolve } from 'node:path'
import { renderGateHtml, sanitizeReportLinks } from '../packages/evaluation/src/report-html.ts'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { runWeekly } from './lib/context-weekly.mjs'
import { buildProduct, freezePlan, runPlan } from './lib/context-evaluation.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command || command === '--help') {
  console.log('Usage:\n  node scripts/eval-gate.mjs build --source <checkout> --output <new-directory>\n  node scripts/eval-gate.mjs freeze --config <json> --output <new-plan.json>\n  node scripts/eval-gate.mjs run --plan <frozen-plan.json> --output <campaign-directory>\n  node scripts/eval-gate.mjs weekly --plan <frozen-weekly-plan.json> --output <weekly-history-directory>\nWeekly configuration uses mode=weekly and the same Runner. Results never overwrite previous attempts.\n  node scripts/eval-gate.mjs render --report <existing-report.json> (HTML only; does not rescore)')
} else {
  const options = {}
  const allowed = { render: ['--report'], build: ['--source', '--output'], freeze: ['--config', '--output'], run: ['--plan', '--output'], weekly: ['--plan', '--output'] }[command]
  if (!allowed) throw new Error('Unknown evaluation command')
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Unknown, missing or repeated option')
    options[args[index]] = args[index + 1]
  }
  if (allowed.some(option => !options[option])) throw new Error('Missing required option; use --help')
  if (command === 'render') {
    const reportPath = resolve(options['--report']), directory = dirname(reportPath)
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    if (!['weekly_regression', 'context_change_gate'].includes(report.kind)) throw new Error('Expected an existing regression report')
    const temporary = join(directory, `.render-${Date.now()}.html`)
    await writeFile(temporary, await sanitizeReportLinks(directory, renderGateHtml(report)), { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(directory, 'report.html'))
    console.log(JSON.stringify({ html: join(directory, 'report.html'), rescored: false }))
  }
  if (command === 'build') {
    const product = await buildProduct(options['--source'], options['--output'])
    console.log(JSON.stringify({ core: product.core, coreDigest: product.coreDigest, sourceCommit: product.source.commit, sourceDigest: product.source.contentDigest }, null, 2))
  }
  if (command === 'freeze') console.log(JSON.stringify(await freezePlan(JSON.parse(await readFile(options['--config'], 'utf8')), options['--output']), null, 2))
  if (command === 'run' || command === 'weekly') {
    const { directory, report } = await (command === 'weekly' ? runWeekly : runPlan)(options['--plan'], options['--output'])
    console.log(JSON.stringify({ directory, status: report.status, regressions: report.regressions.length, evidenceGaps: report.evidenceGaps.length }, null, 2))
    process.exitCode = report.status === 'passed' ? 0 : report.status === 'degraded' ? 1 : 2
  }
}
