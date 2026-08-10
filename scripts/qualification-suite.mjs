import {
  parseLegacyV034Arguments,
  runLegacyV034Suite
} from './benchmark/execution/legacy-v034-runner.mjs'

const options = parseLegacyV034Arguments(process.argv.slice(2))
if (!options) usage()
process.exitCode = await runLegacyV034Suite(options)

function usage() {
  console.error('Usage: node scripts/qualification-suite.mjs --pack <private-pack> --core <packaged-core> --evidence-root <private-root> --suite-id <id> --isolation-profile <private-json> [--diagnostic-no-calibration --prior-calibration-summary <path>]')
  process.exit(2)
}
