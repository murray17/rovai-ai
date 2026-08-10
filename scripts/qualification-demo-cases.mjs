import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { verifyStoredCaseSeal } from './lib/qualification-common.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const demoRoot = join(repositoryRoot, 'qualification', 'demo')

export async function discoverDemoCases(root = demoRoot) {
  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && /^DEMO-[0-9]{3}$/u.test(entry.name))
    .map((entry) => join(root, entry.name))
    .sort()
}

export async function checkDemoCases(root = demoRoot) {
  const directories = await discoverDemoCases(root)
  const results = []
  for (const directory of directories) {
    const record = await verifyStoredCaseSeal(directory)
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    results.push({
      id: manifest.id,
      version: manifest.version,
      seal: record.seal,
      admissionDigest: record.admission.admissionDigest,
      requirements: manifest.requirements.length,
      publicChecks: manifest.publicChecks.length
    })
  }
  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? 'check'
  if (!['check', 'list'].includes(command)) usage()
  try {
    const results = await checkDemoCases()
    if (command === 'list') {
      console.log(JSON.stringify(results.map(({ id, version, seal }) => ({ id, version, seal })), null, 2))
    } else {
      console.log(JSON.stringify({ ok: true, caseCount: results.length, cases: results }, null, 2))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function usage() {
  console.error('Usage: node scripts/qualification-demo-cases.mjs <check|list>')
  process.exit(2)
}
