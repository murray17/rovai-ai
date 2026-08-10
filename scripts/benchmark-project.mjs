import {
  parseProtocolProjectArguments,
  projectBenchmarkProtocolRun
} from './benchmark/reporting/project-pipeline.mjs'

const options = parseProtocolProjectArguments(process.argv.slice(2))
if (!options) usage()
console.log(JSON.stringify(await projectBenchmarkProtocolRun(options), null, 2))

function usage() {
  console.error('Usage: node scripts/benchmark-project.mjs --run <benchmark-run.json> --project-path <path> [--baseline <benchmark-run.json>] [--legacy-trial-camps] [--core <path> --data-dir <path> | --no-import]')
  process.exit(2)
}
