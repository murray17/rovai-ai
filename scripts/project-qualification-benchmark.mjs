import {
  parseLegacyProjectArguments,
  projectLegacyQualificationBenchmark
} from './benchmark/reporting/project-pipeline.mjs'

const options = parseLegacyProjectArguments(process.argv.slice(2))
if (!options) usage()
console.log(JSON.stringify(await projectLegacyQualificationBenchmark(options), null, 2))

function usage() {
  console.error('Usage: node scripts/project-qualification-benchmark.mjs --trial-root <path> --suite-summary <json> --project-path <path> [--selection <json> --prior-calibration-summary <json>] [--legacy-trial-camps] [--core <path> --data-dir <path> | --no-import]')
  process.exit(2)
}
