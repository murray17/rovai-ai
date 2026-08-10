import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeBenchmarkArtifact } from './benchmark/adapters/registry.mjs'

const options = parseArguments(process.argv.slice(2))
if (!options) usage()
const results = []
for (const artifactPath of options.artifacts) {
  const source = JSON.parse(await readFile(artifactPath, 'utf8'))
  const normalized = normalizeBenchmarkArtifact(source, { adapterId: options.adapterId })
  results.push({
    artifact: artifactPath,
    adapterId: normalized.adapterId,
    sourceSchemaVersion: normalized.sourceSchemaVersion,
    lane: normalized.lane,
    suite: normalized.suite
  })
}
console.log(JSON.stringify({ ok: true, artifacts: results }, null, 2))

function parseArguments(args) {
  const artifacts = []
  let adapterId = null
  while (args.length > 0) {
    const argument = args.shift()
    if (argument === '--adapter') adapterId = args.shift()
    else if (argument?.startsWith('--')) return null
    else artifacts.push(resolve(argument))
  }
  return artifacts.length > 0 ? { artifacts, adapterId } : null
}

function usage() {
  console.error('Usage: node scripts/benchmark-validate.mjs [--adapter <id>] <artifact.json> [...]')
  process.exit(2)
}
