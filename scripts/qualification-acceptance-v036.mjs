import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  canonicalJson,
  digestJson,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'
import { validateQualificationSchemaCatalog } from './lib/qualification-schema-validation.mjs'
import {
  validateV036Schema,
  validateV036SchemaCatalog
} from './lib/qualification-v036-schema-validation.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const options = parseArguments(process.argv.slice(2))
validateQualificationSchemaCatalog()
validateV036SchemaCatalog()

const publicCatalog = JSON.parse(await readFile(
  join(repositoryRoot, 'qualification', 'diagnostic', 'v0.36', 'cases.json'),
  'utf8'
))
validateV036Schema('diagnostic-case-public-catalog.schema.json', publicCatalog)
const publicPayload = Object.fromEntries(
  Object.entries(publicCatalog).filter(([key]) => key !== 'payloadDigest')
)
if (publicCatalog.payloadDigest !== `sha256:${digestJson(publicPayload)}`) {
  throw new Error('Diagnostic Case Public Catalog payload digest mismatch')
}

const legacy = await verifyStoredCaseSeal(join(repositoryRoot, 'qualification', 'demo', 'DEMO-001'))
const result = {
  ok: true,
  v034SchemaCatalog: 'valid',
  v036SchemaCatalog: 'valid',
  legacyV2Seal: legacy.seal,
  publicCases: publicCatalog.cases.map(({ caseId, caseVersion, caseSeal }) => ({
    caseId,
    caseVersion,
    caseSeal
  })),
  privateCaseAdmission: 'not_requested'
}

if (options.privateCaseRoot) {
  const directories = (await readdir(options.privateCaseRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(options.privateCaseRoot, entry.name))
  const records = []
  for (const directory of directories) {
    const record = await verifyStoredCaseSeal(directory)
    if (record.contract.manifest.schemaVersion === 3) records.push(record)
  }
  const admitted = records.map((record) => ({
    caseId: record.contract.manifest.id,
    caseVersion: record.contract.manifest.version,
    caseSeal: `sha256:${record.seal}`
  })).sort((left, right) => left.caseId.localeCompare(right.caseId))
  if (canonicalJson(admitted) !== canonicalJson(result.publicCases)) {
    throw new Error('private admitted Case identities differ from the public Case Catalog')
  }
  result.privateCaseAdmission = 'verified'
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

function parseArguments(args) {
  let privateCaseRoot = null
  while (args.length > 0) {
    const argument = args.shift()
    if (argument === '--private-case-root') privateCaseRoot = resolve(args.shift() ?? '')
    else usage()
  }
  return { privateCaseRoot }
}

function usage() {
  console.error('Usage: node scripts/qualification-acceptance-v036.mjs [--private-case-root <directory>]')
  process.exit(2)
}
