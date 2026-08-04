import { resolve } from 'node:path'
import { verifyQualificationEvidenceBundle } from './lib/qualification-bundle-verifier.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--evidence-dir') {
  console.error('Usage: node scripts/qualification-verify-bundle.mjs --evidence-dir <trial>')
  process.exit(2)
}

const report = await verifyQualificationEvidenceBundle(resolve(args[1]))
console.log(JSON.stringify(report, null, 2))
