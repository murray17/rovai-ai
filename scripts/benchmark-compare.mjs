import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readBenchmarkRunV3 } from './benchmark/protocol/v3.mjs'
import { compareBenchmarkRuns } from './benchmark/evaluation/comparison.mjs'
import { renderComparisonEligibility } from './benchmark/reporting/markdown.mjs'

const options = parseArguments(process.argv.slice(2))
if (!options) usage()
const comparison = compareBenchmarkRuns(
  await readBenchmarkRunV3(options.baseline),
  await readBenchmarkRunV3(options.candidate)
)
if (options.output) {
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 })
  await writeFile(options.output, `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o600 })
  await writeFile(`${options.output}.md`, `# Benchmark Comparison\n\n${renderComparisonEligibility(comparison.axes)}\n`, { mode: 0o600 })
}
console.log(JSON.stringify(comparison, null, 2))

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!['--baseline', '--candidate', '--output'].includes(argument)) return null
    values[argument.slice(2)] = args.shift()
  }
  if (!values.baseline || !values.candidate) return null
  return {
    baseline: resolve(values.baseline),
    candidate: resolve(values.candidate),
    output: values.output ? resolve(values.output) : null
  }
}

function usage() {
  console.error('Usage: node scripts/benchmark-compare.mjs --baseline <run.json> --candidate <run.json> [--output <comparison.json>]')
  process.exit(2)
}
