import { resolve } from 'node:path'
import { runCurrentContractConformance } from './benchmark/execution/current-contract-runner.mjs'

const options = parseArguments(process.argv.slice(2))
if (!options) usage()
const result = await runCurrentContractConformance(options)
console.log(JSON.stringify({
  ok: result.benchmarkRun.outcome.hardOutcome === 'pass',
  runId: result.benchmarkRun.runId,
  hardOutcome: result.benchmarkRun.outcome.hardOutcome,
  failureTaxonomy: result.benchmarkRun.outcome.failureTaxonomy,
  contentIdentityDigest: result.benchmarkRun.integrity.contentIdentityDigest,
  outputDirectory: options.outputDirectory
}, null, 2))
if (result.benchmarkRun.outcome.hardOutcome !== 'pass') process.exitCode = 2

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!['--output', '--run-id', '--core', '--timeout-ms'].includes(argument)) return null
    values[argument.slice(2)] = args.shift()
  }
  const timeoutMs = values['timeout-ms'] === undefined
    ? 20 * 60 * 1000
    : Number.parseInt(values['timeout-ms'], 10)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return null
  return {
    outputDirectory: resolve(values.output ?? '.benchmark/current-contract-conformance'),
    runId: values['run-id'] ?? 'current-contract-conformance-local',
    coreExecutable: values.core ? resolve(values.core) : null,
    timeoutMs
  }
}

function usage() {
  console.error('Usage: node scripts/benchmark-current-contract.mjs [--output <directory>] [--run-id <id>] [--core <executable>] [--timeout-ms <milliseconds>]')
  process.exit(2)
}
