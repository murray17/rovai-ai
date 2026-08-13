import { resolve } from 'node:path'
import {
  admitToolMeasurementPack,
  verifyToolMeasurementPack
} from './lib/qualification-tool-measurement-spec.mjs'
import { verifyStoredCaseSeal } from './lib/qualification-common.mjs'

const options = parseArguments(process.argv.slice(2))
const caseRecord = await verifyStoredCaseSeal(options.caseDirectory, options.expectedSeal)
const result = options.command === 'admit'
  ? await admitToolMeasurementPack(options.packDirectory, caseRecord)
  : (await verifyToolMeasurementPack(options.packDirectory, caseRecord)).admission
console.log(JSON.stringify({ ok: true, command: options.command, admission: result }, null, 2))

function parseArguments(args) {
  const command = args.shift()
  if (!['admit', 'verify'].includes(command)) usage()
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument?.startsWith('--')) usage()
    const key = argument.slice(2)
    if (!['pack', 'case', 'expected-seal'].includes(key)) usage()
    values[key] = args.shift()
    if (!values[key]) usage()
  }
  if (!values.pack || !values.case) usage()
  return {
    command,
    packDirectory: resolve(values.pack),
    caseDirectory: resolve(values.case),
    expectedSeal: values['expected-seal'] ?? null
  }
}

function usage() {
  console.error('Usage: node scripts/qualification-tool-measurement-pack.mjs <admit|verify> --pack <private-dir> --case <case-dir> [--expected-seal <sha256>]')
  process.exit(2)
}
